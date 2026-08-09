#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
let generator = null;
let selfTest = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--generator") generator = args[++index];
  else if (args[index] === "--self-test") selfTest = true;
  else throw new Error(`Unknown option ${args[index]}`);
}

export function completePlanningVectorizeContract(source) {
  let output = source;
  output = replaceOnce(
    output,
    "      const extracted = await buildGeoJsonCandidates(runtime, parsed, entry, config);",
    "      const semantic = await extractPlanningSemanticAnchors(runtime, sourceFile, entry.georeference.page || 1, parsed, entry.document);\n" +
      "      const extracted = await buildGeoJsonCandidates(runtime, parsed, entry, config, semantic);",
    "semantic extraction handoff"
  );
  output = replaceOnce(
    output,
    "        withheldFeatures: extracted.withheld + Math.max(0, extracted.features.length - acceptedFeatures.length),\n" +
      "        svgSha256: sha256Text(svg)",
    "        withheldFeatures: extracted.withheld + Math.max(0, extracted.features.length - acceptedFeatures.length),\n" +
      "        semanticAnchors: semantic.anchors.length,\n" +
      "        semanticMatches: extracted.semanticMatches,\n" +
      "        svgSha256: sha256Text(svg)",
    "semantic diagnostics"
  );
  output = replaceOnce(
    output,
    "async function buildGeoJsonCandidates(runtime, parsed, entry, config) {\n" +
      "  const features = [], withheldReasons = {};",
    "async function buildGeoJsonCandidates(runtime, parsed, entry, config, semantic = { anchors: [] }) {\n" +
      "  const features = [], withheldReasons = {};\n" +
      "  let semanticMatches = 0;",
    "semantic candidate input"
  );
  output = replaceOnce(
    output,
    "\\b(footbridge|bridge|boardwalk|raised walkway|raised path|elevated walkway|elevated path|deck)\\b",
    "\\b(footbri(?:dge|dde)|bridge|boardwalk|raised walkway|raised path|elevated walkway|elevated path|deck)\\b",
    "common planning-drawing OCR bridge label"
  );
  validateCompletedContract(output);
  return output;
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Phase 30B completion anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Phase 30B completion anchor is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function validateCompletedContract(source) {
  const required = [
    "const semantic = await extractPlanningSemanticAnchors",
    "buildGeoJsonCandidates(runtime, parsed, entry, config, semantic)",
    "semanticAnchors: semantic.anchors.length",
    "semanticMatches: extracted.semanticMatches",
    "config, semantic = { anchors: [] }",
    "let semanticMatches = 0",
    "return { features, withheld, withheldReasons, semanticMatches }",
    "footbri(?:dge|dde)"
  ];
  for (const token of required) {
    if (!source.includes(token)) throw new Error(`Phase 30B semantic contract still lacks ${token}`);
  }
}

if (selfTest) {
  const incomplete = [
    "async function run(runtime, sourceFile, parsed, entry, config) {",
    "      const extracted = await buildGeoJsonCandidates(runtime, parsed, entry, config);",
    "      const acceptedFeatures = extracted.features;",
    "      const report = {",
    "        withheldFeatures: extracted.withheld + Math.max(0, extracted.features.length - acceptedFeatures.length),",
    "        svgSha256: sha256Text(svg)",
    "      };",
    "}",
    "async function buildGeoJsonCandidates(runtime, parsed, entry, config) {",
    "  const features = [], withheldReasons = {};",
    "  let withheld = 0;",
    "  let semanticMatchesUsed = true;",
    "  return { features, withheld, withheldReasons, semanticMatches };",
    "}",
    "async function extractPlanningSemanticAnchors() { return { anchors: [] }; }",
    "function classifyPlanningSemanticLabel(text) { return /\\b(footbridge|bridge|boardwalk|raised walkway|raised path|elevated walkway|elevated path|deck)\\b/.test(text); }"
  ].join("\n");
  const completed = completePlanningVectorizeContract(incomplete);
  if (completePlanningVectorizeContract(completed) !== completed) throw new Error("Phase 30B completion is not idempotent");
  console.log("Phase 30B semantic contract completion self-test passed");
} else {
  if (!generator) throw new Error("--generator is required");
  const filename = path.join(path.resolve(generator), "src/lib/planning-vectorize.mjs");
  const source = await readFile(filename, "utf8");
  const completed = completePlanningVectorizeContract(source);
  if (completed !== source) await writeFile(filename, completed);
  console.log(JSON.stringify({ status: completed === source ? "already-complete" : "completed", file: filename }));
}
