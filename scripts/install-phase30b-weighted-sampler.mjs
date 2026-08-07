#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MARKER = "TPMAP_PHASE30B_UNIFORM_WEIGHTED_SAMPLER_V1";
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
  const observed = uniformitySample();
  process.stdout.write(`phase30b_weighted_sampler_self_test=PASS observed=${observed.map((v) => v.toFixed(4)).join(",")}\n`);
}

async function install(generator) {
  if (!generator) throw new Error("--generator is required");
  const file = path.resolve(generator, "src/lib/fidelity.mjs");
  const before = await readFile(file, "utf8");
  const after = patchWeightedSampler(before);
  if (after !== before) await writeFile(file, after, "utf8");
  if (!after.includes(MARKER)) throw new Error("weighted sampler marker missing after install");
  process.stdout.write(`phase30b_weighted_sampler=${after === before ? "already-current" : "installed"}\n`);
}

const args = parse(process.argv);
if (args.selfTest) await selfTest();
else await install(args.generator);
