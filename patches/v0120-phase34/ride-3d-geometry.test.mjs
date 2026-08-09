import test from "node:test";
import assert from "node:assert/strict";
import { buildRide3dGeometry, validateRide3dGeometry } from "../src/lib/ride-3d-geometry.mjs";

function ride(profile) {
  const local = { type: "LineString", coordinates: [[0,0],[10,0],[20,0]] };
  const geometry = { local, centroid: [10,0], bounds: { minX:0,minZ:0,maxX:20,maxZ:0 } };
  return { id:"ride:1", type:"ride-track", geometry, rideVerticalProfile: profile };
}

function graph(node) { return { nodes:[node], summary:{} }; }

function profile(segments) {
  return { marker:"TPMAP_PHASE34_RIDE_VERTICAL_PROFILE_V1", rideId:"ride:1", status:"partial", segments, anchors:[] };
}

test("builds 3D samples and pitch only where vertical profile is supported", () => {
  const r = ride(profile([
    { startMeasureM:0,endMeasureM:10,startElevationM:100,endElevationM:110,mode:"linear-planning-interpolation" },
    { startMeasureM:10,endMeasureM:20,startElevationM:110,endElevationM:105,mode:"linear-planning-interpolation" }
  ]));
  const g = graph(r);
  buildRide3dGeometry(g, { ride3dSampleStepM: 5 });
  assert.deepEqual(r.geometry3d.samples.map(s => s.y), [100,105,110,107.5,105]);
  assert.ok(r.geometry3d.segments.every(s => s.mode === "resolved-3d"));
  assert.ok(r.geometry3d.segments.some(s => s.pitchDeg > 0));
  assert.ok(r.geometry3d.segments.some(s => s.pitchDeg < 0));
  validateRide3dGeometry(g);
});

test("does not fabricate Y through an unsupported planning gap", () => {
  const r = ride(profile([
    { startMeasureM:0,endMeasureM:5,startElevationM:100,endElevationM:105,mode:"linear-planning-interpolation" },
    { startMeasureM:5,endMeasureM:15,mode:"unsupported-gap" },
    { startMeasureM:15,endMeasureM:20,startElevationM:95,endElevationM:100,mode:"linear-planning-interpolation" }
  ]));
  const g = graph(r);
  buildRide3dGeometry(g, { ride3dSampleStepM: 5 });
  assert.deepEqual(r.geometry3d.samples.map(s => s.y), [100,105,null,95,100]);
  assert.equal(r.geometry3d.status, "partial");
  assert.ok(r.geometry3d.segments.some(s => s.mode === "unresolved-vertical-gap"));
  validateRide3dGeometry(g);
});

test("does not extrapolate before first or after last supported profile span", () => {
  const r = ride(profile([
    { startMeasureM:5,endMeasureM:15,startElevationM:100,endElevationM:110,mode:"linear-planning-interpolation" }
  ]));
  const g = graph(r);
  buildRide3dGeometry(g, { ride3dSampleStepM: 5 });
  assert.deepEqual(r.geometry3d.samples.map(s => s.y), [null,100,105,110,null]);
});

test("resolved 3D segments expose true 3D length", () => {
  const r = ride(profile([{ startMeasureM:0,endMeasureM:20,startElevationM:100,endElevationM:120,mode:"linear-planning-interpolation" }]));
  const g = graph(r);
  buildRide3dGeometry(g, { ride3dSampleStepM: 10 });
  assert.ok(r.geometry3d.segments[0].length3dM > 10);
  assert.equal(r.geometry3d.segments[0].pitchDeg, 45);
});
