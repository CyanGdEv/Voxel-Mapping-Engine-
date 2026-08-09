// TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_V2
// Reconcile phase-6 terrain structures and Phase 35 steep-bank surfaces with the
// verified Phase 34 excavation mask. This stage never creates air or widens excavation.

const TERRAIN_PHASE = 6;
const TERRAIN_BLOCKS = new Set([
  'minecraft:stone','minecraft:andesite','minecraft:cobblestone','minecraft:mossy_cobblestone',
  'minecraft:dirt','minecraft:coarse_dirt','minecraft:stone_bricks','minecraft:smooth_stone',
  'minecraft:normal_stone_slab','minecraft:cobblestone_slab','minecraft:mossy_cobblestone_slab',
  'minecraft:normal_stone_stairs','minecraft:stone_stairs','minecraft:mossy_cobblestone_stairs'
]);

export function reconcileTerrainWithRideExcavation(compilation, mask, options = {}) {
  validateCompilation(compilation);
  if (!mask || mask.marker !== 'TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1' || !Array.isArray(mask.cells)) throw new Error('Phase 35 portal reconciliation requires verified Phase 34 excavation mask');
  const datumM=Number(compilation.meta.elevationDatumM); if(!Number.isFinite(datumM))throw new Error('Phase 35 portal reconciliation requires finite elevation datum');
  if(!mask.cells.length)return noOp(datumM,'empty-verified-mask');
  const mouthDepthM=bounded(options.terrainTunnelPortalMouthDepthM,2,0,8),normalized=normalizeMask(mask.cells,datumM),authorised=new Set(normalized.map(c=>key(c.x,c.y,c.z))),portal=portalMouthCells(normalized,mouthDepthM);
  let removed=0,portalRemoved=0,tunnelRemoved=0,cuttingRemoved=0; const beforeOps=countOps(compilation);
  for(const chunk of compilation.chunks){const next=[];for(const op of chunk.o){const spec=compilation.palette[op[7]];if(op[0]!==TERRAIN_PHASE||!isTerrainSurfaceSpec(spec)){next.push(op);continue;}const kept=filterOp(op,(x,y,z)=>!authorised.has(key(x,y,z))),delta=volume(op)-kept.reduce((n,o)=>n+volume(o),0);if(delta){removed+=delta;forEachVoxel(op,(x,y,z)=>{const k=key(x,y,z);if(!authorised.has(k))return;const cell=normalized.byKey.get(k);if(portal.has(k))portalRemoved++;if(cell?.mode==='tunnel')tunnelRemoved++;else if(cell?.mode==='cutting')cuttingRemoved++;});}next.push(...kept);}chunk.o=next;}
  if(!removed)return noOp(datumM,'no-phase6-overlap',portal.meta);
  for(const chunk of compilation.chunks)chunk.o.sort(compareOps);compilation.chunks=compilation.chunks.filter(c=>c.o.length).sort((a,b)=>a.z-b.z||a.x-b.x);
  const afterOps=countOps(compilation),diagnostics={marker:'TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_V2',status:'applied',datumM,authorisedExcavationCells:authorised.size,portalMouthCells:portal.size,portalMouthsDetected:portal.meta.mouthsDetected,ridesWithTunnel:portal.meta.ridesWithTunnel,terrainVoxelsRemoved:removed,portalTerrainVoxelsRemoved:portalRemoved,tunnelTerrainVoxelsRemoved:tunnelRemoved,cuttingTerrainVoxelsRemoved:cuttingRemoved,emittedAirOperations:0,netOperationDelta:afterOps-beforeOps,policy:'split-phase6-terrain-and-stateful-steep-surfaces-only-inside-existing-verified-mask;no-new-air;no-mask-expansion;phase7-remains-carve-authority'};
  compilation.meta.terrainTunnelPortalReconciliation=diagnostics;const stats=compilation.stats||(compilation.stats={});stats.operations=afterOps;stats.rawOperations=afterOps;stats.terrainPortalTerrainVoxelsRemoved=removed;return diagnostics;
}

export function validateTerrainTunnelPortalReconciliation(compilation, mask, diagnostics) {
  if(!diagnostics||!["TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_V1","TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_V2"].includes(diagnostics.marker))throw new Error('Phase 35 portal reconciliation diagnostics missing');
  if(diagnostics.emittedAirOperations!==0)throw new Error('Phase 35 portal reconciliation must never emit air');if(diagnostics.status==='no-op')return compilation;
  const datumM=Number(compilation.meta.elevationDatumM),normal=normalizeMask(mask.cells,datumM),authorised=new Set(normal.map(c=>key(c.x,c.y,c.z)));
  for(const chunk of compilation.chunks)for(const op of chunk.o){if(op[0]!==TERRAIN_PHASE||!isTerrainSurfaceSpec(compilation.palette[op[7]]))continue;forEachVoxel(op,(x,y,z)=>{if(authorised.has(key(x,y,z)))throw new Error('Phase 35 portal reconciliation left phase-6 terrain inside verified excavation');});}
  return compilation;
}

