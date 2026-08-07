#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
if (rootIndex < 0 || !args[rootIndex + 1]) throw new Error('Usage: material-pattern-transform.mjs --root <generator-root>');
const root = path.resolve(args[rootIndex + 1]);

await transformFidelity(path.join(root, 'src/lib/fidelity.mjs'));
await transformRaster(path.join(root, 'src/lib/raster.mjs'));
await transformMcworld(path.join(root, 'src/lib/mcworld.mjs'));
await writeMaterialTests(path.join(root, 'test/material-pattern-recipes.test.mjs'));
console.log('Phase 30B material-pattern recipes installed');

async function transformFidelity(file) {
  let text = await readFile(file, 'utf8');
  if (text.includes('const MATERIAL_PATTERN_RECIPES = Object.freeze({')) return;

  const objectStart = text.indexOf('const DEFAULT_MATERIAL_BLOCKS = Object.freeze({');
  if (objectStart < 0) throw new Error('DEFAULT_MATERIAL_BLOCKS anchor not found');
  const objectEnd = text.indexOf('\n});', objectStart);
  if (objectEnd < 0) throw new Error('DEFAULT_MATERIAL_BLOCKS terminator not found');
  const insertAt = objectEnd + '\n});'.length;
  text = text.slice(0, insertAt) + `\n\n// User-authored material recipes are deterministic weighted surface patterns.\n// Recipes can contain any number of Bedrock blocks. If explicit percentages\n// total less than 100, the unallocated remainder stays on the primary block so\n// no unspecified material is invented.\nconst MATERIAL_PATTERN_RECIPES = Object.freeze({\n  asphalt: materialRecipe("asphalt-v1", "speckled", [\n    ["minecraft:gray_wool", 60],\n    ["minecraft:gray_concrete", 40]\n  ]),\n  brick: materialRecipe("brick-v1", "mixed", [\n    ["minecraft:terracotta", 60],\n    ["minecraft:jungle_planks", 30],\n    ["minecraft:packed_mud", 10]\n  ]),\n  stone: materialRecipe("stone-v1", "mosaic", [\n    ["minecraft:stone", 40],\n    ["minecraft:cracked_stone_bricks", 5],\n    ["minecraft:stone_bricks", 20],\n    ["minecraft:andesite", 15],\n    ["minecraft:polished_andesite", 5]\n  ]),\n  grass: materialRecipe("grass-v1", "organic", [\n    ["minecraft:grass_block", 70],\n    ["minecraft:moss_block", 30]\n  ])\n});` + text.slice(insertAt);

  text = replaceOnce(text,
    '  const blocks = chooseSurfaceBlocks(material, colour);',
    '  const materialRecipe = material ? MATERIAL_PATTERN_RECIPES[material] || null : null;\n  const blocks = materialRecipe?.blocks || chooseSurfaceBlocks(material, colour);');
  text = replaceOnce(text,
    '  const pattern = explicitPattern || (hasObservedAppearance ? defaultPattern(material) : "solid");',
    '  const pattern = explicitPattern || materialRecipe?.pattern || (hasObservedAppearance ? defaultPattern(material) : "solid");');
  text = replaceOnce(text,
    '    paletteBlocks: [primaryBlock, secondaryBlock, tertiaryBlock],\n    paletteWeights: paletteWeightsFor(material, pattern),',
    '    paletteBlocks: materialRecipe?.blocks || [primaryBlock, secondaryBlock, tertiaryBlock],\n    paletteWeights: materialRecipe?.weights || paletteWeightsFor(material, pattern),\n    materialPatternRecipe: materialRecipe?.id || null,\n    exactMaterialPalette: Boolean(materialRecipe),');
  text = replaceOnce(text,
    '  const palette = [style.primaryBlock, style.secondaryBlock, style.tertiaryBlock]\n    .filter(Boolean);',
    '  const palette = (Array.isArray(style.paletteBlocks) && style.paletteBlocks.length\n    ? style.paletteBlocks\n    : [style.primaryBlock, style.secondaryBlock, style.tertiaryBlock]).filter(Boolean);');
  text = replaceOnce(text,
`  if (style.pattern === "mosaic") {\n    const roll = hash2d(Math.floor(rawX / scale), Math.floor(rawZ / scale), seed) % 100;\n    return roll < 20 ? tertiary : roll < 48 ? secondary : primary;\n  }\n  if (["mixed", "speckled", "organic"].includes(style.pattern)) {\n    const weights = normalizeWeights(style.paletteWeights || paletteWeightsFor(style.material, style.pattern));\n    const roll = hash2d(rawX, rawZ, seed) % 10_000 / 10_000;\n    if (roll < weights[0]) return primary;\n    if (roll < weights[0] + weights[1]) return secondary;\n    return tertiary;\n  }`,
`  if (["mixed", "speckled", "organic", "mosaic"].includes(style.pattern)) {\n    const weights = normalizeWeights(style.paletteWeights || paletteWeightsFor(style.material, style.pattern), palette.length);\n    return weightedPaletteBlock(palette, weights, rawX, rawZ, seed, scale);\n  }`);

  const normalizeMaterial = text.indexOf('function normalizeMaterial(value) {');
  if (normalizeMaterial < 0) throw new Error('normalizeMaterial anchor not found');
  text = text.slice(0, normalizeMaterial) + `function materialRecipe(id, pattern, entries) {\n  const clean = entries\n    .map(([block, weight]) => [String(block), Math.max(0, Number(weight) || 0)])\n    .filter(([, weight]) => weight > 0);\n  if (!clean.length) return Object.freeze({ id, pattern, blocks: [], weights: [] });\n  let total = clean.reduce((sum, [, weight]) => sum + weight, 0);\n  if (total < 100) {\n    clean[0][1] += 100 - total;\n    total = 100;\n  }\n  const weights = clean.map(([, weight]) => weight / total);\n  return Object.freeze({\n    id, pattern,\n    blocks: Object.freeze(clean.map(([block]) => block)),\n    weights: Object.freeze(weights)\n  });\n}\n\nfunction weightedPaletteBlock(palette, weights, rawX, rawZ, seed, scale = 1) {\n  const sampleX = Math.floor(rawX / Math.max(1, scale));\n  const sampleZ = Math.floor(rawZ / Math.max(1, scale));\n  let roll = hash2d(sampleX, sampleZ, seed) % 1_000_000 / 1_000_000;\n  for (let index = 0; index < palette.length; index += 1) {\n    roll -= weights[index] || 0;\n    if (roll < 0) return palette[index];\n  }\n  return palette.at(-1) || "minecraft:grass_block";\n}\n\n` + text.slice(normalizeMaterial);

  text = replaceOnce(text,
`function normalizeWeights(weights) {\n  const values = [0, 1, 2].map((index) => Math.max(0, Number(weights?.[index] || 0)));\n  const total = values.reduce((sum, value) => sum + value, 0) || 1;\n  return values.map((value) => value / total);\n}`,
`function normalizeWeights(weights, length = Math.max(1, weights?.length || 3)) {\n  const values = Array.from({ length }, (_, index) => Math.max(0, Number(weights?.[index] || 0)));\n  const total = values.reduce((sum, value) => sum + value, 0) || 1;\n  return values.map((value) => value / total);\n}`);
  await writeFile(file, text);
}

