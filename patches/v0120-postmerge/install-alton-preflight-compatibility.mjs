#!/usr/bin/env node
// TPMAP_ALTON_POSTMERGE_PREFLIGHT_COMPATIBILITY_V2
// Read-only assembled-generator validation. All production mutations must be
// owned by their canonical Phase 30/34/35 installers before this boundary.

import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const generatorIndex = args.indexOf('--generator');
const generator = generatorIndex >= 0 ? path.resolve(args[generatorIndex + 1]) : null;
const selfTest = args.includes('--self-test');
// Retain CLI compatibility for old callers, but this script never mutates in any mode.
const validateOnly = args.includes('--validate-only');
void validateOnly;

const GENERATED_TEST_IMPLEMENTATION = /^(?:vertical-evidence-engine|terrain-surface-model|building-roof-reconstruction|building-roof-plane-decomposition|building-roof-planning-constraints|vegetation-reconstruction|ride-vertical-profile|ride-3d-geometry|ride-support-reconstruction|ride-terrain-interaction|ride-excavation-mask|ride-excavation-compiler|ride-graph-compiler|terrain-morphology|terrain-planning-structure-association|terrain-structure-compiler|terrain-steep-bank-treatment|terrain-tunnel-portal-reconciliation|retaining-wall-detail|terrain-qa|block-state-transport|mcworld|bedrock|pipeline)\.mjs$/;

async function validateInstallation(root) {
  const vertical = await readFile(path.join(root, 'src/lib/vertical-evidence-engine.mjs'), 'utf8');
  const pipeline = await readFile(path.join(root, 'src/lib/pipeline.mjs'), 'utf8');
  const planning = await readFile(path.join(root, 'test/planning-vectorize.test.mjs'), 'utf8');

  validateVertical(vertical);
  validatePipeline(pipeline);
  validatePlanningVectorTest(planning);
  await validateGeneratedTestImports(root);

  console.log(JSON.stringify({
    status: 'validated',
    marker: 'TPMAP_ALTON_POSTMERGE_PREFLIGHT_COMPATIBILITY_V2',
    mutation: 'none'
  }));
}

export function validateVertical(source) {
  const required = [
    'value === null || value === undefined',
    'buildTerrainSurfaceModel(graph, options.verticalSources || null, options)',
    'classifyTerrainMorphology(graph, options.verticalSources || null, options)',
    'associatePlanningTerrainStructures(graph, options)',
    'reconstructBuildingRoofs(graph, options.verticalSources || null, options)',
    'decomposeBuildingRoofPlanes(graph, options.verticalSources || null, options)',
    'applyBuildingRoofPlanningConstraints(graph, options)',
    'reconstructVegetation(graph, options.verticalSources || null, options)',
    'solveRideVerticalProfiles(graph, options)'
  ];
  for (const token of required) {
    if (!source.includes(token)) throw new Error(`Postmerge validation: vertical engine missing ${token}`);
  }

  const orderedStages = [
    'buildTerrainSurfaceModel(graph, options.verticalSources || null, options)',
    'classifyTerrainMorphology(graph, options.verticalSources || null, options)',
    'associatePlanningTerrainStructures(graph, options)',
    'reconstructBuildingRoofs(graph, options.verticalSources || null, options)',
    'decomposeBuildingRoofPlanes(graph, options.verticalSources || null, options)',
    'applyBuildingRoofPlanningConstraints(graph, options)',
    'reconstructVegetation(graph, options.verticalSources || null, options)',
    'solveRideVerticalProfiles(graph, options)'
  ];
  const positions = orderedStages.map((token) => source.indexOf(token));
  for (let index = 1; index < positions.length; index += 1) {
    if (!(positions[index] > positions[index - 1])) {
      throw new Error(`Postmerge validation: canonical vertical stage ordering invalid at ${orderedStages[index]}`);
    }
  }
}

export function validatePipeline(source) {
  for (const token of [
    'TPMAP_PHASE34_VERTICAL_EVIDENCE_PIPELINE',
    'TPMAP_PHASE34_VERTICAL_SOURCES_HANDOFF',
    'solveParkVerticalEvidence(reconstructionGraph, { ...options, verticalSources: sources })',
    'validateVerticalResolution(reconstructionGraph)'
  ]) {
    if (!source.includes(token)) throw new Error(`Postmerge validation: pipeline missing ${token}`);
  }
}

