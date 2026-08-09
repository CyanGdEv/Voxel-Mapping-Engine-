// TPMAP_PHASE35_TERRAIN_STRUCTURE_COMPILER_V1
// Compile only verified Phase 35 terrain structures into native Bedrock operations.
// Ordinary heightfield terrain remains untouched. Phase 6 intentionally precedes
// ride excavation (7), supports/portals (8) and track (9).

const TERRAIN_STRUCTURE_PHASE = 6;
const MAX_VOXELS = 2_000_000;
const COMPILABLE = new Set(["natural-rock-face","natural-terrace-break","retaining-wall","cutting","embankment","engineered-terrace"]);
const PALETTES = Object.freeze({
  "natural-rock-face":["minecraft:stone","minecraft:andesite","minecraft:cobblestone","minecraft:mossy_cobblestone"],
  "natural-terrace-break":["minecraft:stone","minecraft:andesite","minecraft:dirt"],
  "retaining-wall":["minecraft:stone_bricks","minecraft:andesite","minecraft:cobblestone"],
  "cutting":["minecraft:stone","minecraft:andesite","minecraft:dirt"],
  "embankment":["minecraft:dirt","minecraft:coarse_dirt","minecraft:stone"],
  "engineered-terrace":["minecraft:stone_bricks","minecraft:smooth_stone","minecraft:andesite"]
});

export function applyTerrainStructuresToCompilation(compilation, graph, options = {}) {
  validateCompilation(compilation);
  const morphology = graph?.terrainMorphology;
  const association = graph?.terrainPlanningAssociation;
  if (!morphology || morphology.marker !== "TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1") throw new Error("Phase 35 terrain compiler requires morphology model");
  if (!association || association.marker !== "TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1") throw new Error("Phase 35 terrain compiler requires planning association model");
  const datumM = Number(compilation.meta.elevationDatumM);
  if (!Number.isFinite(datumM)) throw new Error("Phase 35 terrain compiler requires finite elevation datum");
  const maxColumnHeight = bounded(options.terrainStructureMaxColumnHeightM, 64, 1, 128);
  const voxels = collectVoxels(morphology.structures || [], datumM, maxColumnHeight);
  if (voxels.size === 0) return noOp(datumM);
  if (voxels.size > MAX_VOXELS) throw new Error(`Phase 35 terrain compiler exceeded safe voxel cap ${MAX_VOXELS}`);
  const before = countOps(compilation);
  const materialIndexes = new Map();
  for (const voxel of voxels.values()) {
    const block = chooseBlock(voxel.classification, voxel.x, voxel.y, voxel.z);
    if (!materialIndexes.has(block)) materialIndexes.set(block, ensurePalette(compilation, block));
    voxel.paletteIndex = materialIndexes.get(block);
  }
  const emittedOperations = emit(compilation, voxels);
  for (const chunk of compilation.chunks) chunk.o.sort(compareOps);
  compilation.chunks = compilation.chunks.filter(c => c.o.length).sort((a,b)=>a.z-b.z||a.x-b.x);
  const after = countOps(compilation);
  const byClass = {};
  for (const v of voxels.values()) byClass[v.classification] = (byClass[v.classification] || 0) + 1;
  const diagnostics = { marker:"TPMAP_PHASE35_TERRAIN_STRUCTURE_COMPILER_V1", status:"applied", phase:TERRAIN_STRUCTURE_PHASE, datumM, voxels:voxels.size, emittedOperations, netOperationDelta:after-before, byClass, policy:"exact-morphology-cells-only;phase6-before-excavation;ordinary-heightfield-unchanged" };
  compilation.meta.terrainStructureCompilation = diagnostics;
  const stats = compilation.stats || (compilation.stats = {});
  stats.operations = after; stats.rawOperations = after; stats.chunks = compilation.chunks.length;
  stats.terrainStructureVoxels = voxels.size; stats.terrainStructureOperations = emittedOperations;
  return diagnostics;
}

export function validateTerrainStructureCompilation(compilation, diagnostics) {
  if (!diagnostics || diagnostics.marker !== "TPMAP_PHASE35_TERRAIN_STRUCTURE_COMPILER_V1") throw new Error("Phase 35 terrain compilation diagnostics missing");
  if (diagnostics.status === "no-op") return compilation;
  validateCompilation(compilation);
  let blocks = 0;
  for (const chunk of compilation.chunks) for (const op of chunk.o) if (op[0] === TERRAIN_STRUCTURE_PHASE) blocks += volume(op);
  if (blocks < diagnostics.voxels) throw new Error("Phase 35 terrain compiler lost verified structure voxels");
  for (const chunk of compilation.chunks) {
    for (const op of chunk.o) {
      if (op[0] !== TERRAIN_STRUCTURE_PHASE) continue;
      const block = compilation.palette[op[7]];
      if (!Object.values(PALETTES).flat().includes(block)) throw new Error(`Phase 35 terrain compiler emitted unsupported block ${block}`);
    }
  }
  return compilation;
}

