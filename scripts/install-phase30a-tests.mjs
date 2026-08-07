#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const out = { selfTest: false, generator: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--self-test') out.selfTest = true;
    else if (argv[i] === '--generator') out.generator = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return out;
}

function replaceBlock(text, oldBlock, newBlock, label) {
  if (text.includes(newBlock)) return text;
  if (!text.includes(oldBlock)) throw new Error(`Phase 30A test anchor missing: ${label}`);
  return text.replace(oldBlock, newBlock);
}

export function transformPlanningVectorFusionTest(text) {
  let out = text;
  out = replaceBlock(out,
`test("approved-only geometry requires a matching OSM target in gated mode", async () => {
  const prepared = preparePlanningVectorFusion({ planningVectorFusionMode: "gated" }, catalogue());
  const promoted = prepared.collection.features[0];
  assert.equal(promoted.properties.planning_geometry_role, "approved-layout");
  assert.equal(promoted.properties.planning_requires_existing_osm_target, true);
  assert.equal(promoted.properties.planning_allow_gap_fill, false);`,
`test("approved planning geometry is authoritative and may fill gaps in gated mode", async () => {
  const prepared = preparePlanningVectorFusion({ planningVectorFusionMode: "gated" }, catalogue());
  const promoted = prepared.collection.features[0];
  assert.equal(promoted.properties.planning_geometry_role, "approved-layout");
  assert.equal(promoted.properties.planning_requires_existing_osm_target, false);
  assert.equal(promoted.properties.planning_allow_gap_fill, true);
  assert.equal(promoted.properties.planning_authoritative, true);
  assert.equal(promoted.properties.planning_qa, true);
  assert.equal(promoted.properties.planning_qa_block, "minecraft:pink_wool");`, 'approved vector policy');

  out = replaceBlock(out,
`  assert.equal(missing.length, 0);
  assert.equal(missingSummary.planningAuthority.vector.withheld, 1);`,
`  assert.equal(missing.length, 1);
  assert.equal(missing[0].id, "planning-vector:path:1");
  assert.equal(missingSummary.planningAuthority.vector.gapFilled, 1);`, 'approved gap fill expectation');

  out = replaceBlock(out,
`test("planning state keeps approved layouts target-only unless authoritative mode is explicit", () => {
  assert.deepEqual(__test.planningState("approved", "approved", "gated"), {
    allowed: true, role: "approved-layout", status: "approved", implemented: false,
    requiresExistingTarget: true, gapFillAllowed: false
  });
  assert.equal(__test.planningState("approved", "approved", "authoritative").gapFillAllowed, true);
});`,
`test("planning state makes approved layouts authoritative after normal acceptance gates", () => {
  assert.deepEqual(__test.planningState("approved", "approved", "gated"), {
    allowed: true, role: "approved-layout", status: "approved", implemented: false,
    requiresExistingTarget: false, gapFillAllowed: true
  });
  assert.equal(__test.planningState("approved", "approved", "private").gapFillAllowed, true);
  assert.equal(__test.planningState("approved", "approved", "review").gapFillAllowed, false);
});`, 'planningState expectation');
  return out;
}

export function transformPlanningAuthorityTest(text) {
  let out = text;
  out = replaceBlock(out,
`test("equivalent planning geometry corroborates rather than duplicates OSM", async () => {
  const geometry = polygon(-1.9001, 52.9799, -1.8999, 52.9801);
  const existing = [osmFeature("osm:way:3", geometry, "building", "Tower")];
  const summary = await fuseAdditionalMapSources(existing, projector, {
    acquiredPublicData: acquiredPlanning([planningFeature({ geometry, name: "Tower" })])
  });
  assert.equal(existing.length, 1);
  assert.equal(existing[0].id, "osm:way:3");
  assert.equal(existing[0].verification.plan, "planning-corroborated-public-map");
  assert.equal(existing[0].source.planningCorroboration.length, 1);
  assert.equal(summary.planningAuthority.corroborated, 1);
});`,
`test("equivalent accepted planning geometry replaces OSM as the geometry authority", async () => {
  const geometry = polygon(-1.9001, 52.9799, -1.8999, 52.9801);
  const existing = [osmFeature("osm:way:3", geometry, "building", "Tower")];
  const summary = await fuseAdditionalMapSources(existing, projector, {
    acquiredPublicData: acquiredPlanning([planningFeature({ geometry, name: "Tower" })])
  });
  assert.equal(existing.length, 1);
  assert.equal(existing[0].id, "planning:123");
  assert.equal(existing[0].verification.plan, "planning-authority-override");
  assert.equal(existing[0].source.replaces, "osm:way:3");
  assert.equal(summary.planningAuthority.osmOverridden, 1);
});`, 'equivalent OSM authority');

  out = replaceBlock(out,
`test("ambiguous planning geometry cannot delete multiple possible OSM targets", async () => {`,
`test("accepted planning geometry replaces all materially conflicting OSM targets", async () => {`, 'ambiguous test name');
  out = replaceBlock(out,
`  assert.equal(existing.length, 2);
  assert.equal(summary.planningAuthority.osmOverridden, 0);
  assert.equal(summary.planningAuthority.ambiguousWithheld, 1);`,
`  assert.equal(existing.length, 1);
  assert.equal(existing[0].id, "planning:ambiguous");
  assert.match(existing[0].source.replaces, /osm:way:a/);
  assert.match(existing[0].source.replaces, /osm:way:b/);
  assert.equal(summary.planningAuthority.osmOverridden, 1);`, 'multi OSM authority expectations');
  return out;
}

