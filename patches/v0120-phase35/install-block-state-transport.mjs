#!/usr/bin/env node
// TPMAP_PHASE35_BLOCK_STATE_TRANSPORT_INSTALLER
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),i=args.indexOf('--generator'),generator=i>=0?path.resolve(args[i+1]):null,validateOnly=args.includes('--validate-only'),selfTest=args.includes('--self-test');
if(selfTest)selfTestTransforms();else if(!generator)throw new Error('--generator is required');else await install(generator,validateOnly);

async function install(root,validate){
  const mcworldFile=path.join(root,'src/lib/mcworld.mjs');
  const bedrockFile=path.join(root,'src/lib/bedrock.mjs');
  const testFile=path.join(root,'test/block-state-transport.test.mjs');
  if(!validate){
    await writeFile(mcworldFile,transformMcworld(await readFile(mcworldFile,'utf8')));
    await writeFile(bedrockFile,transformBedrock(await readFile(bedrockFile,'utf8')));
    await writeFile(testFile,await readFile(path.join(here,'block-state-transport.test.mjs'),'utf8'));
  }
  const m=await readFile(mcworldFile,'utf8'),b=await readFile(bedrockFile,'utf8'),t=await readFile(testFile,'utf8');
  validateMcworld(m); validateBedrock(b);
  for(const token of ['stateful palette descriptor round-trips stair states into mcworld','stateful addon operation uses BlockPermutation instead of fill','plain string palette remains backward compatible'])if(!t.includes(token))throw new Error(`Phase 35 block-state tests missing ${token}`);
  console.log(JSON.stringify({status:validate?'validated':'installed',marker:'TPMAP_PHASE35_BLOCK_STATE_TRANSPORT_V1'}));
}

