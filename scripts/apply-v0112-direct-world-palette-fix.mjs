#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'generator');

async function replaceIn(relative, replacements) {
  const file = path.join(root, relative);
  let text = await readFile(file, 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`${relative}: patch anchor not found: ${from.slice(0, 80)}`);
    text = text.replaceAll(from, to);
  }
  await writeFile(file, text);
}

await replaceIn('src/lib/fidelity.mjs', [['minecraft:rooted_dirt', 'minecraft:dirt_with_roots']]);
await replaceIn('src/lib/aerial-appearance.mjs', [['minecraft:rooted_dirt', 'minecraft:dirt_with_roots']]);

const mcworldPath = path.join(root, 'src/lib/mcworld.mjs');
let mcworld = await readFile(mcworldPath, 'utf8');
const additions = [
  'minecraft:azalea_leaves', 'minecraft:birch_leaves', 'minecraft:brown_terracotta',
  'minecraft:calcite', 'minecraft:cyan_terracotta', 'minecraft:dark_oak_leaves',
  'minecraft:deepslate', 'minecraft:gray_concrete_powder', 'minecraft:light_gray_concrete_powder',
  'minecraft:mud_bricks', 'minecraft:oak_planks', 'minecraft:orange_terracotta',
  'minecraft:packed_mud', 'minecraft:podzol', 'minecraft:polished_andesite',
  'minecraft:red_terracotta', 'minecraft:smooth_sandstone', 'minecraft:yellow_terracotta'
];
const marker = 'const BEDROCK_BLOCKS = new Set([';
const arrayStart = mcworld.indexOf(marker);
const arrayEnd = mcworld.indexOf('\n]);', arrayStart);
if (arrayStart < 0 || arrayEnd < 0) throw new Error('mcworld.mjs: BEDROCK_BLOCKS registry not found');
const bodyStart = arrayStart + marker.length;
let body = mcworld.slice(bodyStart, arrayEnd);
const missing = additions.filter((id) => !body.includes(`"${id}"`));
if (missing.length) {
  const trimmed = body.trimEnd();
  const trailingWhitespace = body.slice(trimmed.length);
  const separator = trimmed.endsWith(',') ? '\n  ' : ',\n  ';
  body = `${trimmed}${separator}${missing.map((id) => `"${id}"`).join(', ')}${trailingWhitespace}`;
  mcworld = mcworld.slice(0, bodyStart) + body + mcworld.slice(arrayEnd);
  await writeFile(mcworldPath, mcworld);
}

for (const relative of ['package.json', 'package-lock.json']) {
  const file = path.join(root, relative);
  const json = JSON.parse(await readFile(file, 'utf8'));
  json.version = '0.11.2';
  if (relative === 'package-lock.json' && json.packages?.['']) json.packages[''].version = '0.11.2';
  await writeFile(file, JSON.stringify(json, null, 2) + '\n');
}
await replaceIn('src/cli.mjs', [['ThemePark Map 0.11.1', 'ThemePark Map 0.11.2']]);
await replaceIn('src/lib/sources.mjs', [['ThemeParkMap/0.11.1', 'ThemeParkMap/0.11.2']]);

await mkdir(path.join(root, 'test'), { recursive: true });
await writeFile(path.join(root, 'test/direct-world-palette-compatibility.test.mjs'), `import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
const P = /["'](minecraft:[a-z0-9_]+)["']/g;
const blocks = (text) => new Set([...text.matchAll(P)].map((m) => m[1]));
test("direct-world module is valid JavaScript", () => {
  const file = fileURLToPath(new URL("../src/lib/mcworld.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
test("appearance palettes are accepted by the direct-world compiler", async () => {
  const [world, fidelity, aerial, raster] = await Promise.all([
    readFile(new URL("../src/lib/mcworld.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/fidelity.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/aerial-appearance.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/raster.mjs", import.meta.url), "utf8")
  ]);
  const section = world.slice(world.indexOf("const BEDROCK_BLOCKS"), world.indexOf("export const WORLD_PALETTES"));
  const allowed = blocks(section);
  const emitted = new Set([...blocks(fidelity), ...blocks(aerial), ...blocks(raster)]);
  emitted.delete("minecraft:overworld");
  const unsupported = [...emitted].filter((b) => !allowed.has(b)).sort();
  assert.deepEqual(unsupported, []);
});
test("Java rooted_dirt alias is not emitted", async () => {
  const text = (await Promise.all([
    readFile(new URL("../src/lib/fidelity.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/aerial-appearance.mjs", import.meta.url), "utf8")
  ])).join("\\n");
  assert.equal(text.includes("minecraft:rooted_dirt"), false);
});
`);

console.log(JSON.stringify({ version: '0.11.2', patchedBlocks: missing, root }, null, 2));
