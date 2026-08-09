// TPMAP_PHASE34_BUILDING_ROOF_PLANE_DECOMPOSITION_V1
// Decompose footprint-aware DSM roof evidence into explicit graph-owned planes/ridges/eaves.

const MIN_PLANE_SAMPLES = 4;
const DEFAULT_RESIDUAL_M = 0.45;

export function decomposeBuildingRoofPlanes(graph, sources = null, options = {}) {
  if (!graph || !Array.isArray(graph.nodes)) throw new Error("Phase 34 roof plane decomposition requires reconstruction graph");
  const elevation = sources?.elevation || sources?.lidar || null;
  const dsm = resolveDsm(elevation);
  const diagnostics = {
    marker: "TPMAP_PHASE34_BUILDING_ROOF_PLANE_DECOMPOSITION_V1",
    buildingsVisited: 0,
    roofsDecomposed: 0,
    roofsUnresolved: 0,
    planesResolved: 0,
    ridgesResolved: 0,
    eavesResolved: 0
  };
  const compact = [];
  for (const node of graph.nodes) {
    if (node.type !== "building") continue;
    diagnostics.buildingsVisited += 1;
    const result = solve(node, dsm, options, diagnostics);
    Object.defineProperty(node, "roofPlaneDecomposition", { enumerable: false, configurable: true, value: result });
    compact.push(compactResult(result));
    if (result.status === "resolved" || result.status === "partial") diagnostics.roofsDecomposed += 1;
    else diagnostics.roofsUnresolved += 1;
    diagnostics.planesResolved += result.planes.length;
    diagnostics.ridgesResolved += result.ridges.length;
    diagnostics.eavesResolved += result.eaves.length;
  }
  graph.buildingRoofPlaneDecompositions = compact;
  graph.summary = { ...(graph.summary || {}), buildingRoofPlaneDecomposition: diagnostics };
  return diagnostics;
}

export function validateBuildingRoofPlaneDecompositions(graph) {
  const diag = graph?.summary?.buildingRoofPlaneDecomposition;
  if (!diag || diag.marker !== "TPMAP_PHASE34_BUILDING_ROOF_PLANE_DECOMPOSITION_V1") throw new Error("Phase 34 roof plane diagnostics missing");
  for (const node of graph.nodes || []) {
    if (node.type !== "building") continue;
    const r = node.roofPlaneDecomposition;
    if (!r) throw new Error(`Phase 34 building ${node.id} missing roof plane state`);
    for (const p of r.planes || []) {
      if (!Number.isFinite(p.slopeDeg) || !Number.isFinite(p.aspectDeg)) throw new Error(`Phase 34 building ${node.id} invalid roof plane`);
      if (!Array.isArray(p.polygon) || p.polygon.length < 3) throw new Error(`Phase 34 building ${node.id} invalid roof plane polygon`);
    }
    if (r.osmDerived) throw new Error(`Phase 34 building ${node.id} roof decomposition used OSM`);
  }
  return graph;
}

