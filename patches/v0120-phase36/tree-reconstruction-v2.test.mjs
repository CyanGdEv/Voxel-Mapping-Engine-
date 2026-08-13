import test from "node:test";
import assert from "node:assert/strict";
import { tryCompileTreeReconstructionV2, TREE_RECONSTRUCTION_V2_MARKER } from "./tree-reconstruction-v2.mjs";

function compile(feature, extra = {}) {
  const writes = [];
  const width = 64, height = 64, minX = -16, minZ = -16;
  const elevationY = new Int16Array(width * height).fill(100);
  const mask = new Uint8Array(width * height).fill(1);
  const result = tryCompileTreeReconstructionV2({
    add: (...args) => writes.push(args),
    feature,
    geometry: feature.localGeometry,
    minX, minZ, width, height, elevationY, mask,
    seed: 42,
    ...extra
  });
  return { result, writes };
}

function pointTree(extra = {}) {
  return {
    id: "tree-1",
    kind: "vegetation",
    localGeometry: { type: "Point", coordinates: [8, 8] },
    tags: { natural: "tree", ...extra.tags },
    vegetationReconstruction: {
      marker: "TPMAP_PHASE34_VEGETATION_RECONSTRUCTION_V1",
      status: "resolved",
      classification: "individual-tree",
      groundElevationM: 100,
      heightM: 18,
      crownDiameterM: 9,
      ...extra.reconstruction
    },
    ...extra.feature
  };
}

test("individual tree emits trunk branches and porous crown", () => {
  const { result, writes } = compile(pointTree());
  assert.ok(result);
  assert.equal(result.marker, TREE_RECONSTRUCTION_V2_MARKER);
  assert.equal(result.treeModels, 1);
  assert.ok(result.trunkBlocks >= 8);
  assert.ok(result.branchBlocks >= 4);
  assert.ok(result.leafBlocks > result.branchBlocks);
  assert.ok(result.canopyAirGaps > result.leafBlocks * 0.2);
  assert.ok(result.maxLeafFillRatio < 0.72, `leaf fill ratio ${result.maxLeafFillRatio} is blob-like`);
  assert.ok(writes.some((w) => w[7] === "minecraft:oak_log"));
  assert.ok(writes.some((w) => w[7] === "minecraft:oak_leaves"));
});

test("resolved Phase 34 height and crown control model scale", () => {
  const small = compile(pointTree({ reconstruction: { heightM: 9, crownDiameterM: 4 } })).result;
  const large = compile(pointTree({ reconstruction: { heightM: 24, crownDiameterM: 12 } })).result;
  assert.ok(large.blocks > small.blocks);
  assert.ok(large.trunkBlocks > small.trunkBlocks);
  assert.ok(large.leafBlocks > small.leafBlocks);
});

test("explicit conifer evidence produces a tapered spruce form", () => {
  const { result, writes } = compile(pointTree({ tags: { natural: "tree", leaf_type: "needleleaved", genus: "Picea" } }));
  assert.ok(result);
  assert.ok(result.branchBlocks > 0);
  assert.ok(result.maxLeafFillRatio < 0.72);
  assert.ok(writes.some((w) => w[7] === "minecraft:spruce_log"));
  assert.ok(writes.some((w) => w[7] === "minecraft:spruce_leaves"));
});

test("woodland polygons become separated deterministic trees rather than one leaf mass", () => {
  const feature = {
    id: "wood-1",
    kind: "vegetation",
    localGeometry: { type: "Polygon", coordinates: [[[0,0],[30,0],[30,30],[0,30],[0,0]]] },
    tags: { natural: "wood" },
    vegetationReconstruction: {
      marker: "TPMAP_PHASE34_VEGETATION_RECONSTRUCTION_V1",
      status: "resolved",
      classification: "woodland",
      groundElevationM: 100,
      heightM: 16,
      crownDiameterM: null
    }
  };
  const a = compile(feature).result;
  const b = compile(feature).result;
  assert.ok(a.treeModels > 2);
  assert.ok(a.treeModels <= 96);
  assert.equal(a.treeModels, b.treeModels);
  assert.equal(a.blocks, b.blocks);
  assert.ok(a.maxLeafFillRatio < 0.72);
});

test("tree compiler falls back when no usable vertical evidence exists", () => {
  const feature = pointTree({ reconstruction: { heightM: null, crownDiameterM: null }, feature: { fidelity: {} } });
  const { result, writes } = compile(feature, { elevation: null });
  assert.equal(result, null);
  assert.equal(writes.length, 0);
});

test("planning QA geometry is never converted into a tree", () => {
  const feature = pointTree({ tags: { natural: "tree", planning_qa: true } });
  const { result } = compile(feature);
  assert.equal(result, null);
});
