#!/usr/bin/env node
// TPMAP_PREPARED_GENERATOR_SOURCE_CONTRACT_VALIDATOR_V1
// Read-only validation for fully assembled production generator source.
// Deliberately imports no write/remove filesystem APIs.

import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';

const args = process.argv.slice(2);
const generatorIndex = args.indexOf('--generator');
const generator = generatorIndex >= 0 ? path.resolve(args[generatorIndex + 1]) : null;
const selfTest = args.includes('--self-test');

const GENERATED_IMPLEMENTATIONS = new Set([
  'vertical-evidence-engine.mjs',
  'terrain-surface-model.mjs',
  'building-roof-reconstruction.mjs',
  'building-roof-plane-decomposition.mjs',
  'building-roof-planning-constraints.mjs',
  'vegetation-reconstruction.mjs',
  'ride-vertical-profile.mjs',
  'ride-3d-geometry.mjs',
  'ride-support-reconstruction.mjs',
  'ride-terrain-interaction.mjs',
  'ride-excavation-mask.mjs',
  'ride-excavation-compiler.mjs',
  'ride-graph-compiler.mjs',
  'terrain-morphology.mjs',
  'terrain-planning-structure-association.mjs',
  'terrain-structure-compiler.mjs',
  'terrain-steep-bank-treatment.mjs',
  'terrain-tunnel-portal-reconciliation.mjs',
  'retaining-wall-detail.mjs',
  'terrain-qa.mjs',
  'block-state-transport.mjs',
  'mcworld.mjs',
  'bedrock.mjs',
  'pipeline.mjs'
]);
const FINITE_IMPLEMENTATIONS = new Set([...GENERATED_IMPLEMENTATIONS].filter((name) => ![
  'block-state-transport.mjs', 'mcworld.mjs', 'bedrock.mjs', 'pipeline.mjs'
].includes(name)));
const FINITE_GUARD = 'if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;';
const PHASE30B_REJECT = 'src/lib/planning-vectorize.mjs.rej';
const PHASE30B_SOURCE_TOKENS = Object.freeze([
  'extractPlanningSemanticAnchors(runtime, sourceFile',
  'buildGeoJsonCandidates(runtime, parsed, entry, config, semantic)',
  'semanticAnchors: semantic.anchors.length',
  'semanticMatches: extracted.semanticMatches',
  'config, semantic = { anchors: [] }',
  'let semanticMatches = 0',
  'return { features, withheld, withheldReasons, semanticMatches }'
]);

if (selfTest) runSelfTest();
else if (!generator) throw new Error('--generator is required');
else await validateGenerator(generator);

async function validateGenerator(root) {
  const libDir = path.join(root, 'src/lib');
  const libEntries = (await readdir(libDir)).filter((name) => name.endsWith('.mjs'));
  let finiteFilesValidated = 0;

  for (const name of libEntries) {
    if (!FINITE_IMPLEMENTATIONS.has(name)) continue;
    validateFiniteHelpers(await readFile(path.join(libDir, name), 'utf8'), name);
    finiteFilesValidated += 1;
  }

  validatePhase30bSemanticSource(await readFile(path.join(libDir, 'planning-vectorize.mjs'), 'utf8'));
  if (await exists(path.join(root, PHASE30B_REJECT))) {
    throw new Error(`Prepared generator source validator: stale ${PHASE30B_REJECT} remains`);
  }

  console.log(JSON.stringify({
    status: 'validated',
    marker: 'TPMAP_PREPARED_GENERATOR_SOURCE_CONTRACT_VALIDATOR_V1',
    finiteFilesValidated,
    sourceMutation: false
  }));
}

export function validatePhase30bSemanticSource(source) {
  for (const token of PHASE30B_SOURCE_TOKENS) {
    if (!source.includes(token)) throw new Error(`Prepared generator source validator: Phase 30B vector source lacks ${token}`);
  }
}

export function validateFiniteHelpers(source, filename = '<source>') {
  for (const range of namedFunctionRanges(source, 'finite')) {
    const fn = source.slice(range.start, range.end);
    if (!fn.includes(FINITE_GUARD)) {
      throw new Error(`Prepared generator source validator: ${filename} contains null-unsafe finite(value)`);
    }
  }
}

function namedFunctionRanges(source, name) {
  const ranges = [];
  const expression = new RegExp(`function\\s+${escapeRegExp(name)}\\s*\\(\\s*[A-Za-z_$][\\w$]*\\s*\\)\\s*\\{`, 'g');
  let match;
  while ((match = expression.exec(source))) {
    const open = source.indexOf('{', match.index);
    const close = findMatchingBrace(source, open);
    if (close < 0) throw new Error(`Prepared generator source validator: unbalanced ${name}() function`);
    ranges.push({ start: match.index, end: close + 1 });
    expression.lastIndex = close + 1;
  }
  return ranges;
}

function findMatchingBrace(source, open) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index], next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
async function exists(file) { try { await stat(file); return true; } catch { return false; } }

function runSelfTest() {
  const safe = `function finite(value) {\n  ${FINITE_GUARD}\n  const n = Number(value);\n  return Number.isFinite(n) ? n : null;\n}`;
  validateFiniteHelpers(safe, 'safe.mjs');

  const unsafe = 'function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }';
  let rejectedUnsafe = false;
  try { validateFiniteHelpers(unsafe, 'unsafe.mjs'); } catch { rejectedUnsafe = true; }
  if (!rejectedUnsafe) throw new Error('Prepared generator source validator self-test: unsafe finite() was accepted');

  validatePhase30bSemanticSource(PHASE30B_SOURCE_TOKENS.join('\n'));
  console.log('Prepared generator source contract validator self-test passed');
}
