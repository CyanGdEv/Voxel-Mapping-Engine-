#!/usr/bin/env node
// TPMAP_PHASE33_RECONSTRUCTION_GRAPH_INSTALLER
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const generatorIndex = args.indexOf("--generator");
const generator = generatorIndex >= 0 ? path.resolve(args[generatorIndex + 1]) : null;
const validateOnly = args.includes("--validate-only");
const selfTest = args.includes("--self-test");

if (selfTest) {
  selfTestTransform();
} else if (!generator) {
  throw new Error("--generator is required");
} else {
  await install(generator, validateOnly);
}

async function install(root, validate) {
  const moduleFile = path.join(root, "src/lib/park-reconstruction-graph.mjs");
  const testFile = path.join(root, "test/park-reconstruction-graph.test.mjs");
  const pipelineFile = path.join(root, "src/lib/pipeline.mjs");

  if (!validate) {
    await writeFile(moduleFile, await readFile(path.join(here, "park-reconstruction-graph.mjs"), "utf8"));
    await writeFile(testFile, await readFile(path.join(here, "park-reconstruction-graph.test.mjs"), "utf8"));
    const pipeline = await readFile(pipelineFile, "utf8");
    await writeFile(pipelineFile, transformPipeline(pipeline));
  }

  const moduleSource = await readFile(moduleFile, "utf8");
  const testSource = await readFile(testFile, "utf8");
  const pipelineSource = await readFile(pipelineFile, "utf8");
  for (const token of ["TPMAP_PHASE33_PARK_RECONSTRUCTION_GRAPH_V1", "buildParkReconstructionGraph", "validateParkReconstructionGraph"]) {
    if (!moduleSource.includes(token)) throw new Error(`Phase 33 reconstruction module missing ${token}`);
  }
  if (!testSource.includes("planning-only graph fails closed")) throw new Error("Phase 33 reconstruction behavior tests are incomplete");
  validatePipeline(pipelineSource);
  console.log(JSON.stringify({ status: validate ? "validated" : "installed", marker: "TPMAP_PHASE33_PARK_RECONSTRUCTION_GRAPH_V1" }));
}

export function transformPipeline(source) {
  if (source.includes("TPMAP_PHASE33_RECONSTRUCTION_GRAPH_PIPELINE")) return source;
  let output = replaceOnce(
    source,
    'import { enforcePlanningCoverage } from "./planning-coverage.mjs";',
    'import { enforcePlanningCoverage } from "./planning-coverage.mjs";\n' +
      'import { buildParkReconstructionGraph, compactParkReconstructionGraph } from "./park-reconstruction-graph.mjs";\n' +
      'const TPMAP_PHASE33_RECONSTRUCTION_GRAPH_PIPELINE = true;',
    "reconstruction graph import"
  );
  output = replaceOnce(
    output,
    '  const accuracy = assessAccuracy(map, sources, options);\n\n  progress("Compiling 1 m raster and chunked Bedrock operations");',
    '  const accuracy = assessAccuracy(map, sources, options);\n\n' +
      '  progress("Building unified 3D park reconstruction graph");\n' +
      '  const reconstructionGraph = buildParkReconstructionGraph({ parkName, map, sources, accuracy, options });\n' +
      '  map.reconstructionGraph = reconstructionGraph;\n\n' +
      '  progress("Compiling 1 m raster and chunked Bedrock operations");',
    "reconstruction graph build stage"
  );
  output = replaceOnce(
    output,
    '    rideProfiles: compactRideEvidence(rideProfiles),\n    accuracy,',
    '    rideProfiles: compactRideEvidence(rideProfiles),\n' +
      '    reconstructionGraph: reconstructionGraph.summary,\n' +
      '    accuracy,',
    "reconstruction graph evidence summary"
  );
  output = replaceOnce(
    output,
    '  const fidelityPath = await writeJson(path.join(outputDir, "fidelity.json"), fidelity);',
    '  const reconstructionGraphPath = await writeJson(\n' +
      '    path.join(outputDir, \"park-reconstruction-graph.json\"), compactParkReconstructionGraph(reconstructionGraph), 0\n' +
      '  );\n' +
      '  const fidelityPath = await writeJson(path.join(outputDir, "fidelity.json"), fidelity);',
    "reconstruction graph artifact"
  );
  output = replaceOnce(
    output,
    '      fidelity: fidelityPath,\n      orthophotoEvidence:',
    '      fidelity: fidelityPath,\n' +
      '      reconstructionGraph: reconstructionGraphPath,\n' +
      '      orthophotoEvidence:',
    "reconstruction graph result path"
  );
  validatePipeline(output);
  return output;
}

function validatePipeline(source) {
  for (const token of [
    "TPMAP_PHASE33_RECONSTRUCTION_GRAPH_PIPELINE",
    "buildParkReconstructionGraph({ parkName, map, sources, accuracy, options })",
    "compactParkReconstructionGraph(reconstructionGraph)",
    "map.reconstructionGraph = reconstructionGraph",
    "park-reconstruction-graph.json",
    "reconstructionGraph: reconstructionGraph.summary",
    "reconstructionGraph: reconstructionGraphPath"
  ]) {
    if (!source.includes(token)) throw new Error(`Phase 33 pipeline integration missing ${token}`);
  }
  const graphBuild = source.indexOf('progress("Building unified 3D park reconstruction graph")');
  const compile = source.indexOf('progress("Compiling 1 m raster and chunked Bedrock operations")');
  if (!(graphBuild >= 0 && compile > graphBuild)) throw new Error("Phase 33 graph must be built before Minecraft raster compilation");
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Phase 33 anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Phase 33 anchor ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function selfTestTransform() {
  const sample = [
    'import { enforcePlanningCoverage } from "./planning-coverage.mjs";',
    'export async function buildPark() {',
    '  const accuracy = assessAccuracy(map, sources, options);',
    '',
    '  progress("Compiling 1 m raster and chunked Bedrock operations");',
    '  const evidencePath = await writeJson(path.join(outputDir, "evidence.json"), {',
    '    rideProfiles: compactRideEvidence(rideProfiles),',
    '    accuracy,',
    '  });',
    '  const fidelityPath = await writeJson(path.join(outputDir, "fidelity.json"), fidelity);',
    '  const result = { paths: {',
    '      fidelity: fidelityPath,',
    '      orthophotoEvidence: orthophotoEvidencePath,',
    '  } };',
    '}'
  ].join("\n");
  const first = transformPipeline(sample);
  const second = transformPipeline(first);
  if (first !== second) throw new Error("Phase 33 pipeline transform is not idempotent");
  validatePipeline(first);
  console.log("Phase 33 reconstruction graph installer self-test passed");
}
