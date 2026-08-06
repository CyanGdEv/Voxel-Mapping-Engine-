#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";

const HOST = "publicaccess.staffsmoorlands.gov.uk";
const HTTPS_ORIGIN = `https://${HOST}`;
const HTTP_ORIGIN = `http://${HOST}`;
const MAJOR = `${HTTP_ORIGIN}/portal/servlets/MajorContentiousDevelopmentservlet`;
const SEARCH = `${HTTP_ORIGIN}/portal/servlets/ApplicationSearchServlet`;
const GUIDE = "https://www.staffsmoorlands.gov.uk/article/568/Search-and-track-planning-applications";
const PARK = /\b(alton towers|farley lane|st10\s*4db|st10\s*4bz)\b/i;
const APP = /ApplicationSearchServlet\?PKID=/i;
const REF = /\bSMD\/\d{4}\/\d{4}\b/i;
const DOWNLOADABLE = /(?:\.pdf|\.png|\.jpe?g|\.tiff?)(?:$|[?#])|AttachmentShowServlet\?(?:[^#]*&)?ImageName=/i;
const REJECT = /\b(comment|representation|neighbour|consultation|application form|ownership certificate|fee|validation checklist|covering letter|email|correspondence|public notice|press notice|privacy|redact|superseded|withdrawn|obsolete)\b/i;

function parseArgs(argv) {
  const result = { output: "planning-prefetch-output", runner: `legacy-http-${process.platform}`, maxApplications: 80, maxDocuments: 240, maxBytes: 25 * 1024 * 1024, selfTest: false };
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
  const config = parseArgs(process.argv.slice(2));
  if (config.selfTest) return selfTest();
  const output = path.resolve(config.output);
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, "files"), { recursive: true });
  const cookies = new Map();
  const manifest = {
    schemaVersion: 1,
    status: "no-live-data",
    generatedAt: new Date().toISOString(),
    runner: config.runner,
    platform: process.platform,
    transportFamily: "official-legacy-HTTP",
    tlsVerification: "legacy-http-official-host",
    transportSecurity: "plaintext-http-exact-host-only",
    liveApplications: 0,
    documentsDownloaded: 0,
    totalBytes: 0,
    applications: [],
    entries: [],
    attempts: [],
    warnings: []
  };
  const seenEntries = new Set();
  const applications = new Map();

  for (const seed of [MAJOR, SEARCH]) {
    try {
      const fetched = await fetchHttp(seed, { cookies, referer: GUIDE, maxBytes: 5 * 1024 * 1024, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" });
      manifest.attempts.push(attempt(seed, fetched));
      pushEntry(manifest, await store(output, seed, fetched, "seed-page", seenEntries));
      for (const application of extractApplications(fetched.data.toString("utf8"), seed)) applications.set(application.reference || application.transportUrl, application);
    } catch (error) {
      manifest.attempts.push({ url: canonical(seed), transportUrl: seed, transport: "node-http", ok: false, error: error.message, tlsVerification: "legacy-http-official-host" });
      manifest.warnings.push(`${seed}: ${error.message}`);
    }
  }

  for (const application of [...applications.values()].slice(0, config.maxApplications)) {
    try {
      const fetched = await fetchHttp(application.transportUrl, { cookies, referer: MAJOR, maxBytes: 5 * 1024 * 1024, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" });
      manifest.attempts.push(attempt(application.transportUrl, fetched));
      pushEntry(manifest, await store(output, application.transportUrl, fetched, "application-page", seenEntries, application.reference));
      application.documents = extractDocuments(fetched.data.toString("utf8"), application.transportUrl).slice(0, Math.max(0, config.maxDocuments - manifest.documentsDownloaded));
      application.downloadedDocuments = [];
      for (const document of application.documents) {
        if (manifest.documentsDownloaded >= config.maxDocuments || manifest.totalBytes >= config.maxBytes) break;
        try {
          const fetchedDocument = await fetchHttp(document.transportUrl, { cookies, referer: application.transportUrl, maxBytes: config.maxBytes - manifest.totalBytes, accept: "application/pdf,image/png,image/jpeg,image/tiff;q=0.9,*/*;q=0.1" });
          const mime = sniff(fetchedDocument.data, document.transportUrl);
          if (!allowedMime(mime)) throw new Error(`unsupported MIME ${mime}`);
          const entry = await store(output, document.transportUrl, fetchedDocument, "document", seenEntries, application.reference, mime);
          pushEntry(manifest, entry);
          manifest.attempts.push(attempt(document.transportUrl, fetchedDocument));
          manifest.documentsDownloaded++;
          manifest.totalBytes += fetchedDocument.data.length;
          application.downloadedDocuments.push({ url: canonical(document.transportUrl), transportUrl: document.transportUrl, role: document.role, bytes: fetchedDocument.data.length, sha256: entry.sha256, mime });
        } catch (error) {
          document.failure = error.message;
          manifest.attempts.push({ url: canonical(document.transportUrl), transportUrl: document.transportUrl, transport: "node-http", ok: false, error: error.message, tlsVerification: "legacy-http-official-host" });
        }
      }
      manifest.applications.push(application);
    } catch (error) {
      manifest.applications.push({ ...application, failure: error.message });
      manifest.attempts.push({ url: application.url, transportUrl: application.transportUrl, transport: "node-http", ok: false, error: error.message, tlsVerification: "legacy-http-official-host" });
    }
  }

  manifest.liveApplications = manifest.applications.filter((application) => !application.failure).length;
  manifest.status = manifest.liveApplications > 0 && manifest.documentsDownloaded > 0 ? "usable" : "no-live-data";
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ runner: manifest.runner, status: manifest.status, applications: manifest.liveApplications, documents: manifest.documentsDownloaded, transport: manifest.transportFamily }));
}

function fetchHttp(value, options) {
  const url = exactHttp(value);
  return new Promise((resolve, reject) => {
    const headers = {
      Host: HOST,
      Accept: options.accept,
      "Accept-Language": "en-GB,en;q=0.9",
      "Cache-Control": "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    };
    if (options.referer) headers.Referer = options.referer;
    if (options.cookies.size) headers.Cookie = [...options.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    const request = http.get({ protocol: "http:", hostname: HOST, port: 80, path: `${url.pathname}${url.search}`, headers, timeout: 45000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} redirect refused (${response.headers.location || "no location"})`));
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      for (const cookie of response.headers["set-cookie"] || []) {
        const pair = cookie.split(";", 1)[0];
        const index = pair.indexOf("=");
        if (index > 0) options.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > options.maxBytes) request.destroy(new Error(`response exceeded ${options.maxBytes} bytes`));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ data: Buffer.concat(chunks), transportUrl: url.toString(), finalTransportUrl: url.toString(), transport: "node-http", tlsVerification: "legacy-http-official-host" }));
    });
    request.on("timeout", () => request.destroy(new Error("HTTP request timed out")));
    request.on("error", reject);
  });
}

function extractApplications(html, base) {
  const found = new Map();
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const text = strip(row[1]);
    if (!PARK.test(text)) continue;
    const link = links(row[1], base).find((item) => APP.test(item.transportUrl));
    if (!link) continue;
    const reference = text.match(REF)?.[0] || null;
    found.set(reference || link.transportUrl, { reference, status: inferStatus(text), proposal: text.slice(0, 1000), url: canonical(link.transportUrl), transportUrl: link.transportUrl, documents: [] });
  }
  return [...found.values()];
}

function extractDocuments(html, base) {
  const found = new Map();
  for (const link of links(html, base)) {
    if (!DOWNLOADABLE.test(link.transportUrl)) continue;
    const text = `${link.text} ${safeDecode(path.basename(new URL(link.transportUrl).pathname))}`.replace(/[_+.-]+/g, " ");
    const rejected = REJECT.test(text);
    const role = roleFor(text);
    const score = roleScore(role) + (/approved/i.test(text) ? 25 : 0) + (/as[- ]?built|implemented|completion/i.test(text) ? 35 : 0) - (rejected ? 100 : 0);
    if (!rejected && score >= 35) found.set(link.transportUrl, { url: canonical(link.transportUrl), transportUrl: link.transportUrl, text: link.text, role, score, rejected });
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

function links(html, base) {
  const result = [];
  const pattern = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const raw = decodeHtml(match[1] || match[2] || match[3] || "").trim();
    if (!raw || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    try {
      const transportUrl = exactHttp(new URL(raw, base).toString()).toString();
      result.push({ transportUrl, text: strip(match[4] || "") });
    } catch {
      // Ignore off-host or malformed links.
    }
  }
  return result;
}

async function store(output, transportUrl, fetched, kind, seen, reference = null, explicitMime = null) {
  const publicUrl = canonical(transportUrl);
  if (seen.has(publicUrl)) return null;
  seen.add(publicUrl);
  const digest = sha256(fetched.data);
  const mime = explicitMime || (kind === "document" ? sniff(fetched.data, transportUrl) : "text/html");
  const file = `files/${digest}${extensionFor(mime)}`;
  await writeFile(path.join(output, file), fetched.data);
  return { url: publicUrl, finalUrl: publicUrl, transportUrl: exactHttp(transportUrl).toString(), file, kind, applicationReference: reference, bytes: fetched.data.length, sha256: digest, mime, transport: "node-http", tlsVerification: "legacy-http-official-host" };
}

function pushEntry(manifest, entry) { if (entry) manifest.entries.push(entry); }
function attempt(transportUrl, fetched) { return { url: canonical(transportUrl), transportUrl: exactHttp(transportUrl).toString(), transport: fetched.transport, ok: true, bytes: fetched.data.length, tlsVerification: "legacy-http-official-host" }; }
function exactHttp(value) { const url = new URL(value); if (url.protocol !== "http:" || url.hostname.toLowerCase() !== HOST || (url.port && url.port !== "80")) throw new Error(`legacy HTTP URL outside exact official host: ${value}`); return url; }
function canonical(value) { const url = exactHttp(value); url.protocol = "https:"; return url.toString(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function bounded(value, min, max) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new Error(`value must be between ${min} and ${max}`); return number; }
function strip(value) { return decodeHtml(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function decodeHtml(value) { return String(value).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"); }
function safeDecode(value) { try { return decodeURIComponent(value); } catch { return value; } }
function inferStatus(text) { const value = String(text).toLowerCase(); if (/withdrawn|invalid|returned/.test(value)) return "withdrawn"; if (/refused|dismissed/.test(value)) return "refused"; if (/approved|permission granted|consent granted/.test(value)) return "approved"; if (/pending|consultation|awaiting/.test(value)) return "pending"; return "unknown"; }
function roleFor(text) { const value = text.toLowerCase(); if (/ride|track/.test(value)) return "ride-layout"; if (/landscap|planting/.test(value)) return "landscape-plan"; if (/access|path|circulation/.test(value)) return "access-plan"; if (/drainage|level|topograph/.test(value)) return "terrain-or-drainage"; if (/elevation/.test(value)) return "elevation"; if (/section/.test(value)) return "section"; if (/floor|roof/.test(value)) return "floor-plan"; if (/block plan/.test(value)) return "block-plan"; if (/site|location|layout|masterplan|general arrangement|drawing/.test(value)) return "site-plan"; if (/lighting/.test(value)) return "lighting-plan"; return "document"; }
function roleScore(role) { return ({ "ride-layout": 120, "access-plan": 110, "site-plan": 100, "block-plan": 95, "landscape-plan": 90, "terrain-or-drainage": 80, "floor-plan": 70, elevation: 65, section: 60, "lighting-plan": 55, document: 0 })[role] || 0; }
function sniff(bytes, url) { if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf"; if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png"; if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg"; if (bytes.length >= 4 && ((bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42 && bytes[3] === 0) || (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && bytes[3] === 42))) return "image/tiff"; const ext = path.extname(new URL(url).pathname).toLowerCase(); return ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(ext) ? "image/jpeg" : [".tif", ".tiff"].includes(ext) ? "image/tiff" : "application/octet-stream"; }
function allowedMime(mime) { return ["application/pdf", "image/png", "image/jpeg", "image/tiff"].includes(mime); }
function extensionFor(mime) { return mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : mime === "image/jpeg" ? ".jpg" : mime === "image/tiff" ? ".tif" : ".html"; }

function selfTest() {
  if (canonical(MAJOR) !== "https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/MajorContentiousDevelopmentservlet") throw new Error("canonical URL self-test failed");
  const html = `<table><tr><td><a href="/portal/servlets/ApplicationSearchServlet?PKID=42">SMD/2022/0556</a></td><td>Alton Towers Farley Lane</td><td>Approved ride layout</td></tr></table>`;
  const applications = extractApplications(html, MAJOR);
  if (applications.length !== 1 || applications[0].reference !== "SMD/2022/0556" || !applications[0].url.startsWith("https://")) throw new Error("HTTP application parser self-test failed");
  const documents = extractDocuments(`<a href="/portal/servlets/AttachmentShowServlet?ImageName=9">Approved Site Plan</a>`, applications[0].transportUrl);
  if (documents.length !== 1 || documents[0].role !== "site-plan" || !documents[0].url.startsWith("https://")) throw new Error("HTTP document parser self-test failed");
  console.log("planning legacy HTTP prefetch self-test passed");
}

main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
