import test from "node:test";
import assert from "node:assert/strict";
import { reconstructVegetation, validateVegetationReconstructions } from "./vegetation-reconstruction.mjs";

function graph(node){return {authorityMode:"planning-only",nodes:[node],summary:{}};}
function poly(){return {type:"Polygon",coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]]]};}
function veg(extra={}){return {id:"veg-1",type:"vegetation",geometry:{local:poly(),centroid:[5,5]},authority:{geometry:"planning-data",planningAuthoritative:true,osmDerived:false},vertical:{},sourceFeature:{tags:{}},semantics:{planningClass:"tree canopy"},...extra};}

const sources={elevation:{sampleDtmLocal:()=>100,sampleDsmLocal:(x,z)=>110+((x+z)%3),dtmSourceKind:"lidar-dtm",dsmSourceKind:"lidar-dsm"}};

test("derives vegetation height from independent DTM and DSM",()=>{const g=graph(veg());reconstructVegetation(g,sources,{vegetationSampleStepM:2});validateVegetationReconstructions(g);const v=g.nodes[0].vegetationReconstruction;assert.equal(v.status,"resolved");assert.equal(v.groundElevationM,100);assert.ok(v.canopyTopElevationM>110);assert.ok(v.heightM>10);assert.ok(v.crownAreaM2>90);});

test("planning height overrides sampled canopy height",()=>{const n=veg({vertical:{heightM:17}});const g=graph(n);reconstructVegetation(g,sources);assert.equal(g.nodes[0].vegetationReconstruction.heightM,17);assert.equal(g.nodes[0].vegetationReconstruction.authority.height,"planning-vertical");});

test("generic ground-only sampler never fabricates canopy top",()=>{const g=graph(veg());reconstructVegetation(g,{elevation:{sampleLocal:()=>99,sourceKind:"terrain"}});const v=g.nodes[0].vegetationReconstruction;assert.equal(v.groundElevationM,99);assert.equal(v.canopyTopElevationM,null);assert.equal(v.heightM,null);assert.notEqual(v.status,"resolved");});

test("point vegetation is classified as an individual tree",()=>{const n=veg({geometry:{local:{type:"Point",coordinates:[4,4]},centroid:[4,4]},sourceFeature:{tags:{crown_diameter_m:8}}});const g=graph(n);reconstructVegetation(g,sources);assert.equal(g.nodes[0].vegetationReconstruction.classification,"individual-tree");assert.ok(g.nodes[0].vegetationReconstruction.crownAreaM2>50);});

test("woodland semantics remain woodland",()=>{const n=veg({semantics:{planningClass:"retained woodland"}});const g=graph(n);reconstructVegetation(g,sources);assert.equal(g.nodes[0].vegetationReconstruction.classification,"woodland");});

test("rejects OSM-derived vegetation geometry",()=>{const n=veg({authority:{geometry:"osm",planningAuthoritative:false,osmDerived:true}});const g=graph(n);assert.throws(()=>reconstructVegetation(g,sources),/OSM-derived/);});
