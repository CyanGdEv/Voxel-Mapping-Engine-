#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const OFFICIAL_HOSTS = new Set(["publicaccess.staffsmoorlands.gov.uk", "www.staffsmoorlands.gov.uk"]);
const DOCUMENT_MIMES = new Set(["application/pdf", "image/png", "image/jpeg", "image/tiff"]);

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

  const usable = results
    .filter((result) => result.valid && result.manifest.status === "usable" && result.manifest.liveApplications > 0 && result.manifest.documentsDownloaded > 0)
    .sort(compareCandidates);
  const report = {
    schemaVersion: 1,
    selectedAt: new Date().toISOString(),
    required: true,
    candidates: results.map((result) => ({
      runner: result.manifest?.runner || path.basename(path.dirname(result.manifestPath)),
      valid: result.valid,
      status: result.manifest?.status || "invalid",
      liveApplications: result.manifest?.liveApplications || 0,
      documentsDownloaded: result.manifest?.documentsDownloaded || 0,
      tlsVerification: result.manifest?.tlsVerification || null,
      score: result.score,
      reason: result.reason || null
    }))
  };

  if (!usable.length) {
    report.status = "no-usable-prefetch";
    await writeFile(path.join(output, "selection-report.json"), JSON.stringify(report, null, 2));
    throw new Error("No cross-platform planning prefetch produced at least one verified live application and one downloaded document");
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
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) || !Array.isArray(manifest.applications)) throw new Error("invalid manifest schema");
  const generatedAt = Date.parse(manifest.generatedAt || "");
  if (!Number.isFinite(generatedAt) || Math.abs(Date.now() - generatedAt) > 24 * 60 * 60 * 1000) throw new Error("stale manifest");

  const liveApplications = strictCount(manifest.liveApplications, "liveApplications");
  const documentsDownloaded = strictCount(manifest.documentsDownloaded, "documentsDownloaded");
  const actualLiveApplications = manifest.applications.filter((application) => application && typeof application === "object" && !application.failure).length;
  if (liveApplications !== actualLiveApplications) throw new Error(`live application count mismatch (${liveApplications} != ${actualLiveApplications})`);

  const urls = new Set();
  let documentEntries = 0;
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== "object") throw new Error("manifest contains an empty entry");
    const url = new URL(entry.url);
    if (url.protocol !== "https:" || !OFFICIAL_HOSTS.has(url.hostname.toLowerCase())) throw new Error(`off-host entry ${entry.url}`);
    if (urls.has(entry.url)) throw new Error(`duplicate URL ${entry.url}`);
    urls.add(entry.url);
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) throw new Error(`invalid byte count ${entry.url}`);
    if (!/^[a-f0-9]{64}$/i.test(entry.sha256 || "")) throw new Error(`invalid hash ${entry.url}`);
    if (entry.kind === "document") {
      documentEntries += 1;
      if (!DOCUMENT_MIMES.has(entry.mime)) throw new Error(`unsupported document MIME ${entry.mime || "missing"}`);
    }
    const filename = safePath(directory, entry.file);
    const data = await readFile(filename);
    if (data.length !== entry.bytes) throw new Error(`byte mismatch ${entry.url}`);
    if (sha256(data) !== entry.sha256) throw new Error(`hash mismatch ${entry.url}`);
  }
  if (documentsDownloaded !== documentEntries) throw new Error(`downloaded document count mismatch (${documentsDownloaded} != ${documentEntries})`);

  const tlsTierValue = tlsTier(manifest.tlsVerification);
  if (tlsTierValue < 1) throw new Error(`unsupported transport verification ${manifest.tlsVerification || "none"}`);
  const platform = platformRank(manifest.runner);
  const score = tlsTierValue * 1_000_000_000 + documentsDownloaded * 100_000 + liveApplications * 100 + platform;
  return { valid: true, manifestPath, directory, manifest: { ...manifest, liveApplications, documentsDownloaded }, score, tlsTierValue, platform };
}

function compareCandidates(a, b) {
  return b.tlsTierValue - a.tlsTierValue
    || b.manifest.documentsDownloaded - a.manifest.documentsDownloaded
    || b.manifest.liveApplications - a.manifest.liveApplications
    || b.platform - a.platform
    || String(a.manifest.runner).localeCompare(String(b.manifest.runner));
}

function tlsTier(value) {
  return value === "verified-browser" ? 4
    : value === "verified-native" ? 3
      : value === "bypassed-allowlisted" ? 2
        : value === "legacy-http-official-host" ? 1
          : 0;
}

function platformRank(runner) {
  const value = String(runner || "").toLowerCase();
  return value.includes("windows") ? 3 : value.includes("macos") ? 2 : 1;
}

function strictCount(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`invalid ${name}`);
  return number;
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
    const page = Buffer.from("<html><body>Alton Towers planning application</body></html>");
    const document = Buffer.from("%PDF-1.4\nplanning drawing\n");
    await writeFile(path.join(candidate, "files/page.html"), page);
    await writeFile(path.join(candidate, "files/document.pdf"), document);
    await writeFile(path.join(candidate, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      status: "usable",
      generatedAt: new Date().toISOString(),
      runner: "windows-schannel",
      tlsVerification: "verified-native",
      liveApplications: 1,
      documentsDownloaded: 1,
      applications: [{ reference: "SMD/2022/0556" }],
      entries: [
        { url: "https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet?PKID=42", file: "files/page.html", kind: "application-page", bytes: page.length, sha256: sha256(page), mime: "text/html" },
        { url: "https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/AttachmentShowServlet?ImageName=9", file: "files/document.pdf", kind: "document", bytes: document.length, sha256: sha256(document), mime: "application/pdf" }
      ]
    }));
    const result = await validateCandidate(path.join(candidate, "manifest.json"));
    if (!result.valid || result.tlsTierValue !== 3 || result.manifest.documentsDownloaded !== 1) throw new Error("selector self-test failed");
    console.log("planning prefetch selector self-test passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 2; });
