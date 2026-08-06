#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const OFFICIAL_HOSTS = new Set(["publicaccess.staffsmoorlands.gov.uk", "www.staffsmoorlands.gov.uk"]);

function parseArgs(argv) {
  const options = { input: "planning-prefetch-candidates", output: "planning-prefetch-selected", required: true, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--self-test") options.selfTest = true;
    else if (argv[i] === "--input") options.input = argv[++i];
    else if (argv[i] === "--output") options.output = argv[++i];
    else if (argv[i] === "--required") options.required = argv[++i] !== "false";
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) return selfTest();
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  if (!options.required) {
    await writeFile(path.join(output, "manifest.json"), JSON.stringify({ schemaVersion: 1, status: "disabled", generatedAt: new Date().toISOString(), runner: "none", entries: [] }, null, 2));
    return;
  }
  const manifests = await findManifests(input);
  const results = [];
  for (const manifestPath of manifests) {
    try {
      results.push(await validateCandidate(manifestPath));
    } catch (error) {
      results.push({ manifestPath, valid: false, reason: error.message, score: -1 });
    }
  }
  const usable = results.filter((result) => result.valid && result.manifest.status === "usable" && result.manifest.liveApplications > 0 && result.manifest.documentsDownloaded > 0)
    .sort((a, b) => b.score - a.score);
  const report = {
    schemaVersion: 1,
    selectedAt: new Date().toISOString(),
    required: true,
    candidates: results.map((result) => ({ runner: result.manifest?.runner || path.basename(path.dirname(result.manifestPath)), valid: result.valid, status: result.manifest?.status || "invalid", liveApplications: result.manifest?.liveApplications || 0, documentsDownloaded: result.manifest?.documentsDownloaded || 0, tlsVerification: result.manifest?.tlsVerification || null, score: result.score, reason: result.reason || null }))
  };
  if (!usable.length) {
    report.status = "no-usable-prefetch";
    await writeFile(path.join(output, "selection-report.json"), JSON.stringify(report, null, 2));
    throw new Error("No cross-platform planning prefetch produced at least one live application and one downloaded document");
  }
  const selected = usable[0];
  await cp(selected.directory, output, { recursive: true, force: true });
  const manifest = { ...selected.manifest, selectedAt: report.selectedAt, selectionScore: selected.score, selectionCandidates: report.candidates };
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  report.status = "selected";
  report.runner = manifest.runner;
  report.score = selected.score;
  await writeFile(path.join(output, "selection-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, runner: report.runner, liveApplications: manifest.liveApplications, documentsDownloaded: manifest.documentsDownloaded }));
}

async function validateCandidate(manifestPath) {
  const directory = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) throw new Error("invalid manifest schema");
  const generatedAt = Date.parse(manifest.generatedAt || "");
  if (!Number.isFinite(generatedAt) || Math.abs(Date.now() - generatedAt) > 24 * 60 * 60 * 1000) throw new Error("stale manifest");
  const urls = new Set();
  for (const entry of manifest.entries) {
    const url = new URL(entry.url);
    if (url.protocol !== "https:" || !OFFICIAL_HOSTS.has(url.hostname.toLowerCase())) throw new Error(`off-host entry ${entry.url}`);
    if (urls.has(entry.url)) throw new Error(`duplicate URL ${entry.url}`);
    urls.add(entry.url);
    const filename = safePath(directory, entry.file);
    const data = await readFile(filename);
    if (data.length !== entry.bytes) throw new Error(`byte mismatch ${entry.url}`);
    if (sha256(data) !== entry.sha256) throw new Error(`hash mismatch ${entry.url}`);
  }
  const tlsScore = manifest.tlsVerification === "verified-native" ? 100000 : manifest.tlsVerification === "bypassed-allowlisted" ? 10000 : 0;
  const platformScore = String(manifest.runner).includes("windows") ? 300 : String(manifest.runner).includes("macos") ? 200 : 100;
  const score = tlsScore + Number(manifest.documentsDownloaded || 0) * 100 + Number(manifest.liveApplications || 0) * 10 + platformScore;
  return { valid: true, manifestPath, directory, manifest, score };
}

async function findManifests(root) {
  const found = [];
  async function walk(directory) {
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile() && entry.name === "manifest.json") found.push(filename);
    }
  }
  await walk(root);
  return found;
}

function safePath(directory, relative) {
  if (!relative || path.isAbsolute(relative)) throw new Error("artifact path must be relative");
  const filename = path.resolve(directory, relative);
  const rel = path.relative(directory, filename);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("artifact path escapes candidate directory");
  return filename;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

async function selfTest() {
  const root = path.join(process.cwd(), `.planning-prefetch-selftest-${process.pid}`);
  try {
    const candidate = path.join(root, "planning-prefetch-windows");
    await mkdir(path.join(candidate, "files"), { recursive: true });
    const body = Buffer.from("<html><body>planning application documents</body></html>");
    await writeFile(path.join(candidate, "files/page.html"), body);
    await writeFile(path.join(candidate, "manifest.json"), JSON.stringify({ schemaVersion: 1, status: "usable", generatedAt: new Date().toISOString(), runner: "windows-schannel", tlsVerification: "verified-native", liveApplications: 1, documentsDownloaded: 1, entries: [{ url: "https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet", file: "files/page.html", bytes: body.length, sha256: sha256(body) }] }));
    const result = await validateCandidate(path.join(candidate, "manifest.json"));
    if (!result.valid || result.score < 100000) throw new Error("selector self-test failed");
    console.log("planning prefetch selector self-test passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 2; });
