#!/usr/bin/env node
// TPMAP_PHASE30D_NATIVE_PDF_DERIVATIVE_CACHE_INSTALLER
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { planningProcessedDerivativeFingerprint } from "./planning-processed-derivative-cache.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const generatorIndex = args.indexOf("--generator");
const generator = generatorIndex >= 0 ? path.resolve(args[generatorIndex + 1]) : null;
const selfTest = args.includes("--self-test");
const validateOnly = args.includes("--validate-only");

if (selfTest) {
  runSelfTest();
} else if (!generator) {
  throw new Error("--generator is required");
} else {
  await install(generator, validateOnly);
}

async function install(root, validate) {
  const vectorFile = path.join(root, "src/lib/planning-vectorize.mjs");
  const cacheFile = path.join(root, "src/lib/planning-processed-derivative-cache.mjs");
  if (!validate) {
    await writeFile(cacheFile, await readFile(path.join(here, "planning-processed-derivative-cache.mjs"), "utf8"));
    const source = await readFile(vectorFile, "utf8");
    await writeFile(vectorFile, transformVectorize(source));
  }
  validateInstallation(await readFile(vectorFile, "utf8"), await readFile(cacheFile, "utf8"));
  console.log(JSON.stringify({ status: validate ? "validated" : "installed", marker: "TPMAP_PHASE30D_NATIVE_PDF_DERIVATIVE_CACHE" }));
}

export function transformVectorize(source) {
  if (source.includes("TPMAP_PHASE30D_NATIVE_PDF_DERIVATIVE_CACHE")) return source;
  let output = replaceOnce(
    source,
    'import { extractRasterPlanningPage } from "./planning-raster-extraction.mjs";',
    'import { extractRasterPlanningPage } from "./planning-raster-extraction.mjs";\n' +
      'import { cachedPlanningDerivative } from "./planning-processed-derivative-cache.mjs";\n' +
      'const TPMAP_PHASE30D_NATIVE_PDF_DERIVATIVE_CACHE = true;',
    "native planning derivative cache import"
  );

  const before =
    '      if (entry.document.mime === "application/pdf") {\n' +
    '        svg = await renderPdfPageAsSvg(runtime, sourceFile, entry.georeference.page || 1, workDirectory, entry.document);\n' +
    '        parsed = parseSvgDrawing(svg, { curveTolerance: config.curveTolerance });\n' +
    '        semantic = await extractPlanningSemanticAnchors(runtime, sourceFile, entry.georeference.page || 1, parsed, entry.document);\n' +
    '      }';
  const after =
    '      if (entry.document.mime === "application/pdf") {\n' +
    '        const computeNativeDerivative = async () => {\n' +
    '          const nativeSvg = await renderPdfPageAsSvg(runtime, sourceFile, entry.georeference.page || 1, workDirectory, entry.document);\n' +
    '          const nativeParsed = parseSvgDrawing(nativeSvg, { curveTolerance: config.curveTolerance });\n' +
    '          const nativeSemantic = await extractPlanningSemanticAnchors(runtime, sourceFile, entry.georeference.page || 1, nativeParsed, entry.document);\n' +
    '          return { svg: nativeSvg, semantic: nativeSemantic };\n' +
    '        };\n' +
    '        // Runtime providers are injected, non-source-derived inputs used by deterministic\n' +
    '        // tests and bounded probes. Their closure/output is not represented by the\n' +
    '        // persistent derivative key, so reading or writing that cache would let one\n' +
    '        // provider invocation poison another document with the same synthetic bytes.\n' +
    '        const hasInjectedPlanningProviders =\n' +
    '          typeof runtime.planningVectorSvgProvider === "function" ||\n' +
    '          typeof runtime.planningVectorTextProvider === "function";\n' +
    '        const nativeDerivative = hasInjectedPlanningProviders\n' +
    '          ? await computeNativeDerivative()\n' +
    '          : await cachedPlanningDerivative({\n' +
    '              filename: sourceFile,\n' +
    '              page: entry.georeference.page || 1,\n' +
    '              document: entry.document,\n' +
    '              kind: "native-pdf-svg-positioned-text-v1",\n' +
    '              behaviorFiles: [\n' +
    '                new URL("./planning-vectorize.mjs", import.meta.url),\n' +
    '                new URL("./planning-comprehensive-semantics.mjs", import.meta.url)\n' +
    '              ],\n' +
    '              toolCommands: [\n' +
    '                ["pdftocairo", ["-v"]],\n' +
    '                ["pdftotext", ["-v"]]\n' +
    '              ],\n' +
    '              compute: computeNativeDerivative\n' +
    '            });\n' +
    '        svg = nativeDerivative.svg;\n' +
    '        parsed = parseSvgDrawing(svg, { curveTolerance: config.curveTolerance });\n' +
    '        semantic = nativeDerivative.semantic;\n' +
    '      }';
  output = replaceOnce(output, before, after, "native PDF SVG/text extraction");
  validateVectorize(output);
  return output;
}

