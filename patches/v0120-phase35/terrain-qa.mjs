// TPMAP_PHASE35_TERRAIN_QA_V1
// Read-only QA for compiled Phase-35 terrain. Compares native phase-6 output against
// bare-earth DTM morphology and accepted planning terrain-level observations.

const PHASE = 6;
const DEFAULT_WARN_M = 0.75;
const DEFAULT_OUTLIER_M = 1.5;
const MAX_SAMPLES = 750_000;

export function evaluateTerrainCompilationQA(compilation, graph, options = {}) {
  validateCompilation(compilation);
  const morphology = graph?.terrainMorphology;
  if (!morphology || morphology.marker !== 'TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1') throw new Error('Phase 35 terrain QA requires morphology model');
  const datumM = Number(compilation.meta.elevationDatumM);
  if (!Number.isFinite(datumM)) throw new Error('Phase 35 terrain QA requires finite elevation datum');
  const warnM = bounded(options.terrainQaWarnErrorM, DEFAULT_WARN_M, 0.1, 5);
  const outlierM = bounded(options.terrainQaOutlierErrorM, DEFAULT_OUTLIER_M, warnM, 10);
  const surface = compiledSurfaceIndex(compilation, datumM);
  const samples = [];
  const unresolved = [];
  let dtmCompared = 0, planningCompared = 0, overbuild = 0, underbuild = 0, withinTolerance = 0;

  for (const structure of morphology.structures || []) {
    if (!Array.isArray(structure.cells) || structure.cells.length !== structure.cellCount) throw new Error(`Phase 35 terrain QA requires exact cells for ${structure.id}`);
    for (const cell of structure.cells) {
      if (samples.length + unresolved.length >= MAX_SAMPLES) throw new Error(`Phase 35 terrain QA exceeded safe sample cap ${MAX_SAMPLES}`);
      if (![cell.x, cell.z, cell.elevationM].every(Number.isFinite)) { unresolved.push({kind:'dtm',structureId:structure.id,reason:'missing-dtm-cell-elevation'}); continue; }
      const x=Math.round(cell.x), z=Math.round(cell.z), actual=surface.get(key(x,z));
      if (actual == null) { unresolved.push({kind:'dtm',structureId:structure.id,x,z,expectedElevationM:round3(cell.elevationM),reason:'no-phase6-surface'}); continue; }
      const errorM=round3(actual-Number(cell.elevationM));
      samples.push({kind:'dtm',structureId:structure.id,classification:structure.engineering?.classification||structure.type,x,z,expectedElevationM:round3(cell.elevationM),compiledElevationM:round3(actual),errorM,absErrorM:round3(Math.abs(errorM))});
      dtmCompared++; if(errorM>warnM)overbuild++; else if(errorM<-warnM)underbuild++; else withinTolerance++;
    }
  }

  for (const obs of graph?.evidenceNodes || []) {
    if (obs?.observationType !== 'terrain-level' || obs.authority?.osmDerived) continue;
    const c=obs.geometry?.centroid; const expected=finite(obs.vertical?.explicitElevationM) ?? finite(obs.vertical?.baseElevationM) ?? finite(obs.vertical?.groundElevationM);
    if (!c || expected == null) continue;
    const nearest=nearestSurface(surface, c[0], c[1], 3);
    if (!nearest) { unresolved.push({kind:'planning-terrain-level',observationId:obs.id,expectedElevationM:round3(expected),reason:'no-nearby-phase6-surface'}); continue; }
    const errorM=round3(nearest.elevationM-expected);
    samples.push({kind:'planning-terrain-level',observationId:obs.id,x:nearest.x,z:nearest.z,expectedElevationM:round3(expected),compiledElevationM:round3(nearest.elevationM),errorM,absErrorM:round3(Math.abs(errorM))});
    planningCompared++; if(errorM>warnM)overbuild++; else if(errorM<-warnM)underbuild++; else withinTolerance++;
  }

  const errors=samples.map(s=>s.absErrorM).sort((a,b)=>a-b);
  const outliers=samples.filter(s=>s.absErrorM>outlierM).sort((a,b)=>b.absErrorM-a.absErrorM).slice(0,200);
  const result={
    marker:'TPMAP_PHASE35_TERRAIN_QA_V1',
    status: outliers.length ? 'warning' : (unresolved.length ? 'partial' : 'passed'),
    datumM,warnM,outlierM,dtmCompared,planningCompared,totalCompared:samples.length,
    unresolved:unresolved.length,withinTolerance,overbuild,underbuild,outliers:outliers.length,
    meanAbsErrorM:round3(errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:0),
    p95AbsErrorM:round3(percentile(errors,0.95)),maxAbsErrorM:round3(errors.at(-1)||0),
    worstOutliers:outliers,unresolvedSamples:unresolved.slice(0,200),
    policy:'read-only-qa;dtm-and-planning-terrain-level-comparison;no-geometry-repair;no-osm-elevation-authority'
  };
  compilation.meta.terrainQA=result;
  graph.summary={...(graph.summary||{}),terrainQA:{marker:result.marker,status:result.status,totalCompared:result.totalCompared,unresolved:result.unresolved,p95AbsErrorM:result.p95AbsErrorM,maxAbsErrorM:result.maxAbsErrorM,outliers:result.outliers}};
  return result;
}

