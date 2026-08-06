#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const HOST = "publicaccess.staffsmoorlands.gov.uk";
const HTTP_ORIGIN = `http://${HOST}`;
const HTTPS_ORIGIN = `https://${HOST}`;
const ATTACHMENT_PATH = "/portal/servlets/AttachmentShowServlet";
const REJECT = /\b(comment|representation|neighbour|consultation|application form|ownership certificate|fee|validation checklist|covering letter|email|correspondence|public notice|press notice|privacy|redact|superseded|withdrawn|obsolete|economic benefits|planning statement|heritage impact|transport statement)\b/i;

function parseArgs(argv) {
  const result = { directory: "planning-prefetch-output", maxDocuments: 240, maxBytes: 25 * 1024 * 1024, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--self-test") result.selfTest = true;
    else if (key === "--directory") result.directory = argv[++i];
    else if (key === "--max-documents") result.maxDocuments = bounded(argv[++i], 1, 2000);
    else if (key === "--max-mb") result.maxBytes = bounded(argv[++i], 1, 250) * 1024 * 1024;
    else throw new Error(`Unknown option ${key}`);
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) return selfTest();
  const directory = path.resolve(options.directory);
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.applications) || !Array.isArray(manifest.entries)) throw new Error("invalid planning prefetch manifest");
  await mkdir(path.join(directory, "files"), { recursive: true });
  const entryByApplication = new Map(manifest.entries.filter((entry) => entry.kind === "application-page" && entry.applicationReference).map((entry) => [entry.applicationReference, entry]));
  const seenUrls = new Set(manifest.entries.map((entry) => entry.url));
  let documentsDownloaded = Number(manifest.documentsDownloaded || 0);
  let totalBytes = Number(manifest.totalBytes || 0);

  for (const application of manifest.applications) {
    if (documentsDownloaded >= options.maxDocuments || totalBytes >= options.maxBytes) break;
    const pageEntry = entryByApplication.get(application.reference);
    if (!pageEntry) continue;
    const pagePath = safePath(directory, pageEntry.file);
    const html = await readFile(pagePath, "utf8");
    const candidates = extractBlobAttachments(html)
      .filter((candidate) => candidate.score >= 35 && !candidate.rejected)
      .slice(0, Math.max(0, options.maxDocuments - documentsDownloaded));
    application.documents = mergeByUrl(application.documents || [], candidates.map(publicCandidate));
    application.downloadedDocuments ||= [];

    for (const candidate of candidates) {
      if (documentsDownloaded >= options.maxDocuments || totalBytes >= options.maxBytes) break;
      const publicUrl = canonical(candidate.transportUrl);
      if (seenUrls.has(publicUrl)) continue;
      try {
        const remaining = options.maxBytes - totalBytes;
        const fetched = await fetchAttachment(candidate.transportUrl, remaining, pageEntry.transportUrl || application.transportUrl);
        const mime = sniffMime(fetched.data);
        if (!allowedMime(mime)) throw new Error(`unsupported MIME ${mime}`);
        const digest = sha256(fetched.data);
        const file = `files/${digest}${extensionFor(mime)}`;
        await writeFile(path.join(directory, file), fetched.data);
        const entry = {
          url: publicUrl,
          finalUrl: publicUrl,
          transportUrl: candidate.transportUrl,
          file,
          kind: "document",
          applicationReference: application.reference || null,
          bytes: fetched.data.length,
          sha256: digest,
          mime,
          transport: "node-http-appblobimage",
          tlsVerification: "legacy-http-official-host"
        };
        manifest.entries.push(entry);
        manifest.attempts ||= [];
        manifest.attempts.push({ url: publicUrl, transportUrl: candidate.transportUrl, transport: entry.transport, ok: true, bytes: entry.bytes, tlsVerification: entry.tlsVerification });
        application.downloadedDocuments.push({ url: publicUrl, transportUrl: candidate.transportUrl, role: candidate.role, bytes: entry.bytes, sha256: digest, mime, text: candidate.text });
        documentsDownloaded += 1;
        totalBytes += entry.bytes;
        seenUrls.add(publicUrl);
      } catch (error) {
        candidate.failure = error.message;
        manifest.attempts ||= [];
        manifest.attempts.push({ url: publicUrl, transportUrl: candidate.transportUrl, transport: "node-http-appblobimage", ok: false, error: error.message, tlsVerification: "legacy-http-official-host" });
      }
    }
  }

  manifest.documentsDownloaded = documentsDownloaded;
  manifest.totalBytes = totalBytes;
  manifest.liveApplications = manifest.applications.filter((application) => !application.failure).length;
  manifest.status = manifest.liveApplications > 0 && documentsDownloaded > 0 ? "usable" : "no-live-data";
  manifest.attachmentExtraction = {
    method: "legacy-AppBlobImage",
    completedAt: new Date().toISOString(),
    documentsDownloaded,
    exactHostOnly: true,
    redirectsAllowed: false
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ status: manifest.status, applications: manifest.liveApplications, documents: documentsDownloaded, bytes: totalBytes }));
}