export function validatePlanningVectorTest(source) {
  if (!source.includes('TPMAP_PREPARED_GENERATOR_VECTOR_CANDIDATE_SET_V1')) {
    throw new Error('Postmerge validation: prepared planning-vector candidate-set contract missing');
  }
  const testName = 'accepted georeferenced vector PDF produces evidence-only path and footprint candidates';
  const start = source.indexOf(testName);
  if (start < 0) throw new Error('Postmerge validation: planning vector regression test missing');
  const next = source.indexOf('\ntest(', start + testName.length);
  const block = source.slice(start, next < 0 ? source.length : next);
  if (/assert\.(?:equal|strictEqual)\([^;\n]*?\.length\s*,\s*2\s*\);/.test(block)) {
    throw new Error('Postmerge validation: obsolete exact planning-vector cardinality remains');
  }
  if (!/\.length\s*>=\s*2/.test(block)) {
    throw new Error('Postmerge validation: minimum planning-vector candidate-set assertion missing');
  }
}

async function validateGeneratedTestImports(root) {
  const testDir = path.join(root, 'test');
  const entries = await readdir(testDir);
  for (const name of entries) {
    if (!name.endsWith('.test.mjs')) continue;
    const source = await readFile(path.join(testDir, name), 'utf8');
    const bad = [...source.matchAll(/from\s+['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]/g)]
      .map((match) => match[1])
      .filter((moduleName) => GENERATED_TEST_IMPLEMENTATION.test(moduleName));
    if (bad.length) {
      throw new Error(`Postmerge validation: generated test ${name} imports test-local implementation ${bad.join(',')}`);
    }
  }
}

function selfTestContracts() {
  const vertical = [
    'function finite(value) {',
    '  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;',
    '}',
    'const terrainSurfaceModel = buildTerrainSurfaceModel(graph, options.verticalSources || null, options);',
    'const terrainMorphology = classifyTerrainMorphology(graph, options.verticalSources || null, options);',
    'const terrainPlanningAssociation = associatePlanningTerrainStructures(graph, options);',
    'const buildingRoofReconstruction = reconstructBuildingRoofs(graph, options.verticalSources || null, options);',
    'const buildingRoofPlaneDecomposition = decomposeBuildingRoofPlanes(graph, options.verticalSources || null, options);',
    'const buildingRoofPlanningConstraints = applyBuildingRoofPlanningConstraints(graph, options);',
    'const vegetationReconstruction = reconstructVegetation(graph, options.verticalSources || null, options);',
    'const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);'
  ].join('\n');
  validateVertical(vertical);

  const badOrder = vertical.replace(
    'const terrainMorphology = classifyTerrainMorphology(graph, options.verticalSources || null, options);\nconst terrainPlanningAssociation = associatePlanningTerrainStructures(graph, options);',
    'const terrainPlanningAssociation = associatePlanningTerrainStructures(graph, options);\nconst terrainMorphology = classifyTerrainMorphology(graph, options.verticalSources || null, options);'
  );
  try {
    validateVertical(badOrder);
    throw new Error('Postmerge validation self-test accepted invalid stage order');
  } catch (error) {
    if (!String(error?.message || error).includes('stage ordering invalid')) throw error;
  }

  validatePipeline([
    'const TPMAP_PHASE34_VERTICAL_EVIDENCE_PIPELINE = true;',
    'const TPMAP_PHASE34_VERTICAL_SOURCES_HANDOFF = true;',
    'const verticalResolution = solveParkVerticalEvidence(reconstructionGraph, { ...options, verticalSources: sources });',
    'validateVerticalResolution(reconstructionGraph);'
  ].join('\n'));

  validatePlanningVectorTest([
    "test('accepted georeferenced vector PDF produces evidence-only path and footprint candidates',()=>{",
    '  const features=[];',
    '  assert.ok(features.length >= 2);',
    '});',
    '// TPMAP_PREPARED_GENERATOR_VECTOR_CANDIDATE_SET_V1'
  ].join('\n'));

  console.log('Alton postmerge read-only compatibility self-test passed');
}

// Dispatch only after every module-scoped validation dependency is initialized.
if (selfTest) selfTestContracts();
else if (!generator) throw new Error('--generator is required');
else await validateInstallation(generator);
