import test from "node:test";
import assert from "node:assert/strict";
import { buildRideExcavationMask, validateRideExcavationMask } from "./ride-excavation-mask.mjs";

function graphFor(samples, intervals = []) {
  return { nodes:[{ id:"ride:a", type:"ride-track", authority:{ planningAuthoritative:true, osmDerived:false }, terrainInteraction:{ samples, excavationIntervals:intervals } }], summary:{} };
}

const baseSample = { measureM:10, x:5.2, y:100, z:8.1, groundY:103, clearanceM:-3, status:"tunnel" };

test("verified tunnel produces bounded excavation cells", () => {
  const graph = graphFor([baseSample], [{ status:"tunnel", startMeasureM:9, endMeasureM:11, excavationRequired:true, minClearanceM:-3, maxClearanceM:-2.5 }]);
  const mask = buildRideExcavationMask(graph, { rideExcavationHalfWidthM:1.5, rideExcavationHeadroomM:2 });
  validateRideExcavationMask(graph);
  assert.ok(mask.cells.length > 0);
  assert.ok(mask.cells.every(c => c.mode === "tunnel" && c.rideId === "ride:a"));
  assert.equal(mask.spans.length, 1);
});

test("verified cutting opens through terrain surface", () => {
  const graph = graphFor([{ ...baseSample, status:"cutting", groundY:101.1, clearanceM:-1.1 }]);
  const mask = buildRideExcavationMask(graph, { rideExcavationHalfWidthM:1 });
  assert.ok(mask.cells.some(c => c.mode === "cutting" && c.y >= 102));
});

test("unresolved ride samples are exact no-op", () => {
  const graph = graphFor([{ measureM:10, x:5, y:null, z:8, groundY:null, clearanceM:null, status:"unresolved" }]);
  const mask = buildRideExcavationMask(graph);
  assert.equal(mask.cells.length, 0);
  assert.equal(mask.spans.length, 0);
});

test("non excavation states never remove terrain", () => {
  const graph = graphFor([
    { measureM:1, x:0, y:105, z:0, groundY:100, clearanceM:5, status:"elevated" },
    { measureM:2, x:1, y:100, z:0, groundY:100, clearanceM:0, status:"near-grade" }
  ]);
  assert.equal(buildRideExcavationMask(graph).cells.length, 0);
});

test("malformed cutting or tunnel sample cannot fabricate cells", () => {
  const graph = graphFor([{ measureM:1, x:0, y:99, z:0, groundY:null, clearanceM:null, status:"tunnel" }]);
  const mask = buildRideExcavationMask(graph);
  assert.equal(mask.cells.length, 0);
  assert.equal(mask.diagnostics.rejectedSamples, 1);
});

test("planning-only excavation rejects OSM ride authority", () => {
  const graph = { nodes:[{ id:"ride:osm", type:"ride-track", authority:{ osmDerived:true }, terrainInteraction:{ samples:[baseSample], excavationIntervals:[] } }], summary:{} };
  assert.throws(() => buildRideExcavationMask(graph), /OSM-derived/);
});

test("tunnel wins deterministic overlap over cutting", () => {
  const graph = graphFor([
    { ...baseSample, status:"cutting", groundY:101, clearanceM:-1 },
    { ...baseSample, status:"tunnel", groundY:103, clearanceM:-3 }
  ]);
  const mask = buildRideExcavationMask(graph);
  const central = mask.cells.find(c => c.x===5 && c.z===8 && c.y===100);
  assert.equal(central?.mode, "tunnel");
});
