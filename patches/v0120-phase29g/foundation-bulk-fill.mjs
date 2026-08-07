#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--self-test') options.selfTest = true;
    else if (argv[i] === '--file') options.file = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

const OFFSET_ANCHOR = 'const DEFAULT_CHUNK_VERSION = 42; // Bedrock 1.21.120 chunk storage.\n';
const OFFSET_TABLE = `const DEFAULT_CHUNK_VERSION = 42; // Bedrock 1.21.120 chunk storage.\nconst CHUNK_LAYER_OFFSETS = Array.from({ length: 16 }, (_, localY) => {\n  const offsets = new Uint16Array(256);\n  let index = 0;\n  for (let localZ = 0; localZ < 16; localZ += 1) {\n    for (let localX = 0; localX < 16; localX += 1) {\n      offsets[index++] = offsetToChunkBlockIndex({ x: localX, y: localY, z: localZ });\n    }\n  }\n  return offsets;\n});\n`;

const OLD_FOUNDATION = `  buildFoundation() {\n    const bedrock = this.registry.id("minecraft:bedrock");\n    const stone = this.registry.id("minecraft:stone");\n    const dirt = this.registry.id("minecraft:dirt");\n    for (let localZ = 0; localZ < 16; localZ += 1) {\n      for (let localX = 0; localX < 16; localX += 1) {\n        const worldX = this.chunkX * 16 + localX;\n        const worldZ = this.chunkZ * 16 + localZ;\n        for (let y = 0; y <= this.baseY; y += 1) {\n          let id;\n          if (y === 0) id = bedrock;\n          else if (y < this.baseY - 3) id = stone;\n          else if (y < this.baseY) id = dirt;\n          else id = this.registry.id(resolveMaterial("minecraft:grass_block", this.paletteProfile, this.seed, worldX, y, worldZ));\n          this.set(localX, y, localZ, id);\n        }\n      }\n    }\n  }`;

const NEW_FOUNDATION = `  buildFoundation() {\n    const bedrock = this.registry.id("minecraft:bedrock");\n    const stone = this.registry.id("minecraft:stone");\n    const dirt = this.registry.id("minecraft:dirt");\n    // Preserve the original registry side effects even when baseY is negative.\n    if (this.baseY < 0) return;\n    const maxSubChunkIndex = floorDiv(this.baseY, 16);\n\n    for (let subChunkIndex = 0; subChunkIndex <= maxSubChunkIndex; subChunkIndex += 1) {\n      const subChunkBaseY = subChunkIndex * 16;\n      const maxLocalY = Math.min(15, this.baseY - subChunkBaseY);\n      const blocks = new Uint16Array(4096);\n\n      // Full interior stone subchunks are the common case at normal base Y.\n      // Filling the typed array directly replaces thousands of set()/Map/floor\n      // operations while producing the exact same global block IDs.\n      if (subChunkBaseY > 0 && maxLocalY === 15 && subChunkBaseY + 15 < this.baseY - 3) {\n        blocks.fill(stone);\n        this.subchunks.set(subChunkIndex, blocks);\n        continue;\n      }\n\n      for (let localY = 0; localY <= maxLocalY; localY += 1) {\n        const y = subChunkBaseY + localY;\n        const offsets = CHUNK_LAYER_OFFSETS[localY];\n        let id;\n        if (y === 0) id = bedrock;\n        else if (y < this.baseY - 3) id = stone;\n        else if (y < this.baseY) id = dirt;\n        else {\n          // Preserve the previous z/x traversal order so palette registration\n          // order and deterministic realistic-material choices stay identical.\n          let offsetIndex = 0;\n          for (let localZ = 0; localZ < 16; localZ += 1) {\n            const worldZ = this.chunkZ * 16 + localZ;\n            for (let localX = 0; localX < 16; localX += 1) {\n              const worldX = this.chunkX * 16 + localX;\n              blocks[offsets[offsetIndex++]] = this.registry.id(\n                resolveMaterial("minecraft:grass_block", this.paletteProfile, this.seed, worldX, y, worldZ)\n              );\n            }\n          }\n          continue;\n        }\n        for (let index = 0; index < offsets.length; index += 1) blocks[offsets[index]] = id;\n      }\n      this.subchunks.set(subChunkIndex, blocks);\n    }\n  }`;

