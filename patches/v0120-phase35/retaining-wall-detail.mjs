// TPMAP_PHASE35_RETAINING_WALL_DETAIL_V1
// Evidence-bounded retaining-wall refinement. DTM remains vertical truth; planning
// may provide material, thickness and coping/cap semantics. No generic barrier is
// promoted and no unspecified thickness/cap is invented.

const PHASE=6;
const MAX_EXTRA=500_000;
const DEFAULT_BODY='minecraft:stone_bricks';
const MATERIALS={
  brick:'minecraft:stone_bricks', stone:'minecraft:stone_bricks', masonry:'minecraft:stone_bricks',
  concrete:'minecraft:smooth_stone', blockwork:'minecraft:stone_bricks', cobble:'minecraft:cobblestone',
  cobblestone:'minecraft:cobblestone', andesite:'minecraft:andesite'
};

export function applyRetainingWallDetailToCompilation(compilation, graph, options={}){
  validateCompilation(compilation);
  const morphology=graph?.terrainMorphology, association=graph?.terrainPlanningAssociation;
  if(!morphology||morphology.marker!=='TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1')throw new Error('Phase 35 retaining-wall detail requires morphology model');
  if(!association||association.marker!=='TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1')throw new Error('Phase 35 retaining-wall detail requires planning association model');
  const datumM=Number(compilation.meta.elevationDatumM); if(!Number.isFinite(datumM))throw new Error('Phase 35 retaining-wall detail requires finite elevation datum');
  const maxThickness=Math.max(1,Math.min(8,Number(options.terrainRetainingWallMaxThicknessM)||4));
  const writes=new Map(); let wallsVisited=0,wallsDetailed=0,explicitThicknessWalls=0,explicitCapWalls=0,materialWalls=0;
  for(const s of morphology.structures||[]){
    if(s.engineering?.classification!=='retaining-wall')continue; wallsVisited++;
    const node=graph.nodes?.find(n=>n.id===s.engineering?.planningNodeId);
    if(!node?.authority?.planningAuthoritative||node.authority?.osmDerived)throw new Error(`Phase 35 retaining-wall ${s.id} lacks valid planning authority`);
    if(!Array.isArray(s.cells)||s.cells.length!==s.cellCount)throw new Error(`Phase 35 retaining-wall detail requires exact cells for ${s.id}`);
    const tags=node.sourceFeature?.tags||{}; const thickness=explicitThickness(tags,maxThickness); const cap=explicitCap(tags); const material=explicitMaterial(tags);
    if(thickness)explicitThicknessWalls++; if(cap)explicitCapWalls++; if(material)materialWalls++;
    let touched=false;
    for(const cell of s.cells){
      if(![cell.x,cell.z,cell.localMinElevationM,cell.localMaxElevationM].every(Number.isFinite))continue;
      let y1=Math.round(cell.localMinElevationM-datumM),y2=Math.round(cell.localMaxElevationM-datumM); if(y2<y1)[y1,y2]=[y2,y1]; if(y2<=y1)continue;
      const footprint=thickness?expandCell(cell,node.geometry?.bounds,thickness):[[Math.round(cell.x),Math.round(cell.z)]];
      const bodyBlock=material||DEFAULT_BODY;
      for(const [x,z] of footprint){
        if(material||thickness){for(let y=y1;y<=y2;y++)setWrite(writes,{x,y,z,block:bodyBlock,kind:'body',wallId:s.id});}
        if(cap){const capY=y2+1;setWrite(writes,{x,y:capY,z,block:capBlock(material),kind:'cap',wallId:s.id});}
      }
      touched ||= Boolean(thickness||cap||material);
      if(writes.size>MAX_EXTRA)throw new Error(`Phase 35 retaining-wall detail exceeded safe write cap ${MAX_EXTRA}`);
    }
    if(touched)wallsDetailed++;
  }
  if(!writes.size)return noOp(datumM,wallsVisited);
  const before=countOps(compilation),indexes=new Map();
  for(const w of writes.values()){const key=paletteKey(w.block);if(!indexes.has(key))indexes.set(key,ensurePalette(compilation,w.block));w.paletteIndex=indexes.get(key);}
  emit(compilation,writes);for(const ch of compilation.chunks)ch.o.sort(compareOps);compilation.chunks=compilation.chunks.filter(c=>c.o.length).sort((a,b)=>a.z-b.z||a.x-b.x);
  const after=countOps(compilation),d={marker:'TPMAP_PHASE35_RETAINING_WALL_DETAIL_V1',status:'applied',phase:PHASE,datumM,wallsVisited,wallsDetailed,explicitThicknessWalls,explicitCapWalls,materialWalls,writes:writes.size,emittedOperations:after-before,policy:'dtm-vertical-truth;planning-explicit-thickness-cap-material-only;no-generic-barrier-promotion;no-implicit-decoration'};
  compilation.meta.retainingWallDetail=d;const stats=compilation.stats||(compilation.stats={});stats.operations=after;stats.rawOperations=after;stats.retainingWallDetailWrites=writes.size;return d;
}

