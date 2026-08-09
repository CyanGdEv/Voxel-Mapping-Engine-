import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyPlanningWorldAuthority, planningWorldBoundary } from "../src/lib/planning-world-authority.mjs";
import { fuseAdditionalMapSources } from "../src/lib/source-fusion.mjs";
import { parseArgs } from "../src/lib/args.mjs";
import { normalizeMap } from "../src/lib/osm.mjs";

const projector = { forward: ([x, z]) => [x, z] };
const line = { type: "LineString", coordinates: [[0, 0], [10, 0]] };

function sourceFeature(id, provider, extra = {}) {
  return {
    id, name: id, kind: "path", subtype: "path", tags: {}, geometry: line, localGeometry: line,
    vertical: { heightM: null, elevationM: null, explicit: false },
    source: { provider, ...extra }, verification: { plan: "test", vertical: "unknown" }
  };
}

test("planning-only authority removes every OSM and Overture world feature", () => {
  const planning = sourceFeature("planning:1", "Local planning authority drawing vector", { dataset: "planning-drawing-vector" });
  planning.tags.planning_authoritative = true;
  const independent = sourceFeature("survey:1", "Independent survey");
  const features = [
    sourceFeature("osm:way:1", "OpenStreetMap"),
    sourceFeature("overture:segment:1", "Overture Maps Foundation"),
    planning,
    independent
  ];
  const evidence = applyPlanningWorldAuthority(features, { planningWorldAuthority: "planning-only" });
  assert.deepEqual(features.map((feature) => feature.id), ["planning:1", "survey:1"]);
  assert.equal(evidence.osmFeaturesRemoved, 1);
  assert.equal(evidence.overtureFeaturesRemoved, 1);
  assert.equal(evidence.planningFeaturesRetained, 1);
  assert.equal(evidence.zeroOsmWorldFeatures, true);
});

test("planning-only world authority is an explicit validated CLI policy", () => {
  const { options } = parseArgs(["build", "--planning-world-authority", "planning-only"]);
  assert.equal(options.planningWorldAuthority, "planning-only");
  assert.throws(() => parseArgs(["build", "--planning-world-authority", "osm-fallback"]), /legacy or planning-only/);
});

test("planning-only boundary is derived solely from accepted planning geometry", () => {
  const planning = sourceFeature("planning:2", "Planning Data", { dataset: "planning-drawing-vector" });
  planning.geometry = { type: "LineString", coordinates: [[-1.91, 52.98], [-1.89, 53.01]] };
  planning.localGeometry = { type: "LineString", coordinates: [[10, 20], [40, 70]] };
  const boundary = planningWorldBoundary([planning, sourceFeature("survey:2", "Independent survey")], "Park");
  assert.equal(boundary.source.provider, "Accepted planning data");
  assert.equal(boundary.subtype, "planning-coverage-envelope");
  assert.deepEqual(boundary.localGeometry.coordinates[0][0], [2, 12]);
  assert.deepEqual(boundary.localGeometry.coordinates[0][2], [48, 78]);
});