export function validateTerrainCompilationQA(compilation, graph, result) {
  if (!result || result.marker !== 'TPMAP_PHASE35_TERRAIN_QA_V1') throw new Error('Phase 35 terrain QA diagnostics missing');
  validateCompilation(compilation);
  if (result.totalCompared !== result.dtmCompared + result.planningCompared) throw new Error('Phase 35 terrain QA comparison accounting mismatch');
  if (result.worstOutliers.some(o=>!Number.isFinite(o.absErrorM)||o.absErrorM<=result.outlierM)) throw new Error('Phase 35 terrain QA contains invalid outlier');
  if ((graph?.evidenceNodes||[]).some(e=>e.observationType==='terrain-level'&&e.authority?.osmDerived&&result.worstOutliers.some(o=>o.observationId===e.id))) throw new Error('Phase 35 terrain QA used OSM-derived terrain-level evidence');
  return result;
}

function compiledSurfaceIndex(c,datumM){const m=new Map();for(const ch of c.chunks||[])for(const op of ch.o||[]){if(op[0]!==PHASE)continue;const spec=c.palette[op[7]],name=typeof spec==='string'?spec:spec?.name;if(!name||name==='minecraft:air')continue;const h=surfaceHeight(name,spec);for(let z=Math.min(op[3],op[6]);z<=Math.max(op[3],op[6]);z++)for(let x=Math.min(op[1],op[4]);x<=Math.max(op[1],op[4]);x++){const top=datumM+Math.max(op[2],op[5])+h,k=key(x,z),old=m.get(k);if(old==null||top>old)m.set(k,top);}}return m;}
function surfaceHeight(name,spec){if(name.includes('slab')){const top=spec?.states?.top_slot_bit;return top===true?1:0.5;}return 1;}
function nearestSurface(index,x,z,r){let best=null;for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){const xx=Math.round(x)+dx,zz=Math.round(z)+dz,e=index.get(key(xx,zz));if(e==null)continue;const d=Math.hypot(xx-x,zz-z);if(!best||d<best.distance)best={x:xx,z:zz,elevationM:e,distance:d};}return best;}
function validateCompilation(c){if(!c||!c.meta||!Array.isArray(c.palette)||!Array.isArray(c.chunks))throw new Error('Phase 35 terrain QA rejected unsupported compilation schema');for(const ch of c.chunks){if(!Array.isArray(ch.o))throw new Error('Phase 35 terrain QA rejected malformed chunk');for(const op of ch.o)if(!Array.isArray(op)||op.length!==8||!op.slice(0,7).every(Number.isFinite)||!Number.isInteger(op[7])||op[7]<0||op[7]>=c.palette.length)throw new Error('Phase 35 terrain QA rejected malformed native operation');}}
function percentile(a,p){if(!a.length)return 0;return a[Math.min(a.length-1,Math.max(0,Math.ceil(a.length*p)-1))];}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}function key(x,z){return`${x},${z}`;}function round3(v){return Math.round(Number(v)*1000)/1000;}function bounded(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;}