export function validateRetainingWallDetailCompilation(compilation,diagnostics){
  if(!diagnostics||diagnostics.marker!=='TPMAP_PHASE35_RETAINING_WALL_DETAIL_V1')throw new Error('Phase 35 retaining-wall detail diagnostics missing');
  if(diagnostics.status==='no-op')return compilation;validateCompilation(compilation);
  for(const ch of compilation.chunks)for(const op of ch.o){if(op[0]!==PHASE)continue;const b=compilation.palette[op[7]];const n=typeof b==='string'?b:b?.name;if(n==='minecraft:air')throw new Error('Phase 35 retaining-wall detail emitted forbidden air');}
  return compilation;
}

function explicitThickness(tags,max){for(const k of ['wall_thickness','thickness','width']){const n=Number(tags?.[k]);if(Number.isFinite(n)&&n>=1&&n<=max)return Math.max(1,Math.round(n));}return 0;}
function explicitCap(tags){const text=[tags?.coping,tags?.cap,tags?.wall_cap,tags?.capped].filter(v=>v!=null).join(' ').toLowerCase();return /^(1|true|yes|stone|masonry|concrete|coping|cap)$/.test(text.trim())||/coping|capped/.test(text);}
function explicitMaterial(tags){const raw=String(tags?.material||tags?.wall_material||'').toLowerCase().replaceAll('_','-');for(const [k,v] of Object.entries(MATERIALS))if(raw.includes(k))return v;return null;}
function capBlock(material){return material||DEFAULT_BODY;}
function expandCell(cell,bounds,thickness){const x=Math.round(cell.x),z=Math.round(cell.z);if(thickness<=1)return[[x,z]];if(!bounds||![bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ].every(Number.isFinite))return[[x,z]];const sx=bounds.maxX-bounds.minX,sz=bounds.maxZ-bounds.minZ;if(Math.min(sx,sz)>1.5)return[[x,z]];const out=[];const half=Math.floor((thickness-1)/2),extra=thickness-1-half;if(sx<=sz){for(let dx=-half;dx<=extra;dx++)out.push([x+dx,z]);}else{for(let dz=-half;dz<=extra;dz++)out.push([x,z+dz]);}return out;}
function setWrite(map,w){const k=`${w.x},${w.y},${w.z}`;const cur=map.get(k);if(!cur||w.kind==='cap'||cur.kind!=='cap')map.set(k,w);}
function paletteKey(v){return typeof v==='string'?v:JSON.stringify(v);}
function ensurePalette(c,v){const k=paletteKey(v);let i=c.palette.findIndex(p=>paletteKey(p)===k);if(i<0){i=c.palette.length;c.palette.push(v);}return i;}
function emit(c,writes){const chunks=new Map(c.chunks.map(ch=>[`${ch.x},${ch.z}`,ch]));for(const v of writes.values()){const cx=Math.floor(v.x/16),cz=Math.floor(v.z/16),k=`${cx},${cz}`;let ch=chunks.get(k);if(!ch){ch={x:cx,z:cz,o:[]};c.chunks.push(ch);chunks.set(k,ch);}ch.o.push([PHASE,v.x,v.y,v.z,v.x,v.y,v.z,v.paletteIndex]);}}
function validateCompilation(c){if(!c||!c.meta||!Array.isArray(c.palette)||!Array.isArray(c.chunks))throw new Error('Phase 35 retaining-wall detail rejected unsupported compilation schema');for(const ch of c.chunks){if(!Number.isInteger(ch?.x)||!Number.isInteger(ch?.z)||!Array.isArray(ch.o))throw new Error('Phase 35 retaining-wall detail rejected malformed chunk schema');for(const op of ch.o)if(!Array.isArray(op)||op.length!==8||!op.slice(0,7).every(Number.isFinite)||!Number.isInteger(op[7])||op[7]<0||op[7]>=c.palette.length)throw new Error('Phase 35 retaining-wall detail rejected malformed native operation');}}
function noOp(datumM,wallsVisited){return{marker:'TPMAP_PHASE35_RETAINING_WALL_DETAIL_V1',status:'no-op',phase:PHASE,datumM,wallsVisited,wallsDetailed:0,explicitThicknessWalls:0,explicitCapWalls:0,materialWalls:0,writes:0,emittedOperations:0,policy:'no-explicit-planning-wall-detail-exact-no-op'};}
function compareOps(a,b){return a[0]-b[0]||a[3]-b[3]||a[2]-b[2]||a[1]-b[1];}function countOps(c){return c.chunks.reduce((n,ch)=>n+ch.o.length,0);}
