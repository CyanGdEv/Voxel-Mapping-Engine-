import test from "node:test";
import assert from "node:assert/strict";
import { solveRideVerticalProfiles, validateRideVerticalProfiles, elevationAtRideMeasure } from "../src/lib/ride-vertical-profile.mjs";

function ride(id, coords, extra = {}) {
  const geometry = { type: "LineString", coordinates: coords };
  const node = {
    id,
    type: "ride-track",
    geometry: { centroid: coords[Math.floor(coords.length / 2)], local: geometry },
    authority: { planningAuthoritative: true, osmDerived: false },
    evidence: { planningReference: extra.reference || null, sourceHash: extra.hash || null }
  };
  return node;
}
function obs(id, x, z, elevation, extra = {}) {
  return {
    id,
    observationType: "ride-elevation",
    geometry: { centroid: [x, z] },
    vertical: { explicitElevationM: elevation },
    authority: { planningAuthoritative: true, osmDerived: false },
    evidence: { planningReference: extra.reference || null, sourceHash: extra.hash || null },
    confidence: { overall: extra.confidence ?? 0.98 },
    semantics: { planningRole: extra.role || null }
  };
}
function graph(nodes, evidenceNodes) {
  return { authorityMode: "planning-only", nodes, evidenceNodes, summary: {} };
}

test("multiple HP/LP observations create a continuous evidence-bounded ride profile", () => {
  const r = ride("ride:1", [[0,0],[50,0],[100,0]], { reference: "APP-1" });
  const g = graph([r], [
    obs("hp:1", 0, 1, 100, { reference: "APP-1", role: "HP" }),
    obs("lp:1", 50, -1, 80, { reference: "APP-1", role: "LP" }),
    obs("hp:2", 100, 1, 110, { reference: "APP-1", role: "HP" })
  ]);
  const d = solveRideVerticalProfiles(g);
  assert.equal(d.profilesResolved, 1);
  assert.equal(r.rideVerticalProfile.anchors.length, 3);
  assert.equal(r.rideVerticalProfile.segments.length, 2);
  assert.equal(elevationAtRideMeasure(r.rideVerticalProfile, 25), 90);
  assert.equal(elevationAtRideMeasure(r.rideVerticalProfile, 75), 95);
  validateRideVerticalProfiles(g);
});

test("solver does not extrapolate before first or after last planning anchor", () => {
  const r = ride("ride:2", [[0,0],[100,0]]);
  const g = graph([r], [obs("a", 20, 0, 90), obs("b", 80, 0, 110)]);
  solveRideVerticalProfiles(g);
  assert.equal(r.rideVerticalProfile.status, "partial");
  assert.equal(elevationAtRideMeasure(r.rideVerticalProfile, 10), null);
  assert.equal(elevationAtRideMeasure(r.rideVerticalProfile, 50), 100);
  assert.equal(elevationAtRideMeasure(r.rideVerticalProfile, 90), null);
});

test("large unsupported gaps remain unresolved instead of being bridged", () => {
  const r = ride("ride:3", [[0,0],[500,0]]);
  const g = graph([r], [obs("a", 0, 0, 100), obs("b", 500, 0, 100)]);
  const d = solveRideVerticalProfiles(g, { rideVerticalMaxAnchorGapM: 100 });
  assert.equal(d.unsupportedGaps, 1);
  assert.equal(r.rideVerticalProfile.segments[0].mode, "unsupported-gap");
  assert.equal(elevationAtRideMeasure(r.rideVerticalProfile, 250), null);
});

test("document identity prevents nearby elevation labels crossing between rides", () => {
  const r = ride("ride:4", [[0,0],[100,0]], { hash: "ride-doc" });
  const g = graph([r], [
    obs("wrong-a", 0, 0, 150, { hash: "other-doc" }),
    obs("wrong-b", 100, 0, 160, { hash: "other-doc" }),
    obs("right-a", 0, 1, 90, { hash: "ride-doc" }),
    obs("right-b", 100, 1, 100, { hash: "ride-doc" })
  ]);
  solveRideVerticalProfiles(g);
  assert.deepEqual(r.rideVerticalProfile.anchors.map((a) => a.observationId), ["right-a", "right-b"]);
});

test("planning-only mode rejects OSM-derived ride anchors", () => {
  const r = ride("ride:5", [[0,0],[10,0]]);
  const bad = obs("osm", 0, 0, 90);
  bad.authority.osmDerived = true;
  assert.throws(() => solveRideVerticalProfiles(graph([r], [bad])), /OSM-derived ride elevation/);
});
