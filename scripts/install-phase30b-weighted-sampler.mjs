#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MARKER = "TPMAP_PHASE30B_UNIFORM_WEIGHTED_SAMPLER_V1";
const TEST_MARKER = "TPMAP_PHASE30B_ACTIVE_MATERIAL_LAYER_TEST_V1";
const OLD = `function weightedPaletteBlock(palette, weights, rawX, rawZ, seed, scale = 1) {
  const sampleX = Math.floor(rawX / Math.max(1, scale));
  const sampleZ = Math.floor(rawZ / Math.max(1, scale));
  let roll = hash2d(sampleX, sampleZ, seed) % 1_000_000 / 1_000_000;
  for (let index = 0; index < palette.length; index += 1) {
    roll -= weights[index] || 0;
    if (roll < 0) return palette[index];
  }
  return palette.at(-1) || "minecraft:grass_block";
}`;

const NEW = `// ${MARKER}
function weightedPaletteBlock(palette, weights, rawX, rawZ, seed, scale = 1) {
  const sampleX = Math.floor(rawX / Math.max(1, scale));
  const sampleZ = Math.floor(rawZ / Math.max(1, scale));
  let roll = stablePaletteUnitRandom(sampleX, sampleZ, seed);
  for (let index = 0; index < palette.length; index += 1) {
    roll -= weights[index] || 0;
    if (roll < 0) return palette[index];
  }
  return palette.at(-1) || "minecraft:grass_block";
}

function stablePaletteUnitRandom(x, z, seed) {
  let h = (
    Math.imul(Number(x) | 0, 0x1f123bb5) ^
    Math.imul(Number(z) | 0, 0x5f356495) ^
    Math.imul(Number(seed) | 0, 0x6c8e9cf5)
  ) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}`;

const LEGACY_DISTRIBUTION_ASSERTION = `  for (const [style, expected] of [[asphalt,[0.6,0.4]],[brick,[0.6,0.3,0.1]],[stone,[0.55,0.05,0.2,0.15,0.05]],[grass,[0.7,0.3]]]) { const mix=distribution(style); style.paletteBlocks.forEach((block,index)=>assert.ok(Math.abs(mix[block]-expected[index])<0.035, \`\${block} distribution \${mix[block]}\`)); }`;

const ACTIVE_LAYER_ASSERTION = `  // ${TEST_MARKER}
  const themeLibrary = await import('../src/lib/surface-material-library.mjs').catch((error) => {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  if (!themeLibrary) {
    for (const [style, expected] of [[asphalt,[0.6,0.4]],[brick,[0.6,0.3,0.1]],[stone,[0.55,0.05,0.2,0.15,0.05]],[grass,[0.7,0.3]]]) {
      const mix=distribution(style);
      style.paletteBlocks.forEach((block,index)=>assert.ok(Math.abs(mix[block]-expected[index])<0.035, \`\${block} distribution \${mix[block]}\`));
    }
  } else {
    const presets = themeLibrary.THEMEPARK_SURFACE_MATERIAL_PRESETS;
    const expected = {
      weathered_asphalt: [['minecraft:gray_wool',0.45],['minecraft:gray_concrete',0.30],['minecraft:light_gray_concrete',0.15],['minecraft:andesite',0.10]],
      red_block_paving: [['minecraft:brick_block',0.45],['minecraft:red_terracotta',0.25],['minecraft:granite',0.15],['minecraft:polished_granite',0.10],['minecraft:packed_mud',0.05]],
      natural_rock: [['minecraft:stone',0.30],['minecraft:andesite',0.20],['minecraft:tuff',0.20],['minecraft:cobblestone',0.10],['minecraft:mossy_cobblestone',0.10],['minecraft:gravel',0.10]],
      healthy_lawn: [['minecraft:grass_block',0.70],['minecraft:moss_block',0.20],['minecraft:green_wool',0.05],['minecraft:lime_terracotta',0.05]]
    };
    for (const [id, recipe] of Object.entries(expected)) {
      assert.ok(presets[id], \`missing active surface preset \${id}\`);
      assert.deepEqual(presets[id].palette.map((entry)=>[entry.block,entry.weight]), recipe);
    }
    const preset = presets.weathered_asphalt;
    const activeStyle = {
      materialPreset: preset.id,
      pattern: preset.pattern,
      paletteBlocks: preset.palette.map((entry)=>entry.block),
      paletteWeights: preset.palette.map((entry)=>entry.weight)
    };
    const mix = distribution(activeStyle);
    activeStyle.paletteBlocks.forEach((block,index)=>assert.ok(Math.abs(mix[block]-activeStyle.paletteWeights[index])<0.02, \`\${block} active-layer distribution \${mix[block]}\`));
  }`;

