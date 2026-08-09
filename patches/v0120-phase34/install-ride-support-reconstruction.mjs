#!/usr/bin/env node
// TPMAP_PHASE34_RIDE_SUPPORT_RECONSTRUCTION_INSTALLER
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
  const moduleFile = path.join(root, "src/lib/ride-support-reconstruction.mjs");
  const testFile = path.join(root, "test/ride-support-reconstruction.test.mjs");
  const verticalFile = path.join(root, "src/lib/vertical-evidence-engine.mjs");
  if (!validate) {
    await writeFile(moduleFile, await readFile(path.join(here, "ride-support-reconstruction.mjs"), "utf8"));
    await writeFile(testFile, await readFile(path.join(here, "ride-support-reconstruction.test.mjs"), "utf8"));
    const vertical = await readFile(verticalFile, "utf8");
    await writeFile(verticalFile, transformVerticalEngine(vertical));
  }
  const moduleSource = await readFile(moduleFile, "utf8");
  const testSource = await readFile(testFile, "utf8");
  const verticalSource = await readFile(verticalFile, "utf8");
  for (const token of ["TPMAP_PHASE34_RIDE_SUPPORT_RECONSTRUCTION_V1", "reconstructRideSupports", "validateRideSupportReconstructions"]) {
    if (!moduleSource.includes(token)) throw new Error(`Phase 34 support module missing ${token}`);
  }
  if (!testSource.includes("support remains unresolved when ground is missing")) throw new Error("Phase 34 support tests are incomplete");
  validateVerticalEngine(verticalSource);
  console.log(JSON.stringify({ status: validate ? "validated" : "installed", marker: "TPMAP_PHASE34_RIDE_SUPPORT_RECONSTRUCTION_V1" }));
}

export function transformVerticalEngine(source) {
  if (source.includes("TPMAP_PHASE34_RIDE_SUPPORT_INTEGRATION")) return source;
  let output = replaceOnce(
    source,
    'import { buildRide3dGeometry, validateRide3dGeometry } from "./ride-3d-geometry.mjs";',
    'import { buildRide3dGeometry, validateRide3dGeometry } from "./ride-3d-geometry.mjs";\n' +
      'import { reconstructRideSupports, validateRideSupportReconstructions } from "./ride-support-reconstruction.mjs";\n' +
      'const TPMAP_PHASE34_RIDE_SUPPORT_INTEGRATION = true;',
    "ride support import"
  );
  output = replaceOnce(
    output,
    '  diagnostics.ride3dGeometry = ride3dGeometry;\n  graph.verticalResolution = diagnostics;',
    '  diagnostics.ride3dGeometry = ride3dGeometry;\n' +
      '  const rideSupportReconstruction = reconstructRideSupports(graph, options);\n' +
      '  validateRideSupportReconstructions(graph);\n' +
      '  diagnostics.rideSupportReconstruction = rideSupportReconstruction;\n' +
      '  graph.verticalResolution = diagnostics;',
    "ride support stage"
  );
  validateVerticalEngine(output);
  return output;
}

function validateVerticalEngine(source) {
  for (const token of [
    "TPMAP_PHASE34_RIDE_SUPPORT_INTEGRATION",
    "reconstructRideSupports(graph, options)",
    "validateRideSupportReconstructions(graph)",
    "diagnostics.rideSupportReconstruction = rideSupportReconstruction"
  ]) if (!source.includes(token)) throw new Error(`Phase 34 ride support integration missing ${token}`);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Phase 34 support anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Phase 34 support anchor ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function selfTestTransform() {
  const sample = [
    '// TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1',
    'import { buildRide3dGeometry, validateRide3dGeometry } from "./ride-3d-geometry.mjs";',
    'export function solveParkVerticalEvidence(graph, options = {}) {',
    '  const diagnostics = {};',
    '  const ride3dGeometry = buildRide3dGeometry(graph, options);',
    '  validateRide3dGeometry(graph);',
    '  diagnostics.ride3dGeometry = ride3dGeometry;',
    '  graph.verticalResolution = diagnostics;',
    '  return diagnostics;',
    '}'
  ].join("\n");
  const first = transformVerticalEngine(sample);
  const second = transformVerticalEngine(first);
  if (first !== second) throw new Error("Phase 34 support transform is not idempotent");
  validateVerticalEngine(first);
  console.log("Phase 34 ride support reconstruction installer self-test passed");
}
