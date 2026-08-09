import test from "node:test";
import assert from "node:assert/strict";
import { reconstructRideSupports, validateRideSupportReconstructions } from "../src/lib/ride-support-reconstruction.mjs";

function ride(id, samples, extra = {}) {
  const node = {
    id,
    sourceFeatureId: id,
    type: "ride-track",
    geometry3d: { samples },
    authority: { planningAuthoritative: true, osmDerived: false },
    evidence: { planningReference: extra.reference || null, sourceHash: extra.hash || null },
    confidence: { overall: 0.95 }
  };
  return node;
}

function support(id, x, z, ground, extra = {}) {
  return {
    id,
    sourceFeatureId: id,
    type: "ride-support",
    geometry: { centroid: [x, z] },
    vertical: { groundElevationM: ground, baseElevationM: ground },
    semantics: {},
    authority: { planningAuthoritative: true, osmDerived: Boolean(extra.osmDerived) },
    evidence: { planningReference: extra.reference || null, sourceHash: extra.hash || null },
    confidence: { overall: 0.92 }
  };
}

function graph(nodes) {
  return { authorityMode: "planning-only", nodes, summary: {} };
}

test("support resolves from planning point to nearest resolved 3D track and ground", () => {
  const r = ride("ride:1", [
    { measureM: 0, x: 0, y: 110, z: 0, resolved: true },
    { measureM: 10, x: 10, y: 112, z: 0, resolved: true }
  ], { reference: "APP-1" });
  const s = support("support:1", 9, 2, 100, { reference: "APP-1" });
  const g = graph([r, s]);
  reconstructRideSupports(g);
  assert.equal(s.supportReconstruction.status, "resolved");
  assert.equal(s.supportReconstruction.rideId, "ride:1");
  assert.equal(s.supportReconstruction.footing.y, 100);
  assert.equal(s.supportReconstruction.connection.y, 112);
  assert.equal(s.supportReconstruction.verticalHeightM, 12);
  assert.ok(s.supportReconstruction.length3dM > 12);
  validateRideSupportReconstructions(g);
});

test("support does not use unresolved track samples", () => {
  const r = ride("ride:2", [{ measureM: 5, x: 5, y: null, z: 0, resolved: false }], { reference: "APP-2" });
  const s = support("support:2", 5, 0, 90, { reference: "APP-2" });
  const g = graph([r, s]);
  reconstructRideSupports(g);
  assert.equal(s.supportReconstruction.status, "unresolved");
  assert.equal(s.supportReconstruction.reason, "no-resolved-track-connection");
});

test("support remains unresolved when ground is missing", () => {
  const r = ride("ride:3", [{ measureM: 5, x: 5, y: 105, z: 0, resolved: true }], { reference: "APP-3" });
  const s = support("support:3", 5, 0, null, { reference: "APP-3" });
  const g = graph([r, s]);
  reconstructRideSupports(g);
  assert.equal(s.supportReconstruction.status, "unresolved");
  assert.equal(s.supportReconstruction.reason, "missing-ground-elevation");
});

test("support does not cross planning identity when references disagree", () => {
  const a = ride("ride:a", [{ measureM: 1, x: 0, y: 120, z: 0, resolved: true }], { reference: "APP-A" });
  const b = ride("ride:b", [{ measureM: 1, x: 1, y: 100, z: 0, resolved: true }], { reference: "APP-B" });
  const s = support("support:4", 0, 0, 90, { reference: "APP-B" });
  const g = graph([a, b, s]);
  reconstructRideSupports(g);
  assert.equal(s.supportReconstruction.rideId, "ride:b");
});

test("planning-only mode rejects OSM-derived support", () => {
  const r = ride("ride:5", [{ measureM: 0, x: 0, y: 110, z: 0, resolved: true }]);
  const s = support("support:5", 0, 0, 90, { osmDerived: true });
  assert.throws(() => reconstructRideSupports(graph([r, s])), /OSM-derived support/);
});
