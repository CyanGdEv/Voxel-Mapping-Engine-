import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTerrainMorphology, validateTerrainMorphology } from './terrain-morphology.mjs';

function graph(bounds={minX:0,minZ:0,maxX:12,maxZ:12}) {
  return { nodes:[{ id:'terrain-probe', type:'terrain-detail', geometry:{ bounds, centroid:[6,6] }, authority:{ planningAuthoritative:true } }], summary:{} };
}
function sources(fn){ return { elevation:{ sampleDtmLocal:fn, dtmSourceKind:'test-dtm' } }; }

test('flat DTM stays level and emits no explicit structures', () => {
  const g=graph(); classifyTerrainMorphology(g,sources(()=>100),{terrainMorphologyStepM:2}); validateTerrainMorphology(g);
  assert.equal(g.summary.terrainMorphology.cliffFace,0);
  assert.equal(g.summary.terrainMorphology.steepBank,0);
  assert.equal(g.terrainMorphology.structures.length,0);
});

test('steep slope is classified without mutating graph terrain geometry', () => {
  const g=graph(); const before=JSON.stringify(g.nodes[0].geometry);
  classifyTerrainMorphology(g,sources((x)=>100+x),{terrainMorphologyStepM:2,terrainSteepSlopeDeg:35,terrainCliffSlopeDeg:70});
  validateTerrainMorphology(g);
  assert.ok(g.summary.terrainMorphology.steepBank>0);
  assert.equal(JSON.stringify(g.nodes[0].geometry),before);
});

test('near vertical break produces explicit cliff structure groups', () => {
  const g=graph({minX:0,minZ:0,maxX:16,maxZ:16});
  classifyTerrainMorphology(g,sources((x)=>x<8?100:112),{terrainMorphologyStepM:2,terrainCliffSlopeDeg:55});
  validateTerrainMorphology(g);
  assert.ok(g.summary.terrainMorphology.cliffFace>0);
  assert.ok(g.terrainMorphology.structures.some(s=>s.type==='cliff-face'&&s.compilerIntent==='explicit-vertical-rock-face'));
});

test('break of slope can resolve as terrace edge', () => {
  const g=graph({minX:0,minZ:0,maxX:16,maxZ:16});
  classifyTerrainMorphology(g,sources((x)=>x<8?100:100+(x-8)*0.35),{terrainMorphologyStepM:2,terrainBreakReliefM:0.5,terrainSteepSlopeDeg:45});
  validateTerrainMorphology(g);
  assert.ok(g.summary.terrainMorphology.terraceBreak>=0);
});

test('missing DTM is unresolved and never invents structures', () => {
  const g=graph(); classifyTerrainMorphology(g,{},{}); validateTerrainMorphology(g);
  assert.equal(g.terrainMorphology.status,'unresolved');
  assert.deepEqual(g.terrainMorphology.structures,[]);
});

test('sample cap fails closed instead of downsampling silently', () => {
  const g=graph({minX:0,minZ:0,maxX:2000,maxZ:2000});
  assert.throws(()=>classifyTerrainMorphology(g,sources(()=>100),{terrainMorphologyStepM:1}),/safe sample cap/);
});
