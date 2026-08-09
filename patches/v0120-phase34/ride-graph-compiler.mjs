// TPMAP_PHASE34_RIDE_GRAPH_COMPILER_V1
// Replace legacy ride voxels only where Phase 34 has resolved graph-owned 3D geometry.

const TRACK_PHASE=9, SUPPORT_PHASE=8;
const TRACK_BLOCK="minecraft:blue_concrete", SUPPORT_BLOCK="minecraft:iron_bars", FOOTING_BLOCK="minecraft:yellow_concrete";
const LEGACY_TRACK_BLOCKS=new Set(["minecraft:cyan_concrete","minecraft:blue_concrete","minecraft:lime_concrete","minecraft:gold_block","minecraft:yellow_concrete","minecraft:orange_concrete","minecraft:red_concrete"]);
const MAX_GRAPH_VOXELS=2_000_000;

export function applyRideGraphToCompilation(compilation,graph,options={}){
  validateCompilation(compilation);
  if(!graph||!Array.isArray(graph.nodes)) throw new Error("Phase 34 ride graph compiler requires reconstruction graph");
  const datumM=Number(compilation.meta.elevationDatumM);
  if(!Number.isFinite(datumM)) throw new Error("Phase 34 ride graph compiler requires finite elevation datum");
  const cfg={trackTol:bounded(options.rideGraphLegacyTrackVerticalTolerance,6,0,32),supportRadius:bounded(options.rideGraphSupportSuppressRadius,2,0,8)};
  const track=collectTrack(graph,datumM), supports=collectSupports(graph,datumM);
  if(track.size+supports.columns.size+supports.footings.size>MAX_GRAPH_VOXELS) throw new Error(`Phase 34 ride graph compiler exceeded safe voxel cap ${MAX_GRAPH_VOXELS}`);
  if(!track.size&&!supports.columns.size&&!supports.footings.size) return noOp(datumM);

  const beforeOps=countOps(compilation); let legacyTrackRemoved=0,legacySupportRemoved=0;
  for(const chunk of compilation.chunks){
    const next=[];
    for(const op of chunk.o){
      const block=compilation.palette[op[7]];
      if(op[0]===TRACK_PHASE&&LEGACY_TRACK_BLOCKS.has(block)){
        const kept=filterOp(op,(x,y,z)=>!nearTrack(track,x,y,z,cfg.trackTol));
        legacyTrackRemoved+=volume(op)-kept.reduce((n,o)=>n+volume(o),0); next.push(...kept);
      }else if(op[0]===SUPPORT_PHASE&&(block===SUPPORT_BLOCK||block===FOOTING_BLOCK)){
        const kept=filterOp(op,(x,y,z)=>!nearSupport(supports,x,y,z,cfg.supportRadius));
        legacySupportRemoved+=volume(op)-kept.reduce((n,o)=>n+volume(o),0); next.push(...kept);
      }else next.push(op);
    }
    chunk.o=next;
  }

  const trackIndex=ensurePalette(compilation,TRACK_BLOCK), supportIndex=ensurePalette(compilation,SUPPORT_BLOCK), footingIndex=ensurePalette(compilation,FOOTING_BLOCK);
  const emittedTrackOperations=emit(compilation,track,TRACK_PHASE,trackIndex);
  const emittedSupportOperations=emit(compilation,supports.columns,SUPPORT_PHASE,supportIndex);
  const emittedFootingOperations=emit(compilation,supports.footings,SUPPORT_PHASE,footingIndex);
  for(const chunk of compilation.chunks) chunk.o.sort(compareOps);
  compilation.chunks=compilation.chunks.filter(c=>c.o.length).sort((a,b)=>a.z-b.z||a.x-b.x);
  const afterOps=countOps(compilation);
  const diagnostics={marker:"TPMAP_PHASE34_RIDE_GRAPH_COMPILER_V1",status:"applied",datumM,resolvedTrackVoxels:track.size,resolvedSupportVoxels:supports.columns.size,resolvedSupportFootings:supports.footings.size,resolvedRideIds:[...track.rideIds].sort(),resolvedSupportIds:[...supports.supportIds].sort(),legacyTrackVoxelsRemoved:legacyTrackRemoved,legacySupportVoxelsRemoved:legacySupportRemoved,emittedTrackOperations,emittedSupportOperations,emittedFootingOperations,netOperationDelta:afterOps-beforeOps,policy:"resolved-graph-only-cutover;unresolved-spans-preserve-legacy;3d-bounded-track-suppression;phase8-portals-preserved"};
  compilation.meta.rideGraphCompilation=diagnostics;
  const stats=compilation.stats||(compilation.stats={});
  stats.operations=afterOps; stats.rawOperations=afterOps; stats.chunks=compilation.chunks.length;
  stats.rideGraphTrackBlocks=track.size; stats.rideGraphSupportBlocks=supports.columns.size; stats.rideGraphSupportFootings=supports.footings.size;
  stats.rideGraphLegacyTrackRemoved=legacyTrackRemoved; stats.rideGraphLegacySupportRemoved=legacySupportRemoved;
  return diagnostics;
}

