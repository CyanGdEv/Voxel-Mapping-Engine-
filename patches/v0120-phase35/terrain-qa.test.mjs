import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTerrainCompilationQA, validateTerrainCompilationQA } from './terrain-qa.mjs';

function compilation(){return{meta:{elevationDatumM:100},palette:['minecraft:stone','minecraft:normal_stone_slab','minecraft:air'],chunks:[{x:0,z:0,o:[[6,4,3,4,4,3,4,0],[6,6,3,4,6,3,4,1]]}],stats:{}};}
function graph(){return{terrainMorphology:{marker:'TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1',structures:[{id:'s1',type:'cliff-face',cellCount:2,cells:[{x:4,z:4,elevationM:104},{x:6,z:4,elevationM:103.5}],engineering:{classification:'natural-rock-face'}}]},evidenceNodes:[],summary:{}};}

test('compiled phase-6 surface matches DTM including half slab height',()=>{const c=compilation(),g=graph(),before=JSON.stringify(c.chunks);const r=evaluateTerrainCompilationQA(c,g);assert.equal(r.status,'passed');assert.equal(r.dtmCompared,2);assert.equal(r.maxAbsErrorM,0);assert.equal(JSON.stringify(c.chunks),before);validateTerrainCompilationQA(c,g,r);});

test('vertical overbuild is reported without mutating geometry',()=>{const c=compilation(),g=graph();g.terrainMorphology.structures[0].cells[0].elevationM=102;const before=JSON.stringify(c.chunks);const r=evaluateTerrainCompilationQA(c,g,{terrainQaOutlierErrorM:1});assert.equal(r.status,'warning');assert.equal(r.overbuild,1);assert.equal(r.outliers,1);assert.equal(JSON.stringify(c.chunks),before);});

test('vertical underbuild is reported',()=>{const c=compilation(),g=graph();g.terrainMorphology.structures[0].cells[0].elevationM=106;const r=evaluateTerrainCompilationQA(c,g,{terrainQaOutlierErrorM:1});assert.equal(r.underbuild,1);assert.ok(r.worstOutliers.some(o=>o.errorM<0));});

test('missing compiled terrain stays unresolved instead of fabricated',()=>{const c=compilation(),g=graph();g.terrainMorphology.structures[0].cells.push({x:12,z:12,elevationM:104});g.terrainMorphology.structures[0].cellCount=3;const r=evaluateTerrainCompilationQA(c,g);assert.equal(r.status,'partial');assert.equal(r.unresolved,1);});

test('planning terrain-level observation compares against nearest compiled surface',()=>{const c=compilation(),g=graph();g.evidenceNodes=[{id:'spot',observationType:'terrain-level',authority:{planningAuthoritative:true,osmDerived:false},geometry:{centroid:[4.2,4]},vertical:{explicitElevationM:104}}];const r=evaluateTerrainCompilationQA(c,g);assert.equal(r.planningCompared,1);assert.equal(r.maxAbsErrorM,0);});

test('OSM terrain-level evidence is ignored',()=>{const c=compilation(),g=graph();g.evidenceNodes=[{id:'osm',observationType:'terrain-level',authority:{planningAuthoritative:false,osmDerived:true},geometry:{centroid:[4,4]},vertical:{explicitElevationM:130}}];const r=evaluateTerrainCompilationQA(c,g);assert.equal(r.planningCompared,0);assert.equal(r.maxAbsErrorM,0);validateTerrainCompilationQA(c,g,r);});

test('malformed morphology exact-cell contract fails closed',()=>{const c=compilation(),g=graph();g.terrainMorphology.structures[0].cellCount=3;assert.throws(()=>evaluateTerrainCompilationQA(c,g),/requires exact cells/);});
