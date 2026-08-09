// TPMAP_PHASE35_STEEP_BANK_TREATMENT_V2
// Improve verified natural steep-bank surface quantisation without smoothing or
// widening. Stateful stairs are emitted only for cardinal-dominant DTM normals;
// ambiguous/diagonal surfaces keep the proven half-block slab treatment.

const TERRAIN_STRUCTURE_PHASE = 6;
const MAX_TREATMENT_CELLS = 500_000;
const SLABS = Object.freeze([
  "minecraft:normal_stone_slab",
  "minecraft:cobblestone_slab",
  "minecraft:mossy_cobblestone_slab"
]);
const STAIRS = Object.freeze([
  "minecraft:normal_stone_stairs",
  "minecraft:stone_stairs",
  "minecraft:mossy_cobblestone_stairs"
]);

export function applySteepBankTreatmentToCompilation(compilation, graph, options = {}) {
  validateCompilation(compilation);
  const morphology = graph?.terrainMorphology;
  const association = graph?.terrainPlanningAssociation;
  if (!morphology || morphology.marker !== "TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1") throw new Error("Phase 35 steep-bank treatment requires morphology model");
  if (!association || association.marker !== "TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1") throw new Error("Phase 35 steep-bank treatment requires planning association model");
  const datumM = Number(compilation.meta.elevationDatumM);
  if (!Number.isFinite(datumM)) throw new Error("Phase 35 steep-bank treatment requires finite elevation datum");

  const cfg = {
    minSlopeDeg: bounded(options.terrainSteepBankTreatmentMinSlopeDeg, 35, 20, 65),
    maxStairSlopeDeg: bounded(options.terrainSteepBankStairMaxSlopeDeg, 58, 35, 70),
    minFraction: bounded(options.terrainSteepBankSlabMinFraction, 0.35, 0.2, 0.49),
    maxFraction: bounded(options.terrainSteepBankSlabMaxFraction, 0.65, 0.51, 0.8),
    stairMinFraction: bounded(options.terrainSteepBankStairMinFraction, 0.25, 0.1, 0.49),
    stairMaxFraction: bounded(options.terrainSteepBankStairMaxFraction, 0.75, 0.51, 0.9),
    cardinalConfidence: bounded(options.terrainSteepBankCardinalConfidence, 0.82, 0.7, 0.99),
    maxCells: Math.max(1000, Math.min(MAX_TREATMENT_CELLS, Math.floor(Number(options.terrainSteepBankTreatmentMaxCells) || MAX_TREATMENT_CELLS)))
  };

  const targets = new Map();
  let structuresVisited=0,structuresTreated=0,sourceCells=0,skippedFraction=0,skippedSlope=0,skippedDirection=0;
  for (const structure of morphology.structures || []) {
    if (structure.engineering?.classification !== "natural-steep-bank") continue;
    structuresVisited++;
    if (!Array.isArray(structure.cells) || structure.cells.length !== structure.cellCount) throw new Error(`Phase 35 steep-bank treatment requires exact cells for ${structure.id}`);
    let treatedThisStructure=false;
    const step=Math.max(1,Math.round(Number(structure.sampleStepM)||1));
    const minDx=-Math.floor(step/2),maxDx=minDx+step-1,minDz=-Math.floor(step/2),maxDz=minDz+step-1;
    for (const cell of structure.cells) {
      sourceCells++;
      if (![cell.x,cell.z,cell.elevationM,cell.slopeDeg].every(Number.isFinite)) continue;
      if (cell.slopeDeg < cfg.minSlopeDeg) { skippedSlope++; continue; }
      const localHeight=Number(cell.elevationM)-datumM,baseY=Math.floor(localHeight),fraction=localHeight-baseY;
      const stairDirection=cell.slopeDeg<=cfg.maxStairSlopeDeg ? ascentDirection(cell.normal,cfg.cardinalConfidence) : null;
      let mode=null;
      if(stairDirection!==null && fraction>=cfg.stairMinFraction && fraction<=cfg.stairMaxFraction) mode='stair';
      else if(fraction>=cfg.minFraction && fraction<=cfg.maxFraction) mode='slab';
      else { skippedFraction++; if(stairDirection===null)skippedDirection++; continue; }
      for(let dx=minDx;dx<=maxDx;dx++)for(let dz=minDz;dz<=maxDz;dz++){
        const x=Math.round(cell.x)+dx,z=Math.round(cell.z)+dz,key=`${x}:${baseY}:${z}`;
        targets.set(key,{x,y:baseY,z,structureId:structure.id,slopeDeg:cell.slopeDeg,fraction,mode,weirdoDirection:stairDirection});
        if(targets.size>cfg.maxCells)throw new Error(`Phase 35 steep-bank treatment exceeded safe cell cap ${cfg.maxCells}`);
      }
      treatedThisStructure=true;
    }
    if(treatedThisStructure)structuresTreated++;
  }
  if(!targets.size)return noOp(datumM,cfg,structuresVisited,sourceCells,skippedFraction,skippedSlope,skippedDirection);

  const before=countOps(compilation),paletteIndexes=new Map();
  let stairsEmitted=0,slabsEmitted=0;
  for(const target of targets.values()){
    const block=target.mode==='stair'?chooseStair(target):chooseSlab(target);
    const spec=target.mode==='stair'?{name:block,states:{upside_down_bit:false,weirdo_direction:target.weirdoDirection}}:block;
    const paletteIndex=ensurePalette(compilation,spec,paletteIndexes);
    target.paletteIndex=paletteIndex;
    if(target.mode==='stair')stairsEmitted++;else slabsEmitted++;
  }
  emit(compilation,targets);
  for(const chunk of compilation.chunks)chunk.o.sort(compareOps);
  compilation.chunks=compilation.chunks.filter(c=>c.o.length).sort((a,b)=>a.z-b.z||a.x-b.x);
  const after=countOps(compilation);
  const diagnostics={marker:"TPMAP_PHASE35_STEEP_BANK_TREATMENT_V2",status:"applied",phase:TERRAIN_STRUCTURE_PHASE,datumM,structuresVisited,structuresTreated,sourceCells,treatedVoxels:targets.size,stairsEmitted,slabsEmitted,skippedFraction,skippedSlope,skippedDirection,emittedOperations:after-before,stairsDeferred:false,stateTransport:"stateful-palette-v1;direct-mcworld-nbt+addon-blockpermutation",config:cfg,policy:"natural-steep-bank-only;dtm-normal-directed-cardinal-stairs;diagonal-falls-back-to-slab;exact-footprints;no-smoothing;no-widening;no-air"};
  compilation.meta.steepBankTreatment=diagnostics;
  const stats=compilation.stats||(compilation.stats={});stats.operations=after;stats.rawOperations=after;stats.chunks=compilation.chunks.length;stats.steepBankTreatmentVoxels=targets.size;stats.steepBankStairs=stairsEmitted;stats.steepBankSlabs=slabsEmitted;
  return diagnostics;
}

