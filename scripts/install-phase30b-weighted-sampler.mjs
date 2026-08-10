#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MARKER = "TPMAP_PHASE30B_UNIFORM_WEIGHTED_SAMPLER_V1";
const TEST_MARKER = "TPMAP_PHASE30B_ACTIVE_MATERIAL_LAYER_TEST_V1";
const TEST_TITLE = "requested asphalt/brick/stone/grass material recipes are exact and deterministic";

const CANONICAL_WEIGHTED_SAMPLER = `// ${MARKER}
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

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unbalanced function/test body beginning at offset ${openIndex}`);
}

function namedFunctionRanges(source, name) {
  const expression = new RegExp(`\\bfunction\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'g');
  const ranges = [];
  for (const match of source.matchAll(expression)) {
    const open = match.index + match[0].lastIndexOf('{');
    const close = findMatchingBrace(source, open);
    ranges.push({ start: match.index, end: close + 1, open, close });
  }
  return ranges;
}

function stripMarkerLine(source, marker) {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.includes(marker))
    .join('\n');
}

function validateWeightedSampler(source) {
  const weighted = namedFunctionRanges(source, 'weightedPaletteBlock');
  const random = namedFunctionRanges(source, 'stablePaletteUnitRandom');
  const markerCount = countMatches(source, new RegExp(MARKER, 'g'));
  const calls = countMatches(source, /stablePaletteUnitRandom\s*\(\s*sampleX\s*,\s*sampleZ\s*,\s*seed\s*\)/g);
  if (weighted.length !== 1 || random.length !== 1 || markerCount !== 1 || calls !== 1) {
    throw new Error(`Phase 30B sampler postcondition failed weighted=${weighted.length} random=${random.length} marker=${markerCount} calls=${calls}`);
  }
  if (/hash2d\s*\(\s*sampleX\s*,\s*sampleZ\s*,\s*seed\s*\)\s*%\s*1_000_000/.test(source)) {
    throw new Error('Phase 30B legacy modulo sampler remained after install');
  }
}

export function patchWeightedSampler(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Phase 30B sampler source must be non-empty text');

  let out = stripMarkerLine(source, MARKER);
  const weighted = namedFunctionRanges(out, 'weightedPaletteBlock');
  if (weighted.length !== 1) {
    throw new Error(`Phase 30B expected exactly one weightedPaletteBlock implementation, found ${weighted.length}`);
  }

  const random = namedFunctionRanges(out, 'stablePaletteUnitRandom');
  if (random.length > 1) {
    throw new Error(`Phase 30B expected at most one stablePaletteUnitRandom helper, found ${random.length}`);
  }

  let replaceStart = weighted[0].start;
  let replaceEnd = weighted[0].end;
  if (random.length === 1) {
    if (random[0].start < replaceEnd || /\S/.test(out.slice(replaceEnd, random[0].start))) {
      throw new Error('Phase 30B stablePaletteUnitRandom helper is detached from weightedPaletteBlock');
    }
    replaceEnd = random[0].end;
  }

  out = out.slice(0, replaceStart) + CANONICAL_WEIGHTED_SAMPLER + out.slice(replaceEnd);
  validateWeightedSampler(out);
  return out;
}

function locateMaterialRecipeTest(source) {
  const escaped = TEST_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`test\\s*\\(\\s*(['\"])${escaped}\\1\\s*,\\s*(async\\s+)?\\(\\s*\\)\\s*=>\\s*\\{`, 'gm');
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1) {
    throw new Error(`Phase 30B expected exactly one material recipe test, found ${matches.length}`);
  }
  const match = matches[0];
  const open = match.index + match[0].lastIndexOf('{');
  const close = findMatchingBrace(source, open);
  return { match, open, close };
}

function validateActiveMaterialTest(source) {
  const test = locateMaterialRecipeTest(source);
  const body = source.slice(test.open + 1, test.close);
  const markerCount = countMatches(body, new RegExp(TEST_MARKER, 'g'));
  if (!test.match[2] || markerCount !== 1 || !body.includes("THEMEPARK_SURFACE_MATERIAL_PRESETS") || !body.includes("weathered_asphalt")) {
    throw new Error('Phase 30B active material-layer test is partial or corrupt');
  }
}

function locateLegacyDistributionAssertion(source, test) {
  const body = source.slice(test.open + 1, test.close);
  const startExpression = /for\s*\(\s*const\s+\[\s*style\s*,\s*expected\s*\]\s+of\s+\[\s*\[\s*asphalt\b/gm;
  const matches = [...body.matchAll(startExpression)];
  if (matches.length !== 1) {
    throw new Error(`Phase 30B expected exactly one legacy distribution assertion, found ${matches.length}`);
  }
  const start = test.open + 1 + matches[0].index;
  const open = source.indexOf('{', start);
  if (open < 0 || open > test.close) throw new Error('Phase 30B legacy distribution assertion body is malformed');
  const close = findMatchingBrace(source, open);
  if (close > test.close) throw new Error('Phase 30B legacy distribution assertion escaped its owning test');
  return { start, end: close + 1 };
}

export function patchMaterialRecipeTest(source) {
  if (!source) return source;
  if (source.includes(TEST_MARKER)) {
    validateActiveMaterialTest(source);
    return source;
  }

  const test = locateMaterialRecipeTest(source);
  const legacy = locateLegacyDistributionAssertion(source, test);
  let out = source.slice(0, legacy.start) + ACTIVE_LAYER_ASSERTION.trimStart() + source.slice(legacy.end);

  const updated = locateMaterialRecipeTest(out);
  if (!updated.match[2]) {
    const header = updated.match[0];
    const asyncHeader = header.replace(/\(\s*\)\s*=>\s*\{$/, 'async () => {');
    if (asyncHeader === header) throw new Error('Phase 30B could not make material recipe test asynchronous');
    out = out.slice(0, updated.match.index) + asyncHeader + out.slice(updated.match.index + header.length);
  }

  validateActiveMaterialTest(out);
  return out;
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

async function selfTest() {
  const fixture = `function   weightedPaletteBlock ( palette, weights, rawX, rawZ, seed, scale = 1 ) {
    const sampleX=Math.floor(rawX/Math.max(1,scale));
    const sampleZ=Math.floor(rawZ/Math.max(1,scale));
    let roll=hash2d(sampleX,sampleZ,seed)%1_000_000/1_000_000;
    for(let index=0;index<palette.length;index+=1){roll-=weights[index]||0;if(roll<0)return palette[index];}
    return palette.at(-1)||"minecraft:grass_block";
  }`;
  const once = patchWeightedSampler(fixture);
  const twice = patchWeightedSampler(once);
  if (once !== twice || !once.includes(MARKER) || once.includes('hash2d(sampleX')) {
    throw new Error('weighted palette sampler structural transform self-test failed');
  }

  const partial = once.replace(/\nfunction stablePaletteUnitRandom[\s\S]*$/, '');
  const repaired = patchWeightedSampler(partial);
  if (repaired.trimEnd() !== once.trimEnd()) throw new Error('weighted palette sampler did not repair partial integration');

  let duplicateRejected = false;
  try {
    patchWeightedSampler(`${fixture}\n${fixture}`);
  } catch (error) {
    duplicateRejected = /exactly one/.test(String(error?.message));
  }
  if (!duplicateRejected) throw new Error('weighted palette sampler did not reject duplicate implementations');

  const testFixture = `test(
    '${TEST_TITLE}',
    () => {
      const keepThisAssertion = true;
      assert.equal(keepThisAssertion, true);
      for (
        const [style, expected] of [[asphalt,[0.6,0.4]],[brick,[0.6,0.3,0.1]],[stone,[0.55,0.05,0.2,0.15,0.05]],[grass,[0.7,0.3]]]
      ) {
        const mix = distribution(style);
        style.paletteBlocks.forEach((block,index) => assert.ok(Math.abs(mix[block]-expected[index]) < 0.035));
      }
    }
  );\n`;
  const patchedTest = patchMaterialRecipeTest(testFixture);
  if (!patchedTest.includes(TEST_MARKER) || !patchedTest.includes('async () =>') || !patchedTest.includes('keepThisAssertion')) {
    throw new Error('active material-layer regression test transform self-test failed');
  }
  if (patchMaterialRecipeTest(patchedTest) !== patchedTest) throw new Error('active material-layer test transform is not idempotent');

  const corruptTest = patchedTest.replace('THEMEPARK_SURFACE_MATERIAL_PRESETS', 'BROKEN_PRESET_EXPORT');
  let corruptRejected = false;
  try {
    patchMaterialRecipeTest(corruptTest);
  } catch (error) {
    corruptRejected = /partial or corrupt/.test(String(error?.message));
  }
  if (!corruptRejected) throw new Error('active material-layer transform accepted a partial marker-only integration');

  const observed = uniformitySample();
  process.stdout.write(`phase30b_weighted_sampler_self_test=PASS observed=${observed.map((v) => v.toFixed(4)).join(',')} structural_patch=PASS partial_repair=PASS\n`);
}

async function install(generator) {
  if (!generator) throw new Error('--generator is required');
  const root = path.resolve(generator);
  const file = path.resolve(root, 'src/lib/fidelity.mjs');
  const testFile = path.resolve(root, 'test/material-pattern-recipes.test.mjs');

  // Compute and validate both transforms before writing either file. A changed
  // test contract can no longer leave the generator half-patched.
  const before = await readFile(file, 'utf8');
  const testBefore = await readFile(testFile, 'utf8');
  const after = patchWeightedSampler(before);
  const testAfter = patchMaterialRecipeTest(testBefore);
  validateWeightedSampler(after);
  validateActiveMaterialTest(testAfter);

  if (after !== before) await writeFile(file, after, 'utf8');
  if (testAfter !== testBefore) await writeFile(testFile, testAfter, 'utf8');

  process.stdout.write(`phase30b_weighted_sampler=${after === before ? 'already-current' : 'installed'}\n`);
  process.stdout.write(`phase30b_material_test=${testAfter === testBefore ? 'already-current' : 'patched-for-active-layer'}\n`);
}

const args = parse(process.argv);
try {
  if (args.selfTest) await selfTest();
  else await install(args.generator);
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
