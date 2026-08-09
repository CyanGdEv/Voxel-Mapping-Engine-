#!/usr/bin/env node
// TPMAP_PHASE34_RIDE_EXCAVATION_COMPILER_INSTALLER
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf("--generator");
const generator = i >= 0 ? path.resolve(args[i + 1]) : null;
const validateOnly = args.includes("--validate-only");
const selfTest = args.includes("--self-test");

if (selfTest) selfTestTransform();
else if (!generator) throw new Error("--generator is required");
else await install(generator, validateOnly);

async function install(root, validate) {
  const moduleFile = path.join(root, "src/lib/ride-excavation-compiler.mjs");
  const testFile = path.join(root, "test/ride-excavation-compiler.test.mjs");
  const pipelineFile = path.join(root, "src/lib/pipeline.mjs");
  if (!validate) {
    await writeFile(moduleFile, await readFile(path.join(here, "ride-excavation-compiler.mjs"), "utf8"));
    await writeFile(testFile, await readFile(path.join(here, "ride-excavation-compiler.test.mjs"), "utf8"));
    await writeFile(pipelineFile, transformPipeline(await readFile(pipelineFile, "utf8")));
  }
  const moduleSource = await readFile(moduleFile, "utf8");
  const testSource = await readFile(testFile, "utf8");
  const pipelineSource = await readFile(pipelineFile, "utf8");
  for (const token of ["TPMAP_PHASE34_RIDE_EXCAVATION_COMPILER_V1", "applyRideExcavationToCompilation", "validateRideExcavationCompilation"]) {
    if (!moduleSource.includes(token)) throw new Error(`Phase 34 excavation compiler module missing ${token}`);
  }
  for (const token of ["empty excavation mask is exact compilation no-op", "only authorised cells become native phase-7 air operations", "planning elevation is translated through compiler datum", "unsupported compiler schema fails closed before mutation"]) {
    if (!testSource.includes(token)) throw new Error(`Phase 34 excavation compiler tests missing: ${token}`);
  }
  validatePipeline(pipelineSource);
  console.log(JSON.stringify({ status: validate ? "validated" : "installed", marker: "TPMAP_PHASE34_RIDE_EXCAVATION_COMPILER_V1" }));
}

export function transformPipeline(source) {
  if (source.includes("TPMAP_PHASE34_RIDE_EXCAVATION_COMPILER_PIPELINE")) return source;
  let out = replaceOnce(
    source,
    'import { buildRideExcavationMask, validateRideExcavationMask } from "./ride-excavation-mask.mjs";',
    'import { buildRideExcavationMask, validateRideExcavationMask } from "./ride-excavation-mask.mjs";\n' +
      'import { applyRideExcavationToCompilation, validateRideExcavationCompilation } from "./ride-excavation-compiler.mjs";\n' +
      'const TPMAP_PHASE34_RIDE_EXCAVATION_COMPILER_PIPELINE = true;',
    "excavation compiler import"
  );
  out = replaceOnce(
    out,
    '  const compilation = compileMap({ parkName, map: reconstructionCompileMap, sources, accuracy, options });',
    '  const compilation = compileMap({ parkName, map: reconstructionCompileMap, sources, accuracy, options });\n' +
      '  const rideExcavationCompilation = applyRideExcavationToCompilation(compilation, rideExcavationMask);\n' +
      '  validateRideExcavationCompilation(compilation, rideExcavationCompilation);',
    "native compiler cutover"
  );
  out = replaceOnce(
    out,
    '    rideExcavationMask: rideExcavationMask.diagnostics,\n    accuracy,',
    '    rideExcavationMask: rideExcavationMask.diagnostics,\n' +
      '    rideExcavationCompilation,\n' +
      '    accuracy,',
    "excavation compiler evidence"
  );
  validatePipeline(out);
  return out;
}

function validatePipeline(source) {
  for (const token of [
    "TPMAP_PHASE34_RIDE_EXCAVATION_COMPILER_PIPELINE",
    "applyRideExcavationToCompilation(compilation, rideExcavationMask)",
    "validateRideExcavationCompilation(compilation, rideExcavationCompilation)",
    "rideExcavationCompilation,"
  ]) if (!source.includes(token)) throw new Error(`Phase 34 excavation compiler pipeline missing ${token}`);
  const mask = source.indexOf("buildRideExcavationMask(reconstructionGraph, options)");
  const compile = source.indexOf("const compilation = compileMap({ parkName, map: reconstructionCompileMap, sources, accuracy, options })");
  const apply = source.indexOf("applyRideExcavationToCompilation(compilation, rideExcavationMask)");
  if (!(mask >= 0 && compile > mask && apply > compile)) {
    throw new Error("Phase 34 excavation compiler must apply verified mask after native compileMap");
  }
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Phase 34 excavation compiler anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Phase 34 excavation compiler anchor ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function selfTestTransform() {
  const sample = [
    'import { buildRideExcavationMask, validateRideExcavationMask } from "./ride-excavation-mask.mjs";',
    'async function build(){',
    '  const rideExcavationMask = buildRideExcavationMask(reconstructionGraph, options);',
    '  const compilation = compileMap({ parkName, map: reconstructionCompileMap, sources, accuracy, options });',
    '  const evidence={',
    '    rideExcavationMask: rideExcavationMask.diagnostics,',
    '    accuracy,',
    '  };',
    '}'
  ].join("\n");
  const a = transformPipeline(sample), b = transformPipeline(a);
  if (a !== b) throw new Error("Phase 34 excavation compiler transform not idempotent");
  validatePipeline(a);
  console.log("Phase 34 excavation compiler installer self-test passed");
}