function isTerrainSurfaceSpec(spec){const name=typeof spec==='string'?spec:spec?.name;return TERRAIN_BLOCKS.has(name);}
function portalMouthCells(cells,depth){const byRide=new Map();for(const c of cells){if(c.mode!=='tunnel'||!Number.isFinite(c.measureM))continue;if(!byRide.has(c.rideId))byRide.set(c.rideId,[]);byRide.get(c.rideId).push(c);}const out=new Set();let mouthsDetected=0;for(const rideCells of byRide.values()){const measures=rideCells.map(c=>c.measureM),min=Math.min(...measures),max=Math.max(...measures);for(const c of rideCells)if(c.measureM<=min+depth||c.measureM>=max-depth)out.add(key(c.x,c.y,c.z));mouthsDetected+=max>min+depth*2?2:1;}out.meta={mouthsDetected,ridesWithTunnel:byRide.size};return out;}
function normalizeMask(cells,datumM){const out=[],byKey=new Map();for(const c of cells){if(!['tunnel','cutting'].includes(c?.mode)||![c.x,c.y,c.z].every(Number.isInteger)||!c.rideId)throw new Error('Phase 35 portal reconciliation rejected invalid excavation cell');const n={...c,y:Math.round(c.y-datumM),measureM:Number(c.measureM)},k=key(n.x,n.y,n.z);if(byKey.has(k))throw new Error(`Phase 35 portal reconciliation rejected duplicate excavation voxel ${k}`);out.push(n);byKey.set(k,n);}out.byKey=byKey;return out;}
function filterOp(op,keep){const out=[];for(let z=Math.min(op[3],op[6]);z<=Math.max(op[3],op[6]);z++)for(let y=Math.min(op[2],op[5]);y<=Math.max(op[2],op[5]);y++){let s=null,p=null;for(let x=Math.min(op[1],op[4]);x<=Math.max(op[1],op[4])+1;x++){const ok=x<=Math.max(op[1],op[4])&&keep(x,y,z);if(ok&&s===null){s=p=x;continue;}if(ok){p=x;continue;}if(s!==null){out.push([op[0],s,y,z,p,y,z,op[7]]);s=p=null;}}}return out;}
function forEachVoxel(op,fn){for(let z=Math.min(op[3],op[6]);z<=Math.max(op[3],op[6]);z++)for(let y=Math.min(op[2],op[5]);y<=Math.max(op[2],op[5]);y++)for(let x=Math.min(op[1],op[4]);x<=Math.max(op[1],op[4]);x++)fn(x,y,z);}
function validateCompilation(c){if(!c||!c.meta||!Array.isArray(c.palette)||!Array.isArray(c.chunks))throw new Error('Phase 35 portal reconciliation rejected unsupported compilation schema');for(const ch of c.chunks){if(!Number.isInteger(ch?.x)||!Number.isInteger(ch?.z)||!Array.isArray(ch.o))throw new Error('Phase 35 portal reconciliation rejected malformed chunk schema');for(const op of ch.o)if(!Array.isArray(op)||op.length!==8||!op.slice(0,7).every(Number.isFinite)||!Number.isInteger(op[7])||op[7]<0||op[7]>=c.palette.length)throw new Error('Phase 35 portal reconciliation rejected malformed native operation');}}
function noOp(datumM,reason,meta={mouthsDetected:0,ridesWithTunnel:0}){return{marker:'TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_V2',status:'no-op',reason,datumM,authorisedExcavationCells:0,portalMouthCells:0,portalMouthsDetected:meta.mouthsDetected||0,ridesWithTunnel:meta.ridesWithTunnel||0,terrainVoxelsRemoved:0,portalTerrainVoxelsRemoved:0,tunnelTerrainVoxelsRemoved:0,cuttingTerrainVoxelsRemoved:0,emittedAirOperations:0,netOperationDelta:0,policy:'exact-no-op-no-new-air'};}
function key(x,y,z){return`${x},${y},${z}`;}function countOps(c){return c.chunks.reduce((n,ch)=>n+ch.o.length,0);}function volume(op){return(Math.abs(op[4]-op[1])+1)*(Math.abs(op[5]-op[2])+1)*(Math.abs(op[6]-op[3])+1);}function compareOps(a,b){return a[0]-b[0]||a[3]-b[3]||a[2]-b[2]||a[1]-b[1];}function bounded(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;}
