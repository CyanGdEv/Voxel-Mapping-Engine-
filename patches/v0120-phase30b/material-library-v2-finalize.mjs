#!/usr/bin/env node
// PHASE30B_MATERIAL_LIBRARY_V2_FINALIZE
// Final compatibility pass for V2 recipes: register the sandstone material's
// canonical self-alias and relax only the legacy V1 exact-shape assertions for
// recipes intentionally superseded by V2. V2's own tests remain exact.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args=process.argv.slice(2);
const rootIndex=args.indexOf('--root');
if(rootIndex<0||!args[rootIndex+1])throw new Error('Usage: material-library-v2-finalize.mjs --root <generator-root>');
const root=path.resolve(args[rootIndex+1]);
const MARKER='PHASE30B_MATERIAL_LIBRARY_V2_FINALIZE';
const OVERRIDDEN=new Set([
  'weathered_asphalt','fresh_asphalt','light_asphalt','red_tarmac','concrete','old_concrete',
  'paving_stones','red_block_paving','buff_paving','old_stone_paving','gravel','compacted',
  'dirt_trail','woodland_floor','healthy_lawn','worn_grass','boardwalk','weathered_timber','sand',
  'natural_rock','dark_rockwork','artificial_rockwork','old_brick_wall','industrial_service_paving'
]);

const fidelityFile=path.join(root,'src/lib/fidelity.mjs');
const legacyTestFile=path.join(root,'test/material-pattern-library.test.mjs');
await patchFidelity(fidelityFile);
await patchLegacyTest(legacyTestFile);
console.log(`Phase 30B material library V2 finalize complete overrides=${OVERRIDDEN.size}`);

async function patchFidelity(file){
  let text=await readFile(file,'utf8');
  if(!text.includes(MARKER)){
    const before='"sandstone":"sandstone_material","sandstone_paving":"sandstone_material"';
    const after='"sandstone":"sandstone_material","sandstone_material":"sandstone_material","sandstone_paving":"sandstone_material"';
    const index=text.indexOf(before);
    if(index<0)throw new Error('Phase 30B V2 finalize could not locate sandstone aliases');
    if(text.indexOf(before,index+before.length)>=0)throw new Error('Phase 30B V2 finalize sandstone alias anchor is ambiguous');
    text=text.slice(0,index)+after+text.slice(index+before.length);
    const aliasEnd=text.indexOf(');',text.indexOf('const MATERIAL_PATTERN_RECIPE_ALIASES_V2 = Object.freeze('));
    if(aliasEnd<0)throw new Error('Phase 30B V2 finalize could not locate V2 alias terminator');
    text=text.slice(0,aliasEnd+2)+`\nconst ${MARKER} = true;`+text.slice(aliasEnd+2);
    await writeFile(file,text);
  }
  validateFidelity(await readFile(file,'utf8'));
}

async function patchLegacyTest(file){
  let text=await readFile(file,'utf8');
  if(!text.includes(MARKER)){
    const casesAnchor='const cases=';
    const casesAt=text.indexOf(casesAnchor);
    if(casesAt<0)throw new Error('Phase 30B V2 finalize could not locate legacy material cases');
    const lineEnd=text.indexOf('\n',casesAt);
    if(lineEnd<0)throw new Error('Phase 30B V2 finalize legacy material cases line is malformed');
    const setLine=`\nconst V2_OVERRIDDEN=new Set(${JSON.stringify([...OVERRIDDEN])}); // ${MARKER}`;
    text=text.slice(0,lineEnd)+setLine+text.slice(lineEnd);
    const before='assert.equal(s.paletteBlocks.length,len,surface);assert.equal(s.paletteBlocks[0],primary,surface);';
    const after='if(!V2_OVERRIDDEN.has(surface)){assert.equal(s.paletteBlocks.length,len,surface);assert.equal(s.paletteBlocks[0],primary,surface);}';
    const index=text.indexOf(before);
    if(index<0)throw new Error('Phase 30B V2 finalize could not locate legacy exact-recipe assertions');
    if(text.indexOf(before,index+before.length)>=0)throw new Error('Phase 30B V2 finalize legacy assertion anchor is ambiguous');
    text=text.slice(0,index)+after+text.slice(index+before.length);
    await writeFile(file,text);
  }
  validateLegacyTest(await readFile(file,'utf8'));
}

function validateFidelity(text){
  for(const token of [MARKER,'"sandstone_material":"sandstone_material"','MATERIAL_PATTERN_RECIPE_ALIASES_V2']){
    if(!text.includes(token))throw new Error(`Phase 30B V2 finalize fidelity missing ${token}`);
  }
}
function validateLegacyTest(text){
  for(const token of [MARKER,'V2_OVERRIDDEN','if(!V2_OVERRIDDEN.has(surface))']){
    if(!text.includes(token))throw new Error(`Phase 30B V2 finalize legacy test missing ${token}`);
  }
}
