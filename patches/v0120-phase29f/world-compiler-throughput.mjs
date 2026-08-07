#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--self-test') options.selfTest = true;
    else if (argv[i] === '--file') options.file = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

const OLD_CHUNK_LOOP = `    let completed = 0;\n    for (let chunkZ = bounds.minChunkZ; chunkZ <= bounds.maxChunkZ; chunkZ += 1) {\n      for (let chunkX = bounds.minChunkX; chunkX <= bounds.maxChunkX; chunkX += 1) {\n        const volume = new ChunkVolume({ chunkX, chunkZ, baseY, registry, paletteProfile, seed });\n        volume.buildFoundation();\n        const sourceChunk = operationChunks.get(\`\${chunkX},\${chunkZ}\`);\n        if (sourceChunk) volume.applyOperations(sourceChunk.o, compilation.palette);\n        const sourceSigns = signChunks.get(\`\${chunkX},\${chunkZ}\`) || [];\n\n        const records = volume.serialize({ chunkVersion, signs: sourceSigns });\n        await database.batch(chunkRecords(chunkX, chunkZ, records, chunkVersion));\n        if (!firstSample && records.subchunks.length) {\n          firstSample = { chunkX, chunkZ, subChunkIndex: records.subchunks[0].subChunkIndex };\n        }\n        if (containsColumn(chunkX, chunkZ, spawnTarget.x, spawnTarget.z)) {\n          spawnTopY = volume.highestBlockAt(floorMod(spawnTarget.x, 16), floorMod(spawnTarget.z, 16));\n        }\n\n        completed += 1;\n        if (completed % 100 === 0 || completed === chunkCount) {\n          progress(\`Writing Bedrock chunks \${completed.toLocaleString()}/\${chunkCount.toLocaleString()}\`);\n        }\n      }\n    }`;

const NEW_CHUNK_LOOP = `    // Group a small number of complete chunk record sets into one native\n    // LevelDB batch. Keys remain identical; this only reduces JS/native and\n    // storage synchronization overhead. Keep the group deliberately bounded.\n    const levelDbChunkBatchSize = 16;\n    let pendingChunkRecords = [];\n    let pendingChunkCount = 0;\n    const flushChunkRecords = async () => {\n      if (!pendingChunkRecords.length) return;\n      await database.batch(pendingChunkRecords);\n      pendingChunkRecords = [];\n      pendingChunkCount = 0;\n    };\n\n    let completed = 0;\n    for (let chunkZ = bounds.minChunkZ; chunkZ <= bounds.maxChunkZ; chunkZ += 1) {\n      for (let chunkX = bounds.minChunkX; chunkX <= bounds.maxChunkX; chunkX += 1) {\n        const volume = new ChunkVolume({ chunkX, chunkZ, baseY, registry, paletteProfile, seed });\n        volume.buildFoundation();\n        const sourceChunk = operationChunks.get(\`\${chunkX},\${chunkZ}\`);\n        if (sourceChunk) volume.applyOperations(sourceChunk.o, compilation.palette);\n        const sourceSigns = signChunks.get(\`\${chunkX},\${chunkZ}\`) || [];\n\n        const records = volume.serialize({ chunkVersion, signs: sourceSigns });\n        pendingChunkRecords.push(...chunkRecords(chunkX, chunkZ, records, chunkVersion));\n        pendingChunkCount += 1;\n        if (!firstSample && records.subchunks.length) {\n          firstSample = { chunkX, chunkZ, subChunkIndex: records.subchunks[0].subChunkIndex };\n        }\n        if (containsColumn(chunkX, chunkZ, spawnTarget.x, spawnTarget.z)) {\n          spawnTopY = volume.highestBlockAt(floorMod(spawnTarget.x, 16), floorMod(spawnTarget.z, 16));\n        }\n\n        completed += 1;\n        if (pendingChunkCount >= levelDbChunkBatchSize || completed === chunkCount) {\n          await flushChunkRecords();\n        }\n        if (completed % 100 === 0 || completed === chunkCount) {\n          progress(\`Writing Bedrock chunks \${completed.toLocaleString()}/\${chunkCount.toLocaleString()}\`);\n        }\n      }\n    }`;

const OLD_HEIGHT_MAP = `  serialize({ chunkVersion, signs = [] }) {\n    const heightMap = Array.from({ length: 16 }, () => Array(16).fill(WORLD_MIN_Y));\n    for (let x = 0; x < 16; x += 1) {\n      for (let z = 0; z < 16; z += 1) heightMap[x][z] = this.highestBlockAt(x, z) + 1;\n    }\n`;

