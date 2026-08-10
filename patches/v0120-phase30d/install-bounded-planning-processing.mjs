#!/usr/bin/env node
// TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING_INSTALLER
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const generatorIndex = args.indexOf("--generator");
const generator = generatorIndex >= 0 ? path.resolve(args[generatorIndex + 1]) : null;
const selfTest = args.includes("--self-test");
const validateOnly = args.includes("--validate-only");
const GEOREREFERENCE_ONE_ANCHOR = "async function georeferenceOne({ runtime, options, config, bbox, document, sourceFile, derivedDirectory, explicit }) {";

if (selfTest) runSelfTest();
else if (!generator) throw new Error("--generator is required");
else await install(generator, validateOnly);

async function install(root, validate) {
  const filename = path.join(root, "src/lib/planning-georeference.mjs");
  const source = await readFile(filename, "utf8");
  const transformed = transformGeoreference(source);
  if (!validate && transformed !== source) await writeFile(filename, transformed);
  validateGeoreference(validate ? source : transformed);
  console.log(JSON.stringify({
    status: validate ? "validated" : transformed === source ? "already-installed" : "installed",
    marker: "TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING"
  }));
}

export function transformGeoreference(source) {
  if (source.includes("TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING")) return source;
  if (!source.includes("TPMAP_PHASE30D_RASTER_PLANNING_GEOREFERENCE")) {
    throw new Error("bounded planning processing requires Phase 30D georeference source");
  }
  const behaviorDigest = createHash("sha256").update(source).digest("hex");
  let output = replaceOnce(
    source,
    'import { buildPlanningRegistrationWorkspace } from "./planning-registration-workspace.mjs";',
    'import { buildPlanningRegistrationWorkspace } from "./planning-registration-workspace.mjs";\nimport { cachedJson } from "./io.mjs";',
    "planning georeference result cache import"
  );
  output = replaceOnce(
    output,
    'const TPMAP_PHASE30D_RASTER_PLANNING_GEOREFERENCE = true;',
    'const TPMAP_PHASE30D_RASTER_PLANNING_GEOREFERENCE = true;\n' +
      'const TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING = true;\n' +
      `const TPMAP_PLANNING_GEOREFERENCE_BEHAVIOR_SHA256 = "${behaviorDigest}";`,
    "bounded planning processing marker"
  );

  const newLoop = `  const processingConcurrency = planningProcessingConcurrency(options);
  report.processing = {
    concurrency: processingConcurrency,
    resultCache: "content-addressed-v1",
    cacheHits: 0,
    cacheMisses: 0
  };
  console.error(\`TPMAP planning georeference: queued=\${documents.length} concurrency=\${processingConcurrency}\`);
  const outcomes = await mapConcurrent(documents, processingConcurrency, async (document) => {
    try {
      const sourceFile = await locateCachedDocument(cacheDirectory, document);
      if (!sourceFile) return { document, rejectedReason: "cached-document-not-found" };
      const explicit = findManifestEntry(manifests, document);
      const cached = await cachedPlanningGeoreference({
        runtime, options, config, bbox, document, sourceFile, derivedDirectory, explicit
      });
      return { document, result: cached.result, cacheHit: cached.cacheHit };
    } catch (error) {
      return { document, error };
    }
  });

  for (const outcome of outcomes) {
    const document = outcome.document;
    report.documentsConsidered += 1;
    if (outcome.rejectedReason) {
      pushRejected(report, document, outcome.rejectedReason);
      continue;
    }
    if (outcome.error) {
      report.errors += 1;
      report.documents.push(baseDocumentResult(document, {
        status: "error",
        reason: outcome.error?.message || String(outcome.error)
      }));
      report.warnings.push(\`\${document.applicationReference || document.id}: \${outcome.error?.message || outcome.error}\`);
      if (config.failClosed) throw outcome.error;
      continue;
    }
    if (outcome.cacheHit) report.processing.cacheHits += 1;
    else report.processing.cacheMisses += 1;
    const result = outcome.result;
    report.documents.push(result);
    if (result.status === "accepted") {
      report.accepted += 1;
      if (result.method === "embedded-geospatial") report.methods.embeddedGeospatial += 1;
      if (result.method === "explicit-control-points") report.methods.explicitControlPoints += 1;
      if (result.method === "coordinate-grid") report.methods.coordinateGrid += 1;
      if (result.method === "coordinate-pairs") report.methods.coordinatePairs += 1;
      if (result.method === "automatic-linework-registration") report.methods.automaticLinework += 1;
    } else report.rejected += 1;
  }
  console.error(\`TPMAP planning georeference complete: considered=\${report.documentsConsidered} accepted=\${report.accepted} rejected=\${report.rejected} errors=\${report.errors} cacheHits=\${report.processing.cacheHits} cacheMisses=\${report.processing.cacheMisses}\`);

`;

  output = replaceBetween(
    output,
    "  for (const document of documents) {",
    "  if (config.automaticEnabled) {",
    newLoop,
    "parallel georeference loop"
  );

  const helpers = `function planningProcessingConcurrency(options = {}) {
  const raw = Number(options.planningProcessingConcurrency ?? process.env.TPMAP_PLANNING_PROCESSING_CONCURRENCY ?? 4);
  return Number.isInteger(raw) ? Math.max(1, Math.min(6, raw)) : 4;
}

async function mapConcurrent(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function cachedPlanningGeoreference({ runtime, options, config, bbox, document, sourceFile, derivedDirectory, explicit }) {
  const sourceIdentity = /^[a-f0-9]{64}$/i.test(String(document.sha256 || ""))
    ? String(document.sha256).toLowerCase()
    : (await fileDigest(sourceFile)).sha256;
  const planningOptions = Object.fromEntries(
    Object.entries(options || {})
      .filter(([key]) => /^planning(?:Georeference|Automatic)/.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
  );
  const toolSignature = await planningGeoreferenceToolSignature();
  const key = stableJson({
    namespace: "tpmap-planning-georeference-result-v1",
    behaviorSha256: TPMAP_PLANNING_GEOREFERENCE_BEHAVIOR_SHA256,
    toolSignature,
    sourceSha256: sourceIdentity,
    document: {
      id: document.id || null,
      role: document.role || null,
      state: document.state || null,
      mime: document.mime || null,
      applicationReference: document.applicationReference || null,
      applicationStatus: document.applicationStatus || null,
      applicationLocation: document.applicationLocation || null
    },
    bbox,
    config: {
      maxPages: config.maxPages,
      maxRmseM: config.maxRmseM,
      maxExtentKm2: config.maxExtentKm2,
      dpi: config.dpi,
      automaticEnabled: config.automaticEnabled,
      automaticMinConfidence: config.automaticMinConfidence
    },
    explicit: explicit || null,
    planningOptions
  });
  const cached = await cachedJson({
    cacheDir: path.join(runtime.cacheDir, "supplemental", "planning-georeference-results-v1"),
    key,
    noCache: runtime.noCache === true,
    fetcher: () => georeferenceOne({
      runtime, options, config, bbox, document, sourceFile, derivedDirectory, explicit
    })
  });
  return { result: cached.data, cacheHit: cached.cacheHit };
}

let planningGeoreferenceToolSignaturePromise = null;
async function planningGeoreferenceToolSignature() {
  if (!planningGeoreferenceToolSignaturePromise) {
    planningGeoreferenceToolSignaturePromise = (async () => {
      const signatures = [];
      for (const [command, args] of [
        ["gdalinfo", ["--version"]],
        ["gdal_translate", ["--version"]],
        ["gdalwarp", ["--version"]],
        ["pdftotext", ["-v"]],
        ["pdftoppm", ["-v"]],
        ["python3", ["-c", "import cv2,sys; print(sys.version.split()[0]); print(cv2.__version__)"]]
      ]) signatures.push([command, await planningToolVersion(command, args)]);
      return { platform: process.platform, arch: process.arch, node: process.version, tools: signatures };
    })();
  }
  return planningGeoreferenceToolSignaturePromise;
}

async function planningToolVersion(command, args) {
  try {
    const result = await execFileAsync(command, args, { timeout: 15_000, maxBuffer: 1024 * 1024, encoding: "utf8" });
    return (String(result.stdout || "") + "\\n" + String(result.stderr || "")).trim();
  } catch (error) {
    return "unavailable:" + String(error?.code || error?.message || "unknown");
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return \`[\${value.map((item) => stableJson(item)).join(",")}]\`;
  if (value && typeof value === "object") {
    return \`{\${Object.keys(value).sort().map((key) => \`\${JSON.stringify(key)}:\${stableJson(value[key])}\`).join(",")}\`;
  }
  return JSON.stringify(value);
}

${GEOREREFERENCE_ONE_ANCHOR}`;
  output = replaceOnce(output, GEOREREFERENCE_ONE_ANCHOR, helpers, "planning processing helpers");
  validateGeoreference(output);
  return output;
}

