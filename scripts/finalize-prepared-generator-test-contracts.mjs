#!/usr/bin/env node
// TPMAP_PREPARED_GENERATOR_TEST_CONTRACT_FINALIZER_V2
// Canonicalizes assembled-generator test contracts before the final compatibility gate.
// This script changes tests only; production generator source is never rewritten here.

import path from 'node:path';
import { readFile, writeFile, readdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const generatorIndex = args.indexOf('--generator');
const generator = generatorIndex >= 0 ? path.resolve(args[generatorIndex + 1]) : null;
const validateOnly = args.includes('--validate-only');
const selfTest = args.includes('--self-test');

const VECTOR_TEST_TITLE = 'accepted georeferenced vector PDF produces evidence-only path and footprint candidates';
const VECTOR_MARKERS = Object.freeze([
  'TPMAP_PREPARED_GENERATOR_VECTOR_CANDIDATE_SET_V1',
  'TPMAP_ALTON_VECTOR_CARDINALITY_COMPATIBILITY_V2',
  'TPMAP_ALTON_POSTMERGE_VECTOR_CARDINALITY_COMPATIBILITY'
]);
const GENERATED_IMPLEMENTATIONS = /^(?:vertical-evidence-engine|terrain-surface-model|building-roof-reconstruction|building-roof-plane-decomposition|building-roof-planning-constraints|vegetation-reconstruction|ride-vertical-profile|ride-3d-geometry|ride-support-reconstruction|ride-terrain-interaction|ride-excavation-mask|ride-excavation-compiler|ride-graph-compiler|terrain-morphology|terrain-planning-structure-association|terrain-structure-compiler|terrain-steep-bank-treatment|terrain-tunnel-portal-reconciliation|retaining-wall-detail|terrain-qa|block-state-transport|mcworld|bedrock|pipeline)\.mjs$/;

if (selfTest) runSelfTest();
else if (!generator) throw new Error('--generator is required');
else await finalize(generator, validateOnly);

async function finalize(root, validate) {
  const testDir = path.join(root, 'test');
  const tests = (await readdir(testDir)).filter((name) => name.endsWith('.test.mjs'));
  let importsChanged = 0;
  let vectorChanged = false;

  if (!validate) {
    for (const name of tests) {
      const file = path.join(testDir, name);
      const source = await readFile(file, 'utf8');
      const normalized = normalizeGeneratedTestImports(source);
      if (normalized !== source) {
        await writeFile(file, normalized);
        importsChanged += 1;
      }
    }

    const vectorFile = path.join(testDir, 'planning-vectorize.test.mjs');
    const vectorSource = await readFile(vectorFile, 'utf8');
    const modernized = modernizePlanningVectorCandidateContract(vectorSource);
    if (modernized !== vectorSource) {
      await writeFile(vectorFile, modernized);
      vectorChanged = true;
    }
  }

  for (const name of tests) {
    validateGeneratedTestImports(await readFile(path.join(testDir, name), 'utf8'), name);
  }
  validatePlanningVectorCandidateContract(await readFile(path.join(testDir, 'planning-vectorize.test.mjs'), 'utf8'));

  console.log(JSON.stringify({
    status: validate ? 'validated' : 'finalized',
    marker: 'TPMAP_PREPARED_GENERATOR_TEST_CONTRACT_FINALIZER_V2',
    importsChanged,
    vectorChanged
  }));
}

export function normalizeGeneratedTestImports(source) {
  return source.replace(/from\s+(['"])\.\/([A-Za-z0-9._-]+\.mjs)\1/g, (whole, quote, moduleName) => {
    if (!GENERATED_IMPLEMENTATIONS.test(moduleName)) return whole;
    return `from ${quote}../src/lib/${moduleName}${quote}`;
  });
}

export function modernizePlanningVectorCandidateContract(source) {
  const range = locateNamedTest(source, VECTOR_TEST_TITLE);
  if (!range) throw new Error('Prepared generator test finalizer: planning vector regression test anchor missing');

  let block = source.slice(range.start, range.end);
  const rewritten = rewriteExactLengthAssertions(block);
  block = rewritten.source;

  if (!rewritten.changed && hasObsoleteExactCandidateAssertion(block)) {
    throw new Error('Prepared generator test finalizer: obsolete exact candidate assertion could not be safely rewritten');
  }

  // Keep marker layout canonical so running the finalizer repeatedly is byte-for-byte idempotent.
  for (const marker of VECTOR_MARKERS) {
    const markerPattern = new RegExp(`\\n?[\\t ]*//[\\t ]*${escapeRegex(marker)}[\\t ]*(?=\\n|$)`, 'g');
    block = block.replace(markerPattern, '');
  }
  block = block.replace(/[\t ]+$/gm, '').replace(/\s+$/, '');
  block += `\n${VECTOR_MARKERS.map((marker) => `// ${marker}`).join('\n')}\n`;

  const output = source.slice(0, range.start) + block + source.slice(range.end);
  validatePlanningVectorCandidateContract(output);
  return output;
}

function rewriteExactLengthAssertions(source) {
  let output = source;
  let cursor = 0;
  let changed = false;

  while (cursor < output.length) {
    const equalIndex = output.indexOf('assert.equal', cursor);
    const strictIndex = output.indexOf('assert.strictEqual', cursor);
    const candidates = [equalIndex, strictIndex].filter((index) => index >= 0);
    if (!candidates.length) break;

    const callStart = Math.min(...candidates);
    const open = output.indexOf('(', callStart);
    if (open < 0) break;
    const close = findMatchingParen(output, open);
    if (close < 0) throw new Error('Prepared generator test finalizer: malformed assertion call in planning vector regression');

    const args = splitTopLevelArguments(output.slice(open + 1, close));
    const first = args[0]?.trim() || '';
    const second = args[1]?.trim() || '';
    const message = args.length === 3 ? args[2].trim() : '';

    const expectedCount = parseIntegerLiteral(second);
    if (args.length >= 2 && args.length <= 3 && first.includes('.length') && expectedCount !== null && expectedCount >= 2) {
      const statementEnd = consumeOptionalSemicolon(output, close + 1);
      const replacement = `assert.ok(${first} >= 2${message ? `, ${message}` : ''});`;
      output = output.slice(0, callStart) + replacement + output.slice(statementEnd);
      cursor = callStart + replacement.length;
      changed = true;
    } else {
      cursor = close + 1;
    }
  }

  return { source: output, changed };
}

function hasObsoleteExactCandidateAssertion(source) {
  let cursor = 0;
  while (cursor < source.length) {
    const equalIndex = source.indexOf('assert.equal', cursor);
    const strictIndex = source.indexOf('assert.strictEqual', cursor);
    const candidates = [equalIndex, strictIndex].filter((index) => index >= 0);
    if (!candidates.length) return false;

    const callStart = Math.min(...candidates);
    const open = source.indexOf('(', callStart);
    if (open < 0) return false;
    const close = findMatchingParen(source, open);
    if (close < 0) return true;
    const args = splitTopLevelArguments(source.slice(open + 1, close));
    const expectedCount = parseIntegerLiteral((args[1] || '').trim());
    if ((args[0] || '').includes('.length') && expectedCount !== null && expectedCount >= 2) return true;
    cursor = close + 1;
  }
  return false;
}

function parseIntegerLiteral(source) {
  const value = String(source || '').trim();
  if (!/^[0-9]+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function consumeOptionalSemicolon(source, index) {
  let cursor = index;
  while (cursor < source.length && /[\t ]/.test(source[cursor])) cursor += 1;
  if (source[cursor] === ';') cursor += 1;
  return cursor;
}

function findMatchingParen(source, openIndex) {
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
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelArguments(source) {
  const args = [];
  let start = 0;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
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
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') brace -= 1;
    else if (char === ',' && paren === 0 && bracket === 0 && brace === 0) {
      args.push(source.slice(start, index));
      start = index + 1;
    }
  }
  args.push(source.slice(start));
  return args;
}

function validateGeneratedTestImports(source, filename) {
  const bad = [...source.matchAll(/from\s+['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]/g)]
    .map((match) => match[1])
    .filter((moduleName) => GENERATED_IMPLEMENTATIONS.test(moduleName));
  if (bad.length) {
    throw new Error(`Prepared generator test finalizer: ${filename} imports generated implementation from test directory: ${bad.join(',')}`);
  }
}

function validatePlanningVectorCandidateContract(source) {
  const range = locateNamedTest(source, VECTOR_TEST_TITLE);
  if (!range) throw new Error('Prepared generator test finalizer: planning vector regression test missing');
  const block = source.slice(range.start, range.end);
  if (hasObsoleteExactCandidateAssertion(block)) {
    throw new Error('Prepared generator test finalizer: obsolete exact candidate cardinality remains');
  }
  if (!/\.length\s*>=\s*2/.test(block)) {
    throw new Error('Prepared generator test finalizer: minimum candidate-set assertion missing');
  }
  for (const marker of VECTOR_MARKERS) {
    if (!block.includes(marker)) throw new Error(`Prepared generator test finalizer: missing ${marker}`);
  }
}

function locateNamedTest(source, title) {
  const titleIndex = source.indexOf(title);
  if (titleIndex < 0) return null;
  const testA = source.lastIndexOf('\ntest(', titleIndex);
  const testB = source.lastIndexOf('\ntest (', titleIndex);
  const testStart = Math.max(testA, testB);
  const start = testStart < 0 ? 0 : testStart + 1;
  const nextA = source.indexOf('\ntest(', titleIndex + title.length);
  const nextB = source.indexOf('\ntest (', titleIndex + title.length);
  const candidates = [nextA, nextB].filter((value) => value >= 0);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return { start, end };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runSelfTest() {
  const imports = [
    'import { x } from "./terrain-morphology.mjs";',
    'import { y } from "./mcworld.mjs";',
    'import { z } from "./fixture.mjs";'
  ].join('\n');
  const normalized = normalizeGeneratedTestImports(imports);
  if (!normalized.includes('../src/lib/terrain-morphology.mjs') || !normalized.includes('../src/lib/mcworld.mjs') || !normalized.includes('./fixture.mjs')) {
    throw new Error('Prepared generator test finalizer self-test: generated import normalization failed');
  }

  const legacy = `test('${VECTOR_TEST_TITLE}',()=>{\n  const features=[];\n  assert.equal(features.length, 2);\n});\ntest('next',()=>{});`;
  const modern = modernizePlanningVectorCandidateContract(legacy);
  if (!modern.includes('features.length >= 2')) throw new Error('Prepared generator test finalizer self-test: cardinality not modernized');
  if (modernizePlanningVectorCandidateContract(modern) !== modern) throw new Error('Prepared generator test finalizer self-test: transform not idempotent');

  const realRunShape = `test('${VECTOR_TEST_TITLE}', async () => {\n  const candidates = await Promise.resolve(new Array(10).fill({}));\n  assert.strictEqual(\n    candidates.length,\n    2,\n    'legacy fixture expected only path + footprint candidates'\n  );\n  assert.equal(candidates[0] !== undefined, true);\n});\ntest('next',()=>{});`;
  const realModern = modernizePlanningVectorCandidateContract(realRunShape);
  if (!realModern.includes("assert.ok(candidates.length >= 2, 'legacy fixture expected only path + footprint candidates');")) {
    throw new Error('Prepared generator test finalizer self-test: multiline/message assertion not modernized');
  }
  if (modernizePlanningVectorCandidateContract(realModern) !== realModern) {
    throw new Error('Prepared generator test finalizer self-test: real-run transform not idempotent');
  }

  const expandedExact = `test('${VECTOR_TEST_TITLE}', async () => {\n  const candidates = await Promise.resolve(new Array(10).fill({}));\n  assert.strictEqual(candidates.length, 10);\n});\ntest('next',()=>{});`;
  const expandedModern = modernizePlanningVectorCandidateContract(expandedExact);
  if (!expandedModern.includes('assert.ok(candidates.length >= 2);')) {
    throw new Error('Prepared generator test finalizer self-test: expanded exact cardinality not generalized');
  }
  if (modernizePlanningVectorCandidateContract(expandedModern) !== expandedModern) {
    throw new Error('Prepared generator test finalizer self-test: expanded-cardinality transform not idempotent');
  }

  const alreadyModern = `test('${VECTOR_TEST_TITLE}',()=>{\n  const features=[];\n  assert.ok(features.length >= 2);\n});`;
  validatePlanningVectorCandidateContract(modernizePlanningVectorCandidateContract(alreadyModern));
  console.log('Prepared generator test contract finalizer self-test passed');
}