test("source fusion retains planning attributes and strips the OSM world object", async () => {
  const osm = sourceFeature("osm:way:9", "OpenStreetMap");
  osm.tags = { highway: "footway", surface: "asphalt", name: "OSM path" };
  osm.vertical = { heightM: 7, heightSource: "height", elevationM: 91, explicit: true };
  const planning = {
    type: "Feature", geometry: line, properties: {
      id: "planning-vector:9", name: "Plan path", kind: "path", subtype: "planning-site-path",
      merge_policy: "planning-authority", planning_geometry_role: "approved-layout",
      planning_status: "approved", planning_authoritative: true, planning_allow_gap_fill: true,
      planning_confidence: 0.97, planning_reference: "PLAN-9", planning_vector_role: "site-path-centerline-candidate",
      surface: "resin_bound", source_name: "Local planning authority drawing vector",
      source_url: "https://planning.example/9", source_license: "Private-use planning evidence",
      source_dataset: "planning-drawing-vector"
    }
  };
  const features = [osm];
  const summary = await fuseAdditionalMapSources(features, projector, {
    planningWorldAuthority: "planning-only",
    planningOverrideMode: "authoritative",
    acquiredPublicData: [{ id: "planning-drawing-vector", adapter: "planning-vector-fusion", collection: {
      type: "FeatureCollection", features: [planning], source: {
        name: "Local planning authority drawing vector", url: "https://planning.example/9",
        license: "Private-use planning evidence", dataset: "planning-drawing-vector"
      }
    }}]
  });
  assert.deepEqual(features.map((feature) => feature.id), ["planning-vector:9"]);
  assert.equal(features[0].tags.surface, "resin_bound");
  assert.equal(features[0].tags.highway, undefined);
  assert.equal(features[0].vertical.heightM, null);
  assert.equal(summary.planningAuthority.world.osmFeaturesRemoved, 0);
  assert.equal(summary.planningAuthority.world.zeroOsmWorldFeatures, true);
});

test("normalization rechecks late overrides and hands only planning geometry to the world", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "planning-only-world-"));
  const override = path.join(directory, "late-osm.geojson");
  await writeFile(override, JSON.stringify({ type: "FeatureCollection", features: [{
    type: "Feature", geometry: line, properties: {
      id: "late-osm:1", kind: "path", source_name: "OpenStreetMap", highway: "footway"
    }
  }] }));
  try {
    const planning = {
      type: "Feature", geometry: line, properties: {
        id: "planning-vector:normalize", kind: "path", subtype: "planning-site-path",
        merge_policy: "planning-authority", planning_geometry_role: "approved-layout",
        planning_status: "approved", planning_authoritative: true, planning_allow_gap_fill: true,
        planning_confidence: 0.98, planning_reference: "PLAN-NORMALIZE",
        source_name: "Local planning authority drawing vector", source_url: "https://planning.example/n",
        source_license: "Private-use planning evidence", source_dataset: "planning-drawing-vector"
      }
    };
    const sources = {
      center: { lat: 0, lon: 0 }, parkName: "Planning Park", bbox: [-0.01, -0.01, 0.01, 0.01],
      osm: { data: { elements: [{
        type: "way", id: 7, tags: { highway: "footway", surface: "asphalt" },
        geometry: [{ lon: 0, lat: 0 }, { lon: 10, lat: 0 }]
      }] } },
      supplemental: { collections: [{ id: "planning-drawing-vector", adapter: "planning-vector-fusion", collection: {
        type: "FeatureCollection", features: [planning], source: {
          name: "Local planning authority drawing vector", url: "https://planning.example/n",
          license: "Private-use planning evidence", dataset: "planning-drawing-vector"
        }
      }}] },
      elevation: {}
    };
    const map = await normalizeMap(sources, {
      planningWorldAuthority: "planning-only", planningOverrideMode: "authoritative", override: [override]
    });
    assert.deepEqual(map.features.map((feature) => feature.id), ["planning-vector:normalize"]);
    assert.equal(map.boundary.source.provider, "Accepted planning data");
    assert.equal(map.sourceFusion.planningAuthority.world.postOverride.osmFeaturesRemoved, 1);
    assert.equal(map.sourceFusion.planningAuthority.world.zeroOsmWorldFeatures, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("OSM remains documented only in upstream registration code", async () => {
  const registration = await readFile(new URL("../src/lib/planning-auto-registration.mjs", import.meta.url), "utf8");
  const fusion = await readFile(new URL("../src/lib/source-fusion.mjs", import.meta.url), "utf8");
  assert.match(registration, /osm|OpenStreetMap/i);
  assert.doesNotMatch(fusion, /retainedOsmTags/);
  assert.match(fusion, /applyPlanningWorldAuthority/);
});
