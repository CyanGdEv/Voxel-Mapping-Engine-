#!/usr/bin/env node
// TPMAP_PHASE35_STRUCTURAL_CORE_MATERIALS_V2_INSTALLER
// Align structural body materials with the user-authored Phase 30B core recipes
// while preserving shape selection (walls/slabs/stairs/bars/panes/trapdoors).
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const MARKER='TPMAP_PHASE35_STRUCTURAL_CORE_MATERIALS_V2';
const args=process.argv.slice(2);
const i=args.indexOf('--generator');
const generator=i>=0?path.resolve(args[i+1]):null;
const validateOnly=args.includes('--validate-only');
const selfTest=args.includes('--self-test');

const OLD_BRICK='    body: weighted([["minecraft:brick_block",70],["minecraft:mud_bricks",15],["minecraft:cracked_stone_bricks",10],["minecraft:mossy_stone_bricks",5]]),';
const NEW_BRICK='    body: weighted([["minecraft:terracotta",60],["minecraft:jungle_planks",30],["minecraft:packed_mud",10]]), // '+MARKER;
const OLD_STONE='    body: weighted([["minecraft:stone_bricks",62],["minecraft:andesite",18],["minecraft:cobblestone",12],["minecraft:mossy_stone_bricks",8]]),';
const NEW_STONE='    body: weighted([["minecraft:stone",55],["minecraft:cracked_stone_bricks",5],["minecraft:stone_bricks",20],["minecraft:andesite",15],["minecraft:polished_andesite",5]]),';
const OLD_TEST="  assert.ok(['minecraft:brick_block','minecraft:mud_bricks','minecraft:cracked_stone_bricks','minecraft:mossy_stone_bricks'].includes(a));";
const NEW_TEST="  assert.ok(['minecraft:terracotta','minecraft:jungle_planks','minecraft:packed_mud'].includes(a));";
const REQUIRED_BLOCKS=['minecraft:terracotta','minecraft:jungle_planks','minecraft:packed_mud','minecraft:stone','minecraft:cracked_stone_bricks','minecraft:stone_bricks','minecraft:andesite','minecraft:polished_andesite'];

if(selfTest)selfTestTransform();
else if(!generator)throw new Error('--generator is required');
else await install(generator,validateOnly);

async function install(root,validate){
  const libraryFile=path.join(root,'src/lib/structural-material-pattern-library.mjs');
  const testFile=path.join(root,'test/structural-material-pattern-library.test.mjs');
  const mcworldFile=path.join(root,'src/lib/mcworld.mjs');
  if(!validate){
    let library=await readFile(libraryFile,'utf8');
    library=transformLibrary(library);
    await writeFile(libraryFile,library,'utf8');
    let tests=await readFile(testFile,'utf8');
    tests=transformTests(tests);
    await writeFile(testFile,tests,'utf8');
    let mcworld=await readFile(mcworldFile,'utf8');
    mcworld=extendBedrockBlocks(mcworld,REQUIRED_BLOCKS);
    await writeFile(mcworldFile,mcworld,'utf8');
  }
  validateLibrary(await readFile(libraryFile,'utf8'));
  validateTests(await readFile(testFile,'utf8'));
  validateBlocks(await readFile(mcworldFile,'utf8'),REQUIRED_BLOCKS);
  console.log(JSON.stringify({status:validate?'validated':'installed',marker:MARKER,brick:'60/30/10',stone:'55/5/20/15/5'}));
}

export function transformLibrary(source){
  if(source.includes(MARKER))return source;
  let out=replaceOnce(source,OLD_BRICK,NEW_BRICK,'brick body recipe');
  out=replaceOnce(out,OLD_STONE,NEW_STONE,'stone body recipe');
  validateLibrary(out);
  return out;
}
export function transformTests(source){
  if(source.includes(NEW_TEST))return source;
  const out=replaceOnce(source,OLD_TEST,NEW_TEST,'brick body test');
  validateTests(out);
  return out;
}
export function extendBedrockBlocks(source,blocks){
  const start=source.indexOf('const BEDROCK_BLOCKS = new Set(['),end=source.indexOf('\n]);',start);
  if(start<0||end<0)throw new Error('Structural core V2 cannot locate BEDROCK_BLOCKS');
  const body=source.slice(start,end),existing=new Set(body.match(/minecraft:[a-z0-9_]+/g)||[]);
  const missing=[...new Set(blocks)].filter((block)=>!existing.has(block)).sort();
  if(!missing.length)return source;
  const insertion=`${body.trimEnd().endsWith('[')?'':','}\n  // ${MARKER}_BLOCKS\n  ${missing.map(JSON.stringify).join(',\n  ')}`;
  const out=source.slice(0,end)+insertion+source.slice(end);
  validateBlocks(out,blocks);
  return out;
}
function validateLibrary(source){
  for(const token of [MARKER,'weighted([["minecraft:terracotta",60],["minecraft:jungle_planks",30],["minecraft:packed_mud",10]])','weighted([["minecraft:stone",55],["minecraft:cracked_stone_bricks",5],["minecraft:stone_bricks",20],["minecraft:andesite",15],["minecraft:polished_andesite",5]])'])if(!source.includes(token))throw new Error(`Structural core V2 library missing ${token}`);
}
function validateTests(source){
  if(!source.includes(NEW_TEST))throw new Error('Structural core V2 tests do not assert user-authored brick palette');
}
function validateBlocks(source,blocks){
  const start=source.indexOf('const BEDROCK_BLOCKS = new Set(['),end=source.indexOf('\n]);',start);
  if(start<0||end<0)throw new Error('Structural core V2 block registry missing');
  const registered=new Set(source.slice(start,end).match(/minecraft:[a-z0-9_]+/g)||[]);
  const absent=blocks.filter((block)=>!registered.has(block));
  if(absent.length)throw new Error(`Structural core V2 missing Bedrock blocks: ${absent.join(', ')}`);
}
function replaceOnce(source,before,after,label){
  const first=source.indexOf(before);
  if(first<0)throw new Error(`Structural core V2 anchor missing: ${label}`);
  if(source.indexOf(before,first+before.length)>=0)throw new Error(`Structural core V2 anchor ambiguous: ${label}`);
  return source.slice(0,first)+after+source.slice(first+before.length);
}
function selfTestTransform(){
  const fixture=`const RECIPES={\n  brick: recipe({\n${OLD_BRICK}\n  }),\n  stone: recipe({\n${OLD_STONE}\n  })\n};\n`;
  const first=transformLibrary(fixture),second=transformLibrary(first);
  if(first!==second)throw new Error('Structural core V2 transform is not idempotent');
  const test=transformTests(`test('x',()=>{\n${OLD_TEST}\n});\n`);
  if(!test.includes('minecraft:jungle_planks'))throw new Error('Structural core V2 test transform failed');
  const mc=extendBedrockBlocks('const BEDROCK_BLOCKS = new Set([\n  "minecraft:air"\n]);\n',REQUIRED_BLOCKS);
  validateBlocks(mc,REQUIRED_BLOCKS);
  console.log('Structural core material V2 installer self-test passed');
}