async function transformRaster(file) {
  let text = await readFile(file, 'utf8');
  if (text.includes('function compiledSurfaceBlock(style, x, z, seed)')) return;
  text = replaceOnce(text,
    'blockForSurfaceStyle(surfaceStyles[surfaceCode], x, z, seed)',
    'compiledSurfaceBlock(surfaceStyles[surfaceCode], x, z, seed)');
  text = replaceOnce(text,
    'blockForSurfaceStyle(surfaceStyles[surface[next]], end + 1, z, seed)',
    'compiledSurfaceBlock(surfaceStyles[surface[next]], end + 1, z, seed)');
  text = replaceOnce(text,
    'blockForSurfaceStyle(feature.surfaceStyle, cell.x, cell.z, seed)',
    'compiledSurfaceBlock(feature.surfaceStyle, cell.x, cell.z, seed)');

  const anchor = 'function surfaceStyleKey(style) {';
  const index = text.indexOf(anchor);
  if (index < 0) throw new Error('surfaceStyleKey anchor not found');
  text = text.slice(0, index) + `function compiledSurfaceBlock(style, x, z, seed) {\n  const block = blockForSurfaceStyle(style, x, z, seed);\n  return style?.exactMaterialPalette ? \`tpmap_exact:\${block}\` : block;\n}\n\n` + text.slice(index);
  text = replaceOnce(text,
    '    tertiaryBlock: style?.tertiaryBlock,\n    paletteWeights: style?.paletteWeights,',
    '    tertiaryBlock: style?.tertiaryBlock,\n    paletteBlocks: style?.paletteBlocks,\n    paletteWeights: style?.paletteWeights,\n    materialPatternRecipe: style?.materialPatternRecipe,\n    exactMaterialPalette: style?.exactMaterialPalette,');
  await writeFile(file, text);
}

