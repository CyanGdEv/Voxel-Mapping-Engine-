#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";

const DRAWING_ROLES = new Set([
  "site-plan",
  "location-plan",
  "block-plan",
  "masterplan",
  "general-arrangement",
  "landscape-plan",
  "access-plan",
  "ride-layout",
  "track-layout",
  "terrain-or-drainage",
  "floor-plan",
  "roof-plan",
  "elevation",
  "section",
  "lighting-plan"
]);

const DRAWING_TEXT = /\b(site|block|location|master|landscape|planting|access|floor|roof|elevation|section|drainage|levels?|topograph(?:y|ical)?|ride|track|layout|general arrangement|ga|drawing|plan)\b/i;
const NON_DRAWING_TEXT = /\b(decision|officer report|committee report|application form|certificate|notice|consultation|representation|correspondence|email|fee|privacy)\b/i;

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) await selfTest();
else await filterManifest(options);

function parseArgs(argv) {
  const result = { directory: "planning-prefetch-output", maxApplications: 500, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--self-test") result.selfTest = true;
    else if (key === "--directory") result.directory = argv[++index];
    else if (key === "--max-applications") result.maxApplications = boundedInt(argv[++index], 1, 500, "max applications");
    else throw new Error(`Unknown option ${key}`);
  }
  return result;
}

async function filterManifest({ directory, maxApplications }) {
  const root = path.resolve(directory);
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const applications = Array.isArray(manifest.applications) ? manifest.applications : [];
  const drawingBearing = applications.filter(applicationHasDrawing);
  const retained = drawingBearing.slice(0, maxApplications);
  const retainedReferences = new Set(retained.map(applicationReference).filter(Boolean));
  const retainedUrls = new Set(retained.flatMap(applicationUrls));
  const originalEntries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const retainedEntries = originalEntries.filter((entry) => entryBelongsToRetainedApplication(entry, retainedReferences, retainedUrls));

  const retainedFiles = new Set(retainedEntries.map((entry) => entry?.file).filter(Boolean));
  const removedFiles = new Set(originalEntries.map((entry) => entry?.file).filter((file) => file && !retainedFiles.has(file)));
  for (const relative of removedFiles) await removeFileInside(root, relative);

  manifest.applications = retained;
  manifest.entries = retainedEntries;
  manifest.liveApplications = retained.filter((application) => !application?.failure).length;
  manifest.documentsDownloaded = retained.reduce((sum, application) => sum + downloadedDocuments(application).length, 0);
  manifest.totalBytes = retainedEntries
    .filter((entry) => entry?.kind === "document")
    .reduce((sum, entry) => sum + finiteNumber(entry?.bytes), 0);
  manifest.status = manifest.liveApplications > 0 && manifest.documentsDownloaded > 0 ? "usable" : "no-live-data";
  manifest.applicationSelection = {
    policy: "drawing-bearing-only",
    maxApplications,
    inputApplications: applications.length,
    drawingBearingApplications: drawingBearing.length,
    retainedApplications: retained.length,
    excludedWithoutDrawings: applications.length - drawingBearing.length,
    truncatedDrawingApplications: Math.max(0, drawingBearing.length - retained.length),
    drawingRoles: [...DRAWING_ROLES]
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({
    status: manifest.status,
    policy: manifest.applicationSelection.policy,
    inputApplications: applications.length,
    drawingBearingApplications: drawingBearing.length,
    retainedApplications: retained.length,
    documentsDownloaded: manifest.documentsDownloaded,
    totalBytes: manifest.totalBytes
  }));
}

function applicationHasDrawing(application) {
  return candidateDocuments(application).some(isDrawingDocument);
}

function candidateDocuments(application) {
  const documents = Array.isArray(application?.documents) ? application.documents : [];
  const downloaded = downloadedDocuments(application);
  return [...documents, ...downloaded];
}

function downloadedDocuments(application) {
  return Array.isArray(application?.downloadedDocuments) ? application.downloadedDocuments : [];
}