export function transformFoundation(text) {
  if (text.includes('const CHUNK_LAYER_OFFSETS = Array.from') && text.includes('const maxSubChunkIndex = floorDiv(this.baseY, 16);')) {
    return { text, changed: false };
  }
  if (!text.includes(OFFSET_ANCHOR)) throw new Error('Phase 29G: chunk-version anchor changed unexpectedly');
  if (!text.includes(OLD_FOUNDATION)) throw new Error('Phase 29G: foundation builder changed unexpectedly');
  let output = text.replace(OFFSET_ANCHOR, OFFSET_TABLE);
  output = output.replace(OLD_FOUNDATION, NEW_FOUNDATION);
  return { text: output, changed: true };
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-phase29g-'));
  try {
    const sample = `const WORLD_MIN_Y=-64;\nconst WORLD_MAX_Y=319;\nconst offsetToChunkBlockIndex=({x,y,z})=>y*256+z*16+x;\n${OFFSET_ANCHOR}function floorDiv(a,b){return Math.floor(a/b)}\nfunction floorMod(a,b){return ((a%b)+b)%b}\nfunction resolveMaterial(source, profile, seed, x, y, z){return ((x+z+seed)&1)===0?source:"minecraft:moss_block"}\nclass Registry {\n  constructor(){this.blocks=[];this.indices=new Map();}\n  id(name){if(this.indices.has(name))return this.indices.get(name);const id=this.blocks.length;this.indices.set(name,id);this.blocks.push(name);return id;}\n}\nexport class X {\n  constructor(baseY){this.baseY=baseY;this.registry=new Registry();this.subchunks=new Map();this.chunkX=2;this.chunkZ=-3;this.paletteProfile="realistic";this.seed=11;}\n  set(x,y,z,blockId){if(y<WORLD_MIN_Y||y>WORLD_MAX_Y)return;const subChunkIndex=floorDiv(y,16);let blocks=this.subchunks.get(subChunkIndex);if(!blocks){blocks=new Uint16Array(4096);this.subchunks.set(subChunkIndex,blocks);}blocks[offsetToChunkBlockIndex({x,y:floorMod(y,16),z})]=blockId;}\n${OLD_FOUNDATION}\n  snapshot(){return {registry:[...this.registry.blocks],subchunks:[...this.subchunks.entries()].map(([index,blocks])=>[index,Array.from(blocks)])};}\n}\n`;
    const first = transformFoundation(sample);
    if (!first.changed) throw new Error('Phase 29G self-test expected a transformation');
    const second = transformFoundation(first.text);
    if (second.changed || second.text !== first.text) throw new Error('Phase 29G transform is not idempotent');
    for (const marker of ['CHUNK_LAYER_OFFSETS', 'blocks.fill(stone)', 'maxSubChunkIndex']) {
      if (!first.text.includes(marker)) throw new Error(`Phase 29G self-test missing ${marker}`);
    }

    const originalFile = path.join(root, 'original.mjs');
    const transformedFile = path.join(root, 'transformed.mjs');
    await writeFile(originalFile, sample);
    await writeFile(transformedFile, first.text);
    const check = spawnSync(process.execPath, ['--check', transformedFile], { encoding: 'utf8' });
    if (check.status !== 0) throw new Error(`Phase 29G transformed syntax failed: ${check.stderr || check.stdout}`);

    const original = await import(pathToFileURL(originalFile).href + '?old=1');
    const transformed = await import(pathToFileURL(transformedFile).href + '?new=1');
    for (const baseY of [-1, 0, 1, 2, 4, 15, 16, 31, 32, 63, 64, 65, 127]) {
      const before = new original.X(baseY);
      const after = new transformed.X(baseY);
      before.buildFoundation();
      after.buildFoundation();
      const expected = JSON.stringify(before.snapshot());
      const actual = JSON.stringify(after.snapshot());
      if (actual !== expected) throw new Error(`Phase 29G foundation equivalence failed at baseY=${baseY}`);
    }
    console.log('Phase 29G foundation bulk-fill transform self-test passed with exact foundation equivalence');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv);
try {
  if (options.selfTest) await selfTest();
  else {
    if (!options.file) throw new Error('Usage: foundation-bulk-fill.mjs --file <mcworld.mjs>');
    const filename = path.resolve(options.file);
    const original = await readFile(filename, 'utf8');
    const transformed = transformFoundation(original);
    if (transformed.changed) await writeFile(filename, transformed.text);
    console.log(JSON.stringify({ status: transformed.changed ? 'patched' : 'already-patched', file: filename }));
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
