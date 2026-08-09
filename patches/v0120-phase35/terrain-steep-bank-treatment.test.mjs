import test from 'node:test';
import assert from 'node:assert/strict';
import { applySteepBankTreatmentToCompilation, validateSteepBankTreatmentCompilation } from './terrain-steep-bank-treatment.mjs';

function compilation(){return{meta:{elevationDatumM:100},palette:['minecraft:grass_block','minecraft:air'],chunks:[{x:0,z:0,o:[[1,0,0,0,15,0,15,0]]}],stats:{operations:1,rawOperations:1}};}
function graph({classification='natural-steep-bank',elevationM=103.5,slopeDeg=42,step=1}={}){const s={id:'terrain-structure:0',type:'steep-bank',cellCount:1,sampleStepM:step,cells:[{x:4,z:4,elevationM,slopeDeg,localMinElevationM:101,localMaxElevationM:104}],engineering:{classification,source:classification==='natural-steep-bank'?'dtm-only':'planning+dtm'}};return{terrainMorphology:{marker:'TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1',structures:[s]},terrainPlanningAssociation:{marker:'TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1'}};}

test('natural steep bank emits exact half-block treatment at phase 6',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph());assert.equal(d.status,'applied');assert.equal(d.treatedVoxels,1);const ops=c.chunks.flatMap(ch=>ch.o).filter(op=>op[0]===6);assert.equal(ops.length,1);assert.deepEqual(ops[0].slice(1,7),[4,3,4,4,3,4]);assert.ok(['minecraft:normal_stone_slab','minecraft:cobblestone_slab','minecraft:mossy_cobblestone_slab'].includes(c.palette[ops[0][7]]));validateSteepBankTreatmentCompilation(c,d);});

test('non half-block fraction is exact no-op',()=>{const c=compilation(),before=JSON.stringify(c),d=applySteepBankTreatmentToCompilation(c,graph({elevationM:103.9}));assert.equal(d.status,'no-op');assert.equal(JSON.stringify(c),before);});

test('engineered cutting is never treated as natural steep bank',()=>{const c=compilation(),before=JSON.stringify(c),d=applySteepBankTreatmentToCompilation(c,graph({classification:'cutting'}));assert.equal(d.status,'no-op');assert.equal(JSON.stringify(c),before);});

test('low slope fails closed even if supplied inside malformed steep-bank group',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph({slopeDeg:20}));assert.equal(d.status,'no-op');assert.equal(d.skippedSlope,1);});

test('sample footprint stays bounded to morphology cell resolution',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph({step:2}));assert.equal(d.treatedVoxels,4);const coords=c.chunks.flatMap(ch=>ch.o).filter(op=>op[0]===6).map(op=>`${op[1]}:${op[3]}`).sort();assert.deepEqual(coords,['3:3','3:4','4:3','4:4']);});

test('treatment never emits air or directional stairs',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph());const blocks=c.chunks.flatMap(ch=>ch.o).filter(op=>op[0]===6).map(op=>c.palette[op[7]]);assert.ok(blocks.every(b=>b!=='minecraft:air'&&!b.endsWith('_stairs')));assert.equal(d.stairsDeferred,true);});

test('invalid morphology marker fails closed before mutation',()=>{const c=compilation(),before=JSON.stringify(c),g=graph();g.terrainMorphology.marker='bad';assert.throws(()=>applySteepBankTreatmentToCompilation(c,g),/requires morphology model/);assert.equal(JSON.stringify(c),before);});