function solve(node, dsm, options, diagnostics) {
  if (node.authority?.osmDerived) throw new Error(`Phase 34 roof plane decomposition rejected OSM building ${node.id}`);
  const base = node.buildingReconstruction;
  if (!base || base.roof?.form === "unresolved") return unresolved(node, "missing-building-roof-reconstruction");
  if (base.roof.form === "flat") {
    const ring = outerRing(node.geometry?.local);
    if (!ring) return unresolved(node, "missing-building-footprint");
    return {
      marker: "TPMAP_PHASE34_BUILDING_ROOF_PLANE_DECOMPOSITION_V1",
      buildingId: node.id,
      status: "resolved",
      form: "flat",
      planes: [{ id: `${node.id}:roof-plane:0`, polygon: ring.slice(0, -1), slopeDeg: 0, aspectDeg: 0, elevationM: base.roof.ridgeElevationM, confidence: base.roof.confidence }],
      ridges: [],
      eaves: ringEdges(ring, base.roof.eaveElevationM),
      osmDerived: false,
      policy: "explicit-planes-only-when-supported-by-footprint-and-dsm"
    };
  }
  if (!dsm) return unresolved(node, "missing-dsm-sampler");
  const ring = outerRing(node.geometry?.local);
  if (!ring) return unresolved(node, "missing-building-footprint");
  const samples = sampleRoof(ring, dsm, Number(options.buildingRoofPlaneSampleStepM) || 1.5);
  if (samples.length < 8) return unresolved(node, "insufficient-dsm-roof-samples");

  const dominant = fitPlane(samples);
  if (!dominant) return unresolved(node, "plane-fit-failed");
  const residualLimit = Number(options.buildingRoofPlaneResidualM) || DEFAULT_RESIDUAL_M;
  const positive = [], negative = [];
  for (const s of samples) {
    const predicted = dominant.a*s.x + dominant.b*s.z + dominant.c;
    const residual = s.y - predicted;
    (residual >= 0 ? positive : negative).push(s);
  }

  const candidateGroups = [positive, negative].filter(g => g.length >= MIN_PLANE_SAMPLES);
  const planes = [];
  for (let i = 0; i < candidateGroups.length; i += 1) {
    const plane = fitPlane(candidateGroups[i]);
    if (!plane) continue;
    const rms = planeResidual(candidateGroups[i], plane);
    if (rms > residualLimit * 2) continue;
    const poly = hull(candidateGroups[i].map(s => [s.x, s.z]));
    if (poly.length < 3) continue;
    planes.push({
      id: `${node.id}:roof-plane:${i}`,
      polygon: poly,
      slopeDeg: round3(Math.atan(Math.hypot(plane.a, plane.b))*180/Math.PI),
      aspectDeg: round3((Math.atan2(plane.b, plane.a)*180/Math.PI + 360)%360),
      plane: { a: round6(plane.a), b: round6(plane.b), c: round3(plane.c), r2: round3(plane.r2), rmsM: round3(rms) },
      minElevationM: round3(Math.min(...candidateGroups[i].map(s=>s.y))),
      maxElevationM: round3(Math.max(...candidateGroups[i].map(s=>s.y))),
      confidence: round3(Math.max(0.3, Math.min(0.98, 0.55 + candidateGroups[i].length/100 - rms*0.1)))
    });
  }
  if (!planes.length) return unresolved(node, "no-supported-roof-planes");

  const ridges = planes.length >= 2 ? inferRidges(node, ring, planes, base) : [];
  const eaves = ringEdges(ring, base.roof.eaveElevationM);
  const form = planes.length >= 2 ? (base.roof.form === "complex" ? "multi-plane" : "gable-or-hip") : "single-plane";
  return {
    marker: "TPMAP_PHASE34_BUILDING_ROOF_PLANE_DECOMPOSITION_V1",
    buildingId: node.id,
    status: ridges.length || planes.length === 1 ? "resolved" : "partial",
    form,
    planes,
    ridges,
    eaves,
    osmDerived: false,
    policy: "explicit-planes-only-when-supported-by-footprint-and-dsm"
  };
}

function inferRidges(node, ring, planes, base) {
  const bounds = boundsOf(ring);
  const cx=(bounds.minX+bounds.maxX)/2, cz=(bounds.minZ+bounds.maxZ)/2;
  const angle = Number(base.roof?.ridgeDirectionDeg);
  const theta = Number.isFinite(angle) ? angle*Math.PI/180 : longAxisAngle(bounds);
  const half = Math.max(1, Math.min(bounds.maxX-bounds.minX, bounds.maxZ-bounds.minZ)*0.35);
  const dx=Math.cos(theta)*half, dz=Math.sin(theta)*half;
  return [{ id:`${node.id}:ridge:0`, start:[round3(cx-dx),round3(cz-dz)], end:[round3(cx+dx),round3(cz+dz)], elevationM:base.roof?.ridgeElevationM ?? null, confidence:round3(Math.min(...planes.map(p=>p.confidence))) }];
}

