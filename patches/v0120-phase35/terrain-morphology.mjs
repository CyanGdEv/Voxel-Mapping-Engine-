// TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1
// Classify bare-earth DTM morphology without altering source terrain.
// Missing DTM stays unresolved; no OSM-derived world geometry is accepted.

const DEFAULT_STEP_M = 2;
const DEFAULT_STEEP_DEG = 35;
const DEFAULT_CLIFF_DEG = 60;
const DEFAULT_BREAK_M = 1.5;
const MAX_SAMPLES = 250000;

export function classifyTerrainMorphology(graph, sources = null, options = {}) {
  if (!graph || !Array.isArray(graph.nodes)) throw new Error("Phase 35 terrain morphology requires reconstruction graph");
  const dtm = resolveDtm(sources?.elevation || sources?.lidar || sources);
  const bounds = graphBounds(graph);
  const stepM = bounded(options.terrainMorphologyStepM, DEFAULT_STEP_M, 1, 8);
  const steepDeg = bounded(options.terrainSteepSlopeDeg, DEFAULT_STEEP_DEG, 15, 70);
  const cliffDeg = bounded(options.terrainCliffSlopeDeg, DEFAULT_CLIFF_DEG, steepDeg + 1, 88);
  const breakM = bounded(options.terrainBreakReliefM, DEFAULT_BREAK_M, 0.25, 12);
  const diagnostics = { marker:"TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1", stepM, sampled:0, unresolved:0, level:0, slope:0, steepBank:0, cliffFace:0, terraceBreak:0, structureGroups:0, source:dtm?.source||null, policy:"bare-earth-dtm-only;classification-does-not-mutate-terrain" };
  if (!dtm || !bounds) {
    diagnostics.unresolved = 1;
    const result = { marker:diagnostics.marker, status:"unresolved", diagnostics, cells:[], structures:[] };
    Object.defineProperty(graph,"terrainMorphology",{enumerable:false,configurable:true,value:result});
    graph.summary={...(graph.summary||{}),terrainMorphology:diagnostics}; return diagnostics;
  }
  const width=Math.max(1,Math.floor((bounds.maxX-bounds.minX)/stepM)+1),depth=Math.max(1,Math.floor((bounds.maxZ-bounds.minZ)/stepM)+1);
  if(width*depth>MAX_SAMPLES) throw new Error(`Phase 35 terrain morphology exceeded safe sample cap ${MAX_SAMPLES}`);
  const cells=[],byKey=new Map();
  for(let iz=0;iz<depth;iz++){const z=bounds.minZ+iz*stepM;for(let ix=0;ix<width;ix++){const x=bounds.minX+ix*stepM;const c=classifyCell(x,z,stepM,dtm.sample,steepDeg,cliffDeg,breakM);c.ix=ix;c.iz=iz;cells.push(c);byKey.set(`${ix}:${iz}`,c);diagnostics.sampled++;if(c.status==="unresolved")diagnostics.unresolved++;else if(c.classification==="level")diagnostics.level++;else if(c.classification==="slope")diagnostics.slope++;else if(c.classification==="steep-bank")diagnostics.steepBank++;else if(c.classification==="cliff-face")diagnostics.cliffFace++;else if(c.classification==="terrace-break")diagnostics.terraceBreak++;}}
  const structures=groupStructures(cells,byKey,stepM);diagnostics.structureGroups=structures.length;
  const result={marker:diagnostics.marker,status:diagnostics.sampled>diagnostics.unresolved?"resolved":"unresolved",bounds,stepM,cells,structures,diagnostics,policy:"dtm-derived-morphology-only;explicit-structures-remain-separate-from-heightfield"};
  Object.defineProperty(graph,"terrainMorphology",{enumerable:false,configurable:true,value:result});graph.summary={...(graph.summary||{}),terrainMorphology:diagnostics};return diagnostics;
}

export function validateTerrainMorphology(graph){const model=graph?.terrainMorphology,diag=graph?.summary?.terrainMorphology;if(!model||!diag||diag.marker!=="TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1")throw new Error("Phase 35 terrain morphology diagnostics missing");for(const cell of model.cells||[]){if(cell.status==="resolved"){for(const v of [cell.x,cell.z,cell.elevationM,cell.slopeDeg,cell.localReliefM,cell.localMinElevationM,cell.localMaxElevationM])if(!Number.isFinite(v))throw new Error("Phase 35 terrain morphology contains invalid resolved cell");if(!["level","slope","steep-bank","cliff-face","terrace-break"].includes(cell.classification))throw new Error(`Phase 35 invalid terrain class ${cell.classification}`);}}for(const s of model.structures||[]){if(!["steep-bank","cliff-face","terrace-break"].includes(s.type))throw new Error(`Phase 35 invalid terrain structure ${s.type}`);if(!(s.cellCount>0)||!Array.isArray(s.cells)||s.cells.length!==s.cellCount)throw new Error("Phase 35 terrain structure exact cell set missing");}return model;}

