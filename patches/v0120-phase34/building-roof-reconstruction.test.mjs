import test from "node:test";
import assert from "node:assert/strict";
import { reconstructBuildingRoofs, validateBuildingReconstructions } from "../src/lib/building-roof-reconstruction.mjs";

function building(id="b1") { return { id, type:"building", geometry:{ local:{ type:"Polygon", coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]]] } }, vertical:{ baseElevationM:null, topElevationM:null }, terrainSurface:{ dtmElevationM:null, dsmElevationM:null }, authority:{ geometry:"planning-data", planningAuthoritative:true, osmDerived:false }, evidence:{} }; }
function graph(nodes){ return { authorityMode:"planning-only", nodes, summary:{} }; }

test("footprint sampling resolves flat roof from DTM and DSM",()=>{ const g=graph([building()]); const sources={ elevation:{ sampleDtmLocal:()=>100, sampleDsmLocal:()=>108 } }; reconstructBuildingRoofs(g,sources); const b=g.nodes[0].buildingReconstruction; assert.equal(b.status,"resolved"); assert.equal(b.baseElevationM,100); assert.equal(b.topElevationM,108); assert.equal(b.heightM,8); assert.equal(b.roof.form,"flat"); validateBuildingReconstructions(g); });

test("sloped DSM resolves pitched or shed roof and preserves planning footprint",()=>{ const g=graph([building()]); const sources={ elevation:{ sampleDtmLocal:()=>100, sampleDsmLocal:(x,z)=>104+x*0.5 } }; reconstructBuildingRoofs(g,sources,{buildingSurfaceSampleStepM:2}); const b=g.nodes[0].buildingReconstruction; assert.ok(["shed","pitched"].includes(b.roof.form)); assert.ok(b.roof.reliefM>1.5); assert.ok(Number.isFinite(b.roof.ridgeDirectionDeg)); });

test("planning base and top outrank sampled surfaces",()=>{ const b=building(); b.vertical.baseElevationM=102; b.vertical.topElevationM=115; const g=graph([b]); reconstructBuildingRoofs(g,{elevation:{sampleDtmLocal:()=>100,sampleDsmLocal:()=>109}}); assert.equal(b.buildingReconstruction.baseElevationM,102); assert.equal(b.buildingReconstruction.topElevationM,115); assert.equal(b.buildingReconstruction.authority.base,"planning-vertical"); });

test("generic sampler alone never fabricates a roof",()=>{ const g=graph([building()]); reconstructBuildingRoofs(g,{elevation:{sampleLocal:()=>100}}); const b=g.nodes[0].buildingReconstruction; assert.equal(b.baseElevationM,100); assert.equal(b.topElevationM,null); assert.equal(b.roof.form,"unresolved"); });

test("planning-only reconstruction rejects OSM building geometry",()=>{ const b=building(); b.authority.osmDerived=true; assert.throws(()=>reconstructBuildingRoofs(graph([b]),{elevation:{sampleDtmLocal:()=>100,sampleDsmLocal:()=>108}}),/OSM-derived building/); });