export function extractBlobAttachments(html) {
  const found = new Map();
  const pattern = /<a\b[^>]*href\s*=\s*(?:"|')javascript:AppBlobImage\(\s*(?:'|&apos;|&#39;)([^'"&)]+)(?:'|&apos;|&#39;)\s*\)\s*;?(?:"|')[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const imageName = decodeHtml(match[1]).trim();
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(imageName)) continue;
    const text = stripHtml(match[2]);
    const role = inferRole(text);
    const rejected = REJECT.test(text);
    let score = roleScore(role) + (/approved/i.test(text) ? 25 : 0) + (/as\s*(?:existing|extg)|as[- ]?built|implemented|completion/i.test(text) ? 35 : 0) - (rejected ? 120 : 0);
    if (/proposed/i.test(text) && !/approved/i.test(text)) score -= 10;
    const transportUrl = `${HTTP_ORIGIN}${ATTACHMENT_PATH}?ImageName=${encodeURIComponent(imageName)}`;
    found.set(transportUrl, { transportUrl, url: canonical(transportUrl), text, role, score, rejected, imageName });
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

function fetchAttachment(value, maxBytes, referer) {
  const url = exactHttp(value);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; fn(value); };
    const request = http.get({
      protocol: "http:", hostname: HOST, port: 80, path: `${url.pathname}${url.search}`, timeout: 60000,
      headers: {
        Host: HOST,
        Accept: "application/pdf,image/png,image/jpeg,image/tiff;q=0.9,*/*;q=0.1",
        "Accept-Encoding": "identity",
        Connection: "close",
        Referer: referer || `${HTTP_ORIGIN}/portal/servlets/ApplicationSearchServlet`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        finish(reject, new Error(`HTTP ${response.statusCode} redirect refused`));
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        finish(reject, new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const chunks = []; let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) request.destroy(new Error(`attachment exceeded ${maxBytes} bytes`));
        else chunks.push(chunk);
      });
      response.on("end", () => finish(resolve, { data: Buffer.concat(chunks) }));
      response.on("error", (error) => finish(reject, error));
    });
    request.on("timeout", () => request.destroy(new Error("attachment request timed out")));
    request.on("error", (error) => finish(reject, error));
  });
}

function publicCandidate(candidate) { return { url: candidate.url, transportUrl: candidate.transportUrl, text: candidate.text, role: candidate.role, score: candidate.score, rejected: candidate.rejected }; }
function mergeByUrl(first, second) { const map = new Map(); for (const item of [...first, ...second]) map.set(item.url || item.transportUrl, item); return [...map.values()]; }
function exactHttp(value) { const url = new URL(value); if (url.protocol !== "http:" || url.hostname.toLowerCase() !== HOST || (url.port && url.port !== "80") || url.pathname !== ATTACHMENT_PATH) throw new Error(`attachment URL outside exact legacy endpoint: ${value}`); return url; }
function canonical(value) { const url = exactHttp(value); url.protocol = "https:"; return url.toString(); }
function safePath(directory, relative) { if (!relative || path.isAbsolute(relative)) throw new Error("artifact path must be relative"); const filename = path.resolve(directory, relative); const rel = path.relative(directory, filename); if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("artifact path escapes directory"); return filename; }
function bounded(value, min, max) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new Error(`value must be between ${min} and ${max}`); return number; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function stripHtml(value) { return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function decodeHtml(value) { return String(value).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"); }
function inferRole(text) { const value = text.toLowerCase(); if (/ride|track|roller.?coaster/.test(value)) return "ride-layout"; if (/landscap|planting/.test(value)) return "landscape-plan"; if (/access|path|circulation|highway/.test(value)) return "access-plan"; if (/drainage|level|topograph|contour/.test(value)) return "terrain-or-drainage"; if (/elevation/.test(value)) return "elevation"; if (/section/.test(value)) return "section"; if (/floor|roof/.test(value)) return "floor-plan"; if (/block plan/.test(value)) return "block-plan"; if (/site|location|layout|masterplan|general arrangement|drawing/.test(value)) return "site-plan"; if (/lighting/.test(value)) return "lighting-plan"; return "document"; }
function roleScore(role) { return ({ "ride-layout": 120, "access-plan": 110, "site-plan": 100, "block-plan": 95, "landscape-plan": 90, "terrain-or-drainage": 80, "floor-plan": 70, elevation: 65, section: 60, "lighting-plan": 55, document: 0 })[role] || 0; }
function sniffMime(bytes) { if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf"; if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png"; if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg"; if (bytes.length >= 4 && ((bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42 && bytes[3] === 0) || (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && bytes[3] === 42))) return "image/tiff"; return "application/octet-stream"; }
function allowedMime(mime) { return ["application/pdf", "image/png", "image/jpeg", "image/tiff"].includes(mime); }
function extensionFor(mime) { return mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : mime === "image/jpeg" ? ".jpg" : ".tif"; }

function selfTest() {
  const html = `<tr><td><a href="javascript:AppBlobImage('316028');">373_104_3 Site Plan as Extg</a></td></tr><tr><td><a href="javascript:AppBlobImage('316032');">Cover letter</a></td></tr>`;
  const candidates = extractBlobAttachments(html);
  if (candidates.length !== 2 || candidates[0].role !== "site-plan" || candidates[0].rejected || candidates[1].rejected !== true) throw new Error("AppBlobImage attachment parser self-test failed");
  console.log("planning attachment completion self-test passed");
}

main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