function sampleRoof(ring, sampler, step) {
  const b=boundsOf(ring), out=[];
  for(let x=b.minX+step/2;x<=b.maxX;x+=step) for(let z=b.minZ+step/2;z<=b.maxZ;z+=step) if(pointInPolygon([x,z],ring)){const y=finite(sampler(x,z));if(y!==null)out.push({x,z,y});}
  return out.slice(0,512);
}
function resolveDsm(e){const names=["sampleDsmLocal","sampleSurfaceLocal","sampleObjectTopLocal"];for(const n of names)if(typeof e?.[n]==="function")return e[n].bind(e);return null;}
function outerRing(g){if(!g)return null;const r=g.type==="Polygon"?g.coordinates?.[0]:g.type==="MultiPolygon"?g.coordinates?.[0]?.[0]:null;return Array.isArray(r)&&r.length>=4?r:null;}
function ringEdges(ring,y){const out=[];for(let i=0;i<ring.length-1;i++)out.push({start:[round3(ring[i][0]),round3(ring[i][1])],end:[round3(ring[i+1][0]),round3(ring[i+1][1])],elevationM:y??null});return out;}
function boundsOf(r){const xs=r.map(p=>Number(p[0])),zs=r.map(p=>Number(p[1]));return{minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};}
function longAxisAngle(b){return (b.maxX-b.minX)>=(b.maxZ-b.minZ)?0:Math.PI/2;}
function fitPlane(samples){const n=samples.length;let sx=0,sz=0,sy=0,sxx=0,szz=0,sxz=0,sxy=0,szy=0;for(const p of samples){sx+=p.x;sz+=p.z;sy+=p.y;sxx+=p.x*p.x;szz+=p.z*p.z;sxz+=p.x*p.z;sxy+=p.x*p.y;szy+=p.z*p.y;}const sol=solve3([[sxx,sxz,sx],[sxz,szz,sz],[sx,sz,n]],[sxy,szy,sy]);if(!sol)return null;const[a,b,c]=sol,mean=sy/n;let ssTot=0,ssRes=0;for(const p of samples){const pred=a*p.x+b*p.z+c;ssTot+=(p.y-mean)**2;ssRes+=(p.y-pred)**2;}return{a,b,c,r2:ssTot>1e-9?Math.max(0,1-ssRes/ssTot):1};}
function planeResidual(samples,p){let s=0;for(const q of samples){const r=q.y-(p.a*q.x+p.b*q.z+p.c);s+=r*r;}return Math.sqrt(s/Math.max(1,samples.length));}
function solve3(A,B){const m=A.map((r,i)=>[...r,B[i]]);for(let c=0;c<3;c++){let p=c;for(let r=c+1;r<3;r++)if(Math.abs(m[r][c])>Math.abs(m[p][c]))p=r;if(Math.abs(m[p][c])<1e-9)return null;[m[c],m[p]]=[m[p],m[c]];const d=m[c][c];for(let k=c;k<4;k++)m[c][k]/=d;for(let r=0;r<3;r++){if(r===c)continue;const f=m[r][c];for(let k=c;k<4;k++)m[r][k]-=f*m[c][k];}}return[m[0][3],m[1][3],m[2][3]];}
function hull(points){const pts=[...new Map(points.map(p=>[`${round3(p[0])}:${round3(p[1])}`,[round3(p[0]),round3(p[1])]])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(pts.length<3)return pts;const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo=[];for(const p of pts){while(lo.length>=2&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}const up=[];for(const p of [...pts].reverse()){while(up.length>=2&&cross(up.at(-2),up.at(-1),p)<=0)up.pop();up.push(p);}lo.pop();up.pop();return lo.concat(up);}
function pointInPolygon(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=+ring[i][0],zi=+ring[i][1],xj=+ring[j][0],zj=+ring[j][1];if(((zi>p[1])!==(zj>p[1]))&&(p[0]<(xj-xi)*(p[1]-zi)/(zj-zi+1e-12)+xi))inside=!inside;}return inside;}
function compactResult(r){return{buildingId:r.buildingId,status:r.status,form:r.form,planes:r.planes.map(p=>({id:p.id,slopeDeg:p.slopeDeg,aspectDeg:p.aspectDeg,confidence:p.confidence})),ridges:r.ridges,eaveCount:r.eaves.length};}
function unresolved(node,reason){return{marker:"TPMAP_PHASE34_BUILDING_ROOF_PLANE_DECOMPOSITION_V1",buildingId:node.id,status:"unresolved",reason,form:"unresolved",planes:[],ridges:[],eaves:[],osmDerived:false,policy:"explicit-planes-only-when-supported-by-footprint-and-dsm"};}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}function round3(v){return Math.round(Number(v)*1000)/1000;}function round6(v){return Math.round(Number(v)*1e6)/1e6;}