function parse(argv) {
  const out = { selfTest: false, generator: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--generator") out.generator = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

export function patchWeightedSampler(source) {
  if (source.includes(MARKER)) return source;
  if (!source.includes(OLD)) {
    throw new Error("Phase 30B weighted palette sampler anchor changed unexpectedly");
  }
  return source.replace(OLD, NEW);
}

export function patchMaterialRecipeTest(source) {
  if (!source || source.includes(TEST_MARKER)) return source;
  if (!source.includes("test('requested asphalt/brick/stone/grass material recipes are exact and deterministic', () => {")) {
    throw new Error("Phase 30B material recipe test signature changed unexpectedly");
  }
  if (!source.includes(LEGACY_DISTRIBUTION_ASSERTION)) {
    throw new Error("Phase 30B material recipe distribution assertion changed unexpectedly");
  }
  return source
    .replace(
      "test('requested asphalt/brick/stone/grass material recipes are exact and deterministic', () => {",
      "test('requested asphalt/brick/stone/grass material recipes are exact and deterministic', async () => {"
    )
    .replace(LEGACY_DISTRIBUTION_ASSERTION, ACTIVE_LAYER_ASSERTION);
}

function uniformitySample() {
  const weights = [0.6, 0.3, 0.1];
  const counts = [0, 0, 0];
  const size = 180;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      let roll = stablePaletteUnitRandomForTest(x, z, 771);
      let index = 0;
      for (; index < weights.length; index += 1) {
        roll -= weights[index];
        if (roll < 0) break;
      }
      counts[Math.min(index, weights.length - 1)] += 1;
    }
  }
  const total = size * size;
  const observed = counts.map((count) => count / total);
  for (let i = 0; i < weights.length; i += 1) {
    if (Math.abs(observed[i] - weights[i]) > 0.02) {
      throw new Error(`weighted sampler distribution drift index=${i} observed=${observed[i]}`);
    }
  }
  return observed;
}

function stablePaletteUnitRandomForTest(x, z, seed) {
  let h = (
    Math.imul(Number(x) | 0, 0x1f123bb5) ^
    Math.imul(Number(z) | 0, 0x5f356495) ^
    Math.imul(Number(seed) | 0, 0x6c8e9cf5)
  ) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

async function selfTest() {
  const fixture = `${OLD}\n`;
  const once = patchWeightedSampler(fixture);
  const twice = patchWeightedSampler(once);
  if (once !== twice || !once.includes(MARKER) || once.includes("hash2d(sampleX, sampleZ, seed) % 1_000_000")) {
    throw new Error("weighted palette sampler transform self-test failed");
  }
  const testFixture = `test('requested asphalt/brick/stone/grass material recipes are exact and deterministic', () => {\n${LEGACY_DISTRIBUTION_ASSERTION}\n});\n`;
  const patchedTest = patchMaterialRecipeTest(testFixture);
  if (!patchedTest.includes(TEST_MARKER) || !patchedTest.includes("async () =>") || patchMaterialRecipeTest(patchedTest) !== patchedTest) {
    throw new Error("active material-layer regression test transform self-test failed");
  }
  const observed = uniformitySample();
  process.stdout.write(`phase30b_weighted_sampler_self_test=PASS observed=${observed.map((v) => v.toFixed(4)).join(",")}\n`);
}

async function install(generator) {
  if (!generator) throw new Error("--generator is required");
  const root = path.resolve(generator);
  const file = path.resolve(root, "src/lib/fidelity.mjs");
  const before = await readFile(file, "utf8");
  const after = patchWeightedSampler(before);
  if (after !== before) await writeFile(file, after, "utf8");
  if (!after.includes(MARKER)) throw new Error("weighted sampler marker missing after install");

  const testFile = path.resolve(root, "test/material-pattern-recipes.test.mjs");
  const testBefore = await readFile(testFile, "utf8");
  const testAfter = patchMaterialRecipeTest(testBefore);
  if (testAfter !== testBefore) await writeFile(testFile, testAfter, "utf8");
  if (!testAfter.includes(TEST_MARKER)) throw new Error("active material-layer test marker missing after install");

  process.stdout.write(`phase30b_weighted_sampler=${after === before ? "already-current" : "installed"}\n`);
  process.stdout.write(`phase30b_material_test=${testAfter === testBefore ? "already-current" : "patched-for-active-layer"}\n`);
}

const args = parse(process.argv);
if (args.selfTest) await selfTest();
else await install(args.generator);
