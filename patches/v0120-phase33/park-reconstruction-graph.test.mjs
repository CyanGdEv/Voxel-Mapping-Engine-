import test from "node:test";
import assert from "node:assert/strict";
import { buildParkReconstructionGraph, validateParkReconstructionGraph } from "../src/lib/park-reconstruction-graph.mjs";

const line = (a, b) => ({ type: "LineString", coordinates: [a, b] });
const polygon = (x1, z1, x2, z2) => ({ type: "Polygon", coordinates: [[[x1,z1],[x2,z1],[x2,z2],[x1,z2],[x1,z1]]] });

function feature(id, kind, geometry, extra = {}) {
  return {
    id,
    name: extra.name || id,
    kind,
    subtype: extra.subtype || kind,
    geometry,
    localGeometry: geometry,
    tags: extra.tags || { planning_reference: "PLAN-1", planning_authoritative: true },
    vertical: extra.vertical || {},
    source: extra.source || { provider: "Local planning authority drawing vector", dataset: "planning-drawing-vector", geometryAuthority: "planning-drawing", attributeAuthority: "planning-drawing" },
    verification: extra.verification || { plan: "planning-source-of-truth", vertical: "unknown" }
  };
}

test("builds typed physical nodes with property-level authority and vertical evidence", () => {
  const map = {
    geojson: { name: "Test Park" },
    sourceFusion: { planningAuthority: { world: { mode: "planning-only", status: "planning-source-of-truth", osmReferenceOnly: true, zeroOsmWorldFeatures: true } } },
    features: [
      feature("planning:building", "building", polygon(0, 0, 10, 8), { vertical: { heightM: 7, heightSource: "ea-lidar-dsm-minus-dtm", heightConfidence: 0.94 } }),
      feature("planning:path", "path", line([-5, 4], [15, 4]), { tags: { planning_reference: "PLAN-1", planning_authoritative: true, surface: "resin" } })
    ]
  };
  const sources = { elevation: { sourceKind: "ea-lidar", sampleLocal: () => 101.25, survey: { newestSurveyDate: "2024-01-01" } } };
  const graph = buildParkReconstructionGraph({ parkName: "Test Park", map, sources, options: { planningWorldAuthority: "planning-only" } });
  assert.equal(graph.nodes.length, 2);
  const building = graph.nodes.find((node) => node.type === "building");
  assert.equal(building.authority.geometry, "planning-drawing");
  assert.equal(building.vertical.groundElevationM, 101.25);
  assert.equal(building.vertical.topElevationM, 108.25);
  const path = graph.nodes.find((node) => node.type === "path");
  assert.equal(path.material.resolved, "resin");
  assert.equal(graph.summary.nodesWithGroundSample, 2);
  assert.ok(graph.relationships.some((relation) => relation.type === "path-connects-building"));
  validateParkReconstructionGraph(graph, { requirePlanningOnlyClean: true });
});

test("ride supports link deterministically to the nearest ride track", () => {
  const map = {
    features: [
      feature("ride:a", "ride_track", line([0, 0], [20, 0]), { vertical: { elevationM: 110 } }),
      feature("ride:b", "ride_track", line([0, 30], [20, 30]), { vertical: { elevationM: 130 } }),
      feature("support:1", "ride_support", { type: "Point", coordinates: [10, 3] }, { vertical: { heightM: 12 } })
    ]
  };
  const graph = buildParkReconstructionGraph({ map, sources: { elevation: { sampleLocal: () => 100 } }, options: { planningWorldAuthority: "planning-only" } });
  const support = graph.relationships.find((relation) => relation.type === "supports-ride");
  assert.equal(support.from, "support:1");
  assert.equal(support.to, "ride:a");
});

test("evidence-only planning boundaries and explicit exclusions never become physical nodes", () => {
  const map = { features: [
    feature("boundary:1", "detail", polygon(0,0,20,20), { tags: { planning_reference: "P", render_in_world: false } }),
    feature("construction:fence", "barrier", line([0,0],[4,0]), { tags: { planning_reference: "P", planning_exclude_from_world: true, planning_exclusion_reason: "temporary-construction-fence" } }),
    feature("permanent:fence", "barrier", line([0,2],[4,2]))
  ] };
  const graph = buildParkReconstructionGraph({ map, options: { planningWorldAuthority: "planning-only" } });
  assert.deepEqual(graph.nodes.map((node) => node.id), ["permanent:fence"]);
  assert.equal(graph.summary.evidenceOnlySkipped, 2);
});

test("planning level/elevation points are retained as evidence nodes rather than physical objects", () => {
  const level = feature("level:1", "detail", { type: "Point", coordinates: [5, 5] }, {
    subtype: "planning-building-level",
    tags: { planning_reference: "P", planning_authoritative: true, planning_feature_class: "building-level", ffl_m: 103.25 },
    vertical: { elevationM: 103.25, elevationSource: "planning-ffl" }
  });
  const graph = buildParkReconstructionGraph({ map: { features: [level] }, options: { planningWorldAuthority: "planning-only" } });
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.evidenceNodes.length, 1);
  assert.equal(graph.evidenceNodes[0].observationType, "building-level");
  assert.equal(graph.summary.evidenceObservationNodes, 1);
});

test("planning-only graph fails closed if an OSM or Overture feature reaches it", () => {
  const osm = feature("osm:way:1", "path", line([0,0],[2,0]), {
    tags: {}, source: { provider: "OpenStreetMap" }
  });
  assert.throws(
    () => buildParkReconstructionGraph({ map: { features: [osm] }, options: { planningWorldAuthority: "planning-only" } }),
    /OSM-derived/
  );
});

test("bridge-water and vertical relations are preserved for later 3D solvers", () => {
  const bridge = feature("bridge:1", "path", line([0, 5], [20, 5]), { tags: { planning_reference: "P", planning_authoritative: true, bridge: "yes" }, vertical: { elevationM: 104 } });
  const water = feature("water:1", "water", polygon(8,0,12,10), { vertical: { elevationM: 100 } });
  const graph = buildParkReconstructionGraph({ map: { features: [bridge, water] }, options: { planningWorldAuthority: "planning-only" } });
  const relation = graph.relationships.find((item) => item.type === "bridge-crosses-water");
  assert.ok(relation);
  assert.equal(relation.vertical.relation, "above");
  assert.equal(relation.vertical.deltaM, 4);
});
