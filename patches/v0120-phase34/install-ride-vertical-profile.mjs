#!/usr/bin/env node
// TPMAP_PHASE34_RIDE_VERTICAL_PROFILE_INSTALLER
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
  const profileFile = path.join(root, "src/lib/ride-vertical-profile.mjs");
  const profileTestFile = path.join(root, "test/ride-vertical-profile.test.mjs");
  const verticalFile = path.join(root, "src/lib/vertical-evidence-engine.mjs");
  if (!validate) {
    await writeFile(profileFile, await readFile(path.join(here, "ride-vertical-profile.mjs"), "utf8"));
    await writeFile(profileTestFile, await readFile(path.join(here, "ride-vertical-profile.test.mjs"), "utf8"));
    const vertical = await readFile(verticalFile, "utf8");
    await writeFile(verticalFile, transformVerticalEngine(vertical));
  }
  const profileSource = await readFile(profileFile, "utf8");
  const testSource = await readFile(profileTestFile, "utf8");
  const verticalSource = await readFile(verticalFile, "utf8");
  validateProfileSource(profileSource);
  if (!testSource.includes("does not extrapolate")) throw new Error("Phase 34 ride profile tests are incomplete");
  validateVerticalEngine(verticalSource);
  console.log(JSON.stringify({ status: validate ? "validated" : "installed", marker: "TPMAP_PHASE34_RIDE_VERTICAL_PROFILE_V1" }));
}

export function transformVerticalEngine(source) {
  if (source.includes("TPMAP_PHASE34_RIDE_PROFILE_INTEGRATION")) return source;
  let output = replaceOnce(
    source,
    '// TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1',
    '// TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1\n' +
      'import { solveRideVerticalProfiles, validateRideVerticalProfiles } from "./ride-vertical-profile.mjs";\n' +
      'const TPMAP_PHASE34_RIDE_PROFILE_INTEGRATION = true;',
    "ride profile import"
  );
  output = replaceOnce(
    output,
    '  graph.verticalResolution = diagnostics;\n  graph.summary = { ...(graph.summary || {}), verticalResolution: diagnostics };\n  return diagnostics;',
    '  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);\n' +
      '  validateRideVerticalProfiles(graph);\n' +
      '  diagnostics.rideVerticalProfiles = rideVerticalProfiles;\n' +
      '  graph.verticalResolution = diagnostics;\n' +
      '  graph.summary = { ...(graph.summary || {}), verticalResolution: diagnostics };\n' +
      '  return diagnostics;',
    "ride profile solver stage"
  );
  validateVerticalEngine(output);
  return output;
}

function validateProfileSource(source) {
  for (const token of ["TPMAP_PHASE34_RIDE_VERTICAL_PROFILE_V1", "solveRideVerticalProfiles", "elevationAtRideMeasure"]) {
    if (!source.includes(token)) throw new Error(`Phase 34 ride profile module missing ${token}`);
  }
  const guard = 'if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;';
  if (!source.includes(guard)) throw new Error("Phase 34 ride profile finite helper must preserve null/undefined/blank as unresolved");
}

function validateVerticalEngine(source) {
  for (const token of [
    "TPMAP_PHASE34_RIDE_PROFILE_INTEGRATION",
    "solveRideVerticalProfiles(graph, options)",
    "validateRideVerticalProfiles(graph)",
    "diagnostics.rideVerticalProfiles = rideVerticalProfiles"
  ]) if (!source.includes(token)) throw new Error(`Phase 34 ride profile integration missing ${token}`);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Phase 34 ride profile anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Phase 34 ride profile anchor ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function selfTestTransform() {
  const sample = [
    '// TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1',
    'export function solveParkVerticalEvidence(graph, options = {}) {',
    '  const diagnostics = {};',
    '  graph.verticalResolution = diagnostics;',
    '  graph.summary = { ...(graph.summary || {}), verticalResolution: diagnostics };',
    '  return diagnostics;',
    '}'
  ].join("\n");
  const first = transformVerticalEngine(sample);
  const second = transformVerticalEngine(first);
  if (first !== second) throw new Error("Phase 34 ride profile transform is not idempotent");
  validateVerticalEngine(first);

  const safeProfile = [
    '// TPMAP_PHASE34_RIDE_VERTICAL_PROFILE_V1',
    'export function solveRideVerticalProfiles() {}',
    'export function elevationAtRideMeasure() {}',
    'function finite(value) { if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }'
  ].join("\n");
  validateProfileSource(safeProfile);
  try {
    validateProfileSource(safeProfile.replace('if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null; ', ''));
    throw new Error("Phase 34 ride profile null-safety self-test accepted unsafe finite helper");
  } catch (error) {
    if (!String(error?.message || error).includes("preserve null/undefined/blank")) throw error;
  }
  console.log("Phase 34 ride vertical profile installer self-test passed");
}
