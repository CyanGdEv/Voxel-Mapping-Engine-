#!/usr/bin/env node
// TPMAP_PHASE34_VERTICAL_EVIDENCE_INSTALLER
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
  const moduleFile = path.join(root, "src/lib/vertical-evidence-engine.mjs");
  const testFile = path.join(root, "test/vertical-evidence-engine.test.mjs");
  const pipelineFile = path.join(root, "src/lib/pipeline.mjs");
  if (!validate) {
    await writeFile(moduleFile, await readFile(path.join(here, "vertical-evidence-engine.mjs"), "utf8"));
    await writeFile(testFile, await readFile(path.join(here, "vertical-evidence-engine.test.mjs"), "utf8"));
    const pipeline = await readFile(pipelineFile, "utf8");
    await writeFile(pipelineFile, transformPipeline(pipeline));
  }
  const moduleSource = await readFile(moduleFile, "utf8");
  const testSource = await readFile(testFile, "utf8");
  const pipelineSource = await readFile(pipelineFile, "utf8");
  for (const token of ["TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1", "solveParkVerticalEvidence", "validateVerticalResolution"]) {
    if (!moduleSource.includes(token)) throw new Error(`Phase 34 vertical module missing ${token}`);
  }
  if (!testSource.includes("solver never fabricates elevation")) throw new Error("Phase 34 vertical behavior tests are incomplete");
  validatePipeline(pipelineSource);
  console.log(JSON.stringify({ status: validate ? "validated" : "installed", marker: "TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1" }));
}

export function transformPipeline(source) {
  if (source.includes("TPMAP_PHASE34_VERTICAL_EVIDENCE_PIPELINE")) return source;
  let output = replaceOnce(
    source,
    'import { buildParkReconstructionGraph, compactParkReconstructionGraph, reconstructionCompilerMap } from "./park-reconstruction-graph.mjs";',
    'import { buildParkReconstructionGraph, compactParkReconstructionGraph, reconstructionCompilerMap } from "./park-reconstruction-graph.mjs";\n' +
      'import { solveParkVerticalEvidence, validateVerticalResolution } from "./vertical-evidence-engine.mjs";\n' +
      'const TPMAP_PHASE34_VERTICAL_EVIDENCE_PIPELINE = true;',
    "vertical solver import"
  );
  output = replaceOnce(
    output,
    '  map.reconstructionGraph = reconstructionGraph;\n  const reconstructionCompileMap = reconstructionCompilerMap(map);',
    '  map.reconstructionGraph = reconstructionGraph;\n' +
      '  progress("Resolving planning and terrain vertical evidence");\n' +
      '  const verticalResolution = solveParkVerticalEvidence(reconstructionGraph, options);\n' +
      '  validateVerticalResolution(reconstructionGraph);\n' +
      '  const reconstructionCompileMap = reconstructionCompilerMap(map);',
    "vertical solver stage"
  );
  output = replaceOnce(
    output,
    '    reconstructionGraph: reconstructionGraph.summary,\n    accuracy,',
    '    reconstructionGraph: reconstructionGraph.summary,\n' +
      '    verticalResolution,\n' +
      '    accuracy,',
    "vertical evidence summary"
  );
  validatePipeline(output);
  return output;
}

function validatePipeline(source) {
  for (const token of [
    "TPMAP_PHASE34_VERTICAL_EVIDENCE_PIPELINE",
    "solveParkVerticalEvidence(reconstructionGraph, options)",
    "validateVerticalResolution(reconstructionGraph)",
    "verticalResolution,"
  ]) if (!source.includes(token)) throw new Error(`Phase 34 pipeline integration missing ${token}`);
  const graph = source.indexOf('progress("Building unified 3D park reconstruction graph")');
  const vertical = source.indexOf('progress("Resolving planning and terrain vertical evidence")');
  const compile = source.indexOf('progress("Compiling 1 m raster and chunked Bedrock operations")');
  if (!(graph >= 0 && vertical > graph && compile > vertical)) throw new Error("Phase 34 vertical solving must run after graph creation and before compilation");
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Phase 34 anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Phase 34 anchor ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function selfTestTransform() {
  const sample = [
    'import { buildParkReconstructionGraph, compactParkReconstructionGraph, reconstructionCompilerMap } from "./park-reconstruction-graph.mjs";',
    'export async function buildPark() {',
    '  progress("Building unified 3D park reconstruction graph");',
    '  const reconstructionGraph = buildParkReconstructionGraph({ parkName, map, sources, accuracy, options });',
    '  map.reconstructionGraph = reconstructionGraph;',
    '  const reconstructionCompileMap = reconstructionCompilerMap(map);',
    '  progress("Compiling 1 m raster and chunked Bedrock operations");',
    '  const evidence = {',
    '    reconstructionGraph: reconstructionGraph.summary,',
    '    accuracy,',
    '  };',
    '}'
  ].join("\n");
  const first = transformPipeline(sample);
  const second = transformPipeline(first);
  if (first !== second) throw new Error("Phase 34 pipeline transform is not idempotent");
  validatePipeline(first);
  console.log("Phase 34 vertical evidence installer self-test passed");
}