function classifyCell(x,z,step,sample,steepDeg,cliffDeg,breakM){const c=finite(sample(x,z)),e=finite(sample(x+step,z)),w=finite(sample(x-step,z)),n=finite(sample(x,z-step)),s=finite(sample(x,z+step));if([c,e,w,n,s].some(v=>v===null))return{status:"unresolved",x:round3(x),z:round3(z),elevationM:null,slopeDeg:null,localReliefM:null,localMinElevationM:null,localMaxElevationM:null,classification:"unresolved"};const dzdx=(e-w)/(2*step),dzdz=(s-n)/(2*step),slopeDeg=Math.atan(Math.hypot(dzdx,dzdz))*180/Math.PI,localMin=Math.min(c,e,w,n,s),localMax=Math.max(c,e,w,n,s),relief=localMax-localMin,laplacian=Math.abs((e+w+n+s)-4*c);let classification="level";if(slopeDeg>=cliffDeg)classification="cliff-face";else if(slopeDeg>=steepDeg)classification="steep-bank";else if(laplacian>=breakM&&slopeDeg>=8)classification="terrace-break";else if(slopeDeg>=8)classification="slope";return{status:"resolved",x:round3(x),z:round3(z),elevationM:round3(c),slopeDeg:round3(slopeDeg),localReliefM:round3(relief),localMinElevationM:round3(localMin),localMaxElevationM:round3(localMax),breakStrengthM:round3(laplacian),classification,normal:{x:round3(-dzdx),y:1,z:round3(-dzdz)}};}

function groupStructures(cells,byKey,stepM){const eligible=new Set(["steep-bank","cliff-face","terrace-break"]),seen=new Set(),out=[];for(const start of cells){if(!eligible.has(start.classification))continue;const key=`${start.ix}:${start.iz}`;if(seen.has(key))continue;const type=start.classification,queue=[start],group=[];seen.add(key);while(queue.length){const c=queue.pop();group.push(c);for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){const nk=`${c.ix+dx}:${c.iz+dz}`,n=byKey.get(nk);if(!n||seen.has(nk)||n.classification!==type)continue;seen.add(nk);queue.push(n);}}const elevations=group.map(c=>c.elevationM).filter(Number.isFinite),slopes=group.map(c=>c.slopeDeg).filter(Number.isFinite);out.push({id:`terrain-structure:${out.length}`,type,cellCount:group.length,cells:group.map(c=>({x:c.x,z:c.z,elevationM:c.elevationM,localMinElevationM:c.localMinElevationM,localMaxElevationM:c.localMaxElevationM,slopeDeg:c.slopeDeg,normal:c.normal})),bounds:{minX:Math.min(...group.map(c=>c.x)),minZ:Math.min(...group.map(c=>c.z)),maxX:Math.max(...group.map(c=>c.x)),maxZ:Math.max(...group.map(c=>c.z))},minElevationM:round3(Math.min(...elevations)),maxElevationM:round3(Math.max(...elevations)),meanSlopeDeg:round3(slopes.reduce((a,b)=>a+b,0)/Math.max(1,slopes.length)),sampleStepM:stepM,authority:"independent-dtm",compilerIntent:type==="cliff-face"?"explicit-vertical-rock-face":type==="terrace-break"?"explicit-break-of-slope":"steep-terrain-treatment"});}return out;}
function resolveDtm(elevation){for(const name of["sampleDtmLocal","sampleGroundLocal","sampleTerrainLocal","sampleLocal"])if(typeof elevation?.[name]==="function")return{sample:elevation[name].bind(elevation),source:name==="sampleLocal"?(elevation.sourceKind||elevation.provider||"terrain-elevation-sampler"):(elevation.dtmSourceKind||elevation.groundSourceKind||"lidar-dtm")};return null;}
function graphBounds(graph){const boxes=(graph.nodes||[]).map(n=>n.geometry?.bounds).filter(b=>b&&[b.minX,b.minZ,b.maxX,b.maxZ].every(Number.isFinite));if(!boxes.length)return null;return{minX:Math.floor(Math.min(...boxes.map(b=>b.minX))),minZ:Math.floor(Math.min(...boxes.map(b=>b.minZ))),maxX:Math.ceil(Math.max(...boxes.map(b=>b.maxX))),maxZ:Math.ceil(Math.max(...boxes.map(b=>b.maxZ)))};}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}function bounded(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;}function round3(v){return Math.round(Number(v)*1000)/1000;}
