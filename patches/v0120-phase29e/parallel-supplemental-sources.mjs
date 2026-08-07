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

export function transformSupplementalSources(text) {
  if (text.includes('const independentSupplementalSources = [];') && text.includes('const collect = async (id, fn) => {')) {
    return { text, changed: false };
  }

  const runStart = text.indexOf('  const run = async (id, fn) => {');
  if (runStart < 0) throw new Error('Phase 29E: supplemental run helper start was not found');
  const planningStart = text.indexOf('\n\n  if (options.englandOpenData || options.planningData) {', runStart);
  if (planningStart < 0) throw new Error('Phase 29E: planning acquisition boundary was not found');
  const previousRun = text.slice(runStart, planningStart);
  if (!previousRun.includes('result.failures.push(failure)') || !previousRun.includes('runtime.strict')) {
    throw new Error('Phase 29E: supplemental run helper shape changed unexpectedly');
  }

  const replacementRun = `  const collect = async (id, fn) => {\n    try {\n      return { id, value: await fn(), error: null };\n    } catch (error) {\n      return { id, value: null, error };\n    }\n  };\n\n  const apply = (outcome) => {\n    const { id, value, error } = outcome;\n    if (error) {\n      const failure = { id, message: error?.message || String(error), details: error?.details || null };\n      result.failures.push(failure);\n      if (runtime.strict) throw error;\n      result.warnings.push(id + " unavailable: " + failure.message);\n      return;\n    }\n    if (!value) return;\n    for (const collection of value.collections || []) addCollection(result, collection);\n    if (value.evidence) result.evidence[id] = value.evidence;\n    for (const warning of value.warnings || []) result.warnings.push(id + ": " + warning);\n  };\n\n  const run = async (id, fn) => apply(await collect(id, fn));`;

  let output = text.slice(0, runStart) + replacementRun + text.slice(planningStart);

  const independentStart = output.indexOf('  if (options.englandOpenData || options.treesOutsideWoodland) {');
  const afterIndependent = output.indexOf('\n  for (const filename of options.osOpenMapLocal || []) {', independentStart);
  if (independentStart < 0 || afterIndependent < 0) {
    throw new Error('Phase 29E: independent supplemental source block was not found');
  }
  const previousIndependent = output.slice(independentStart, afterIndependent);
  for (const expected of [
    'await run("trees-outside-woodland"',
    'await run("microsoft-buildings"',
    'await run("wikidata-places"',
    'await run("wikimedia-commons"',
    'await run("open-aerial-map"'
  ]) {
    if (!previousIndependent.includes(expected)) {
      throw new Error(`Phase 29E: expected acquisition call is missing: ${expected}`);
    }
  }

  const replacementIndependent = `  // These providers are independent of the planning-document collection and of\n  // each other. Acquire them concurrently, but apply their outcomes in this\n  // declared order so collection/evidence/warning ordering stays deterministic.\n  const independentSupplementalSources = [];\n  if (options.englandOpenData || options.treesOutsideWoodland) {\n    independentSupplementalSources.push(["trees-outside-woodland", () => acquireTreesOutsideWoodland(runtime, options)]);\n  }\n  if (options.microsoftBuildings) {\n    independentSupplementalSources.push(["microsoft-buildings", () => acquireMicrosoftBuildings(runtime, options)]);\n  }\n  if (options.wikidataPlaces) {\n    independentSupplementalSources.push(["wikidata-places", () => acquireWikidataPlaces(runtime, options)]);\n  }\n  if (options.wikimediaCommons) {\n    independentSupplementalSources.push(["wikimedia-commons", () => acquireWikimediaCommons(runtime, options)]);\n  }\n  if (options.openAerialMap) {\n    independentSupplementalSources.push(["open-aerial-map", () => discoverOpenAerialMap(runtime, options)]);\n  }\n  if (independentSupplementalSources.length) {\n    const outcomes = await Promise.all(\n      independentSupplementalSources.map(([id, fn]) => collect(id, fn))\n    );\n    for (const outcome of outcomes) apply(outcome);\n  }`;

  output = output.slice(0, independentStart) + replacementIndependent + output.slice(afterIndependent);
  return { text: output, changed: true };
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-phase29e-'));
  try {
    const sample = `export async function acquireSupplementalSources(options, context) {\n  const result = { collections: [], evidence: {}, warnings: [], failures: [] };\n  const runtime = { strict: false };\n  const run = async (id, fn) => {\n    try {\n      const value = await fn();\n      if (!value) return;\n      for (const collection of value.collections || []) addCollection(result, collection);\n      if (value.evidence) result.evidence[id] = value.evidence;\n      for (const warning of value.warnings || []) result.warnings.push(\`\${id}: \${warning}\`);\n    } catch (error) {\n      const failure = { id, message: error?.message || String(error), details: error?.details || null };\n      result.failures.push(failure);\n      if (runtime.strict) throw error;\n      result.warnings.push(\`\${id} unavailable: \${failure.message}\`);\n    }\n  };\n\n  if (options.englandOpenData || options.planningData) { await run("planning-data", async () => null); }\n  if (options.englandOpenData || options.treesOutsideWoodland) {\n    await run("trees-outside-woodland", () => acquireTreesOutsideWoodland(runtime, options));\n  }\n  if (options.microsoftBuildings) {\n    await run("microsoft-buildings", () => acquireMicrosoftBuildings(runtime, options));\n  }\n  if (options.wikidataPlaces) {\n    await run("wikidata-places", () => acquireWikidataPlaces(runtime, options));\n  }\n  if (options.wikimediaCommons) {\n    await run("wikimedia-commons", () => acquireWikimediaCommons(runtime, options));\n  }\n  if (options.openAerialMap) {\n    await run("open-aerial-map", () => discoverOpenAerialMap(runtime, options));\n  }\n  for (const filename of options.osOpenMapLocal || []) { await run(filename, async () => null); }\n  return result;\n}\nfunction addCollection() {}\nfunction acquireTreesOutsideWoodland() {}\nfunction acquireMicrosoftBuildings() {}\nfunction acquireWikidataPlaces() {}\nfunction acquireWikimediaCommons() {}\nfunction discoverOpenAerialMap() {}\n`;
    const first = transformSupplementalSources(sample);
    if (!first.changed) throw new Error('Phase 29E self-test expected a transformation');
    const second = transformSupplementalSources(first.text);
    if (second.changed || second.text !== first.text) throw new Error('Phase 29E transform is not idempotent');
    for (const marker of ['Promise.all(', 'independentSupplementalSources', 'const collect = async', 'const apply = (outcome)']) {
      if (!first.text.includes(marker)) throw new Error(`Phase 29E self-test missing ${marker}`);
    }
    const transformedFile = path.join(root, 'supplemental-sources.mjs');
    await writeFile(transformedFile, first.text);
    const check = spawnSync(process.execPath, ['--check', transformedFile], { encoding: 'utf8' });
    if (check.status !== 0) throw new Error(`Phase 29E transformed syntax failed: ${check.stderr || check.stdout}`);
    console.log('Phase 29E parallel supplemental source transform self-test passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv);
try {
  if (options.selfTest) await selfTest();
  else {
    if (!options.file) throw new Error('Usage: parallel-supplemental-sources.mjs --file <supplemental-sources.mjs>');
    const filename = path.resolve(options.file);
    const original = await readFile(filename, 'utf8');
    const transformed = transformSupplementalSources(original);
    if (transformed.changed) await writeFile(filename, transformed.text);
    console.log(JSON.stringify({ status: transformed.changed ? 'patched' : 'already-patched', file: filename }));
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
