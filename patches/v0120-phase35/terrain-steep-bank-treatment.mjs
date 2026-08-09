// TPMAP_PHASE35_STEEP_BANK_TREATMENT_V1
// Improve verified natural steep-bank surface quantisation without smoothing,
// widening or inventing terrain. The native operation schema currently carries
// palette block identifiers but no per-operation block-state payload, so this
// first cut uses bottom slabs only; directional stairs remain fail-closed until
// facing/half state transport is verified end-to-end.

const TERRAIN_STRUCTURE_PHASE = 6;
const MAX_TREATMENT_CELLS = 500_000;
const SLABS = Object.freeze([
  "minecraft:normal_stone_slab",
  "minecraft:cobblestone_slab",
  "minecraft:mossy_cobblestone_slab"
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
    minFraction: bounded(options.terrainSteepBankSlabMinFraction, 0.35, 0.2, 0.49),
    maxFraction: bounded(options.terrainSteepBankSlabMaxFraction, 0.65, 0.51, 0.8),
    maxCells: Math.max(1000, Math.min(MAX_TREATMENT_CELLS, Math.floor(Number(options.terrainSteepBankTreatmentMaxCells) || MAX_TREATMENT_CELLS)))
  };

  const targets = new Map();
  let structuresVisited = 0, structuresTreated = 0, sourceCells = 0, skippedFraction = 0, skippedSlope = 0;
  for (const structure of morphology.structures || []) {
    if (structure.engineering?.classification !== "natural-steep-bank") continue;
    structuresVisited++;
    if (!Array.isArray(structure.cells) || structure.cells.length !== structure.cellCount) throw new Error(`Phase 35 steep-bank treatment requires exact cells for ${structure.id}`);
    let treatedThisStructure = false;
    const step = Math.max(1, Math.round(Number(structure.sampleStepM) || 1));
    const minDx = -Math.floor(step / 2), maxDx = minDx + step - 1;
    const minDz = -Math.floor(step / 2), maxDz = minDz + step - 1;
    for (const cell of structure.cells) {
      sourceCells++;
      if (![cell.x, cell.z, cell.elevationM, cell.slopeDeg].every(Number.isFinite)) continue;
      if (cell.slopeDeg < cfg.minSlopeDeg) { skippedSlope++; continue; }
      const localHeight = Number(cell.elevationM) - datumM;
      const baseY = Math.floor(localHeight);
      const fraction = localHeight - baseY;
      if (fraction < cfg.minFraction || fraction > cfg.maxFraction) { skippedFraction++; continue; }
      for (let dx=minDx; dx<=maxDx; dx++) for (let dz=minDz; dz<=maxDz; dz++) {
        const x=Math.round(cell.x)+dx,z=Math.round(cell.z)+dz,key=`${x}:${baseY}:${z}`;
        targets.set(key,{x,y:baseY,z,structureId:structure.id,slopeDeg:cell.slopeDeg,fraction});
        if (targets.size > cfg.maxCells) throw new Error(`Phase 35 steep-bank treatment exceeded safe cell cap ${cfg.maxCells}`);
      }
      treatedThisStructure = true;
    }
    if (treatedThisStructure) structuresTreated++;
  }

  if (!targets.size) return noOp(datumM, cfg, structuresVisited, sourceCells, skippedFraction, skippedSlope);

  const before = countOps(compilation);
  const paletteIndexes = new Map();
  for (const target of targets.values()) {
    const block = chooseSlab(target);
    if (!paletteIndexes.has(block)) paletteIndexes.set(block, ensurePalette(compilation, block));
    target.paletteIndex = paletteIndexes.get(block);
  }
  emit(compilation, targets);
  for (const chunk of compilation.chunks) chunk.o.sort(compareOps);
  compilation.chunks = compilation.chunks.filter(c=>c.o.length).sort((a,b)=>a.z-b.z||a.x-b.x);
  const after = countOps(compilation);

  const diagnostics = {
    marker:"TPMAP_PHASE35_STEEP_BANK_TREATMENT_V1",
    status:"applied",
    phase:TERRAIN_STRUCTURE_PHASE,
    datumM,
    structuresVisited,
    structuresTreated,
    sourceCells,
    treatedVoxels:targets.size,
    skippedFraction,
    skippedSlope,
    emittedOperations:after-before,
    stairsDeferred:true,
    stateTransport:"plain-block-id-only-observed;directional-stairs-not-emitted",
    config:cfg,
    policy:"natural-steep-bank-only;exact-morphology-footprints;half-block-quantisation-only;no-smoothing;no-widening;no-air"
  };
  compilation.meta.steepBankTreatment = diagnostics;
  const stats = compilation.stats || (compilation.stats = {});
  stats.operations = after; stats.rawOperations = after; stats.chunks = compilation.chunks.length;
  stats.steepBankTreatmentVoxels = targets.size;
  return diagnostics;
}