export function validateSteepBankTreatmentCompilation(compilation, diagnostics) {
  if (!diagnostics || !["TPMAP_PHASE35_STEEP_BANK_TREATMENT_V1","TPMAP_PHASE35_STEEP_BANK_TREATMENT_V2"].includes(diagnostics.marker)) throw new Error("Phase 35 steep-bank treatment diagnostics missing");
  if (diagnostics.status === "no-op") return compilation;
  validateCompilation(compilation);
  let stairOps=0,slabOps=0;
  for(const chunk of compilation.chunks)for(const op of chunk.o){
    if(op[0]!==TERRAIN_STRUCTURE_PHASE)continue;
    const spec=compilation.palette[op[7]];
    if(typeof spec==='string'&&SLABS.includes(spec))slabOps++;
    if(isStairSpec(spec)){stairOps++;if(spec.states.upside_down_bit!==false||![0,1,2,3].includes(spec.states.weirdo_direction))throw new Error("Phase 35 steep-bank stair has invalid state payload");}
    if(spec==='minecraft:air'||spec?.name==='minecraft:air')throw new Error("Phase 35 steep-bank treatment emitted forbidden air operation");
  }
  if(stairOps<diagnostics.stairsEmitted||slabOps<diagnostics.slabsEmitted)throw new Error("Phase 35 steep-bank treatment lost emitted surface operations");
  return compilation;
}