function isDrawingDocument(document) {
  if (!document || document.rejected === true) return false;
  const role = String(document.role || "").trim().toLowerCase();
  if (DRAWING_ROLES.has(role)) return true;
  if (["document", "decision-notice", "officer-report", "committee-report"].includes(role)) return false;
  const text = `${document.text || ""} ${document.title || ""} ${document.name || ""} ${document.url || ""}`;
  return DRAWING_TEXT.test(text) && !NON_DRAWING_TEXT.test(text);
}

function entryBelongsToRetainedApplication(entry, references, urls) {
  const reference = String(entry?.applicationReference || "").trim();
  if (reference) return references.has(reference);
  if (entry?.kind === "application-page" || entry?.kind === "document") {
    const url = String(entry?.url || entry?.finalUrl || "");
    return urls.has(url);
  }
  return true;
}

function applicationReference(application) {
  return String(application?.reference || application?.applicationReference || "").trim();
}

function applicationUrls(application) {
  return [application?.url, application?.transportUrl, ...candidateDocuments(application).flatMap((document) => [document?.url, document?.transportUrl])]
    .filter(Boolean)
    .map(String);
}

async function removeFileInside(root, relative) {
  const absolute = path.resolve(root, relative);
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) throw new Error(`refusing to remove file outside planning directory: ${relative}`);
  try { await unlink(absolute); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function boundedInt(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return number;
}

async function selfTest() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tpmap-drawing-app-filter-"));
  try {
    await mkdir(path.join(root, "files"), { recursive: true });
    for (const name of ["seed", "a-page", "a-plan", "b-page", "b-decision", "c-page", "c-plan"]) await writeFile(path.join(root, "files", name), name);
    const manifest = {
      schemaVersion: 1,
      status: "usable",
      liveApplications: 3,
      documentsDownloaded: 3,
      totalBytes: 30,
      applications: [
        { reference: "A", url: "https://example/A", documents: [{ role: "site-plan", text: "Proposed site plan" }], downloadedDocuments: [{ role: "site-plan", url: "https://example/A/plan" }] },
        { reference: "B", url: "https://example/B", documents: [{ role: "decision-notice", text: "Decision notice" }], downloadedDocuments: [{ role: "decision-notice", url: "https://example/B/decision" }] },
        { reference: "C", url: "https://example/C", documents: [{ role: "elevation", text: "Proposed elevations" }], downloadedDocuments: [{ role: "elevation", url: "https://example/C/plan" }] }
      ],
      entries: [
        { kind: "seed-page", file: "files/seed", bytes: 5 },
        { kind: "application-page", applicationReference: "A", file: "files/a-page", bytes: 6 },
        { kind: "document", applicationReference: "A", file: "files/a-plan", bytes: 10 },
        { kind: "application-page", applicationReference: "B", file: "files/b-page", bytes: 6 },
        { kind: "document", applicationReference: "B", file: "files/b-decision", bytes: 10 },
        { kind: "application-page", applicationReference: "C", file: "files/c-page", bytes: 6 },
        { kind: "document", applicationReference: "C", file: "files/c-plan", bytes: 12 }
      ]
    };
    await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
    await filterManifest({ directory: root, maxApplications: 1 });
    const filtered = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
    if (filtered.applications.length !== 1 || filtered.applications[0].reference !== "A") throw new Error("drawing application cap/filter self-test failed");
    if (filtered.applicationSelection.excludedWithoutDrawings !== 1 || filtered.applicationSelection.truncatedDrawingApplications !== 1) throw new Error("drawing selection accounting self-test failed");
    if (filtered.documentsDownloaded !== 1 || filtered.totalBytes !== 10) throw new Error("document accounting self-test failed");
    try { await readFile(path.join(root, "files", "b-decision")); throw new Error("excluded file was not pruned"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    console.log("planning drawing application filter self-test passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
