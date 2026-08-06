#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";

const HOSTS = new Set(["publicaccess.staffsmoorlands.gov.uk", "www.staffsmoorlands.gov.uk"]);
const MAJOR = "https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/MajorContentiousDevelopmentservlet";
const SEARCH = "https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet";
const GUIDE = "https://www.staffsmoorlands.gov.uk/article/568/Search-and-track-planning-applications";
const SEEDS = [MAJOR, SEARCH, GUIDE];
const PARK = /\b(alton towers|farley lane|st10\s*4db|st10\s*4bz)\b/i;
const APP = /ApplicationSearchServlet\?PKID=/i;
const REF = /\bSMD\/\d{4}\/\d{4}\b/i;
const ATTACHMENT = /(?:\.pdf|\.png|\.jpe?g|\.tiff?)(?:$|[?#])|AttachmentShowServlet\?(?:[^#]*&)?ImageName=/i;
const REJECT = /\b(comment|representation|neighbour|consultation|application form|ownership certificate|fee|validation checklist|covering letter|email|correspondence|public notice|press notice|privacy|redact|superseded|withdrawn|obsolete)\b/i;

function options(argv) {
  const result = { output: "planning-prefetch-output", runner: `browser-${process.platform}`, maxApplications: 80, maxDocuments: 240, maxBytes: 25 * 1024 * 1024, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--self-test") result.selfTest = true;
    else if (key === "--output") result.output = argv[++i];
    else if (key === "--runner") result.runner = argv[++i];
    else if (key === "--max-applications") result.maxApplications = bounded(argv[++i], 1, 500);
    else if (key === "--max-documents") result.maxDocuments = bounded(argv[++i], 1, 2000);
    else if (key === "--max-mb") result.maxBytes = bounded(argv[++i], 1, 250) * 1024 * 1024;
    else throw new Error(`Unknown option ${key}`);
  }
  return result;
}

async function main() {
  const config = options(process.argv.slice(2));
  if (config.selfTest) return selfTest();
  const output = path.resolve(config.output);
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, "files"), { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const manifest = {
    schemaVersion: 1, status: "no-live-data", generatedAt: new Date().toISOString(), runner: config.runner,
    platform: process.platform, transportFamily: "Chromium/BoringSSL", tlsVerification: "none",
    liveApplications: 0, documentsDownloaded: 0, totalBytes: 0, applications: [], entries: [], attempts: [], warnings: []
  };
  try {
    const verified = await acquire(browser, false, output, config, manifest);
    if (!verified) await acquire(browser, true, output, config, manifest);
  } finally {
    await browser.close();
  }
  manifest.liveApplications = manifest.applications.filter((application) => !application.failure).length;
  manifest.status = manifest.liveApplications > 0 && manifest.documentsDownloaded > 0 ? "usable" : "no-live-data";
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ runner: manifest.runner, status: manifest.status, applications: manifest.liveApplications, documents: manifest.documentsDownloaded, tls: manifest.tlsVerification }));
}

