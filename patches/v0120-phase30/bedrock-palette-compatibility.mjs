#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MARKER = 'PHASE30_SCENERY_BLOCK_LIBRARY_V2';
const BLOCK_SOURCE_FILES = [
  'src/lib/park-scenery-fidelity.mjs',
  'src/lib/park-landscaping-fidelity.mjs',
  'src/lib/surface-material-library.mjs',
  // Phase 30A planning provenance and several direct geometry paths emit
  // blocks from raster.mjs rather than from one of the fidelity libraries.
  // Scan the direct emitter so every literal block it can place reaches the
  // direct-world writer compatibility set before final preflight.
  'src/lib/raster.mjs',
];
const REQUIRED_BLOCK_SOURCE_FILES = [
  'src/lib/park-scenery-fidelity.mjs',
  'src/lib/park-landscaping-fidelity.mjs',
  'src/lib/raster.mjs',
];

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--self-test') options.selfTest = true;
    else if (argv[i] === '--generator') options.generator = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

export function extractMinecraftBlockIds(text) {
  return [...new Set(text.match(/minecraft:[a-z0-9_]+/g) || [])].sort();
}

function blockSetRegion(text) {
  const anchor = 'const BEDROCK_BLOCKS = new Set([';
  const start = text.indexOf(anchor);
  if (start < 0) throw new Error('Unable to locate BEDROCK_BLOCKS in src/lib/mcworld.mjs');
  const end = text.indexOf('\n]);', start);
  if (end < 0) throw new Error('Unable to locate BEDROCK_BLOCKS closing delimiter in src/lib/mcworld.mjs');
  return { start, end, body: text.slice(start, end) };
}

export function extendBedrockBlockLibrary(text, requiredBlocks) {
  const required = [...new Set(requiredBlocks)].sort();
  for (const block of required) {
    if (!/^minecraft:[a-z0-9_]+$/.test(block)) throw new Error(`Invalid Bedrock block identifier from fidelity library: ${block}`);
  }
  const region = blockSetRegion(text);
  const existing = new Set(extractMinecraftBlockIds(region.body));
  const missing = required.filter((block) => !existing.has(block));
  if (!missing.length && text.includes(MARKER)) return { text, changed: false, added: [] };

  const markerLine = text.includes(MARKER) ? '' : `  // ${MARKER}\n`;
  const insertion = `${region.body.trimEnd().endsWith('[') ? '' : ','}\n${markerLine}  ${missing.map((block) => JSON.stringify(block)).join(',\n  ')}`;
  const output = text.slice(0, region.end) + insertion + text.slice(region.end);
  const finalRegion = blockSetRegion(output);
  const finalIds = new Set(extractMinecraftBlockIds(finalRegion.body));
  const absent = required.filter((block) => !finalIds.has(block));
  if (absent.length) throw new Error(`Failed to register fidelity Bedrock blocks: ${absent.join(', ')}`);
  return { text: output, changed: true, added: missing };
}

async function collectRequiredBlocks(generator) {
  const blocks = new Set();
  const scanned = [];
  for (const relative of BLOCK_SOURCE_FILES) {
    const filename = path.join(generator, relative);
    let text;
    try { text = await readFile(filename, 'utf8'); } catch { continue; }
    scanned.push(relative);
    for (const block of extractMinecraftBlockIds(text)) blocks.add(block);
  }
  const missingSources = REQUIRED_BLOCK_SOURCE_FILES.filter((relative) => !scanned.includes(relative));
  if (missingSources.length) {
    throw new Error(`Required Phase 30 block sources are missing; missing=${missingSources.join(',')} scanned=${scanned.join(',') || 'none'}`);
  }
  return { blocks: [...blocks].sort(), scanned };
}

async function apply(generatorRoot) {
  const generator = path.resolve(generatorRoot);
  const mcworldFile = path.join(generator, 'src/lib/mcworld.mjs');
  const source = await readFile(mcworldFile, 'utf8');
  const { blocks, scanned } = await collectRequiredBlocks(generator);
  const transformed = extendBedrockBlockLibrary(source, blocks);
  if (transformed.changed) await writeFile(mcworldFile, transformed.text, 'utf8');

  const finalText = transformed.changed ? transformed.text : source;
  const region = blockSetRegion(finalText);
  const registered = new Set(extractMinecraftBlockIds(region.body));
  const absent = blocks.filter((block) => !registered.has(block));
  if (absent.length) throw new Error(`Bedrock writer block-library preflight failed: ${absent.join(', ')}`);
  return { status: transformed.changed ? 'patched' : 'already-patched', scanned, required: blocks.length, added: transformed.added };
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-palette-compat-v3-'));
  try {
    const lib = path.join(root, 'src/lib');
    await mkdir(lib, { recursive: true });
    await writeFile(path.join(lib, 'mcworld.mjs'), `const BEDROCK_BLOCKS = new Set([\n  "minecraft:stone"\n]);\n`);
    await writeFile(path.join(lib, 'park-scenery-fidelity.mjs'), 'export const wall = "minecraft:stone_brick_wall";\n');
    await writeFile(path.join(lib, 'park-landscaping-fidelity.mjs'), 'export const wall = "minecraft:polished_blackstone_wall";\n');
    await writeFile(path.join(lib, 'surface-material-library.mjs'), 'export const path = "minecraft:brick_wall";\n');
    await writeFile(path.join(lib, 'raster.mjs'), 'const PLANNING_QA_BLOCK = "minecraft:pink_wool";\n');

    const first = await apply(root);
    if (first.status !== 'patched') throw new Error(`Expected full-source synchronization to patch writer, got ${first.status}`);
    if (!first.scanned.includes('src/lib/raster.mjs')) throw new Error('Direct raster block source was not scanned');
    if (!first.added.includes('minecraft:pink_wool')) throw new Error('Planning QA block was not discovered from raster.mjs');

    const patched = await readFile(path.join(lib, 'mcworld.mjs'), 'utf8');
    const required = [
      'minecraft:stone',
      'minecraft:stone_brick_wall',
      'minecraft:polished_blackstone_wall',
      'minecraft:brick_wall',
      'minecraft:pink_wool',
    ];
    for (const block of required) if (!patched.includes(JSON.stringify(block))) throw new Error(`Missing registered test block ${block}`);
    if ((patched.match(new RegExp(MARKER, 'g')) || []).length !== 1) throw new Error('Bedrock block-library marker should remain singular');

    const second = await apply(root);
    if (second.status !== 'already-patched') throw new Error('Bedrock block-library synchronization is not idempotent');
    const twice = await readFile(path.join(lib, 'mcworld.mjs'), 'utf8');
    if (twice !== patched) throw new Error('Idempotent synchronization changed mcworld.mjs');
    console.log('Bedrock Phase 30 block-source synchronization self-test passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv);
try {
  if (options.selfTest) await selfTest();
  else {
    if (!options.generator) throw new Error('Usage: bedrock-palette-compatibility.mjs --generator <generator-root>');
    const result = await apply(options.generator);
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
