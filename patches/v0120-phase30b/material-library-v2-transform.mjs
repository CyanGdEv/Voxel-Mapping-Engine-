#!/usr/bin/env node
// PHASE30B_MATERIAL_LIBRARY_V2_SOURCE
// Expanded user-authored theme-park material families. This runs after the
// checksum-gated Phase 30B extension, preserving the historical transform while
// allowing newer recipes to override older weights deterministically.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args=process.argv.slice(2);
const rootIndex=args.indexOf('--root');
if(rootIndex<0||!args[rootIndex+1])throw new Error('Usage: material-library-v2-transform.mjs --root <generator-root>');
const root=path.resolve(args[rootIndex+1]);
const MARKER='PHASE30B_MATERIAL_LIBRARY_V2';
const RECIPES=Object.freeze({"weathered_asphalt":["weathered-asphalt-v2","speckled",1,[["minecraft:gray_wool",45],["minecraft:gray_concrete",25],["minecraft:light_gray_concrete",15],["minecraft:andesite",10],["minecraft:stone",5]]],"fresh_asphalt":["fresh-asphalt-v2","speckled",1,[["minecraft:black_concrete",55],["minecraft:black_wool",25],["minecraft:gray_concrete",15],["minecraft:smooth_basalt",5]]],"light_asphalt":["light-asphalt-v2","speckled",1,[["minecraft:light_gray_concrete",45],["minecraft:gray_wool",30],["minecraft:andesite",15],["minecraft:stone",10]]],"old_cracked_asphalt":["old-cracked-asphalt-v2","speckled",1,[["minecraft:gray_wool",40],["minecraft:gray_concrete",25],["minecraft:andesite",15],["minecraft:stone",10],["minecraft:cobblestone",5],["minecraft:gravel",5]]],"red_tarmac":["red-tarmac-v2","speckled",1,[["minecraft:red_concrete",50],["minecraft:red_terracotta",25],["minecraft:brick_block",10],["minecraft:brown_terracotta",10],["minecraft:packed_mud",5]]],"concrete":["concrete-path-v2","mixed",3,[["minecraft:light_gray_concrete",55],["minecraft:smooth_stone",25],["minecraft:stone",15],["minecraft:andesite",5]]],"old_concrete":["old-concrete-v2","mosaic",3,[["minecraft:smooth_stone",35],["minecraft:light_gray_concrete",25],["minecraft:stone",20],["minecraft:andesite",10],["minecraft:gravel",5],["minecraft:moss_block",5]]],"dark_concrete":["dark-concrete-v2","mixed",3,[["minecraft:gray_concrete",50],["minecraft:smooth_stone",20],["minecraft:gray_wool",15],["minecraft:andesite",10],["minecraft:polished_andesite",5]]],"weathered_concrete":["weathered-concrete-v2","mosaic",3,[["minecraft:light_gray_concrete",35],["minecraft:smooth_stone",25],["minecraft:stone",15],["minecraft:andesite",10],["minecraft:cracked_stone_bricks",10],["minecraft:moss_block",5]]],"paving_stones":["grey-block-paving-v2","mosaic",1,[["minecraft:stone_bricks",40],["minecraft:andesite",25],["minecraft:polished_andesite",15],["minecraft:smooth_stone",10],["minecraft:cracked_stone_bricks",10]]],"dark_block_paving":["dark-block-paving-v2","mosaic",1,[["minecraft:deepslate_bricks",35],["minecraft:polished_deepslate",25],["minecraft:gray_concrete",15],["minecraft:andesite",15],["minecraft:cracked_deepslate_bricks",10]]],"red_block_paving":["red-block-paving-v2","mosaic",1,[["minecraft:brick_block",45],["minecraft:red_terracotta",25],["minecraft:granite",15],["minecraft:polished_granite",10],["minecraft:packed_mud",5]]],"buff_paving":["buff-paving-v2","mosaic",2,[["minecraft:smooth_sandstone",40],["minecraft:sandstone",25],["minecraft:cut_sandstone",20],["minecraft:calcite",10],["minecraft:birch_planks",5]]],"old_stone_paving":["old-stone-paving-v2","mosaic",2,[["minecraft:stone_bricks",30],["minecraft:stone",25],["minecraft:andesite",15],["minecraft:cracked_stone_bricks",15],["minecraft:mossy_stone_bricks",10],["minecraft:cobblestone",5]]],"weathered_stone":["weathered-stone-v2","mosaic",3,[["minecraft:stone",35],["minecraft:stone_bricks",20],["minecraft:andesite",15],["minecraft:cracked_stone_bricks",15],["minecraft:mossy_stone_bricks",10],["minecraft:cobblestone",5]]],"dark_stone":["dark-stone-v2","mosaic",3,[["minecraft:tuff",30],["minecraft:deepslate",25],["minecraft:cobbled_deepslate",20],["minecraft:andesite",15],["minecraft:blackstone",10]]],"light_stone":["light-stone-v2","mosaic",3,[["minecraft:stone",35],["minecraft:calcite",25],["minecraft:smooth_stone",20],["minecraft:diorite",10],["minecraft:polished_diorite",10]]],"sandstone_material":["sandstone-material-v2","mosaic",2,[["minecraft:sandstone",45],["minecraft:cut_sandstone",25],["minecraft:smooth_sandstone",20],["minecraft:calcite",5],["minecraft:dripstone_block",5]]],"mossy_stone":["mossy-stone-v2","organic",3,[["minecraft:stone",25],["minecraft:mossy_stone_bricks",25],["minecraft:mossy_cobblestone",20],["minecraft:stone_bricks",15],["minecraft:andesite",10],["minecraft:moss_block",5]]],"natural_rock":["natural-rock-v2","mosaic",4,[["minecraft:stone",30],["minecraft:andesite",20],["minecraft:tuff",20],["minecraft:cobblestone",10],["minecraft:mossy_cobblestone",10],["minecraft:gravel",10]]],"dark_rockwork":["dark-rockwork-v2","mosaic",4,[["minecraft:tuff",30],["minecraft:cobbled_deepslate",25],["minecraft:deepslate",20],["minecraft:blackstone",10],["minecraft:andesite",10],["minecraft:mossy_cobblestone",5]]],"weathered_rock":["weathered-rock-v2","organic",4,[["minecraft:stone",25],["minecraft:andesite",20],["minecraft:cobblestone",20],["minecraft:tuff",15],["minecraft:mossy_cobblestone",10],["minecraft:gravel",5],["minecraft:moss_block",5]]],"artificial_rockwork":["artificial-rockwork-v2","mosaic",4,[["minecraft:tuff",30],["minecraft:stone",25],["minecraft:andesite",15],["minecraft:packed_mud",10],["minecraft:brown_terracotta",10],["minecraft:cobblestone",5],["minecraft:mossy_cobblestone",5]]],"gravel":["gravel-path-v2","speckled",1,[["minecraft:gravel",60],["minecraft:andesite",15],["minecraft:stone",10],["minecraft:coarse_dirt",10],["minecraft:tuff",5]]],"compacted":["hoggin-v2","speckled",1,[["minecraft:packed_mud",35],["minecraft:coarse_dirt",25],["minecraft:gravel",20],["minecraft:brown_terracotta",10],["minecraft:sand",10]]],"dirt_trail":["dirt-trail-v2","organic",2,[["minecraft:coarse_dirt",40],["minecraft:dirt",30],["minecraft:dirt_with_roots",15],["minecraft:packed_mud",10],["minecraft:gravel",5]]],"muddy_ground":["muddy-ground-v2","organic",2,[["minecraft:mud",40],["minecraft:packed_mud",25],["minecraft:coarse_dirt",15],["minecraft:dirt",10],["minecraft:dirt_with_roots",10]]],"healthy_lawn":["healthy-grass-v2","organic",4,[["minecraft:grass_block",70],["minecraft:moss_block",20],["minecraft:green_wool",5],["minecraft:lime_terracotta",5]]],"worn_grass":["worn-grass-v2","organic",3,[["minecraft:grass_block",50],["minecraft:dirt",15],["minecraft:coarse_dirt",15],["minecraft:moss_block",10],["minecraft:dirt_with_roots",10]]],"woodland_floor":["woodland-floor-v2","organic",3,[["minecraft:podzol",35],["minecraft:dirt",20],["minecraft:coarse_dirt",15],["minecraft:dirt_with_roots",15],["minecraft:moss_block",10],["minecraft:brown_wool",5]]],"planting_bed":["planting-bed-v2","organic",3,[["minecraft:podzol",40],["minecraft:coarse_dirt",20],["minecraft:brown_wool",15],["minecraft:dirt_with_roots",15],["minecraft:packed_mud",10]]],"boardwalk":["boardwalk-v2","mixed",2,[["minecraft:spruce_planks",55],["minecraft:dark_oak_planks",20],["minecraft:oak_planks",15],["minecraft:stripped_spruce_log",10]]],"weathered_timber":["weathered-timber-v2","mixed",2,[["minecraft:spruce_planks",35],["minecraft:dark_oak_planks",25],["minecraft:stripped_spruce_log",20],["minecraft:brown_terracotta",10],["minecraft:mangrove_planks",10]]],"dark_timber":["dark-timber-v2","mixed",2,[["minecraft:dark_oak_planks",50],["minecraft:spruce_planks",25],["minecraft:stripped_dark_oak_log",15],["minecraft:brown_terracotta",10]]],"queue_floor":["queue-floor-v2","mixed",2,[["minecraft:gray_concrete",40],["minecraft:gray_wool",25],["minecraft:smooth_stone",20],["minecraft:andesite",10],["minecraft:polished_andesite",5]]],"service_yard":["service-yard-v2","mixed",3,[["minecraft:gray_concrete",35],["minecraft:smooth_stone",25],["minecraft:stone",20],["minecraft:andesite",15],["minecraft:gravel",5]]],"old_brickwork":["old-brickwork-v2","mosaic",2,[["minecraft:terracotta",40],["minecraft:jungle_planks",20],["minecraft:packed_mud",10],["minecraft:brick_block",15],["minecraft:mud_bricks",10],["minecraft:mossy_stone_bricks",5]]],"industrial_metal_floor":["industrial-metal-floor-v2","mosaic",2,[["minecraft:iron_block",25],["minecraft:polished_andesite",25],["minecraft:gray_concrete",20],["minecraft:smooth_stone",15],["minecraft:deepslate_tiles",10],["minecraft:smooth_basalt",5]]],"slate_roof":["slate-roof-v2","mosaic",2,[["minecraft:deepslate_tiles",45],["minecraft:polished_deepslate",25],["minecraft:deepslate_bricks",15],["minecraft:gray_concrete",10],["minecraft:blackstone",5]]],"weathered_roof":["weathered-roof-v2","organic",2,[["minecraft:deepslate_tiles",30],["minecraft:deepslate_bricks",20],["minecraft:polished_deepslate",15],["minecraft:stone_bricks",10],["minecraft:gray_concrete",10],["minecraft:mossy_stone_bricks",10],["minecraft:moss_block",5]]],"sand":["sand-beach-v2","speckled",2,[["minecraft:sand",65],["minecraft:smooth_sandstone",15],["minecraft:sandstone",10],["minecraft:gravel",5],["minecraft:calcite",5]]]});
const ALIASES=Object.freeze({"weathered_asphalt":"weathered_asphalt","old_asphalt":"old_cracked_asphalt","worn_asphalt":"old_cracked_asphalt","cracked_asphalt":"old_cracked_asphalt","old_cracked_asphalt":"old_cracked_asphalt","fresh_asphalt":"fresh_asphalt","black_asphalt":"fresh_asphalt","light_asphalt":"light_asphalt","red_tarmac":"red_tarmac","red_asphalt":"red_tarmac","concrete_path":"concrete","old_concrete":"old_concrete","dark_concrete":"dark_concrete","weathered_concrete":"weathered_concrete","grey_block_paving":"paving_stones","gray_block_paving":"paving_stones","dark_block_paving":"dark_block_paving","red_block_paving":"red_block_paving","buff_paving":"buff_paving","old_stone_paving":"old_stone_paving","old_paving":"old_stone_paving","weathered_stone":"weathered_stone","dark_stone":"dark_stone","light_stone":"light_stone","sandstone":"sandstone_material","sandstone_paving":"sandstone_material","mossy_stone":"mossy_stone","natural_rock":"natural_rock","rock":"natural_rock","dark_rock":"dark_rockwork","dark_rockwork":"dark_rockwork","weathered_rock":"weathered_rock","rockwork":"artificial_rockwork","artificial_rockwork":"artificial_rockwork","artificial_themepark_rock":"artificial_rockwork","gravel_path":"gravel","hoggin":"compacted","hoggin_path":"compacted","dirt_path":"dirt_trail","dirt_trail":"dirt_trail","muddy_ground":"muddy_ground","healthy_grass":"healthy_lawn","healthy_lawn":"healthy_lawn","lawn":"healthy_lawn","worn_grass":"worn_grass","woodland_floor":"woodland_floor","planting_bed":"planting_bed","mulch_bed":"planting_bed","boardwalk":"boardwalk","timber_decking":"boardwalk","weathered_timber":"weathered_timber","dark_timber":"dark_timber","queue_floor":"queue_floor","service_yard":"service_yard","industrial_service_paving":"service_yard","old_brickwork":"old_brickwork","old_brick_wall":"old_brickwork","industrial_metal_floor":"industrial_metal_floor","slate_roof":"slate_roof","weathered_roof":"weathered_roof","beach":"sand","sandy":"sand","sand_beach":"sand"});
const BLOCKS=Object.freeze([...new Set(Object.values(RECIPES).flatMap((entry)=>entry[3].map(([block])=>block)))].sort());