export function validateRideGraphCompilation(compilation,diagnostics){
  if(!diagnostics||diagnostics.marker!=="TPMAP_PHASE34_RIDE_GRAPH_COMPILER_V1") throw new Error("Phase 34 ride graph compilation diagnostics missing");
  if(diagnostics.status==="no-op") return compilation;
  validateCompilation(compilation);
  const ti=compilation.palette.indexOf(TRACK_BLOCK),si=compilation.palette.indexOf(SUPPORT_BLOCK),fi=compilation.palette.indexOf(FOOTING_BLOCK);
  if(ti<0||si<0||fi<0) throw new Error("Phase 34 ride graph compilation palette incomplete");
  if(countBlocks(compilation,TRACK_PHASE,ti)<diagnostics.resolvedTrackVoxels) throw new Error("Phase 34 ride graph compilation lost resolved track voxels");
  if(countBlocks(compilation,SUPPORT_PHASE,si)<diagnostics.resolvedSupportVoxels) throw new Error("Phase 34 ride graph compilation lost resolved support voxels");
  if(countBlocks(compilation,SUPPORT_PHASE,fi)<diagnostics.resolvedSupportFootings) throw new Error("Phase 34 ride graph compilation lost resolved support footings");
  return compilation;
}

function collectTrack(graph,datumM){
  const set=new Set(); set.rideIds=new Set();
  for(const ride of graph.nodes){
    if(ride.type!=="ride-track") continue;
    if(ride.authority?.osmDerived) throw new Error(`Phase 34 ride graph compiler rejected OSM-derived ride ${ride.id}`);
    for(const segment of ride.geometry3d?.segments||[]){
      if(segment.mode!=="resolved-3d") continue;
      const a=segment.start,b=segment.end;
      if(![a?.[0],a?.[1],a?.[2],b?.[0],b?.[1],b?.[2]].every(Number.isFinite)) continue;
      for(const [x,y,z] of line3d([a[0],a[1]-datumM,a[2]],[b[0],b[1]-datumM,b[2]])) set.add(`${x},${y},${z}`);
      set.rideIds.add(ride.id);
    }
  }
  return set;
}
function collectSupports(graph,datumM){
  const columns=new Set(),footings=new Set(),supportIds=new Set();
  for(const node of graph.nodes){
    if(node.type!=="ride-support") continue;
    if(node.authority?.osmDerived) throw new Error(`Phase 34 ride graph compiler rejected OSM-derived support ${node.id}`);
    const r=node.supportReconstruction;if(r?.status!=="resolved") continue;const a=r.footing,b=r.connection;
    if(![a?.x,a?.y,a?.z,b?.x,b?.y,b?.z].every(Number.isFinite)) continue;
    for(const [x,y,z] of line3d([a.x,a.y-datumM,a.z],[b.x,b.y-datumM,b.z])) columns.add(`${x},${y},${z}`);
    const footing=`${Math.round(a.x)},${Math.round(a.y-datumM)},${Math.round(a.z)}`; footings.add(footing); columns.delete(footing); supportIds.add(node.id);
  }
  return {columns,footings,supportIds};
}
function nearTrack(track,x,y,z,t){for(let dy=-t;dy<=t;dy++)if(track.has(`${x},${y+dy},${z}`))return true;return false;}
function nearSupport(s,x,y,z,r){for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++)for(let dy=-r;dy<=r;dy++){const k=`${x+dx},${y+dy},${z+dz}`;if(s.columns.has(k)||s.footings.has(k))return true;}return false;}
function filterOp(op,keep){const out=[];for(let z=Math.min(op[3],op[6]);z<=Math.max(op[3],op[6]);z++)for(let y=Math.min(op[2],op[5]);y<=Math.max(op[2],op[5]);y++){let s=null,p=null;for(let x=Math.min(op[1],op[4]);x<=Math.max(op[1],op[4])+1;x++){const ok=x<=Math.max(op[1],op[4])&&keep(x,y,z);if(ok&&s===null){s=p=x;continue;}if(ok){p=x;continue;}if(s!==null){out.push([op[0],s,y,z,p,y,z,op[7]]);s=p=null;}}}return out;}
function emit(c,set,phase,pal){const chunks=new Map(c.chunks.map(x=>[`${x.x},${x.z}`,x])),groups=new Map();let ops=0;for(const key of set){const [x,y,z]=key.split(",").map(Number),cx=Math.floor(x/16),cz=Math.floor(z/16),g=`${cx}:${cz}:${y}:${z}`;if(!groups.has(g))groups.set(g,{cx,cz,y,z,xs:[]});groups.get(g).xs.push(x);}for(const g of groups.values()){g.xs.sort((a,b)=>a-b);let s=g.xs[0],p=s;for(let i=1;i<=g.xs.length;i++){const x=g.xs[i];if(x===p+1){p=x;continue;}const ck=`${g.cx},${g.cz}`;let ch=chunks.get(ck);if(!ch){ch={x:g.cx,z:g.cz,o:[]};c.chunks.push(ch);chunks.set(ck,ch);}ch.o.push([phase,s,g.y,g.z,p,g.y,g.z,pal]);ops++;s=x;p=x;}}return ops;}
function line3d(a,b){const A=a.map(Math.round),B=b.map(Math.round),steps=Math.max(Math.abs(B[0]-A[0]),Math.abs(B[1]-A[1]),Math.abs(B[2]-A[2]),1),out=[];let last=null;for(let i=0;i<=steps;i++){const t=i/steps,k=`${Math.round(A[0]+(B[0]-A[0])*t)},${Math.round(A[1]+(B[1]-A[1])*t)},${Math.round(A[2]+(B[2]-A[2])*t)}`;if(k!==last){out.push(k.split(",").map(Number));last=k;}}return out;}
function ensurePalette(c,n){let i=c.palette.indexOf(n);if(i<0){i=c.palette.length;c.palette.push(n);}return i;}
function countBlocks(c,palPhase,pal){let n=0;for(const ch of c.chunks)for(const op of ch.o)if(op[0]===palPhase&&op[7]===pal)n+=volume(op);return n;}
function countOps(c){return c.chunks.reduce((n,ch)=>n+ch.o.length,0);}function volume(op){return (Math.abs(op[4]-op[1])+1)*(Math.abs(op[5]-op[2])+1)*(Math.abs(op[6]-op[3])+1);}function compareOps(a,b){return a[0]-b[0]||a[3]-b[3]||a[2]-b[2]||a[1]-b[1];}
function bounded(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):f;}
function validateCompilation(c){if(!c||!c.meta||!Array.isArray(c.palette)||!Array.isArray(c.chunks))throw new Error("Phase 34 ride graph compiler rejected unsupported compilation schema");for(const ch of c.chunks){if(!Number.isInteger(ch?.x)||!Number.isInteger(ch?.z)||!Array.isArray(ch.o))throw new Error("Phase 34 ride graph compiler rejected malformed chunk schema");for(const op of ch.o)if(!Array.isArray(op)||op.length!==8||!op.slice(0,7).every(Number.isFinite)||!Number.isInteger(op[7])||op[7]<0||op[7]>=c.palette.length)throw new Error("Phase 34 ride graph compiler rejected malformed native operation");}}
function noOp(datumM){return{marker:"TPMAP_PHASE34_RIDE_GRAPH_COMPILER_V1",status:"no-op",datumM,resolvedTrackVoxels:0,resolvedSupportVoxels:0,resolvedSupportFootings:0,resolvedRideIds:[],resolvedSupportIds:[],legacyTrackVoxelsRemoved:0,legacySupportVoxelsRemoved:0,emittedTrackOperations:0,emittedSupportOperations:0,emittedFootingOperations:0,netOperationDelta:0,policy:"no-resolved-graph-geometry-exact-no-op"};}
