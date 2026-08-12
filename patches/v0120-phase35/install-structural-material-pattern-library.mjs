#!/usr/bin/env node
// TPMAP_PHASE35_STRUCTURAL_MATERIAL_PATTERN_LIBRARY_INSTALLER
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { STRUCTURAL_PATTERN_BLOCK_IDS } from './structural-material-pattern-library.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const MARKER='TPMAP_PHASE35_STRUCTURAL_BLOCK_LIBRARY_V1';
const args=process.argv.slice(2),i=args.indexOf('--generator'),generator=i>=0?path.resolve(args[i+1]):null,validateOnly=args.includes('--validate-only'),selfTest=args.includes('--self-test');
if(selfTest)await selfTestInstaller();else if(!generator)throw new Error('--generator is required');else await install(generator,validateOnly);

async function install(root,validate){
  const moduleFile=path.join(root,'src/lib/structural-material-pattern-library.mjs');
  const testFile=path.join(root,'test/structural-material-pattern-library.test.mjs');
  const mcworldFile=path.join(root,'src/lib/mcworld.mjs');
  if(!validate){
    await writeFile(moduleFile,await readFile(path.join(here,'structural-material-pattern-library.mjs'),'utf8'));
    await writeFile(testFile,await readFile(path.join(here,'structural-material-pattern-library.test.mjs'),'utf8'));
    const before=await readFile(mcworldFile,'utf8');
    const after=extendBedrockBlockLibrary(before,STRUCTURAL_PATTERN_BLOCK_IDS);
    if(after!==before)await writeFile(mcworldFile,after,'utf8');
  }
  const moduleSource=await readFile(moduleFile,'utf8'),testSource=await readFile(testFile,'utf8'),mcworldSource=await readFile(mcworldFile,'utf8');
  for(const token of ['TPMAP_PHASE35_STRUCTURAL_MATERIAL_PATTERN_LIBRARY_V1','STRUCTURAL_PATTERN_BLOCK_IDS','structuralBlockFor','structuralPatternCapabilities'])if(!moduleSource.includes(token))throw new Error(`Phase 35 structural material module missing ${token}`);
  for(const token of ['requested Minecraft-native forms','metal railings and coloured glazing','trapdoors carry Bedrock direction','unknown structural roles fail closed'])if(!testSource.includes(token))throw new Error(`Phase 35 structural material tests missing ${token}`);
  validateRegisteredBlocks(mcworldSource,STRUCTURAL_PATTERN_BLOCK_IDS);
  const imported=await import(`${pathToFileURL(moduleFile).href}?tpmapStructuralValidate=${Date.now()}`);
  const caps=imported.structuralPatternCapabilities();
  if(!caps?.walls||!caps?.slabs||!caps?.stairs||!caps?.ironBars||!caps?.glassPanes||!caps?.carpets||!caps?.trapdoors)throw new Error('Phase 35 structural material runtime capabilities incomplete');
  console.log(JSON.stringify({status:validate?'validated':'installed',marker:'TPMAP_PHASE35_STRUCTURAL_MATERIAL_PATTERN_LIBRARY_V1',registeredBlocks:STRUCTURAL_PATTERN_BLOCK_IDS.length,materialFamilies:caps.materialFamilies}));
}

export function extendBedrockBlockLibrary(source,blocks){
  const anchor='const BEDROCK_BLOCKS = new Set([';
  const start=source.indexOf(anchor);if(start<0)throw new Error('Phase 35 structural material installer cannot locate BEDROCK_BLOCKS');
  const end=source.indexOf('\n]);',start);if(end<0)throw new Error('Phase 35 structural material installer cannot locate BEDROCK_BLOCKS terminator');
  const body=source.slice(start,end),existing=new Set(extractBlockIds(body)),required=[...new Set(blocks)].sort();
  for(const block of required)if(!/^minecraft:[a-z0-9_]+$/.test(block))throw new Error(`Invalid structural Bedrock block identifier: ${block}`);
  const missing=required.filter((block)=>!existing.has(block));
  if(!missing.length)return source;
  const marker=body.includes(MARKER)?'':`  // ${MARKER}\n`;
  const insertion=`${body.trimEnd().endsWith('[')?'':','}\n${marker}  ${missing.map(JSON.stringify).join(',\n  ')}`;
  const out=source.slice(0,end)+insertion+source.slice(end);
  validateRegisteredBlocks(out,required);
  return out;
}

function validateRegisteredBlocks(source,blocks){
  const anchor='const BEDROCK_BLOCKS = new Set([',start=source.indexOf(anchor),end=source.indexOf('\n]);',start);
  if(start<0||end<0)throw new Error('Phase 35 structural material block registry region missing');
  const registered=new Set(extractBlockIds(source.slice(start,end))),absent=blocks.filter((block)=>!registered.has(block));
  if(absent.length)throw new Error(`Phase 35 structural material blocks are not registered: ${absent.join(', ')}`);
}
function extractBlockIds(text){return[...new Set(String(text).match(/minecraft:[a-z0-9_]+/g)||[])];}

async function selfTestInstaller(){
  const fixture='const BEDROCK_BLOCKS = new Set([\n  "minecraft:stone"\n]);\n';
  const once=extendBedrockBlockLibrary(fixture,STRUCTURAL_PATTERN_BLOCK_IDS),twice=extendBedrockBlockLibrary(once,STRUCTURAL_PATTERN_BLOCK_IDS);
  if(once!==twice)throw new Error('Phase 35 structural material registry transform is not idempotent');
  validateRegisteredBlocks(once,STRUCTURAL_PATTERN_BLOCK_IDS);
  if((once.match(new RegExp(MARKER,'g'))||[]).length!==1)throw new Error('Phase 35 structural material registry marker must remain singular');
  console.log('Phase 35 structural material pattern library installer self-test passed');
}