function validateVectorize(source) {
  for (const token of [
    "TPMAP_PHASE30D_NATIVE_PDF_DERIVATIVE_CACHE",
    "cachedPlanningDerivative",
    "native-pdf-svg-positioned-text-v1",
    'new URL("./planning-vectorize.mjs", import.meta.url)',
    '["pdftocairo", ["-v"]]',
    '["pdftotext", ["-v"]]',
    "hasInjectedPlanningProviders",
    "runtime.planningVectorSvgProvider",
    "runtime.planningVectorTextProvider",
    "computeNativeDerivative"
  ]) if (!source.includes(token)) throw new Error(`Phase 30D native PDF cache integration lacks ${token}`);
}

function validateInstallation(vectorSource, cacheSource) {
  validateVectorize(vectorSource);
  for (const token of [
    "TPMAP_PHASE30D_PROCESSED_PLANNING_DERIVATIVE_CACHE",
    "cachedPlanningDerivative",
    "planningProcessedDerivativeFingerprint",
    "sourceSha256",
    "behaviorDigest",
    "resultSha256"
  ]) if (!cacheSource.includes(token)) throw new Error(`Phase 30D processed derivative cache lacks ${token}`);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Phase 30D native PDF cache anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Phase 30D native PDF cache anchor ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function runSelfTest() {
  const sourceSha256 = "1".repeat(64);
  const behaviorDigest = "2".repeat(64);
  const key = planningProcessedDerivativeFingerprint({
    sourceSha256,
    behaviorDigest,
    page: 1,
    mime: "application/pdf",
    kind: "native-pdf-svg-positioned-text-v1"
  });
  if (key === planningProcessedDerivativeFingerprint({
    sourceSha256,
    behaviorDigest: "3".repeat(64),
    page: 1,
    mime: "application/pdf",
    kind: "native-pdf-svg-positioned-text-v1"
  })) throw new Error("behavior changes did not invalidate the native PDF derivative key");

  const sample = [
    'import { promisify } from "node:util";',
    'import { extractRasterPlanningPage } from "./planning-raster-extraction.mjs";',
    'const TPMAP_PHASE30D_COMPREHENSIVE_VECTOR_PIPELINE = true;',
    'async function demo(entry, runtime, sourceFile, workDirectory, config) {',
    '      let svg = "";',
    '      let parsed = {};',
    '      let semantic = {};',
    '      if (entry.document.mime === "application/pdf") {',
    '        svg = await renderPdfPageAsSvg(runtime, sourceFile, entry.georeference.page || 1, workDirectory, entry.document);',
    '        parsed = parseSvgDrawing(svg, { curveTolerance: config.curveTolerance });',
    '        semantic = await extractPlanningSemanticAnchors(runtime, sourceFile, entry.georeference.page || 1, parsed, entry.document);',
    '      }',
    '}'
  ].join("\n");
  const transformed = transformVectorize(sample);
  validateVectorize(transformed);
  if (!transformed.includes('typeof runtime.planningVectorTextProvider === "function"')) {
    throw new Error("native PDF derivative cache does not bypass injected positioned-text providers");
  }
  if (!transformed.includes("? await computeNativeDerivative()")) {
    throw new Error("native PDF derivative cache does not execute injected providers live");
  }
  if (transformVectorize(transformed) !== transformed) throw new Error("native PDF derivative cache transform is not idempotent");
  console.log("Phase 30D native PDF derivative cache self-test passed");
}