await patchFidelity(path.join(root,'src/lib/fidelity.mjs'));
await patchMcworld(path.join(root,'src/lib/mcworld.mjs'));
await writeTests(path.join(root,'test/material-pattern-library-v2.test.mjs'));
console.log(`Phase 30B material library V2 installed recipes=${Object.keys(RECIPES).length} blocks=${BLOCKS.length}`);

async function patchFidelity(file){
  let text=await readFile(file,'utf8');
  if(!text.includes(MARKER)){
    const recipeStart=text.indexOf('const MATERIAL_PATTERN_RECIPES = Object.freeze({');
    const recipeEnd=text.indexOf('\n});',recipeStart);
    if(recipeStart<0||recipeEnd<0)throw new Error('Phase 30B V2 requires MATERIAL_PATTERN_RECIPES');
    const recipeText=',\n  // '+MARKER+'\n  '+Object.entries(RECIPES)
      .map(([key,[id,pattern,scale,entries]])=>`${key}: materialRecipe(${JSON.stringify(id)}, ${JSON.stringify(pattern)}, ${JSON.stringify(entries)}, ${scale})`)
      .join(',\n  ');
    text=text.slice(0,recipeEnd)+recipeText+text.slice(recipeEnd);

    const aliasStart=text.indexOf('const MATERIAL_PATTERN_RECIPE_ALIASES = Object.freeze(');
    if(aliasStart<0)throw new Error('Phase 30B V2 requires MATERIAL_PATTERN_RECIPE_ALIASES');
    const aliasEnd=text.indexOf(');',aliasStart);
    if(aliasEnd<0)throw new Error('Phase 30B V2 alias terminator missing');
    const aliasInsert=aliasEnd+2;
    text=text.slice(0,aliasInsert)+`\nconst MATERIAL_PATTERN_RECIPE_ALIASES_V2 = Object.freeze(${JSON.stringify(ALIASES)});`+text.slice(aliasInsert);

    text=replaceOnce(
      text,
      '  const recipeKey = (rawKey && MATERIAL_PATTERN_RECIPE_ALIASES[rawKey]) || canonicalMaterial;',
      '  const recipeKey = (rawKey && MATERIAL_PATTERN_RECIPE_ALIASES_V2[rawKey]) || (rawKey && MATERIAL_PATTERN_RECIPE_ALIASES[rawKey]) || canonicalMaterial;'
    );
    await writeFile(file,text);
  }
  validateFidelity(await readFile(file,'utf8'));
}

