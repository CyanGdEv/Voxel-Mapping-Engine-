import test from 'node:test';
import assert from 'node:assert/strict';
import { associatePlanningTerrainStructures, validatePlanningTerrainStructures } from './terrain-planning-structure-association.mjs';

function graphWith(nodes, structures){
  return {
    nodes,
    terrainMorphology:{marker:'TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1',status:'resolved',structures},
    summary:{terrainMorphology:{marker:'TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1'}}
  };
}
function planningNode(id, subtype, bounds, extraTags={}){
  const node={
    id, sourceFeatureId:id, type:'barrier', subtype,
    geometry:{bounds,centroid:[(bounds.minX+bounds.maxX)/2,(bounds.minZ+bounds.maxZ)/2]},
    authority:{planningAuthoritative:true,osmDerived:false},
    confidence:{overall:0.95}, evidence:{planningReference:'APP-1',sourceHash:'sha'},
  };
  Object.defineProperty(node,'sourceFeature',{enumerable:false,value:{tags:{...extraTags}}});
  return node;
}
function structure(type='cliff-face'){return {id:'terrain-structure:0',type,cellCount:5,bounds:{minX:0,minZ:0,maxX:4,maxZ:4},compilerIntent:'x'};}

test('planning retaining wall promotes nearby DTM cliff to engineered retaining wall',()=>{
  const g=graphWith([planningNode('wall','planning-retaining-wall',{minX:4,minZ:0,maxX:4.5,maxZ:4})],[structure('cliff-face')]);
  const d=associatePlanningTerrainStructures(g);
  assert.equal(d.retainingWalls,1);
  assert.equal(g.terrainMorphology.structures[0].engineering.classification,'retaining-wall');
  assert.equal(g.terrainMorphology.structures[0].engineering.source,'planning+dtm');
  validatePlanningTerrainStructures(g);
});

test('generic fence near cliff does not become retaining wall',()=>{
  const g=graphWith([planningNode('fence','planning-fence',{minX:4,minZ:0,maxX:4.5,maxZ:4},{barrier:'fence'})],[structure('cliff-face')]);
  associatePlanningTerrainStructures(g);
  assert.equal(g.terrainMorphology.structures[0].engineering.classification,'natural-rock-face');
  assert.equal(g.terrainMorphology.structures[0].planningAssociations.length,0);
});

test('planning cutting and embankment remain distinct',()=>{
  const a=planningNode('cut','planning-cutting',{minX:0,minZ:4,maxX:2,maxZ:5});
  const g=graphWith([a],[structure('steep-bank')]);
  associatePlanningTerrainStructures(g);
  assert.equal(g.terrainMorphology.structures[0].engineering.classification,'cutting');
  const b=planningNode('fill','planning-embankment',{minX:0,minZ:4,maxX:2,maxZ:5});
  const h=graphWith([b],[structure('steep-bank')]);
  associatePlanningTerrainStructures(h);
  assert.equal(h.terrainMorphology.structures[0].engineering.classification,'embankment');
});

test('distant planning structure does not override DTM morphology',()=>{
  const g=graphWith([planningNode('wall','planning-retaining-wall',{minX:100,minZ:100,maxX:110,maxZ:110})],[structure('terrace-break')]);
  associatePlanningTerrainStructures(g,{terrainPlanningAssociationDistanceM:8});
  assert.equal(g.terrainMorphology.structures[0].engineering.classification,'natural-terrace-break');
});

test('OSM-derived engineering evidence fails validation if attached',()=>{
  const g=graphWith([], [structure('cliff-face')]);
  associatePlanningTerrainStructures(g);
  g.terrainMorphology.structures[0].engineering={classification:'retaining-wall',planningNodeId:'osm'};
  g.nodes.push({id:'osm',authority:{planningAuthoritative:true,osmDerived:true}});
  assert.throws(()=>validatePlanningTerrainStructures(g),/invalid planning association/);
});