const PINK_QA_TEST = `import test from "node:test";
import assert from "node:assert/strict";
import { compileMap } from "../src/lib/raster.mjs";

function planningFeature(id, kind, geometry, extra = {}) {
  return {
    id, name: id, kind, subtype: \`planning-\${kind}\`,
    tags: { planning_qa: true, planning_authoritative: true, planning_reference: "APP/QA/1", ...(extra.tags || {}) },
    localGeometry: geometry,
    vertical: { heightM: null, elevationM: null, explicit: false, ...(extra.vertical || {}) },
    verification: { plan: "planning-authority-override", vertical: "unknown" },
    source: { provider: "Planning authority", dataset: "planning-drawing-vector" },
    surfaceStyle: { primaryBlock: "minecraft:stone", secondaryBlock: "minecraft:stone", pattern: "solid", appearanceStatus: "source" }
  };
}

test("planning-derived paths, buildings, ride layouts and barriers render pink for provenance QA", () => {
  const map = {
    boundary: { localGeometry: { type: "Polygon", coordinates: [[[0,0],[20,0],[20,20],[0,20],[0,0]]] } },
    features: [
      planningFeature("plan:path", "path", { type: "LineString", coordinates: [[2,2],[18,2]] }, { tags: { highway: "footway", width: "3" } }),
      planningFeature("plan:building", "building", { type: "Polygon", coordinates: [[[4,5],[9,5],[9,10],[4,10],[4,5]]] }),
      planningFeature("plan:ride", "ride_track", { type: "LineString", coordinates: [[2,14],[18,14]] }),
      planningFeature("plan:wall", "barrier", { type: "LineString", coordinates: [[2,18],[18,18]] }, { tags: { barrier: "wall" } })
    ],
    topology: {}, semantics: {}, fidelity: null, orthophoto: null, pathTopology: null, pathGeometry: null,
    rideProfiles: null, terrainDetails: null
  };
  const sources = { center: { lat: 0, lon: 0 }, elevation: { provider: "synthetic", minM: 0, points: [], sampleLocal: () => 0 } };
  const compilation = compileMap({ parkName: "Planning QA", map, sources,
    accuracy: { score: 1, grade: "A", exact3d: false },
    options: { maxCells: 10_000, buildings: "markers", noRideInfoSigns: true, accuracyMode: "verified" } });
  const pink = compilation.palette.indexOf("minecraft:pink_wool");
  assert.ok(pink >= 0, "pink wool must be registered");
  const pinkOperations = compilation.chunks.flatMap((chunk) => chunk.o).filter((operation) => operation[7] === pink);
  assert.ok(pinkOperations.length >= 4, \`expected multiple planning QA operations, got \${pinkOperations.length}\`);
  assert.equal(compilation.palette.includes("minecraft:orange_concrete"), false, "planning ride layout must not use normal orange QA track");
  assert.equal(compilation.palette.includes("minecraft:yellow_concrete"), false, "planning building markers must not use normal yellow markers");
});
`;

async function install(generator) {
  const root = path.resolve(generator);
  const vectorFile = path.join(root, 'test/planning-vector-fusion.test.mjs');
  const authorityFile = path.join(root, 'test/planning-authority.test.mjs');
  const pinkFile = path.join(root, 'test/planning-pink-qa.test.mjs');
  const vector = transformPlanningVectorFusionTest(await readFile(vectorFile, 'utf8'));
  const authority = transformPlanningAuthorityTest(await readFile(authorityFile, 'utf8'));
  await writeFile(vectorFile, vector, 'utf8');
  await writeFile(authorityFile, authority, 'utf8');
  await writeFile(pinkFile, PINK_QA_TEST, 'utf8');
  console.log(JSON.stringify({ status: 'installed', tests: [path.basename(authorityFile), path.basename(vectorFile), path.basename(pinkFile)] }));
}

async function selfTest() {
  const vectorFixture = `test("approved-only geometry requires a matching OSM target in gated mode", async () => {\n  const prepared = preparePlanningVectorFusion({ planningVectorFusionMode: "gated" }, catalogue());\n  const promoted = prepared.collection.features[0];\n  assert.equal(promoted.properties.planning_geometry_role, "approved-layout");\n  assert.equal(promoted.properties.planning_requires_existing_osm_target, true);\n  assert.equal(promoted.properties.planning_allow_gap_fill, false);\n  assert.equal(missing.length, 0);\n  assert.equal(missingSummary.planningAuthority.vector.withheld, 1);\n});\ntest("planning state keeps approved layouts target-only unless authoritative mode is explicit", () => {\n  assert.deepEqual(__test.planningState("approved", "approved", "gated"), {\n    allowed: true, role: "approved-layout", status: "approved", implemented: false,\n    requiresExistingTarget: true, gapFillAllowed: false\n  });\n  assert.equal(__test.planningState("approved", "approved", "authoritative").gapFillAllowed, true);\n});`;
  const transformed = transformPlanningVectorFusionTest(vectorFixture);
  if (!transformed.includes('planning_authoritative, true') && !transformed.includes('planning_authoritative, true')) {
    if (!transformed.includes('planning_authoritative, true') && !transformed.includes('planning_authoritative')) throw new Error('vector test transform self-test failed');
  }
  if (!transformed.includes('requiresExistingTarget: false')) throw new Error('vector test authority expectation self-test failed');
  console.log('Phase 30A runtime test alignment self-test passed');
}

const options = parseArgs(process.argv);
try {
  if (options.selfTest) await selfTest();
  else {
    if (!options.generator) throw new Error('Usage: install-phase30a-tests.mjs --generator <generator-root>');
    await install(options.generator);
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