async function patchMcworld(file){
  let text=await readFile(file,'utf8');
  const setStart=text.indexOf('const BEDROCK_BLOCKS = new Set([');
  const setEnd=text.indexOf('\n]);',setStart);
  if(setStart<0||setEnd<0)throw new Error('Phase 30B V2 requires BEDROCK_BLOCKS');
  const region=text.slice(setStart,setEnd);
  const existing=new Set(region.match(/minecraft:[a-z0-9_]+/g)||[]);
  const missing=BLOCKS.filter((block)=>!existing.has(block));
  if(!text.includes('PHASE30B_MATERIAL_LIBRARY_V2_BLOCKS')){
    const entries=missing.length?`  ${missing.map(JSON.stringify).join(',\n  ')}`:'  // all V2 blocks were already registered';
    const insertion=`${region.trimEnd().endsWith('[')?'':','}\n  // PHASE30B_MATERIAL_LIBRARY_V2_BLOCKS\n${entries}`;
    text=text.slice(0,setEnd)+insertion+text.slice(setEnd);
    await writeFile(file,text);
  }
  const final=await readFile(file,'utf8');
  const finalStart=final.indexOf('const BEDROCK_BLOCKS = new Set([');
  const finalEnd=final.indexOf('\n]);',finalStart);
  const registered=new Set(final.slice(finalStart,finalEnd).match(/minecraft:[a-z0-9_]+/g)||[]);
  const absent=BLOCKS.filter((block)=>!registered.has(block));
  if(absent.length)throw new Error(`Phase 30B V2 Bedrock registration missing: ${absent.join(', ')}`);
}

