import test from "node:test";
import assert from "node:assert/strict";
import { applyBuildingRoofPlanningConstraints, validateBuildingRoofPlanningConstraints } from "../src/lib/building-roof-planning-constraints.mjs";

function building(){return {id:"building:1",type:"building",geometry:{centroid:[10,10]},authority:{planningAuthoritative:true,osmDerived:false},evidence:{planningReference:"APP-1",sourceHash:"DOC-1"},buildingReconstruction:{baseElevationM:100,topElevationM:110,heightM:10,roof:{form:"pitched",eaveElevationM:107,ridgeElevationM:110,ridgeDirectionDeg:0}},roofPlaneDecomposition:{planes:[{slopeDeg:20},{slopeDeg:20}],ridges:[{start:[5,10],end:[15,10],elevationM:110}],eaves:[{elevationM:107},{elevationM:107}]}};}
function obs(id,role,value,x=10,z=10){return {id,observationType:"building-level",geometry:{centroid:[x,z]},vertical:{explicitElevationM:value},semantics:{planningRole:role},authority:{planningAuthoritative:true,osmDerived:false},evidence:{planningReference:"APP-1",sourceHash:"DOC-1"},sourceFeature:{tags:{}}};}
function graph(b,evidenceNodes){return {authorityMode:"planning-only",nodes:[b],evidenceNodes,summary:{}};}

test("planning ridge/eave levels override DSM-derived roof levels and record conflicts",()=>{const b=building();const g=graph(b,[obs("ridge","RIDGE LEVEL",112.5),obs("eave","EAVES LEVEL",108.25)]);applyBuildingRoofPlanningConstraints(g);assert.equal(b.buildingReconstruction.roof.ridgeElevationM,112.5);assert.equal(b.buildingReconstruction.roof.eaveElevationM,108.25);assert.equal(b.roofPlaneDecomposition.ridges[0].elevationM,112.5);assert.equal(b.roofPlaneDecomposition.eaves[0].elevationM,108.25);assert.ok(b.roofPlanningConstraints.conflicts.length>=1);validateBuildingRoofPlanningConstraints(g);});

test("planning pitch and ridge direction constrain explicit roof planes",()=>{const b=building();const pitch=obs("pitch","roof pitch",35);pitch.semantics.valueDeg=35;const dir=obs("dir","ridge direction",90);dir.semantics.directionDeg=90;const g=graph(b,[pitch,dir]);applyBuildingRoofPlanningConstraints(g);assert.equal(b.roofPlaneDecomposition.planes[0].slopeDeg,35);assert.equal(b.buildingReconstruction.roof.ridgeDirectionDeg,90);assert.equal(b.roofPlaneDecomposition.planes[0].authority.slope,"planning-section");});

test("different planning document cannot constrain neighboring building",()=>{const b=building();const bad=obs("ridge","ridge level",120);bad.evidence.sourceHash="DOC-OTHER";const g=graph(b,[bad]);applyBuildingRoofPlanningConstraints(g);assert.equal(b.roofPlanningConstraints.status,"unresolved");assert.equal(b.buildingReconstruction.roof.ridgeElevationM,110);});

test("distant planning constraint is rejected",()=>{const b=building();const far=obs("ridge","ridge level",120,200,200);const g=graph(b,[far]);applyBuildingRoofPlanningConstraints(g,{buildingRoofConstraintMaxDistanceM:30});assert.equal(b.roofPlanningConstraints.status,"unresolved");});

test("OSM-derived roof evidence is never accepted",()=>{const b=building();const bad=obs("ridge","ridge level",120);bad.authority.osmDerived=true;const g=graph(b,[bad]);applyBuildingRoofPlanningConstraints(g);assert.equal(b.roofPlanningConstraints.status,"unresolved");});