export function validateSteepBankTreatmentCompilation(compilation, diagnostics) {
  if (!diagnostics || diagnostics.marker !== "TPMAP_PHASE35_STEEP_BANK_TREATMENT_V1") throw new Error("Phase 35 steep-bank treatment diagnostics missing");
  if (diagnostics.status === "no-op") return compilation;
  validateCompilation(compilation);
  if (!diagnostics.stairsDeferred) throw new Error("Phase 35 steep-bank treatment must keep directional stairs deferred until block states are supported");
  let slabOps = 0;
  for (const chunk of compilation.chunks) for (const op of chunk.o) {
    if (op[0] !== TERRAIN_STRUCTURE_PHASE) continue;
    const block = compilation.palette[op[7]];
    if (SLABS.includes(block)) slabOps += 1;
    if (block === "minecraft:air") throw new Error("Phase 35 steep-bank treatment emitted forbidden air operation");
  }
  if (slabOps < diagnostics.emittedOperations) throw new Error("Phase 35 steep-bank treatment lost emitted slab operations");
  return compilation;
}

function chooseSlab(target) {
  const h=hash(`${target.structureId}:${target.x}:${target.y}:${target.z}`)%100;
  return h<55?SLABS[0]:h<85?SLABS[1]:SLABS[2];
}
function emit(c,targets){const chunks=new Map(c.chunks.map(ch=>[`${ch.x},${ch.z}`,ch]));for(const v of targets.values()){const cx=Math.floor(v.x/16),cz=Math.floor(v.z/16),key=`${cx},${cz}`;let ch=chunks.get(key);if(!ch){ch={x:cx,z:cz,o:[]};c.chunks.push(ch);chunks.set(key,ch);}ch.o.push([TERRAIN_STRUCTURE_PHASE,v.x,v.y,v.z,v.x,v.y,v.z,v.paletteIndex]);}}
function ensurePalette(c,n){let i=c.palette.indexOf(n);if(i<0){i=c.palette.length;c.palette.push(n);}return i;}
function validateCompilation(c){if(!c||!c.meta||!Array.isArray(c.palette)||!Array.isArray(c.chunks))throw new Error("Phase 35 steep-bank treatment rejected unsupported compilation schema");for(const ch of c.chunks){if(!Number.isInteger(ch?.x)||!Number.isInteger(ch?.z)||!Array.isArray(ch.o))throw new Error("Phase 35 steep-bank treatment rejected malformed chunk schema");for(const op of ch.o)if(!Array.isArray(op)||op.length!==8||!op.slice(0,7).every(Number.isFinite)||!Number.isInteger(op[7])||op[7]<0||op[7]>=c.palette.length)throw new Error("Phase 35 steep-bank treatment rejected malformed native operation");}}
function noOp(datumM,cfg,structuresVisited,sourceCells,skippedFraction,skippedSlope){return{marker:"TPMAP_PHASE35_STEEP_BANK_TREATMENT_V1",status:"no-op",phase:TERRAIN_STRUCTURE_PHASE,datumM,structuresVisited,structuresTreated:0,sourceCells,treatedVoxels:0,skippedFraction,skippedSlope,emittedOperations:0,stairsDeferred:true,stateTransport:"plain-block-id-only-observed;directional-stairs-not-emitted",config:cfg,policy:"no-safe-half-block-steep-bank-candidates-exact-no-op"};}
function compareOps(a,b){return a[0]-b[0]||a[3]-b[3]||a[2]-b[2]||a[1]-b[1];}function countOps(c){return c.chunks.reduce((n,ch)=>n+ch.o.length,0);}function bounded(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;}function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