function validateGeoreference(source) {
  const required = [
    "TPMAP_PHASE30D_RASTER_PLANNING_GEOREFERENCE",
    "TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING",
    "TPMAP_PLANNING_GEOREFERENCE_BEHAVIOR_SHA256",
    "planning-georeference-results-v1",
    "mapConcurrent(documents, processingConcurrency",
    "TPMAP_PLANNING_PROCESSING_CONCURRENCY",
    "cachedPlanningGeoreference",
    "planningGeoreferenceToolSignature",
    "toolSignature",
    "cacheHits",
    "cacheMisses"
  ];
  for (const marker of required) {
    if (!source.includes(marker)) throw new Error(`bounded planning processing validation missing: ${marker}`);
  }
  if (source.includes("for (const document of documents) {\n    report.documentsConsidered += 1;\n    try {")) {
    throw new Error("legacy sequential planning georeference loop remains");
  }
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`bounded planning processing start anchor missing: ${label}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`bounded planning processing end anchor missing: ${label}`);
  if (source.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error(`bounded planning processing start anchor is ambiguous: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`bounded planning processing anchor missing: ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`bounded planning processing anchor is ambiguous: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function runSelfTest() {
  const fixture = `import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { buildPlanningRegistrationWorkspace } from "./planning-registration-workspace.mjs";
import { automaticPlanningRegistration, automaticCandidateToManifest, automaticConsensusGroups } from "./planning-auto-registration.mjs";
const execFileAsync = promisify(execFile);
const DEFAULT_DPI = 240;
const TPMAP_PHASE30D_RASTER_PLANNING_GEOREFERENCE = true;
async function test() {
  const documents = [];
  const report = { documentsConsidered: 0, documents: [], warnings: [], errors: 0, accepted: 0, rejected: 0, methods: { embeddedGeospatial: 0, explicitControlPoints: 0, coordinateGrid: 0, coordinatePairs: 0, automaticLinework: 0 } };
  const cacheDirectory = "", manifests = [], runtime = {}, options = {}, config = { failClosed: false }, bbox = {}, derivedDirectory = "";
  for (const document of documents) {
    report.documentsConsidered += 1;
    try {
      const sourceFile = await locateCachedDocument(cacheDirectory, document);
      if (!sourceFile) { pushRejected(report, document, "cached-document-not-found"); continue; }
      const explicit = findManifestEntry(manifests, document);
      const result = await georeferenceOne({ runtime, options, config, bbox, document, sourceFile, derivedDirectory, explicit });
      report.documents.push(result);
      if (result.status === "accepted") report.accepted += 1; else report.rejected += 1;
    } catch (error) {
      report.errors += 1;
      report.documents.push(baseDocumentResult(document, { status: "error", reason: error?.message || String(error) }));
      if (config.failClosed) throw error;
    }
  }
  if (config.automaticEnabled) {}
}
${GEOREREFERENCE_ONE_ANCHOR}
}
async function locateCachedDocument() {}
function pushRejected() {}
function findManifestEntry() {}
function baseDocumentResult() {}
async function fileDigest() { return { sha256: "a".repeat(64) }; }`;
  const transformed = transformGeoreference(fixture);
  validateGeoreference(transformed);
  if (!transformed.includes("const outcomes = await mapConcurrent")) throw new Error("parallel transformation self-test failed");
  console.log("bounded planning processing self-test passed");
}
