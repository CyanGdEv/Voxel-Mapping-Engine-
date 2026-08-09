import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyComprehensivePlanningLabel,
  comprehensiveSemanticGeometryRole,
  comprehensivePointRole,
  associateComprehensivePlanningLabel
} from "../src/lib/planning-comprehensive-semantics.mjs";
import { parseSvgDrawing } from "../src/lib/planning-vectorize.mjs";
import { parseTesseractTsv } from "../src/lib/planning-raster-extraction.mjs";

test("temporary construction fencing is excluded while permanent park fences remain eligible", () => {
  const excluded = classifyComprehensivePlanningLabel("Temporary red fencing to secure building site");
  assert.equal(excluded.excludeFromWorld, true);
  assert.equal(excluded.exclusionReason, "temporary-construction-fence");
  assert.equal(comprehensiveSemanticGeometryRole(excluded, false).excluded, true);
  const permanent = classifyComprehensivePlanningLabel("Existing permanent timber fence");
  assert.equal(permanent.featureClass, "fence");
  assert.equal(comprehensiveSemanticGeometryRole(permanent, false).role, "site-fence-candidate");
});

test("ride elevations, support locations and building FFL values become typed point evidence", () => {
  const high = classifyComprehensivePlanningLabel("Ride track HP 118.450");
  assert.equal(high.levelM, 118.45);
  assert.equal(high.pointType, "high-point");
  assert.equal(comprehensivePointRole(high).role, "ride-elevation-point-candidate");
  assert.equal(comprehensivePointRole(classifyComprehensivePlanningLabel("Coaster support footing S12")).role, "site-ride-support-point-candidate");
  const building = classifyComprehensivePlanningLabel("Station building FFL 102.350");
  assert.equal(building.fflM, 102.35);
  assert.equal(comprehensivePointRole(building).role, "site-building-level-point-candidate");
});

test("park surface, landscape, water, rock and terrain classes retain measurements and state", () => {
  const path = classifyComprehensivePlanningLabel("Proposed 3m wide resin bound pedestrian path");
  assert.deepEqual([path.featureClass, path.state, path.material, path.widthM], ["path", "proposed", "resin", 3]);
  assert.equal(classifyComprehensivePlanningLabel("Existing retained tree T12 canopy 8m").featureClass, "tree");
  assert.equal(classifyComprehensivePlanningLabel("Existing stream water level 96.25").featureClass, "water-level");
  assert.equal(classifyComprehensivePlanningLabel("Rock face and boulders").featureClass, "rock-edge");
  assert.equal(classifyComprehensivePlanningLabel("Proposed spot level 105.40").featureClass, "terrain-level");
});

test("SVG circles and ellipses are retained for trees and ride support symbols", () => {
  const parsed = parseSvgDrawing('<svg width="100" height="100"><circle cx="20" cy="20" r="5" stroke="green"/><ellipse cx="60" cy="60" rx="8" ry="4" stroke="black"/></svg>');
  assert.equal(parsed.shapes.length, 2);
  assert.ok(parsed.shapes.every((shape) => shape.closed && shape.curved));
});

test("red linework corroborates but does not independently trigger construction exclusion", () => {
  const shape = { closed: false, stroke: "rgb(220,0,0)", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  const anchors = [
    { text: "Temporary fencing to secure building site", cx: 50, cy: 4, semantic: classifyComprehensivePlanningLabel("Temporary fencing to secure building site") },
    { text: "Proposed path", cx: 50, cy: 3, semantic: classifyComprehensivePlanningLabel("Proposed path") }
  ];
  assert.equal(associateComprehensivePlanningLabel(shape, anchors, 20).anchor.semantic.exclusionReason, "temporary-construction-fence");
  assert.equal(classifyComprehensivePlanningLabel("Red resin path").excludeFromWorld, undefined);
});

test("raster OCR TSV is normalized into the same semantic schema", () => {
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "5\t1\t1\t1\t1\t1\t10\t20\t50\t12\t95\tTemporary",
    "5\t1\t1\t1\t1\t2\t65\t20\t45\t12\t92\tfencing",
    "5\t1\t1\t1\t1\t3\t115\t20\t20\t12\t90\tto",
    "5\t1\t1\t1\t1\t4\t140\t20\t40\t12\t91\tsecure",
    "5\t1\t1\t1\t1\t5\t185\t20\t45\t12\t93\tbuilding",
    "5\t1\t1\t1\t1\t6\t235\t20\t30\t12\t93\tsite"
  ].join("\n");
  const anchors = parseTesseractTsv(tsv);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].semantic.excludeFromWorld, true);
});