async function acquire(browser, insecure, output, config, manifest) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: insecure,
    locale: "en-GB",
    acceptDownloads: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
  });
  const verification = insecure ? "bypassed-allowlisted" : "verified-browser";
  const appMap = new Map();
  try {
    for (const seed of SEEDS) {
      try {
        const pageData = await htmlPage(context, seed, seed === MAJOR ? GUIDE : null);
        manifest.attempts.push({ url: seed, transport: "chromium-boringssl", ok: true, bytes: pageData.bytes.length, tlsVerification: verification });
        manifest.entries.push(await store(output, seed, pageData.url, pageData.bytes, "seed-page", verification));
        for (const application of applicationsFromRows(pageData.rows)) appMap.set(application.url, application);
      } catch (error) {
        manifest.attempts.push({ url: seed, transport: "chromium-boringssl", ok: false, error: error.message, tlsVerification: verification });
      }
    }
    if (!appMap.size) return false;
    const applications = [...appMap.values()].slice(0, config.maxApplications);
    for (const application of applications) {
      try {
        const pageData = await htmlPage(context, application.url, GUIDE);
        manifest.entries.push(await store(output, application.url, pageData.url, pageData.bytes, "application-page", verification, application.reference));
        manifest.attempts.push({ url: application.url, transport: "chromium-boringssl", ok: true, bytes: pageData.bytes.length, tlsVerification: verification });
        const documents = documentsFromLinks(pageData.links).slice(0, Math.max(0, config.maxDocuments - manifest.documentsDownloaded));
        application.documents = documents;
        application.downloadedDocuments = [];
        for (const document of documents) {
          if (manifest.documentsDownloaded >= config.maxDocuments || manifest.totalBytes >= config.maxBytes) break;
          try {
            const remaining = config.maxBytes - manifest.totalBytes;
            const downloaded = await binaryPage(context, document.url, application.url, remaining);
            const mime = sniff(downloaded.bytes, document.url);
            if (!allowed(mime)) throw new Error(`unsupported MIME ${mime}`);
            const entry = await store(output, document.url, downloaded.url, downloaded.bytes, "document", verification, application.reference, mime);
            manifest.entries.push(entry);
            manifest.attempts.push({ url: document.url, transport: "chromium-boringssl", ok: true, bytes: downloaded.bytes.length, tlsVerification: verification });
            manifest.documentsDownloaded++;
            manifest.totalBytes += downloaded.bytes.length;
            application.downloadedDocuments.push({ url: document.url, role: document.role, bytes: downloaded.bytes.length, sha256: entry.sha256, mime });
          } catch (error) {
            document.failure = error.message;
            manifest.attempts.push({ url: document.url, transport: "chromium-boringssl", ok: false, error: error.message, tlsVerification: verification });
          }
        }
        manifest.applications.push(application);
      } catch (error) {
        manifest.applications.push({ ...application, failure: error.message });
        manifest.attempts.push({ url: application.url, transport: "chromium-boringssl", ok: false, error: error.message, tlsVerification: verification });
      }
    }
    if (manifest.applications.length) manifest.tlsVerification = verification;
    return manifest.applications.length > 0 && manifest.documentsDownloaded > 0;
  } finally {
    await context.close();
  }
}

async function htmlPage(context, url, referer) {
  official(url);
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { referer: referer || undefined, waitUntil: "domcontentloaded", timeout: 180000 });
    if (!response) throw new Error("navigation returned no response");
    if (response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
    await page.waitForTimeout(750);
    const bytes = await response.body();
    const data = await page.evaluate(() => ({
      rows: [...document.querySelectorAll("tr")].map((row) => ({ text: row.innerText || "", links: [...row.querySelectorAll("a[href]")].map((a) => ({ url: a.href, text: a.textContent || "" })) })),
      links: [...document.querySelectorAll("a[href]")].map((a) => ({ url: a.href, text: a.textContent || "" }))
    }));
    return { url: response.url(), bytes, ...data };
  } finally { await page.close(); }
}

async function binaryPage(context, url, referer, maxBytes) {
  official(url);
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { referer, waitUntil: "commit", timeout: 180000 });
    if (!response) throw new Error("document navigation returned no response");
    if (response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
    const bytes = await response.body();
    if (bytes.length > maxBytes) throw new Error(`document exceeded ${maxBytes} bytes`);
    return { url: response.url(), bytes };
  } finally { await page.close(); }
}

function applicationsFromRows(rows) {
  const found = new Map();
  for (const row of rows || []) {
    if (!PARK.test(row.text || "")) continue;
    const link = (row.links || []).find((item) => APP.test(item.url || ""));
    if (!link) continue;
    official(link.url);
    const application = { reference: row.text.match(REF)?.[0] || null, status: status(row.text), proposal: row.text.slice(0, 1000), url: link.url, documents: [] };
    found.set(application.reference || application.url, application);
  }
  return [...found.values()];
}