// DTM cell.normal horizontal components are -gradient, therefore downhill.
// Stairs are encoded by ascent direction: 0 east, 1 west, 2 south, 3 north.
function ascentDirection(normal,minConfidence){
  const nx=Number(normal?.x),nz=Number(normal?.z);if(!Number.isFinite(nx)||!Number.isFinite(nz))return null;
  const length=Math.hypot(nx,nz);if(length<1e-6)return null;
  const uphillX=-nx,uphillZ=-nz,ax=Math.abs(uphillX),az=Math.abs(uphillZ),confidence=Math.max(ax,az)/length;
  if(confidence<minConfidence)return null;
  if(ax>=az)return uphillX>=0?0:1;
  return uphillZ>=0?2:3;
}
function isStairSpec(v){return Boolean(v&&typeof v==='object'&&STAIRS.includes(v.name)&&v.states&&typeof v.states==='object');}
function chooseSlab(t){const h=hash(`${t.structureId}:${t.x}:${t.y}:${t.z}`)%100;return h<55?SLABS[0]:h<85?SLABS[1]:SLABS[2];}
function chooseStair(t){const h=hash(`stair:${t.structureId}:${t.x}:${t.y}:${t.z}`)%100;return h<55?STAIRS[0]:h<85?STAIRS[1]:STAIRS[2];}
function emit(c,targets){const chunks=new Map(c.chunks.map(ch=>[`${ch.x},${ch.z}`,ch]));for(const v of targets.values()){const cx=Math.floor(v.x/16),cz=Math.floor(v.z/16),key=`${cx},${cz}`;let ch=chunks.get(key);if(!ch){ch={x:cx,z:cz,o:[]};c.chunks.push(ch);chunks.set(key,ch);}ch.o.push([TERRAIN_STRUCTURE_PHASE,v.x,v.y,v.z,v.x,v.y,v.z,v.paletteIndex]);}}
function descriptorKey(v){return typeof v==='string'?`s:${v}`:`o:${JSON.stringify(v)}`;}
function ensurePalette(c,n,cache){const key=descriptorKey(n);if(cache.has(key))return cache.get(key);let i=c.palette.findIndex(v=>descriptorKey(v)===key);if(i<0){i=c.palette.length;c.palette.push(n);}cache.set(key,i);return i;}
function validateCompilation(c){if(!c||!c.meta||!Array.isArray(c.palette)||!Array.isArray(c.chunks))throw new Error("Phase 35 steep-bank treatment rejected unsupported compilation schema");for(const ch of c.chunks){if(!Number.isInteger(ch?.x)||!Number.isInteger(ch?.z)||!Array.isArray(ch.o))throw new Error("Phase 35 steep-bank treatment rejected malformed chunk schema");for(const op of ch.o)if(!Array.isArray(op)||op.length!==8||!op.slice(0,7).every(Number.isFinite)||!Number.isInteger(op[7])||op[7]<0||op[7]>=c.palette.length)throw new Error("Phase 35 steep-bank treatment rejected malformed native operation");}}
function noOp(datumM,cfg,structuresVisited,sourceCells,skippedFraction,skippedSlope,skippedDirection){return{marker:"TPMAP_PHASE35_STEEP_BANK_TREATMENT_V2",status:"no-op",phase:TERRAIN_STRUCTURE_PHASE,datumM,structuresVisited,structuresTreated:0,sourceCells,treatedVoxels:0,stairsEmitted:0,slabsEmitted:0,skippedFraction,skippedSlope,skippedDirection,emittedOperations:0,stairsDeferred:false,stateTransport:"stateful-palette-v1",config:cfg,policy:"no-safe-steep-bank-surface-candidates-exact-no-op"};}
function compareOps(a,b){return a[0]-b[0]||a[3]-b[3]||a[2]-b[2]||a[1]-b[1];}function countOps(c){return c.chunks.reduce((n,ch)=>n+ch.o.length,0);}function bounded(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;}function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