async function writeTests(file){
  const cases=Object.entries(RECIPES).map(([surface,entry])=>[surface,entry[3]]);
  const aliases=Object.entries(ALIASES);
  const source=`import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveSurfaceStyle,blockForSurfaceStyle} from '../src/lib/fidelity.mjs';

const CASES=${JSON.stringify(cases)};
const ALIASES=${JSON.stringify(aliases)};
function feature(surface){return{id:'v2:'+surface,kind:'path',tags:{surface},localGeometry:{type:'LineString',coordinates:[[0,0],[80,0]]},source:{provider:'test'}}}
function expected(entries){const total=entries.reduce((n,e)=>n+e[1],0);return entries.map(([,weight],index)=>((index===0&&total<100?weight+(100-total):weight)/(total<100?100:total)))}

test('core user-authored asphalt brick and stone recipes remain exact',()=>{
  const asphalt=deriveSurfaceStyle(feature('asphalt'),{accuracyMode:'plausible'});
  assert.deepEqual(asphalt.paletteBlocks,['minecraft:gray_wool','minecraft:gray_concrete']);
  assert.deepEqual(asphalt.paletteWeights,[0.6,0.4]);
  const brick=deriveSurfaceStyle(feature('brick'),{accuracyMode:'plausible'});
  assert.deepEqual(brick.paletteBlocks,['minecraft:terracotta','minecraft:jungle_planks','minecraft:packed_mud']);
  assert.deepEqual(brick.paletteWeights,[0.6,0.3,0.1]);
  const stone=deriveSurfaceStyle(feature('stone'),{accuracyMode:'plausible'});
  assert.deepEqual(stone.paletteBlocks,['minecraft:stone','minecraft:cracked_stone_bricks','minecraft:stone_bricks','minecraft:andesite','minecraft:polished_andesite']);
  assert.deepEqual(stone.paletteWeights,[0.55,0.05,0.2,0.15,0.05]);
});

test('V2 material recipes preserve requested blocks percentages and deterministic sampling',()=>{
  for(const [surface,entries] of CASES){
    const style=deriveSurfaceStyle(feature(surface),{accuracyMode:'plausible'});
    assert.equal(style.exactMaterialPalette,true,surface);
    assert.deepEqual(style.paletteBlocks,entries.map(([block])=>block),surface);
    const weights=expected(entries);
    assert.equal(style.paletteWeights.length,weights.length,surface);
    style.paletteWeights.forEach((weight,index)=>assert.ok(Math.abs(weight-weights[index])<1e-12,'weight mismatch '+surface+' '+index));
    const a=Array.from({length:1024},(_,i)=>blockForSurfaceStyle(style,i%32,Math.floor(i/32),991));
    const b=Array.from({length:1024},(_,i)=>blockForSurfaceStyle(style,i%32,Math.floor(i/32),991));
    assert.deepEqual(a,b,surface);
    assert.ok(new Set(a).size>=Math.min(3,entries.length),surface);
  }
});

test('V2 aliases resolve to their richer material recipe',()=>{
  for(const [alias,target] of ALIASES){
    const targetEntries=CASES.find(([name])=>name===target)?.[1];
    if(!targetEntries)continue;
    const style=deriveSurfaceStyle(feature(alias),{accuracyMode:'plausible'});
    assert.deepEqual(style.paletteBlocks,targetEntries.map(([block])=>block),alias);
  }
});
`;
  await writeFile(file,source);
}

function validateFidelity(text){
  for(const token of [MARKER,'MATERIAL_PATTERN_RECIPE_ALIASES_V2','old_cracked_asphalt','industrial_metal_floor','slate_roof','weathered_roof']){
    if(!text.includes(token))throw new Error(`Phase 30B V2 fidelity missing ${token}`);
  }
}
function replaceOnce(text,before,after){
  const index=text.indexOf(before);
  if(index<0)throw new Error(`Phase 30B V2 transform anchor missing: ${before.slice(0,100)}`);
  if(text.indexOf(before,index+before.length)>=0)throw new Error(`Phase 30B V2 transform anchor ambiguous: ${before.slice(0,100)}`);
  return text.slice(0,index)+after+text.slice(index+before.length);
}