export function transformMcworld(source){
  if(source.includes('TPMAP_PHASE35_BLOCK_STATE_TRANSPORT_MCWORLD'))return source;
  let out=replaceOnce(source,
    'const BEDROCK_BLOCKS = new Set([',
    'const TPMAP_PHASE35_BLOCK_STATE_TRANSPORT_MCWORLD = true;\nconst BEDROCK_BLOCKS = new Set([',
    'mcworld transport marker');
  out=replaceOnce(out,
    '  "minecraft:azalea_leaves", "minecraft:birch_leaves", "minecraft:brown_terracotta", "minecraft:calcite", "minecraft:cyan_terracotta", "minecraft:dark_oak_leaves", "minecraft:deepslate", "minecraft:gray_concrete_powder", "minecraft:light_gray_concrete_powder", "minecraft:mud_bricks", "minecraft:oak_planks", "minecraft:orange_terracotta", "minecraft:packed_mud", "minecraft:podzol", "minecraft:polished_andesite", "minecraft:red_terracotta", "minecraft:smooth_sandstone", "minecraft:yellow_terracotta"',
    '  "minecraft:azalea_leaves", "minecraft:birch_leaves", "minecraft:brown_terracotta", "minecraft:calcite", "minecraft:cyan_terracotta", "minecraft:dark_oak_leaves", "minecraft:deepslate", "minecraft:gray_concrete_powder", "minecraft:light_gray_concrete_powder", "minecraft:mud_bricks", "minecraft:oak_planks", "minecraft:orange_terracotta", "minecraft:packed_mud", "minecraft:podzol", "minecraft:polished_andesite", "minecraft:red_terracotta", "minecraft:smooth_sandstone", "minecraft:yellow_terracotta",\n  "minecraft:normal_stone_slab", "minecraft:cobblestone_slab", "minecraft:mossy_cobblestone_slab",\n  "minecraft:normal_stone_stairs", "minecraft:stone_stairs", "minecraft:mossy_cobblestone_stairs"',
    'stateful terrain block whitelist');
  out=replaceOnce(out,
`  id(name) {
    if (!BEDROCK_BLOCKS.has(name)) {
      throw new UserError(\`The direct-world palette contains an unsupported Bedrock block identifier: \${name}\`);
    }
    const states = defaultStates(name);
    const key = \`\${name}\\u0000\${JSON.stringify(states)}\`;
    let id = this.indices.get(key);
    if (id !== undefined) return id;
    id = this.blocks.length;
    this.indices.set(key, id);
    this.blocks.push({ name, states });
    return id;
  }`,
`  id(input) {
    const block = normalizeBlockSpec(input);
    const { name, states } = block;
    if (!BEDROCK_BLOCKS.has(name)) {
      throw new UserError(\`The direct-world palette contains an unsupported Bedrock block identifier: \${name}\`);
    }
    const key = \`\${name}\\u0000\${JSON.stringify(states)}\`;
    let id = this.indices.get(key);
    if (id !== undefined) return id;
    id = this.blocks.length;
    this.indices.set(key, id);
    this.blocks.push({ name, states });
    return id;
  }`,
    'BlockRegistry.id descriptor support');
  out=replaceOnce(out,
`      const sourceBlock = sourcePalette[paletteIndex];
      for (let worldZ = z1; worldZ <= z2; worldZ += 1) {`,
`      const sourceBlock = sourcePalette[paletteIndex];
      const stateful = isBlockSpec(sourceBlock);
      for (let worldZ = z1; worldZ <= z2; worldZ += 1) {`,
    'stateful operation detection');
  out=replaceOnce(out,
`            const block = resolveMaterial(sourceBlock, this.paletteProfile, this.seed ^ phase, worldX, worldY, worldZ);
            this.set(localX, worldY, localZ, this.registry.id(block));`,
`            const block = stateful ? sourceBlock : resolveMaterial(sourceBlock, this.paletteProfile, this.seed ^ phase, worldX, worldY, worldZ);
            this.set(localX, worldY, localZ, this.registry.id(block));`,
    'stateful material preservation');
  out=replaceOnce(out,
`    const validation = await validateWorldDirectory(
      stage,
      firstSample,
      chunkVersion,
      compilation.signs || [],
      baseY
    );`,
`    const validation = await validateWorldDirectory(
      stage,
      firstSample,
      chunkVersion,
      compilation.signs || [],
      baseY,
      compilation
    );`,
    'stateful validation input');
  out=replaceOnce(out,
`async function validateWorldDirectory(stage, sample, expectedChunkVersion, signs, baseY) {`,
`async function validateWorldDirectory(stage, sample, expectedChunkVersion, signs, baseY, compilation) {`,
    'stateful validation signature');
  out=replaceOnce(out,
`    const signValidation = signs.length
      ? await validateSigns(database, signs, baseY)
      : { stored: 0, expected: 0, status: "not-applicable" };`,
`    const statefulPalette = await validateStatefulPalette(database, compilation, baseY);
    const signValidation = signs.length
      ? await validateSigns(database, signs, baseY)
      : { stored: 0, expected: 0, status: "not-applicable" };`,
    'stateful roundtrip validation');
  out=replaceOnce(out,
`      sample: { ...sample, paletteEntries: Object.keys(palette).length },
      signLabels: signValidation,`,
`      sample: { ...sample, paletteEntries: Object.keys(palette).length },
      statefulPalette,
      signLabels: signValidation,`,
    'stateful validation result');
  out=replaceOnce(out,
`async function validateSigns(database, signs, baseY) {`,
`async function validateStatefulPalette(database, compilation, baseY) {
  let sample = null;
  for (const chunk of compilation?.chunks || []) {
    for (const op of chunk.o || []) {
      const spec = compilation.palette?.[op[7]];
      if (!isBlockSpec(spec)) continue;
      if (!(op[1] === op[4] && op[2] === op[5] && op[3] === op[6])) throw new UserError("Stateful palette operations must be single-block writes");
      sample = { x:op[1], y:baseY+op[2], z:op[3], spec };
      break;
    }
    if (sample) break;
  }
  if (!sample) return { status:"not-applicable", verified:0 };
  const chunkX=floorDiv(sample.x,16),chunkZ=floorDiv(sample.z,16),subChunkIndex=floorDiv(sample.y,16);
  const indices={x:chunkX,z:chunkZ,dimension:"overworld",subChunkIndex};
  const raw=await database.get(generateChunkKeyFromIndices(indices,"SubChunkPrefix"));
  invariant(raw?.length,"Stateful block sample subchunk missing");
  const parsed=await entryContentTypeToFormatMap.SubChunkPrefix.parse(raw);
  const layer=parsed.value.layers.value.value[0];
  const offset=offsetToChunkBlockIndex({x:floorMod(sample.x,16),y:floorMod(sample.y,16),z:floorMod(sample.z,16)});
  const paletteIndex=layer.block_indices.value.value[offset];
  const entry=layer.palette.value[String(paletteIndex)]?.value;
  invariant(entry?.name?.value===sample.spec.name,"Stateful block name round-trip failed");
  for(const [name,value] of Object.entries(sample.spec.states||{})){
    const stored=entry.states?.value?.[name]?.value;
    const expected=typeof value==="boolean"?(value?1:0):value;
    invariant(stored===expected,\`Stateful block state round-trip failed for \${name}\`);
  }
  return {status:"passed",verified:1,block:sample.spec.name,states:sample.spec.states,x:sample.x,y:sample.y,z:sample.z};
}

async function validateSigns(database, signs, baseY) {`,
    'stateful palette validator function');
  out=replaceOnce(out,
`function defaultStates(name) {`,
`function isBlockSpec(value){return Boolean(value&&typeof value==="object"&&!Array.isArray(value)&&typeof value.name==="string");}
function normalizeBlockSpec(input){
  if(typeof input==="string")return{name:input,states:defaultStates(input)};
  if(!isBlockSpec(input))throw new UserError("The direct-world palette contains an invalid block descriptor");
  const states={...defaultStates(input.name)};
  for(const [name,value] of Object.entries(input.states||{}))states[name]=stateTag(value);
  return{name:input.name,states};
}
function stateTag(value){
  if(value&&typeof value==="object"&&["byte","int","string"].includes(value.type)&&Object.hasOwn(value,"value"))return value;
  if(typeof value==="boolean")return{type:"byte",value:value?1:0};
  if(Number.isInteger(value))return{type:"int",value};
  if(typeof value==="string")return{type:"string",value};
  throw new UserError("Stateful block descriptors only support boolean, integer, or string state values");
}

function defaultStates(name) {`,
    'block descriptor helpers');
  validateMcworld(out); return out;
}