function documentsFromLinks(links) {
  const found = new Map();
  for (const link of links || []) {
    if (!ATTACHMENT.test(link.url || "")) continue;
    official(link.url);
    const text = `${link.text || ""} ${decode(path.basename(new URL(link.url).pathname))}`.replace(/[_+.-]+/g, " ");
    const role = roleFor(text);
    const rejected = REJECT.test(text);
    const score = roleScore(role) + (/approved/i.test(text) ? 25 : 0) + (/as[- ]?built|implemented|completion/i.test(text) ? 35 : 0) - (rejected ? 100 : 0);
    if (!rejected && score >= 35) found.set(link.url, { url: link.url, text: link.text, role, score, rejected });
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

async function store(output, sourceUrl, finalUrl, bytes, kind, tlsVerification, reference = null, explicitMime = null) {
  const sha = hash(bytes); const mime = explicitMime || (kind === "document" ? sniff(bytes, sourceUrl) : "text/html");
  const file = `files/${sha}${extension(mime)}`;
  await writeFile(path.join(output, file), bytes);
  return { url: sourceUrl, finalUrl, file, kind, applicationReference: reference, bytes: bytes.length, sha256: sha, mime, transport: "chromium-boringssl", tlsVerification };
}

function official(value) { const url = new URL(value); if (url.protocol !== "https:" || !HOSTS.has(url.hostname.toLowerCase())) throw new Error(`off-host URL ${value}`); return url; }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function bounded(value, min, max) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new Error(`value must be between ${min} and ${max}`); return number; }
function decode(value) { try { return decodeURIComponent(value); } catch { return value; } }
function status(text) { const value = String(text).toLowerCase(); if (/withdrawn|invalid|returned/.test(value)) return "withdrawn"; if (/refused|dismissed/.test(value)) return "refused"; if (/approved|permission granted|consent granted/.test(value)) return "approved"; if (/pending|consultation|awaiting/.test(value)) return "pending"; return "unknown"; }
function roleFor(text) { const value = text.toLowerCase(); if (/ride|track/.test(value)) return "ride-layout"; if (/landscap|planting/.test(value)) return "landscape-plan"; if (/access|path|circulation/.test(value)) return "access-plan"; if (/drainage|level|topograph/.test(value)) return "terrain-or-drainage"; if (/elevation/.test(value)) return "elevation"; if (/section/.test(value)) return "section"; if (/floor|roof/.test(value)) return "floor-plan"; if (/block plan/.test(value)) return "block-plan"; if (/site|location|layout|masterplan|general arrangement|drawing/.test(value)) return "site-plan"; if (/lighting/.test(value)) return "lighting-plan"; return "document"; }
function roleScore(role) { return ({ "ride-layout": 120, "access-plan": 110, "site-plan": 100, "block-plan": 95, "landscape-plan": 90, "terrain-or-drainage": 80, "floor-plan": 70, elevation: 65, section: 60, "lighting-plan": 55, document: 0 })[role] || 0; }
function sniff(bytes, url) { if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf"; if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png"; if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg"; if (bytes.length >= 4 && ((bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42 && bytes[3] === 0) || (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && bytes[3] === 42))) return "image/tiff"; const ext = path.extname(new URL(url).pathname).toLowerCase(); return ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(ext) ? "image/jpeg" : [".tif", ".tiff"].includes(ext) ? "image/tiff" : "application/octet-stream"; }
function allowed(mime) { return ["application/pdf", "image/png", "image/jpeg", "image/tiff"].includes(mime); }
function extension(mime) { return mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : mime === "image/jpeg" ? ".jpg" : mime === "image/tiff" ? ".tif" : ".html"; }
function selfTest() { const rows = [{ text: "SMD/2022/0556 Alton Towers Farley Lane Planning Permission - Approved", links: [{ url: `${SEARCH}?PKID=42`, text: "SMD/2022/0556" }] }]; const apps = applicationsFromRows(rows); if (apps.length !== 1 || apps[0].status !== "approved") throw new Error("browser application parser self-test failed"); const docs = documentsFromLinks([{ url: "https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/AttachmentShowServlet?ImageName=9", text: "Approved Site Plan" }]); if (docs.length !== 1 || docs[0].role !== "site-plan") throw new Error("browser document parser self-test failed"); console.log("planning browser prefetch self-test passed"); }

main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