function collectVoxels(structures, datumM, maxColumnHeight) {
  const out = new Map();
  for (const structure of structures) {
    const classification = structure.engineering?.classification;
    if (!COMPILABLE.has(classification)) continue;
    if (!Array.isArray(structure.cells) || structure.cells.length !== structure.cellCount) throw new Error(`Phase 35 terrain compiler requires exact cells for ${structure.id}`);
    const step = Math.max(1, Math.round(Number(structure.sampleStepM) || 1));
    for (const cell of structure.cells) {
      if (![cell.x,cell.z,cell.localMinElevationM,cell.localMaxElevationM].every(Number.isFinite)) continue;
      let y1 = Math.round(cell.localMinElevationM - datumM), y2 = Math.round(cell.localMaxElevationM - datumM);
      if (y2 < y1) [y1,y2] = [y2,y1];
      if (y2 - y1 < 1) continue;
      if (y2 - y1 + 1 > maxColumnHeight) y1 = y2 - maxColumnHeight + 1;
      const minDx = -Math.floor(step/2), maxDx = minDx + step - 1;
      const minDz = -Math.floor(step/2), maxDz = minDz + step - 1;
      for (let dx=minDx; dx<=maxDx; dx++) for (let dz=minDz; dz<=maxDz; dz++) for (let y=y1; y<=y2; y++) {
        const x=Math.round(cell.x)+dx,z=Math.round(cell.z)+dz,key=`${x},${y},${z}`;
        const current=out.get(key),candidate={x,y,z,classification,structureId:structure.id,priority:priority(classification)};
        if(!current||candidate.priority>current.priority) out.set(key,candidate);
      }
    }
  }
  return out;
}
function priority(c){return c==="retaining-wall"?60:c==="engineered-terrace"?55:c==="cutting"?50:c==="embankment"?45:c==="natural-rock-face"?30:20;}
function chooseBlock(classification,x,y,z){const list=PALETTES[classification];const h=hash(`${classification}:${x}:${y}:${z}`)%100;if(classification==="natural-rock-face")return h<45?list[0]:h<75?list[1]:h<90?list[2]:list[3];if(classification==="retaining-wall")return h<70?list[0]:h<88?list[1]:list[2];if(classification==="embankment")return h<70?list[0]:h<90?list[1]:list[2];return list[h%list.length];}
function emit(c,voxels){const chunks=new Map(c.chunks.map(ch=>[`${ch.x},${ch.z}`,ch])),groups=new Map();for(const v of voxels.values()){const cx=Math.floor(v.x/16),cz=Math.floor(v.z/16),g=`${cx}:${cz}:${v.paletteIndex}:${v.y}:${v.z}`;if(!groups.has(g))groups.set(g,{cx,cz,p:v.paletteIndex,y:v.y,z:v.z,xs:[]});groups.get(g).xs.push(v.x);}let ops=0;for(const g of groups.values()){g.xs.sort((a,b)=>a-b);let s=g.xs[0],p=s;for(let i=1;i<=g.xs.length;i++){const x=g.xs[i];if(x===p+1){p=x;continue;}const ck=`${g.cx},${g.cz}`;let ch=chunks.get(ck);if(!ch){ch={x:g.cx,z:g.cz,o:[]};c.chunks.push(ch);chunks.set(ck,ch);}ch.o.push([TERRAIN_STRUCTURE_PHASE,s,g.y,g.z,p,g.y,g.z,g.p]);ops++;s=x;p=x;}}return ops;}
function ensurePalette(c,n){let i=c.palette.indexOf(n);if(i<0){i=c.palette.length;c.palette.push(n);}return i;}
function validateCompilation(c){if(!c||!c.meta||!Array.isArray(c.palette)||!Array.isArray(c.chunks))throw new Error("Phase 35 terrain compiler rejected unsupported compilation schema");for(const ch of c.chunks){if(!Number.isInteger(ch?.x)||!Number.isInteger(ch?.z)||!Array.isArray(ch.o))throw new Error("Phase 35 terrain compiler rejected malformed chunk schema");for(const op of ch.o)if(!Array.isArray(op)||op.length!==8||!op.slice(0,7).every(Number.isFinite)||!Number.isInteger(op[7])||op[7]<0||op[7]>=c.palette.length)throw new Error("Phase 35 terrain compiler rejected malformed native operation");}}
function noOp(datumM){return{marker:"TPMAP_PHASE35_TERRAIN_STRUCTURE_COMPILER_V1",status:"no-op",phase:TERRAIN_STRUCTURE_PHASE,datumM,voxels:0,emittedOperations:0,netOperationDelta:0,byClass:{},policy:"no-verified-compilable-terrain-structures-exact-no-op"};}
function compareOps(a,b){return a[0]-b[0]||a[3]-b[3]||a[2]-b[2]||a[1]-b[1];}function countOps(c){return c.chunks.reduce((n,ch)=>n+ch.o.length,0);}function volume(op){return(Math.abs(op[4]-op[1])+1)*(Math.abs(op[5]-op[2])+1)*(Math.abs(op[6]-op[3])+1);}function bounded(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):f;}function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
