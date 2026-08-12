import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRUCTURAL_MATERIAL_PATTERN_MARKER,
  STRUCTURAL_PATTERN_BLOCK_IDS,
  structuralBlockFor,
  structuralMaterialFamily,
  structuralPatternCapabilities
} from '../src/lib/structural-material-pattern-library.mjs';

function blockName(value){return typeof value==='string'?value:value?.name;}

test('structural material library exposes requested Minecraft-native forms',()=>{
  assert.equal(STRUCTURAL_MATERIAL_PATTERN_MARKER,'TPMAP_PHASE35_STRUCTURAL_MATERIAL_PATTERN_LIBRARY_V1');
  const c=structuralPatternCapabilities();
  for(const key of ['fullBlocks','walls','slabs','stairs','railings','fences','ironBars','glassPanes','carpets','trapdoors'])assert.equal(c[key],true,key);
  assert.equal(c.failClosedUnsupportedForms,true);
  assert.ok(c.materialFamilies>=7);
  assert.equal(c.registeredBlocks,STRUCTURAL_PATTERN_BLOCK_IDS.length);
});

test('material aliases resolve to a canonical structural family',()=>{
  assert.equal(structuralMaterialFamily('old brickwork'),'brick');
  assert.equal(structuralMaterialFamily(null,{wall_material:'sandstone masonry'}),'sandstone');
  assert.equal(structuralMaterialFamily('steel railing'),'metal');
  assert.equal(structuralMaterialFamily('glazed'),'glass');
  assert.equal(structuralMaterialFamily('spruce timber'),'timber');
});

test('body material variation is deterministic and shape-independent',()=>{
  const a=structuralBlockFor({material:'brick',role:'body',seed:77,featureId:'wall:1',x:12,y:4,z:-8});
  const b=structuralBlockFor({material:'brick',role:'body',seed:77,featureId:'wall:1',x:12,y:4,z:-8});
  assert.equal(a,b);
  assert.ok(['minecraft:brick_block','minecraft:mud_bricks','minecraft:cracked_stone_bricks','minecraft:mossy_stone_bricks'].includes(a));
});

test('wall slab stair and timber fence roles choose construction form not random full blocks',()=>{
  assert.equal(structuralBlockFor({material:'brick',role:'wall'}),'minecraft:brick_wall');
  assert.equal(structuralBlockFor({material:'sandstone',role:'cap'}),'minecraft:sandstone_slab');
  assert.equal(structuralBlockFor({material:'wood',role:'fence'}),'minecraft:spruce_fence');
  const stair=structuralBlockFor({material:'stone',role:'stairs',orientation:'north'});
  assert.equal(stair.name,'minecraft:stone_brick_stairs');
  assert.deepEqual(stair.states,{upside_down_bit:false,weirdo_direction:3});
});

test('metal railings and coloured glazing use thin structural blocks',()=>{
  assert.equal(structuralBlockFor({material:'steel',role:'railing'}),'minecraft:iron_bars');
  assert.equal(structuralBlockFor({material:'glass',role:'pane'}),'minecraft:glass_pane');
  assert.equal(structuralBlockFor({material:'glass',role:'window',colour:'black'}),'minecraft:black_stained_glass_pane');
  assert.equal(structuralBlockFor({material:'glass',role:'window',colour:'light blue'}),'minecraft:light_blue_stained_glass_pane');
});

test('carpet remains an overlay form and supports observed colour',()=>{
  assert.equal(structuralBlockFor({material:'carpet',role:'carpet',colour:'red'}),'minecraft:red_carpet');
  assert.equal(structuralBlockFor({material:'carpet',role:'overlay',colour:'light grey'}),'minecraft:light_gray_carpet');
});

test('trapdoors carry Bedrock direction open and upside-down states',()=>{
  const timber=structuralBlockFor({material:'timber',role:'trapdoor',direction:2,open:true,upsideDown:false});
  assert.equal(timber.name,'minecraft:spruce_trapdoor');
  assert.deepEqual(timber.states,{direction:2,open_bit:true,upside_down_bit:false});
  const metal=structuralBlockFor({material:'iron',role:'grille',direction:3,open:false,upsideDown:true});
  assert.equal(metal.name,'minecraft:iron_trapdoor');
  assert.deepEqual(metal.states,{direction:3,open_bit:false,upside_down_bit:true});
});

test('every emitted structural form is present in the exported registration set',()=>{
  const samples=[
    structuralBlockFor({material:'brick',role:'body'}),
    structuralBlockFor({material:'brick',role:'wall'}),
    structuralBlockFor({material:'stone',role:'slab'}),
    structuralBlockFor({material:'stone',role:'stair'}),
    structuralBlockFor({material:'metal',role:'railing'}),
    structuralBlockFor({material:'glass',role:'pane',colour:'blue'}),
    structuralBlockFor({material:'carpet',role:'carpet',colour:'green'}),
    structuralBlockFor({material:'timber',role:'trapdoor'})
  ];
  for(const sample of samples)assert.ok(STRUCTURAL_PATTERN_BLOCK_IDS.includes(blockName(sample)),blockName(sample));
});

test('unknown structural roles and impossible family/form combinations fail closed',()=>{
  assert.throws(()=>structuralBlockFor({material:'stone',role:'unknown-shape'}),/Unsupported structural material role/);
  assert.throws(()=>structuralBlockFor({material:'glass',role:'stair'}),/does not support role stair/);
  assert.throws(()=>structuralBlockFor({material:'carpet',role:'wall'}),/does not support role wall/);
  assert.throws(()=>structuralBlockFor({material:'mystery composite',role:'body'}),/Unsupported structural material family/);
});