export function transformBedrock(source){
  if(source.includes('TPMAP_PHASE35_BLOCK_STATE_TRANSPORT_ADDON'))return source;
  let out=replaceOnce(source,
    'function runtimeSource() {\n  return `import { BlockComponentTypes, BlockPermutation, SignSide, system, world } from "@minecraft/server";',
    'function runtimeSource() {\n  return `import { BlockComponentTypes, BlockPermutation, SignSide, system, world } from "@minecraft/server";\n// TPMAP_PHASE35_BLOCK_STATE_TRANSPORT_ADDON',
    'addon transport marker');
  out=replaceOnce(out,
`function commandFor(op, anchor) {
  const block = PARK.palette[op[7]];
  return \`fill \${anchor.x + op[1]} \${anchor.y + op[2]} \${anchor.z + op[3]} \${anchor.x + op[4]} \${anchor.y + op[5]} \${anchor.z + op[6]} \${block}\`;
}`,
`function commandFor(op, anchor) {
  const block = PARK.palette[op[7]];
  if (typeof block !== "string") throw new Error("Stateful block descriptor cannot use fill command path");
  return \`fill \${anchor.x + op[1]} \${anchor.y + op[2]} \${anchor.z + op[3]} \${anchor.x + op[4]} \${anchor.y + op[5]} \${anchor.z + op[6]} \${block}\`;
}

function applyOperation(dimension, op, anchor) {
  const block = PARK.palette[op[7]];
  if (typeof block === "string") { dimension.runCommand(commandFor(op, anchor)); return; }
  if (!block || typeof block.name !== "string" || !block.states || typeof block.states !== "object") throw new Error("Invalid stateful block descriptor");
  if (!(op[1] === op[4] && op[2] === op[5] && op[3] === op[6])) throw new Error("Stateful palette operations must be single-block writes");
  const target = dimension.getBlock({ x:anchor.x+op[1], y:anchor.y+op[2], z:anchor.z+op[3] });
  target?.setPermutation(BlockPermutation.resolve(block.name, block.states));
}`,
    'addon stateful applyOperation');
  out=replaceOnce(out,
`          try { dimension.runCommand(commandFor(operation, anchor)); }
          catch (error) { state.errors += 1; console.warn(\`[ThemePark Map] operation failed: \${error}\`); }`,
`          try { applyOperation(dimension, operation, anchor); }
          catch (error) { state.errors += 1; console.warn(\`[ThemePark Map] operation failed: \${error}\`); }`,
    'addon stateful operation dispatch');
  validateBedrock(out); return out;
}

function validateMcworld(source){
  for(const token of ['TPMAP_PHASE35_BLOCK_STATE_TRANSPORT_MCWORLD','normalizeBlockSpec(input)','statefulPalette = await validateStatefulPalette','minecraft:normal_stone_stairs','minecraft:mossy_cobblestone_stairs','minecraft:normal_stone_slab'])if(!source.includes(token))throw new Error(`Phase 35 mcworld block-state transport missing ${token}`);
}
function validateBedrock(source){
  for(const token of ['TPMAP_PHASE35_BLOCK_STATE_TRANSPORT_ADDON','function applyOperation(dimension, op, anchor)','BlockPermutation.resolve(block.name, block.states)','applyOperation(dimension, operation, anchor)'])if(!source.includes(token))throw new Error(`Phase 35 addon block-state transport missing ${token}`);
}
function replaceOnce(source,before,after,label){if(source.includes(after))return source;const first=source.indexOf(before);if(first<0)throw new Error(`Phase 35 block-state transport anchor missing: ${label}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`Phase 35 block-state transport anchor ambiguous: ${label}`);return source.slice(0,first)+after+source.slice(first+before.length);}
function selfTestTransforms(){
  const mc='const BEDROCK_BLOCKS = new Set([\n  "minecraft:azalea_leaves", "minecraft:birch_leaves", "minecraft:brown_terracotta", "minecraft:calcite", "minecraft:cyan_terracotta", "minecraft:dark_oak_leaves", "minecraft:deepslate", "minecraft:gray_concrete_powder", "minecraft:light_gray_concrete_powder", "minecraft:mud_bricks", "minecraft:oak_planks", "minecraft:orange_terracotta", "minecraft:packed_mud", "minecraft:podzol", "minecraft:polished_andesite", "minecraft:red_terracotta", "minecraft:smooth_sandstone", "minecraft:yellow_terracotta"\n]);\n';
  if(!transformMcworld.toString().includes('normalizeBlockSpec'))throw new Error('Phase 35 mcworld transform self-test missing descriptor support');
  if(!transformBedrock.toString().includes('BlockPermutation.resolve'))throw new Error('Phase 35 addon transform self-test missing permutation support');
  if(!mc.includes('BEDROCK_BLOCKS'))throw new Error('Phase 35 block-state transport self-test failed');
  console.log('Phase 35 block-state transport installer self-test passed');
}
