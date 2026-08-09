import test from "node:test";
import assert from "node:assert/strict";
import { applyRideExcavationToCompilation, validateRideExcavationCompilation } from "./ride-excavation-compiler.mjs";

function compilation() {
  return {
    meta: { elevationDatumM: 100.4, bounds: { minX: -32, minZ: -32, maxX: 32, maxZ: 32 } },
    palette: ["minecraft:grass_block", "minecraft:red_concrete"],
    chunks: [{ x: 0, z: 0, o: [[1,0,0,0,15,0,15,0],[9,2,10,2,2,10,2,1]] }],
    signs: [],
    stats: { rawOperations: 2, operations: 2, estimatedBlocks: 257, chunks: 1, phaseCounts: { 1: 1, 9: 1 } }
  };
}
function mask(cells) { return { marker: "TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1", cells }; }

function phaseAirCells(comp) {
  const air = comp.palette.indexOf("minecraft:air");
  const cells = new Set();
  for (const chunk of comp.chunks) for (const op of chunk.o) {
    if (op[0] !== 7 || op[7] !== air) continue;
    for (let z=op[3]; z<=op[6]; z++) for (let y=op[2]; y<=op[5]; y++) for (let x=op[1]; x<=op[4]; x++) cells.add(`${x}:${y}:${z}`);
  }
  return cells;
}

test("empty excavation mask is exact compilation no-op", () => {
  const comp = compilation();
  const before = JSON.stringify(comp);
  const refPalette = comp.palette, refChunks = comp.chunks;
  const diagnostics = applyRideExcavationToCompilation(comp, mask([]));
  assert.equal(diagnostics.status, "no-op");
  assert.equal(JSON.stringify(comp), before);
  assert.equal(comp.palette, refPalette);
  assert.equal(comp.chunks, refChunks);
  validateRideExcavationCompilation(comp, diagnostics);
});

test("only authorised cells become native phase-7 air operations", () => {
  const comp = compilation();
  const cells = [
    { x:1,y:103,z:4,mode:"cutting" },
    { x:2,y:103,z:4,mode:"cutting" },
    { x:3,y:103,z:4,mode:"tunnel" },
    { x:18,y:99,z:-2,mode:"tunnel" }
  ];
  const diagnostics = applyRideExcavationToCompilation(comp, mask(cells));
  assert.equal(diagnostics.authorisedCells, 4);
  assert.equal(diagnostics.emittedOperations, 2);
  assert.equal(diagnostics.touchedChunks, 2);
  const actual = phaseAirCells(comp);
  const expected = new Set(cells.map((c)=>`${c.x}:${Math.round(c.y-100.4)}:${c.z}`));
  assert.deepEqual(actual, expected);
  assert.equal(comp.stats.rideExcavationCells, 4);
  assert.equal(comp.stats.estimatedBlocks, 261);
  validateRideExcavationCompilation(comp, diagnostics);
});

test("planning elevation is translated through compiler datum", () => {
  const comp = compilation();
  applyRideExcavationToCompilation(comp, mask([{ x:5,y:150,z:5,mode:"tunnel" }]));
  assert.deepEqual([...phaseAirCells(comp)], ["5:50:5"]);
});

test("track remains later than excavation", () => {
  const comp = compilation();
  applyRideExcavationToCompilation(comp, mask([{ x:2,y:110,z:2,mode:"tunnel" }]));
  const phases = comp.chunks.find((c)=>c.x===0&&c.z===0).o.map((op)=>op[0]);
  assert.deepEqual(phases, [1,7,9]);
});

test("unsupported compiler schema fails closed before mutation", () => {
  const bad = { meta:{ elevationDatumM:0, bounds:{minX:0,minZ:0,maxX:1,maxZ:1} }, palette:[], chunks:[{x:0,z:0,o:[[7,0,0]]}] };
  const before = JSON.stringify(bad);
  assert.throws(()=>applyRideExcavationToCompilation(bad, mask([{x:0,y:0,z:0,mode:"tunnel"}])), /malformed native operation/);
  assert.equal(JSON.stringify(bad), before);
});

test("invalid or duplicate mask cells fail closed", () => {
  const a = compilation();
  assert.throws(()=>applyRideExcavationToCompilation(a, mask([{x:0,y:0,z:0,mode:"surface"}])), /rejected mode/);
  const b = compilation();
  assert.throws(()=>applyRideExcavationToCompilation(b, mask([{x:0,y:0,z:0,mode:"tunnel"},{x:0,y:0,z:0,mode:"tunnel"}])), /duplicate mask voxel/);
});
