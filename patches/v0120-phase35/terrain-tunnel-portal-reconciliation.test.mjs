import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTerrainWithRideExcavation, validateTerrainTunnelPortalReconciliation } from './terrain-tunnel-portal-reconciliation.mjs';

function compilation(){return{meta:{elevationDatumM:100,bounds:{minX:-16,minZ:-16,maxX:16,maxZ:16}},palette:['minecraft:stone','minecraft:dirt','minecraft:air','minecraft:blue_concrete'],chunks:[{x:0,z:0,o:[[6,0,4,4,6,4,4,0],[6,0,4,8,6,4,8,0],[9,2,4,4,4,4,4,3]]}],stats:{operations:3,rawOperations:3}};}
function mask(cells){return{marker:'TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1',cells,spans:[],diagnostics:{}};}
const tunnel=[
  {x:2,y:104,z:4,mode:'tunnel',rideId:'r1',measureM:10},
  {x:3,y:104,z:4,mode:'tunnel',rideId:'r1',measureM:11},
  {x:4,y:104,z:4,mode:'tunnel',rideId:'r1',measureM:12}
];

test('verified tunnel splits only overlapping phase-6 terrain and emits no air',()=>{
  const c=compilation(),d=reconcileTerrainWithRideExcavation(c,mask(tunnel),{terrainTunnelPortalMouthDepthM:0.25});
  assert.equal(d.terrainVoxelsRemoved,3); assert.equal(d.emittedAirOperations,0);
  const phase6=c.chunks.flatMap(ch=>ch.o).filter(op=>op[0]===6&&op[3]===4);
  assert.deepEqual(phase6.map(op=>[op[1],op[4]]),[[0,1],[5,6]]);
  assert.ok(c.chunks.flatMap(ch=>ch.o).some(op=>op[0]===6&&op[3]===8&&op[1]===0&&op[4]===6));
  validateTerrainTunnelPortalReconciliation(c,mask(tunnel),d);
});

test('portal mouth detection uses first and last verified tunnel measures',()=>{
  const c=compilation(),d=reconcileTerrainWithRideExcavation(c,mask(tunnel),{terrainTunnelPortalMouthDepthM:0.25});
  assert.equal(d.portalMouthsDetected,2); assert.equal(d.portalMouthCells,2); assert.equal(d.portalTerrainVoxelsRemoved,2);
});

test('cutting overlap is reconciled but never promoted to a tunnel portal',()=>{
  const cells=[{x:3,y:104,z:4,mode:'cutting',rideId:'r1',measureM:11}];
  const c=compilation(),d=reconcileTerrainWithRideExcavation(c,mask(cells));
  assert.equal(d.cuttingTerrainVoxelsRemoved,1); assert.equal(d.portalMouthsDetected,0); assert.equal(d.portalMouthCells,0);
});

test('no overlap is exact compilation no-op',()=>{
  const cells=[{x:12,y:104,z:12,mode:'tunnel',rideId:'r1',measureM:1}];
  const c=compilation(),before=JSON.stringify(c),d=reconcileTerrainWithRideExcavation(c,mask(cells));
  assert.equal(d.status,'no-op'); assert.equal(JSON.stringify(c),before);
});

test('compiler datum translation matches absolute excavation elevations',()=>{
  const c=compilation(); const d=reconcileTerrainWithRideExcavation(c,mask([{x:3,y:104,z:4,mode:'tunnel',rideId:'r1',measureM:1}]));
  assert.equal(d.terrainVoxelsRemoved,1);
});

test('unverified mask marker fails closed before mutation',()=>{
  const c=compilation(),before=JSON.stringify(c);
  assert.throws(()=>reconcileTerrainWithRideExcavation(c,{marker:'wrong',cells:tunnel}),/verified Phase 34 excavation mask/);
  assert.equal(JSON.stringify(c),before);
});

test('duplicate excavation voxels fail closed',()=>{
  const c=compilation(); const duplicate=[tunnel[0],{...tunnel[0]}];
  assert.throws(()=>reconcileTerrainWithRideExcavation(c,mask(duplicate)),/duplicate excavation voxel/);
});
