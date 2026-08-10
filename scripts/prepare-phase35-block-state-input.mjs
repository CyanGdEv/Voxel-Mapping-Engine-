#!/usr/bin/env node
// TPMAP_PHASE35_BLOCK_STATE_INPUT_NORMALIZER_V1
// Canonicalizes only the BEDROCK_BLOCKS declaration shape expected by the
// checksum-era Phase 35 installer while preserving every existing block id.

import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const args=process.argv.slice(2);
const gi=args.indexOf('--generator');
const generator=gi>=0?path.resolve(args[gi+1]):null;
const validateOnly=args.includes('--validate-only');
const selfTest=args.includes('--self-test');

const LEGACY_IDS=[
  'minecraft:azalea_leaves','minecraft:birch_leaves','minecraft:brown_terracotta','minecraft:calcite','minecraft:cyan_terracotta','minecraft:dark_oak_leaves','minecraft:deepslate','minecraft:gray_concrete_powder','minecraft:light_gray_concrete_powder','minecraft:mud_bricks','minecraft:oak_planks','minecraft:orange_terracotta','minecraft:packed_mud','minecraft:podzol','minecraft:polished_andesite','minecraft:red_terracotta','minecraft:smooth_sandstone','minecraft:yellow_terracotta'
];
const LEGACY_LINE='  '+LEGACY_IDS.map((id)=>`"${id}"`).join(', ');
const MARKER='TPMAP_PHASE35_BLOCK_STATE_INPUT_NORMALIZER_V1';

if(selfTest) selfTestTransform();
else if(!generator) throw new Error('--generator is required');
else await run(generator,validateOnly);

async function run(root,validate){
  const file=path.join(root,'src/lib/mcworld.mjs');
  const source=await readFile(file,'utf8');
  const normalized=normalizeBedrockBlocks(source);
  if(!validate&&normalized!==source) await writeFile(file,normalized);
  validateBedrockBlocks(validate?source:normalized);
  console.log(JSON.stringify({status:validate?'validated':normalized===source?'already-normalized':'normalized',marker:MARKER}));
}

export function normalizeBedrockBlocks(source){
  if(source.includes('TPMAP_PHASE35_BLOCK_STATE_TRANSPORT_MCWORLD')) return source;
  const startToken='const BEDROCK_BLOCKS = new Set([';
  const start=source.indexOf(startToken);
  if(start<0) throw new Error('Phase 35 block-state input: BEDROCK_BLOCKS declaration missing');
  if(source.indexOf(startToken,start+startToken.length)>=0) throw new Error('Phase 35 block-state input: BEDROCK_BLOCKS declaration ambiguous');
  const bodyStart=start+startToken.length;
  const close=source.indexOf(']);',bodyStart);
  if(close<0) throw new Error('Phase 35 block-state input: BEDROCK_BLOCKS closing token missing');
  const body=source.slice(bodyStart,close);
  const ids=[...body.matchAll(/['"](minecraft:[a-z0-9_:.+-]+)['"]/g)].map((match)=>match[1]);
  if(!ids.length) throw new Error('Phase 35 block-state input: BEDROCK_BLOCKS contains no block ids');
  const unique=[...new Set(ids)];
  for(const id of LEGACY_IDS) if(!unique.includes(id)) throw new Error(`Phase 35 block-state input: required historical block id missing ${id}`);
  const legacySet=new Set(LEGACY_IDS);
  const extras=unique.filter((id)=>!legacySet.has(id)).sort();
  const lines=[];
  for(const id of extras) lines.push(`  "${id}",`);
  lines.push(LEGACY_LINE);
  const declaration=`${startToken}\n${lines.join('\n')}\n`;
  const output=source.slice(0,start)+declaration+source.slice(close);
  validateBedrockBlocks(output);
  return output;
}

function validateBedrockBlocks(source){
  if(source.includes('TPMAP_PHASE35_BLOCK_STATE_TRANSPORT_MCWORLD')) return;
  if(!source.includes(LEGACY_LINE)) throw new Error('Phase 35 block-state input: canonical structural anchor missing');
  const start=source.indexOf('const BEDROCK_BLOCKS = new Set(['),close=source.indexOf(']);',start);
  const body=source.slice(start,close);
  for(const id of LEGACY_IDS) if(!body.includes(`"${id}"`)&&!body.includes(`'${id}'`)) throw new Error(`Phase 35 block-state input: lost block id ${id}`);
}

function selfTestTransform(){
  const sample='const BEDROCK_BLOCKS = new Set([\n  "minecraft:weathered_copper",\n  '+LEGACY_IDS.slice().reverse().map((id)=>`"${id}"`).join(',\n  ')+'\n]);\nconst after=true;';
  const normalized=normalizeBedrockBlocks(sample);
  if(!normalized.includes(LEGACY_LINE)||!normalized.includes('minecraft:weathered_copper')) throw new Error('Phase 35 block-state input self-test failed to preserve/canonicalize ids');
  if(normalizeBedrockBlocks(normalized)!==normalized) throw new Error('Phase 35 block-state input normalization is not idempotent');
  console.log('Phase 35 block-state input normalizer self-test passed');
}