const NEW_HEIGHT_MAP = `  computeHeightMap() {\n    // Sort the occupied subchunk stack once per chunk instead of once for each\n    // of the 256 columns. The resulting top-Y value is byte-for-byte equivalent\n    // to highestBlockAt(x, z) + 1 used by the previous serializer.\n    const heightMap = Array.from({ length: 16 }, () => Array(16).fill(WORLD_MIN_Y + 1));\n    const indices = [...this.subchunks.keys()].sort((a, b) => b - a);\n    for (let x = 0; x < 16; x += 1) {\n      for (let z = 0; z < 16; z += 1) {\n        let topY = WORLD_MIN_Y;\n        search: for (const subChunkIndex of indices) {\n          const blocks = this.subchunks.get(subChunkIndex);\n          for (let localY = 15; localY >= 0; localY -= 1) {\n            const id = blocks[offsetToChunkBlockIndex({ x, y: localY, z })];\n            if (this.registry.get(id)?.name !== AIR) {\n              topY = subChunkIndex * 16 + localY;\n              break search;\n            }\n          }\n        }\n        heightMap[x][z] = topY + 1;\n      }\n    }\n    return heightMap;\n  }\n\n  serialize({ chunkVersion, signs = [] }) {\n    const heightMap = this.computeHeightMap();\n`;

export function transformWorldCompiler(text) {
  if (text.includes('const levelDbChunkBatchSize = 16;') && text.includes('computeHeightMap() {')) {
    return { text, changed: false };
  }
  if (!text.includes(OLD_CHUNK_LOOP)) throw new Error('Phase 29F: direct-world chunk write loop changed unexpectedly');
  if (!text.includes(OLD_HEIGHT_MAP)) throw new Error('Phase 29F: direct-world height-map serializer changed unexpectedly');
  let output = text.replace(OLD_CHUNK_LOOP, NEW_CHUNK_LOOP);
  output = output.replace(OLD_HEIGHT_MAP, NEW_HEIGHT_MAP);
  return { text: output, changed: true };
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-phase29f-'));
  try {
    const sample = `const WORLD_MIN_Y=-64; const AIR='minecraft:air';\nclass X {\n  highestBlockAt(){return 1;}\n${OLD_HEIGHT_MAP}\n    return heightMap;\n  }\n}\nasync function y(){ let database={batch:async()=>{}}; let bounds={minChunkZ:0,maxChunkZ:-1,minChunkX:0,maxChunkX:-1}; let chunkCount=0, firstSample, spawnTopY, spawnTarget={}; let operationChunks=new Map(), signChunks=new Map(), compilation={palette:[]}, chunkVersion=1, completed=0; const ChunkVolume=class{}; const registry={},paletteProfile='',seed=0; const containsColumn=()=>false,floorMod=()=>0,chunkRecords=()=>[],progress=()=>{};\n${OLD_CHUNK_LOOP}\n}\nfunction offsetToChunkBlockIndex(){return 0;}\n`;
    const first = transformWorldCompiler(sample);
    if (!first.changed) throw new Error('Phase 29F self-test expected a transformation');
    const second = transformWorldCompiler(first.text);
    if (second.changed || second.text !== first.text) throw new Error('Phase 29F transform is not idempotent');
    for (const marker of ['levelDbChunkBatchSize = 16', 'pendingChunkRecords.push', 'computeHeightMap()']) {
      if (!first.text.includes(marker)) throw new Error(`Phase 29F self-test missing ${marker}`);
    }
    const transformedFile = path.join(root, 'mcworld.mjs');
    await writeFile(transformedFile, first.text);
    const check = spawnSync(process.execPath, ['--check', transformedFile], { encoding: 'utf8' });
    if (check.status !== 0) throw new Error(`Phase 29F transformed syntax failed: ${check.stderr || check.stdout}`);
    console.log('Phase 29F world compiler throughput transform self-test passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv);
try {
  if (options.selfTest) await selfTest();
  else {
    if (!options.file) throw new Error('Usage: world-compiler-throughput.mjs --file <mcworld.mjs>');
    const filename = path.resolve(options.file);
    const original = await readFile(filename, 'utf8');
    const transformed = transformWorldCompiler(original);
    if (transformed.changed) await writeFile(filename, transformed.text);
    console.log(JSON.stringify({ status: transformed.changed ? 'patched' : 'already-patched', file: filename }));
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
