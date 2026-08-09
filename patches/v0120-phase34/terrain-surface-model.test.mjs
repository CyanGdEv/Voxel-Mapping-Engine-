import test from "node:test";
import assert from "node:assert/strict";
import { buildTerrainSurfaceModel, validateTerrainSurfaceModel } from "../src/lib/terrain-surface-model.mjs";

function node(id, type, x, z, vertical = {}, sourceFeature = {}) {
  const n = {
    id,
    type,
    geometry: { centroid: [x, z] },
    vertical: { groundElevationM: null, topElevationM: null, ...vertical },
    authority: { geometry: "planning-data", planningAuthoritative: true, osmDerived: false },
    evidence: { planningReference: "APP-1", sourceHash: "hash-1" }
  };
  Object.defineProperty(n, "sourceFeature", { enumerable: false, value: sourceFeature });
  return n;
}

function graph(nodes) {
  return { marker: "TPMAP_PHASE33_PARK_RECONSTRUCTION_GRAPH_V1", authorityMode: "planning-only", nodes, summary: {} };
}

test("DTM and DSM are sampled independently and height is DSM minus DTM", () => {
  const building = node("building:1", "building", 10, 20);
  const g = graph([building]);
  const sources = { elevation: {
    sampleDtmLocal: () => 101.25,
    sampleDsmLocal: () => 112.75,
    dtmSourceKind: "ea-lidar-dtm",
    dsmSourceKind: "ea-lidar-dsm"
  } };
  buildTerrainSurfaceModel(g, sources);
  assert.equal(building.terrainSurface.dtmElevationM, 101.25);
  assert.equal(building.terrainSurface.dsmElevationM, 112.75);
  assert.equal(building.terrainSurface.aboveGroundHeightM, 11.5);
  assert.equal(building.vertical.groundElevationM, 101.25);
  assert.equal(building.terrainSurface.attachmentSurface, "dtm-base+dsm-top");
  validateTerrainSurfaceModel(g);
});

test("generic sampleLocal is ground only and is never duplicated as DSM", () => {
  const tree = node("tree:1", "vegetation", 0, 0);
  const g = graph([tree]);
  buildTerrainSurfaceModel(g, { elevation: { sampleLocal: () => 88.4, sourceKind: "legacy-terrain" } });
  assert.equal(tree.terrainSurface.dtmElevationM, 88.4);
  assert.equal(tree.terrainSurface.dsmElevationM, null);
  assert.equal(tree.terrainSurface.aboveGroundHeightM, null);
});

test("explicit object top can provide DSM while DTM remains independent", () => {
  const building = node("building:2", "building", 5, 5, { groundElevationM: 90 }, { tags: { roof_elevation_m: 101.2 } });
  const g = graph([building]);
  buildTerrainSurfaceModel(g, null);
  assert.equal(building.terrainSurface.dtmElevationM, 90);
  assert.equal(building.terrainSurface.dsmElevationM, 101.2);
  assert.equal(building.terrainSurface.aboveGroundHeightM, 11.2);
});

test("DSM below DTM is rejected instead of producing negative object height", () => {
  const building = node("building:3", "building", 2, 2);
  const g = graph([building]);
  buildTerrainSurfaceModel(g, { elevation: { sampleDtmLocal: () => 100, sampleDsmLocal: () => 95 } });
  assert.equal(building.terrainSurface.dtmElevationM, 100);
  assert.equal(building.terrainSurface.dsmElevationM, null);
  assert.equal(building.terrainSurface.aboveGroundHeightM, null);
  assert.equal(g.summary.terrainSurfaceModel.invalidSurfacePairs, 1);
});

test("water and elevated rides keep independent object surface semantics", () => {
  const water = node("water:1", "water", 1, 1, { groundElevationM: 80 });
  const ride = node("ride:1", "ride-track", 3, 3, { groundElevationM: 82, topElevationM: 110 });
  const g = graph([water, ride]);
  buildTerrainSurfaceModel(g, null);
  assert.equal(water.terrainSurface.attachmentSurface, "independent-water-surface-over-dtm-bed");
  assert.equal(ride.terrainSurface.attachmentSurface, "independent-elevated-object-over-dtm");
});

test("planning-only mode rejects OSM-derived nodes from surface attachment", () => {
  const bad = node("bad:1", "building", 0, 0);
  bad.authority.osmDerived = true;
  assert.throws(() => buildTerrainSurfaceModel(graph([bad]), null), /OSM-derived node/);
});
