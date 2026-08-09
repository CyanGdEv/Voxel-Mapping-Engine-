import test from "node:test";
import assert from "node:assert/strict";
import { decomposeBuildingRoofPlanes, validateBuildingRoofPlaneDecompositions } from "../src/lib/building-roof-plane-decomposition.mjs";

function building(form="pitched") {
  return {
    id:"building:1", type:"building",
    geometry:{ local:{ type:"Polygon", coordinates:[[[0,0],[20,0],[20,10],[0,10],[0,0]]] } },
    authority:{ geometry:"planning-data", planningAuthoritative:true, osmDerived:false },
    buildingReconstruction:{ roof:{ form, eaveElevationM:100, ridgeElevationM:106, ridgeDirectionDeg:0, confidence:0.9 } }
  };
}
function graph(node){return{nodes:[node],summary:{}};}

test("flat roof becomes one explicit plane with eaves",()=>{
  const b=building("flat");
  b.buildingReconstruction.roof.eaveElevationM=105;
  b.buildingReconstruction.roof.ridgeElevationM=105;
  const g=graph(b);
  decomposeBuildingRoofPlanes(g,null,{});
  assert.equal(b.roofPlaneDecomposition.status,"resolved");
  assert.equal(b.roofPlaneDecomposition.planes.length,1);
  assert.equal(b.roofPlaneDecomposition.ridges.length,0);
  assert.equal(b.roofPlaneDecomposition.eaves.length,4);
  validateBuildingRoofPlaneDecompositions(g);
});

test("pitched DSM produces explicit sloped roof planes and ridge",()=>{
  const b=building("pitched");
  const dsm={sampleDsmLocal(x,z){return 100+Math.min(z,10-z)*1.2;}};
  const g=graph(b);
  decomposeBuildingRoofPlanes(g,{elevation:dsm},{buildingRoofPlaneSampleStepM:1});
  assert.ok(b.roofPlaneDecomposition.planes.length>=1);
  assert.ok(b.roofPlaneDecomposition.planes.some(p=>p.slopeDeg>5));
  assert.ok(b.roofPlaneDecomposition.ridges.length<=1);
  validateBuildingRoofPlaneDecompositions(g);
});

test("missing DSM leaves non-flat roof unresolved instead of fabricating planes",()=>{
  const b=building("pitched");
  const g=graph(b);
  decomposeBuildingRoofPlanes(g,{elevation:{sampleLocal(){return 90;}}},{});
  assert.equal(b.roofPlaneDecomposition.status,"unresolved");
  assert.equal(b.roofPlaneDecomposition.planes.length,0);
});

test("planning-only roof decomposition rejects OSM building geometry",()=>{
  const b=building("flat");
  b.authority.osmDerived=true;
  assert.throws(()=>decomposeBuildingRoofPlanes(graph(b),null,{}),/rejected OSM/);
});