async function transformMcworld(file) {
  let text = await readFile(file, 'utf8');
  if (!text.includes('"minecraft:gray_wool"')) {
    text = replaceOnce(text, '  "minecraft:gray_concrete",\n', '  "minecraft:gray_concrete", "minecraft:gray_wool",\n');
  }
  if (!text.includes('"minecraft:jungle_planks"')) {
    text = replaceOnce(text, '"minecraft:brown_terracotta", "minecraft:calcite"', '"minecraft:brown_terracotta", "minecraft:jungle_planks", "minecraft:calcite"');
  }
  if (!text.includes('"minecraft:terracotta"')) {
    text = replaceOnce(text, '"minecraft:smooth_sandstone", "minecraft:yellow_terracotta"', '"minecraft:smooth_sandstone", "minecraft:terracotta", "minecraft:yellow_terracotta"');
  }
  if (!text.includes('const exactPrefix = "tpmap_exact:";')) {
    text = replaceOnce(text,
      'function resolveMaterial(source, profile, seed, x, y, z) {\n  const variants = WORLD_PALETTES[profile]?.[source];',
      'function resolveMaterial(source, profile, seed, x, y, z) {\n  const exactPrefix = "tpmap_exact:";\n  if (String(source || "").startsWith(exactPrefix)) return String(source).slice(exactPrefix.length);\n  const variants = WORLD_PALETTES[profile]?.[source];');
  }
  await writeFile(file, text);
}

async function writeMaterialTests(file) {
  const testSource = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { deriveSurfaceStyle, blockForSurfaceStyle } from '../src/lib/fidelity.mjs';\n\nfunction feature(surface) { return { id: \`surface:\${surface}\`, kind: 'path', subtype: 'footway', tags: { surface }, localGeometry: { type: 'LineString', coordinates: [[0,0],[50,0]] }, source: { provider: 'test', dataset: 'material-recipes' } }; }\nfunction distribution(style, size = 180, seed = 771) { const counts = new Map(style.paletteBlocks.map((block) => [block, 0])); for (let z=0; z<size; z++) for (let x=0; x<size; x++) { const block = blockForSurfaceStyle(style, x, z, seed); counts.set(block, (counts.get(block)||0)+1); } const total=size*size; return Object.fromEntries([...counts].map(([block,count])=>[block,count/total])); }\n\ntest('requested asphalt/brick/stone/grass material recipes are exact and deterministic', () => {\n  const asphalt=deriveSurfaceStyle(feature('asphalt'),{accuracyMode:'plausible'}); assert.deepEqual(asphalt.paletteBlocks,['minecraft:gray_wool','minecraft:gray_concrete']); assert.deepEqual(asphalt.paletteWeights,[0.6,0.4]);\n  const brick=deriveSurfaceStyle(feature('brick'),{accuracyMode:'plausible'}); assert.deepEqual(brick.paletteBlocks,['minecraft:terracotta','minecraft:jungle_planks','minecraft:packed_mud']); assert.deepEqual(brick.paletteWeights,[0.6,0.3,0.1]);\n  const stone=deriveSurfaceStyle(feature('stone'),{accuracyMode:'plausible'}); assert.deepEqual(stone.paletteBlocks,['minecraft:stone','minecraft:cracked_stone_bricks','minecraft:stone_bricks','minecraft:andesite','minecraft:polished_andesite']); assert.deepEqual(stone.paletteWeights,[0.55,0.05,0.2,0.15,0.05]);\n  const grass=deriveSurfaceStyle(feature('grass'),{accuracyMode:'plausible'}); assert.deepEqual(grass.paletteBlocks,['minecraft:grass_block','minecraft:moss_block']); assert.deepEqual(grass.paletteWeights,[0.7,0.3]);\n  for (const [style, expected] of [[asphalt,[0.6,0.4]],[brick,[0.6,0.3,0.1]],[stone,[0.55,0.05,0.2,0.15,0.05]],[grass,[0.7,0.3]]]) { const mix=distribution(style); style.paletteBlocks.forEach((block,index)=>assert.ok(Math.abs(mix[block]-expected[index])<0.035, \`\${block} distribution \${mix[block]}\`)); }\n});\n\ntest('arbitrary-length weighted palettes are supported',()=>{ const style={pattern:'mixed',patternScale:1,paletteBlocks:['a','b','c','d','e','f'],paletteWeights:[0.1,0.15,0.2,0.25,0.2,0.1]}; const a=Array.from({length:256},(_,i)=>blockForSurfaceStyle(style,i%16,Math.floor(i/16),99)); const b=Array.from({length:256},(_,i)=>blockForSurfaceStyle(style,i%16,Math.floor(i/16),99)); assert.deepEqual(a,b); assert.ok(new Set(a).size>=5); });\n`;
  await writeFile(file, testSource);
}

function replaceOnce(text, before, after) {
  const index = text.indexOf(before);
  if (index < 0) throw new Error(`Required transform anchor not found: ${before.slice(0, 100)}`);
  return text.slice(0, index) + after + text.slice(index + before.length);
}
