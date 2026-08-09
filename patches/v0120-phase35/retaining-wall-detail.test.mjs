import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRetainingWallDetailToCompilation, validateRetainingWallDetailCompilation } from './retaining-wall-detail.mjs';

function compilation(){return{meta:{elevationDatumM:100},palette:['minecraft:stone_bricks','minecraft:air'],chunks:[{x:0,z:0,o:[[6,4,1,4,4,4,4,0]]}],stats:{operations:1,rawOperations:1}};}
function graph(tags={}){const node={id:'wall',geometry:{bounds:{minX:4,minZ:0,maxX:4.4,maxZ:8}},authority:{planningAuthoritative:true,osmDerived:false}};Object.defineProperty(node,'sourceFeature',{enumerable:false,value:{tags}});return{nodes:[node],terrainPlanningAssociation:{marker:'TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1'},terrainMorphology:{marker:'TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1',structures:[{id:'s',type:'cliff-face',cellCount:1,cells:[{x:4,z:4,localMinElevationM:101,localMaxElevationM:104}],engineering:{classification:'retaining-wall',planningNodeId:'wall'}}]}};}

test('explicit material refines wall body while DTM keeps vertical extent',()=>{const c=compilation(),d=applyRetainingWallDetailToCompilation(c,graph({material:'concrete'}));assert.equal(d.status,'applied');assert.equal(d.materialWalls,1);const ops=c.chunks.flatMap(ch=>ch.o).filter(op=>op[0]===6&&c.palette[op[7]]==='minecraft:smooth_stone');assert.equal(ops.length,4);assert.deepEqual(ops.map(op=>op[2]).sort((a,b)=>a-b),[1,2,3,4]);validateRetainingWallDetailCompilation(c,d);});

test('explicit thickness expands only axis-aligned wall normal',()=>{const c=compilation(),d=applyRetainingWallDetailToCompilation(c,graph({width:3,material:'stone'}));assert.equal(d.explicitThicknessWalls,1);const xs=new Set(c.chunks.flatMap(ch=>ch.o).filter(op=>op[0]===6&&c.palette[op[7]]==='minecraft:stone_bricks').map(op=>op[1]));assert.ok(xs.has(3)&&xs.has(4)&&xs.has(5));});

test('diagonal or broad bounds do not guess thickness expansion',()=>{const g=graph({width:4,material:'concrete'});g.nodes[0].geometry.bounds={minX:0,minZ:0,maxX:8,maxZ:8};const c=compilation();applyRetainingWallDetailToCompilation(c,g);const coords=c.chunks.flatMap(ch=>ch.o).filter(op=>op[0]===6&&c.palette[op[7]]==='minecraft:smooth_stone').map(op=>`${op[1]}:${op[3]}`);assert.ok(coords.every(v=>v==='4:4'));});

test('explicit coping replaces the measured top course without height growth',()=>{const c=compilation(),d=applyRetainingWallDetailToCompilation(c,graph({coping:'yes'}));assert.equal(d.explicitCapWalls,1);assert.ok(c.chunks.flatMap(ch=>ch.o).some(op=>op[0]===6&&op[1]===4&&op[2]===4&&op[3]===4));assert.ok(!c.chunks.flatMap(ch=>ch.o).some(op=>op[0]===6&&op[2]>4));});

test('no explicit planning detail is exact no-op',()=>{const c=compilation(),before=JSON.stringify(c),d=applyRetainingWallDetailToCompilation(c,graph());assert.equal(d.status,'no-op');assert.equal(JSON.stringify(c),before);});

test('generic or invalid authority fails closed',()=>{const g=graph({material:'stone'});g.nodes[0].authority.osmDerived=true;const c=compilation(),before=JSON.stringify(c);assert.throws(()=>applyRetainingWallDetailToCompilation(c,g),/valid planning authority/);assert.equal(JSON.stringify(c),before);});

test('wall detail never emits air',()=>{const c=compilation(),d=applyRetainingWallDetailToCompilation(c,graph({material:'stone',coping:true}));validateRetainingWallDetailCompilation(c,d);assert.ok(c.chunks.flatMap(ch=>ch.o).filter(op=>op[0]===6).every(op=>(typeof c.palette[op[7]]==='string'?c.palette[op[7]]:c.palette[op[7]].name)!=='minecraft:air'));});
