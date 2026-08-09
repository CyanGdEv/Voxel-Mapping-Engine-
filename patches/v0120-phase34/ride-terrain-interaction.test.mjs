import test from "node:test";
import assert from "node:assert/strict";
import { classifyRideTerrainInteractions, validateRideTerrainInteractions } from "./ride-terrain-interaction.mjs";

function graph(samples, osm=false){return{nodes:[{id:"ride:1",type:"ride-track",authority:{osmDerived:osm},geometry3d:{samples}}]};}
const dtm={elevation:{sampleDtmLocal(){return 100;}}};

test("classifies elevated near-grade cutting and tunnel samples",()=>{
  const g=graph([
    {measureM:0,x:0,y:103,z:0,resolved:true},
    {measureM:1,x:1,y:100.2,z:0,resolved:true},
    {measureM:2,x:2,y:99,z:0,resolved:true},
    {measureM:3,x:3,y:97,z:0,resolved:true},
    {measureM:4,x:4,y:97,z:0,resolved:true}
  ]);
  classifyRideTerrainInteractions(g,dtm);
  validateRideTerrainInteractions(g);
  assert.deepEqual(g.nodes[0].terrainInteraction.samples.map(s=>s.status),["elevated","near-grade","cutting","tunnel","tunnel"]);
  assert.ok(g.nodes[0].terrainInteraction.excavationIntervals.length>=1);
});

test("unresolved track Y never fabricates clearance",()=>{
  const g=graph([{measureM:0,x:0,y:null,z:0,resolved:false},{measureM:1,x:1,y:103,z:0,resolved:true}]);
  classifyRideTerrainInteractions(g,dtm);
  assert.equal(g.nodes[0].terrainInteraction.samples[0].status,"unresolved");
  assert.equal(g.nodes[0].terrainInteraction.samples[0].clearanceM,null);
  validateRideTerrainInteractions(g);
});

test("missing DTM keeps ride interaction unresolved",()=>{
  const g=graph([{measureM:0,x:0,y:103,z:0,resolved:true},{measureM:1,x:1,y:103,z:0,resolved:true}]);
  classifyRideTerrainInteractions(g,null);
  assert.equal(g.nodes[0].terrainInteraction.status,"unresolved");
});

test("rejects OSM-derived ride geometry",()=>{
  const g=graph([{measureM:0,x:0,y:103,z:0,resolved:true}],true);
  assert.throws(()=>classifyRideTerrainInteractions(g,dtm),/OSM-derived ride/);
});
