#!/usr/bin/env node
// TPMAP_PHASE34_TERRAIN_SURFACE_MODEL_INSTALLER
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const generatorIndex = args.indexOf("--generator");
const generator = generatorIndex >= 0 ? path.resolve(args[generatorIndex + 1]) : null;
const validateOnly = args.includes("--validate-only");
const selfTest = args.includes("--self-test");

if (selfTest) selfTestTransform();
else if (!generator) throw new Error("--generator is required");
else await install(generator, validateOnly);

async function install(root, validate) {
  const moduleFile = path.join(root, "src/lib/terrain-surface-model.mjs");
  const testFile = path.join(root, "test/terrain-surface-model.test.mjs");
  const verticalFile = path.join(root, "src/lib/vertical-evidence-engine.mjs");
  const pipelineFile = path.join(root, "src/lib/pipeline.mjs");
  if (!validate) {
    await writeFile(moduleFile, await readFile(path.join(here, "terrain-surface-model.mjs"), "utf8"));
    await writeFile(testFile, await readFile(path.join(here, "terrain-surface-model.test.mjs"), "utf8"));
    await writeFile(verticalFile, transformVerticalEngine(await readFile(verticalFile, "utf8")));
    await writeFile(pipelineFile, transformPipeline(await readFile(pipelineFile, "utf8")));
  }
  const moduleSource = await readFile(moduleFile, "utf8");
  const testSource = await readFile(testFile, "utf8");
  const verticalSource = await readFile(verticalFile, "utf8");
  const pipelineSource = await readFile(pipelineFile, "utf8");
  for (const token of ["TPMAP_PHASE34_TERRAIN_SURFACE_MODEL_V1", "buildTerrainSurfaceModel", "validateTerrainSurfaceModel"]) {
    if (!moduleSource.includes(token)) throw new Error(`Phase 34 terrain surface module missing ${token}`);
  }
  if (!testSource.includes("generic sampleLocal is ground only")) throw new Error("Phase 34 terrain surface tests are incomplete");
  validateVerticalEngine(verticalSource);
  validatePipeline(pipelineSource);
  console.log(JSON.stringify({ status: validate ? "validated" : "installed", marker: "TPMAP_PHASE34_TERRAIN_SURFACE_MODEL_V1" }));
}

export function transformVerticalEngine(source) {
  if (source.includes("TPMAP_PHASE34_TERRAIN_SURFACE_INTEGRATION")) return source;
  let output = replaceOnce(
    source,
    '// TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1',
    '// TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1\n' +
      'import { buildTerrainSurfaceModel, validateTerrainSurfaceModel } from "./terrain-surface-model.mjs";\n' +
      'const TPMAP_PHASE34_TERRAIN_SURFACE_INTEGRATION = true;',
    "terrain surface import"
  );
  output = replaceOnce(
    output,
    '  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);',
    '  const terrainSurfaceModel = buildTerrainSurfaceModel(graph, options.verticalSources || null, options);\n' +
      '  validateTerrainSurfaceModel(graph);\n' +
      '  diagnostics.terrainSurfaceModel = terrainSurfaceModel;\n' +
      '  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);',
    "terrain surface stage"
  );
  validateVerticalEngine(output);
  return output;
}

export function transformPipeline(source) {
  if (source.includes("TPMAP_PHASE34_VERTICAL_SOURCES_HANDOFF")) return source;
  const before = '  const verticalResolution = solveParkVerticalEvidence(reconstructionGraph, options);';
  const after = '  const TPMAP_PHASE34_VERTICAL_SOURCES_HANDOFF = true;\n' +
    '  const verticalResolution = solveParkVerticalEvidence(reconstructionGraph, { ...options, verticalSources: sources });';
  const output = replaceOnce(source, before, after, "vertical sources handoff");
  validatePipeline(output);
  return output;
}

function validateVerticalEngine(source) {
  for (const token of [
    "TPMAP_PHASE34_TERRAIN_SURFACE_INTEGRATION",
    "buildTerrainSurfaceModel(graph, options.verticalSources || null, options)",
    "validateTerrainSurfaceModel(graph)",
    "diagnostics.terrainSurfaceModel = terrainSurfaceModel"
  ]) if (!source.includes(token)) throw new Error(`Phase 34 terrain surface integration missing ${token}`);
  const terrain = source.indexOf("buildTerrainSurfaceModel(graph, options.verticalSources || null, options)");
  const rideProfile = source.indexOf("solveRideVerticalProfiles(graph, options)");
  if (!(terrain >= 0 && rideProfile > terrain)) throw new Error("Phase 34 terrain surface model must run before ride profile/support reconstruction");
}

function validatePipeline(source) {
  for (const token of ["TPMAP_PHASE34_VERTICAL_SOURCES_HANDOFF", "verticalSources: sources"]) {
    if (!source.includes(token)) throw new Error(`Phase 34 vertical source handoff missing ${token}`);
  }
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Phase 34 terrain surface anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Phase 34 terrain surface anchor ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function selfTestTransform() {
  const vertical = [
    '// TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1',
    'export function solveParkVerticalEvidence(graph, options = {}) {',
    '  const diagnostics = {};',
    '  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);',
    '  return diagnostics;',
    '}'
  ].join("\n");
  const pipeline = '  const verticalResolution = solveParkVerticalEvidence(reconstructionGraph, options);';
  const v1 = transformVerticalEngine(vertical);
  const v2 = transformVerticalEngine(v1);
  if (v1 !== v2) throw new Error("Phase 34 terrain vertical transform is not idempotent");
  const p1 = transformPipeline(pipeline);
  const p2 = transformPipeline(p1);
  if (p1 !== p2) throw new Error("Phase 34 terrain pipeline transform is not idempotent");
  validateVerticalEngine(v1);
  validatePipeline(p1);
  console.log("Phase 34 terrain surface model installer self-test passed");
}
