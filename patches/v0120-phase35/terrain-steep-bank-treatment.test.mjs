import test from 'node:test';
import assert from 'node:assert/strict';
import { applySteepBankTreatmentToCompilation, validateSteepBankTreatmentCompilation } from './terrain-steep-bank-treatment.mjs';

function compilation(){return{meta:{elevationDatumM:100},palette:['minecraft:grass_block','minecraft:air'],chunks:[{x:0,z:0,o:[[1,0,0,0,15,0,15,0]]}],stats:{operations:1,rawOperations:1}};}
function graph({classification='natural-steep-bank',elevationM=103.5,slopeDeg=42,step=1,normal=null}={}){const s={id:'terrain-structure:0',type:'steep-bank',cellCount:1,sampleStepM:step,cells:[{x:4,z:4,elevationM,slopeDeg,normal,localMinElevationM:101,localMaxElevationM:104}],engineering:{classification,source:classification==='natural-steep-bank'?'dtm-only':'planning+dtm'}};return{terrainMorphology:{marker:'TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1',structures:[s]},terrainPlanningAssociation:{marker:'TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1'}};}

test('cardinal DTM normal emits correctly stateful stair',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph({normal:{x:-1,y:1,z:0}}));assert.equal(d.status,'applied');assert.equal(d.stairsEmitted,1);const op=c.chunks.flatMap(ch=>ch.o).find(op=>op[0]===6);const spec=c.palette[op[7]];assert.equal(spec.name.startsWith('minecraft:'),true);assert.ok(spec.name.endsWith('_stairs'));assert.deepEqual(spec.states,{upside_down_bit:false,weirdo_direction:0});validateSteepBankTreatmentCompilation(c,d);});

test('west ascent maps to weirdo direction 1',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph({normal:{x:1,y:1,z:0}}));const spec=c.palette[c.chunks.flatMap(ch=>ch.o).find(op=>op[0]===6)[7]];assert.equal(spec.states.weirdo_direction,1);assert.equal(d.stairsEmitted,1);});

test('south and north ascent map to directions 2 and 3',()=>{for(const [normal,expected] of [[{x:0,y:1,z:-1},2],[{x:0,y:1,z:1},3]]){const c=compilation();applySteepBankTreatmentToCompilation(c,graph({normal}));const spec=c.palette[c.chunks.flatMap(ch=>ch.o).find(op=>op[0]===6)[7]];assert.equal(spec.states.weirdo_direction,expected);}});

test('diagonal DTM normal falls back to slab',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph({normal:{x:1,y:1,z:1}}));assert.equal(d.slabsEmitted,1);assert.equal(d.stairsEmitted,0);const block=c.palette[c.chunks.flatMap(ch=>ch.o).find(op=>op[0]===6)[7]];assert.ok(['minecraft:normal_stone_slab','minecraft:cobblestone_slab','minecraft:mossy_cobblestone_slab'].includes(block));});

test('missing DTM normal preserves certified slab fallback',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph());assert.equal(d.slabsEmitted,1);assert.equal(d.stairsEmitted,0);validateSteepBankTreatmentCompilation(c,d);});

test('non half-block fraction is exact no-op without safe stair direction',()=>{const c=compilation(),before=JSON.stringify(c),d=applySteepBankTreatmentToCompilation(c,graph({elevationM:103.9}));assert.equal(d.status,'no-op');assert.equal(JSON.stringify(c),before);});

test('engineered cutting is never treated as natural steep bank',()=>{const c=compilation(),before=JSON.stringify(c),d=applySteepBankTreatmentToCompilation(c,graph({classification:'cutting',normal:{x:-1,y:1,z:0}}));assert.equal(d.status,'no-op');assert.equal(JSON.stringify(c),before);});

test('low slope fails closed even if supplied inside malformed steep-bank group',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph({slopeDeg:20,normal:{x:-1,y:1,z:0}}));assert.equal(d.status,'no-op');assert.equal(d.skippedSlope,1);});

test('sample footprint stays bounded to morphology cell resolution',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph({step:2,normal:null}));assert.equal(d.treatedVoxels,4);const coords=c.chunks.flatMap(ch=>ch.o).filter(op=>op[0]===6).map(op=>`${op[1]}:${op[3]}`).sort();assert.deepEqual(coords,['3:3','3:4','4:3','4:4']);});

test('treatment never emits air',()=>{const c=compilation(),d=applySteepBankTreatmentToCompilation(c,graph({normal:{x:-1,y:1,z:0}}));const blocks=c.chunks.flatMap(ch=>ch.o).filter(op=>op[0]===6).map(op=>c.palette[op[7]]);assert.ok(blocks.every(b=>b!=='minecraft:air'&&b?.name!=='minecraft:air'));assert.equal(d.stairsDeferred,false);});

test('invalid morphology marker fails closed before mutation',()=>{const c=compilation(),before=JSON.stringify(c),g=graph();g.terrainMorphology.marker='bad';assert.throws(()=>applySteepBankTreatmentToCompilation(c,g),/requires morphology model/);assert.equal(JSON.stringify(c),before);});
