import test from "node:test";
import assert from "node:assert/strict";
import { solveParkVerticalEvidence, validateVerticalResolution } from "../src/lib/vertical-evidence-engine.mjs";

function node(id, type, x, z, vertical = {}, extra = {}) {
  return {
    id,
    type,
    geometry: { centroid: [x, z], bounds: { minX: x - 1, minZ: z - 1, maxX: x + 1, maxZ: z + 1 } },
    vertical: { groundElevationM: null, baseElevationM: null, explicitElevationM: null, minHeightM: 0, heightM: null, topElevationM: null, evidence: [], ...vertical },
    authority: { geometry: "planning-data", planningAuthoritative: true, osmDerived: false },
    evidence: { planningReference: extra.reference || null, sourceHash: extra.hash || null },
    confidence: { overall: extra.confidence ?? 0.95, vertical: extra.verticalConfidence ?? null }
  };
}

function observation(id, type, x, z, elevation, extra = {}) {
  return {
    id,
    observationType: type,
    geometry: { centroid: [x, z], bounds: { minX: x, minZ: z, maxX: x, maxZ: z } },
    vertical: { explicitElevationM: elevation, baseElevationM: elevation, groundElevationM: null, heightM: null },
    authority: { geometry: "planning-data", planningAuthoritative: true, osmDerived: false },
    evidence: { planningReference: extra.reference || null, sourceHash: extra.hash || null },
    confidence: { overall: extra.confidence ?? 0.98 }
  };
}

function graph(nodes, evidenceNodes) {
  return { marker: "TPMAP_PHASE33_PARK_RECONSTRUCTION_GRAPH_V1", authorityMode: "planning-only", nodes, evidenceNodes, summary: {} };
}

test("building FFL overrides terrain-derived base while preserving ground", () => {
  const building = node("building:1", "building", 10, 10, { groundElevationM: 101.2, baseElevationM: 101.2, heightM: 8 });
  const g = graph([building], [observation("evidence:ffl", "building-level", 11, 10, 103.45, { reference: "APP-1" })]);
  building.evidence.planningReference = "APP-1";
  solveParkVerticalEvidence(g);
  assert.equal(building.vertical.groundElevationM, 101.2);
  assert.equal(building.vertical.baseElevationM, 103.45);
  assert.equal(building.vertical.topElevationM, 111.45);
  assert.equal(building.vertical.verification, "planning-resolved");
  assert.equal(building.verticalResolution.matchedObservation.observationType, "building-level");
  validateVerticalResolution(g);
});

test("ride HP/LP planning evidence resolves track base but not unrelated path", () => {
  const ride = node("ride:1", "ride-track", 20, 20, { groundElevationM: 95.0 });
  const path = node("path:1", "path", 21, 20, { groundElevationM: 95.1 });
  const g = graph([ride, path], [observation("evidence:hp", "ride-elevation", 20.5, 20, 118.45)]);
  solveParkVerticalEvidence(g);
  assert.equal(ride.vertical.baseElevationM, 118.45);
  assert.equal(path.vertical.baseElevationM, 95.1);
  assert.equal(path.verticalResolution.matchedObservation, null);
});

test("terrain spot level resolves ground for nearby ground-associated path", () => {
  const path = node("path:2", "path", 5, 5, {});
  const g = graph([path], [observation("evidence:spot", "terrain-level", 5.5, 5, 88.275)]);
  solveParkVerticalEvidence(g);
  assert.equal(path.vertical.groundElevationM, 88.275);
  assert.equal(path.vertical.baseElevationM, 88.275);
});

test("water level evidence resolves water surface elevation", () => {
  const water = node("water:1", "water", 30, 30, { groundElevationM: 90 });
  const g = graph([water], [observation("evidence:water", "water-level", 30, 31, 92.4)]);
  solveParkVerticalEvidence(g);
  assert.equal(water.vertical.baseElevationM, 92.4);
  assert.equal(water.vertical.groundElevationM, 90);
});

test("explicit planning elevation outranks conflicting terrain base and records conflict", () => {
  const ride = node("ride:2", "ride-track", 0, 0, {
    groundElevationM: 80,
    baseElevationM: 80,
    explicitElevationM: 100,
    evidence: [{ property: "planningElevationM", value: 102, source: "planning-elevation" }]
  });
  const g = graph([ride], []);
  solveParkVerticalEvidence(g);
  assert.equal(ride.vertical.baseElevationM, 102);
  assert.ok(ride.verticalResolution.conflicts.some((item) => item.property === "baseElevationM"));
});

test("planning-only mode rejects OSM-derived evidence", () => {
  const path = node("path:3", "path", 0, 0, {});
  const bad = observation("evidence:osm", "terrain-level", 0, 0, 90);
  bad.authority.osmDerived = true;
  assert.throws(() => solveParkVerticalEvidence(graph([path], [bad])), /OSM-derived vertical input/);
});

test("solver never fabricates elevation when no compatible evidence exists", () => {
  const building = node("building:2", "building", 100, 100, {});
  const g = graph([building], [observation("evidence:far", "building-level", 500, 500, 120)]);
  solveParkVerticalEvidence(g);
  assert.equal(building.vertical.groundElevationM, null);
  assert.equal(building.vertical.baseElevationM, null);
  assert.equal(building.vertical.topElevationM, null);
  assert.equal(building.verticalResolution.status, "unresolved");
});
