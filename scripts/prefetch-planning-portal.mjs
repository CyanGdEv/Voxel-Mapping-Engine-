#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const OFFICIAL_HOSTS = new Set([
  "publicaccess.staffsmoorlands.gov.uk",
  "www.staffsmoorlands.gov.uk"
]);
const SEEDS = [
  "https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/MajorContentiousDevelopmentservlet",
  "https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet",
  "https://www.staffsmoorlands.gov.uk/article/568/Search-and-track-planning-applications"
];
const REFERER = SEEDS[2];
const PARK_ROW = /\b(alton towers|farley lane|st10\s*4db|st10\s*4bz)\b/i;
const APPLICATION_URL = /ApplicationSearchServlet\?PKID=/i;
const REFERENCE = /\bSMD\/\d{4}\/\d{4}\b/i;
const REJECT = /\b(comment|representation|neighbour|consultation|application form|ownership certificate|fee|validation checklist|covering letter|email|correspondence|public notice|press notice|privacy|redact|superseded|withdrawn|obsolete)\b/i;
const GEOMETRY = /\b(site plan|block plan|location plan|masterplan|layout|general arrangement|ga plan|landscape|landscaping|planting|floor plan|roof plan|elevation|section|drainage|lighting|access plan|ride layout|track layout|as built|as-built|approved plan|proposed plan|existing plan|drawing)\b/i;
const DOWNLOADABLE = /(?:\.pdf|\.png|\.jpe?g|\.tiff?)(?:$|[?#])|AttachmentShowServlet\?(?:[^#]*&)?ImageName=/i;

function parseArgs(argv) {
  const options = { output: "planning-prefetch", runner: process.platform, maxApplications: 80, maxDocuments: 240, maxBytes: 25 * 1024 * 1024, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--self-test") options.selfTest = true;
    else if (key === "--output") options.output = argv[++i];
    else if (key === "--runner") options.runner = argv[++i];
    else if (key === "--max-applications") options.maxApplications = boundedInt(argv[++i], 1, 500, "max applications");
    else if (key === "--max-documents") options.maxDocuments = boundedInt(argv[++i], 1, 2000, "max documents");
    else if (key === "--max-mb") options.maxBytes = boundedInt(argv[++i], 1, 250, "max MB") * 1024 * 1024;
    else throw new Error(`Unknown option ${key}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) return selfTest();
  const output = path.resolve(options.output);
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, "files"), { recursive: true });
  const session = path.join(output, "session-cookies.txt");
  await writeFile(session, "# Netscape HTTP Cookie File\n", { flag: "a" });
  const manifest = {
    schemaVersion: 1,
    status: "no-live-data",
    generatedAt: new Date().toISOString(),
    runner: options.runner,
    platform: process.platform,
    transportFamily: nativeTransportFamily(),
    tlsVerification: "none",
    liveApplications: 0,
    documentsDownloaded: 0,
    totalBytes: 0,
    applications: [],
    entries: [],
    attempts: [],
    warnings: []
  };
  const entryUrls = new Set();
  const applicationMap = new Map();

  for (const seed of SEEDS) {
    try {
      const fetched = await nativeFetch(seed, {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        referer: seed === SEEDS[0] ? REFERER : null,
        session,
        maxBytes: 5 * 1024 * 1024
      });
      pushEntry(manifest, await storeEntry(output, seed, fetched, "seed-page", entryUrls));
      manifest.attempts.push(...fetched.attempts.map((attempt) => ({ url: seed, ...attempt })));
      const html = fetched.data.toString("utf8");
      for (const application of extractApplications(html, fetched.finalUrl || seed)) {
        if (!applicationMap.has(application.url)) applicationMap.set(application.url, application);
      }
    } catch (error) {
      manifest.warnings.push(`seed ${seed}: ${error.message}`);
      if (error.attempts) manifest.attempts.push(...error.attempts.map((attempt) => ({ url: seed, ...attempt })));
    }
  }

  const applications = [...applicationMap.values()].slice(0, options.maxApplications);
  for (const application of applications) {
    try {
      const fetched = await nativeFetch(application.url, {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        referer: REFERER,
        session,
        maxBytes: 5 * 1024 * 1024
      });
      pushEntry(manifest, await storeEntry(output, application.url, fetched, "application-page", entryUrls, application.reference));
      manifest.attempts.push(...fetched.attempts.map((attempt) => ({ url: application.url, ...attempt })));
      application.documents = extractDocumentLinks(fetched.data.toString("utf8"), fetched.finalUrl || application.url)
        .filter((document) => document.score >= 35 && !document.rejected)
        .slice(0, Math.max(0, options.maxDocuments - manifest.documentsDownloaded));
      application.downloadedDocuments = [];
      for (const document of application.documents) {
        if (manifest.documentsDownloaded >= options.maxDocuments || manifest.totalBytes >= options.maxBytes) break;
        try {
          const remaining = options.maxBytes - manifest.totalBytes;
          const downloaded = await nativeFetch(document.url, {
            accept: "application/pdf,image/png,image/jpeg,image/tiff;q=0.9,*/*;q=0.1",
            referer: application.url,
            session,
            maxBytes: remaining
          });
          const mime = sniffMime(downloaded.data, document.url);
          if (!isAllowedMime(mime)) throw new Error(`unsupported MIME ${mime}`);
          const entry = await storeEntry(output, document.url, downloaded, "document", entryUrls, application.reference, mime);
          if (!entry) continue;
          pushEntry(manifest, entry);
          manifest.attempts.push(...downloaded.attempts.map((attempt) => ({ url: document.url, ...attempt })));
          manifest.documentsDownloaded += 1;
          manifest.totalBytes += downloaded.data.length;
          application.downloadedDocuments.push({ url: document.url, role: document.role, bytes: downloaded.data.length, sha256: entry.sha256, mime });
        } catch (error) {
          document.failure = error.message;
          if (error.attempts) manifest.attempts.push(...error.attempts.map((attempt) => ({ url: document.url, ...attempt })));
        }
      }
      manifest.applications.push(application);
    } catch (error) {
      application.failure = error.message;
      manifest.applications.push(application);
      if (error.attempts) manifest.attempts.push(...error.attempts.map((attempt) => ({ url: application.url, ...attempt })));
    }
  }

  manifest.liveApplications = manifest.applications.filter((application) => !application.failure).length;
  const successful = manifest.attempts.filter((attempt) => attempt.ok);
  manifest.tlsVerification = successful.some((attempt) => attempt.tlsVerification === "verified-native")
    ? "verified-native"
    : successful.some((attempt) => attempt.tlsVerification === "bypassed-allowlisted")
      ? "bypassed-allowlisted"
      : "none";
  manifest.status = manifest.liveApplications > 0 && manifest.documentsDownloaded > 0 ? "usable" : "no-live-data";
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ runner: manifest.runner, status: manifest.status, liveApplications: manifest.liveApplications, documentsDownloaded: manifest.documentsDownloaded, entries: manifest.entries.length }));
}

async function nativeFetch(url, options) {
  validateOfficialUrl(url);
  const attempts = [];
  for (const insecure of [false, true]) {
    try {
      const result = process.platform === "linux"
        ? await wgetFetch(url, options, insecure)
        : await curlFetch(url, options, insecure);
      validateOfficialUrl(result.finalUrl || url);
      validatePayload(result.data, options.accept);
      attempts.push({ transport: result.transport, ok: true, bytes: result.data.length, tlsVerification: insecure ? "bypassed-allowlisted" : "verified-native" });
      return { ...result, attempts, tlsVerification: insecure ? "bypassed-allowlisted" : "verified-native" };
    } catch (error) {
      attempts.push({ transport: process.platform === "linux" ? "wget-gnutls" : `${process.platform}-native-curl`, ok: false, insecure, error: error.message, tlsVerification: insecure ? "bypassed-allowlisted" : "verified-native" });
    }
  }
  const error = new Error(`all native transports failed for ${url}: ${attempts.map((attempt) => `${attempt.transport}:${attempt.error || "failed"}`).join("; ")}`);
  error.attempts = attempts;
  throw error;
}

async function wgetFetch(url, options, insecure) {
  const args = [
    "--quiet", "--server-response", "--max-redirect=0", "--timeout=30", "--tries=3",
    "--load-cookies", options.session, "--save-cookies", options.session, "--keep-session-cookies",
    `--header=Accept: ${options.accept}`, "--header=Accept-Language: en-GB,en;q=0.9",
    "--header=Cache-Control: no-cache", "--output-document=-"
  ];
  if (options.referer) args.push(`--referer=${options.referer}`);
  if (insecure) args.push("--no-check-certificate");
  args.push(url);
  const data = await spawnBytes("wget", args, options.maxBytes, 190_000);
  return { data, finalUrl: url, transport: insecure ? "wget-gnutls-insecure-allowlisted" : "wget-gnutls" };
}

async function curlFetch(url, options, insecure) {
  const command = process.platform === "win32" ? "curl.exe" : "/usr/bin/curl";
  const args = [
    "--fail-with-body", "--max-redirs", "0", "--proto", "=https", "--proto-redir", "=https",
    "--retry", "3", "--retry-all-errors", "--connect-timeout", "30", "--max-time", "180",
    "--compressed", "--silent", "--show-error", "--cookie-jar", options.session, "--cookie", options.session,
    "--header", `Accept: ${options.accept}`, "--header", "Accept-Language: en-GB,en;q=0.9", "--header", "Cache-Control: no-cache"
  ];
  if (process.platform === "win32") args.push("--ssl-no-revoke");
  if (options.referer) args.push("--referer", options.referer);
  if (insecure) args.push("--insecure");
  args.push(url);
  const data = await spawnBytes(command, args, options.maxBytes, 190_000);
  const family = process.platform === "win32" ? "windows-schannel" : "macos-native-curl";
  return { data, finalUrl: url, transport: insecure ? `${family}-insecure-allowlisted` : family };
}

function extractApplications(html, baseUrl) {
  const applications = [];
  for (const match of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const text = stripHtml(row);
    if (!PARK_ROW.test(text)) continue;
    const link = extractLinks(row, baseUrl).find((candidate) => APPLICATION_URL.test(candidate.url));
    if (!link) continue;
    applications.push({
      reference: text.match(REFERENCE)?.[0] || null,
      status: inferStatus(text),
      proposal: text.slice(0, 1000),
      url: link.url,
      documents: []
    });
  }
  return dedupeBy(applications, (item) => item.reference || item.url);
}

function extractDocumentLinks(html, baseUrl) {
  return dedupeBy(extractLinks(html, baseUrl).filter((link) => DOWNLOADABLE.test(link.url)).map((link) => {
    const text = `${decodeSafe(path.basename(new URL(link.url).pathname))} ${link.text}`.replace(/[_+.-]+/g, " ");
    const rejected = REJECT.test(text);
    const role = inferRole(text);
    const score = roleScore(role) + 5 + (GEOMETRY.test(text) ? 12 : 0) + (/approved/i.test(text) ? 25 : 0) + (/as[- ]?built|implemented|completion/i.test(text) ? 35 : 0) - (rejected ? 100 : 0);
    return { url: link.url, text: link.text, role, score, rejected };
  }), (item) => item.url).sort((a, b) => b.score - a.score);
}

function extractLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const raw = decodeHtml(match[1] || match[2] || match[3] || "").trim();
    if (!raw || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    try {
      const url = new URL(raw, baseUrl).toString();
      validateOfficialUrl(url);
      links.push({ url, text: stripHtml(match[4] || "") });
    } catch {
      // Ignore malformed or off-host links.
    }
  }
  return links;
}

async function storeEntry(output, url, fetched, kind, seen, reference = null, explicitMime = null) {
  if (seen.has(url)) return null;
  seen.add(url);
  const finalUrl = fetched.finalUrl || url;
  validateOfficialUrl(url);
  validateOfficialUrl(finalUrl);
  const digest = sha256(fetched.data);
  const mime = explicitMime || (kind === "document" ? sniffMime(fetched.data, url) : "text/html");
  const extension = extensionForMime(mime);
  const relative = `files/${digest}${extension}`;
  await writeFile(path.join(output, relative), fetched.data);
  return {
    url,
    finalUrl,
    file: relative,
    kind,
    applicationReference: reference,
    bytes: fetched.data.length,
    sha256: digest,
    mime,
    transport: fetched.transport,
    tlsVerification: fetched.tlsVerification
  };
}

function pushEntry(manifest, entry) { if (entry) manifest.entries.push(entry); }
function validateOfficialUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !OFFICIAL_HOSTS.has(url.hostname.toLowerCase())) throw new Error(`URL outside official planning host allowlist: ${value}`);
  return url;
}

function validatePayload(data, accept) {
  if (!data?.length) throw new Error("empty response");
  if (String(accept).includes("text/html")) {
    const sample = data.subarray(0, Math.min(data.length, 32768)).toString("utf8");
    if (!/<(?:!doctype|html|head|body|table|form|a)\b/i.test(sample) || !/planning|application|document|council|search|plan|drawing|attachment|landscape/i.test(sample)) throw new Error("response failed official planning HTML validation");
  }
}

function sniffMime(bytes, url) {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 4 && ((bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42 && bytes[3] === 0) || (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && bytes[3] === 42))) return "image/tiff";
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(ext) ? "image/jpeg" : [".tif", ".tiff"].includes(ext) ? "image/tiff" : "application/octet-stream";
}

function isAllowedMime(mime) { return ["application/pdf", "image/png", "image/jpeg", "image/tiff"].includes(mime); }
function extensionForMime(mime) { return mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : mime === "image/jpeg" ? ".jpg" : mime === "image/tiff" ? ".tif" : ".bin"; }
function inferRole(text) { const value = text.toLowerCase(); if (/ride|track/.test(value)) return "ride-layout"; if (/landscap|planting/.test(value)) return "landscape-plan"; if (/access|path|circulation/.test(value)) return "access-plan"; if (/drainage|level|topograph/.test(value)) return "terrain-or-drainage"; if (/elevation/.test(value)) return "elevation"; if (/section/.test(value)) return "section"; if (/floor|roof/.test(value)) return "floor-plan"; if (/block plan/.test(value)) return "block-plan"; if (/site|location|layout|masterplan|general arrangement|drawing/.test(value)) return "site-plan"; if (/lighting/.test(value)) return "lighting-plan"; return "document"; }
function roleScore(role) { return ({ "ride-layout": 120, "access-plan": 110, "site-plan": 100, "block-plan": 95, "landscape-plan": 90, "terrain-or-drainage": 80, "floor-plan": 70, elevation: 65, section: 60, "lighting-plan": 55, document: 0 })[role] || 0; }
function inferStatus(text) { const value = text.toLowerCase(); if (/withdrawn|invalid|returned/.test(value)) return "withdrawn"; if (/refused|dismissed/.test(value)) return "refused"; if (/approved|permission granted|consent granted/.test(value)) return "approved"; if (/pending|consultation|awaiting/.test(value)) return "pending"; return "unknown"; }
function stripHtml(value) { return decodeHtml(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function decodeHtml(value) { return String(value).replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">"); }
function decodeSafe(value) { try { return decodeURIComponent(value); } catch { return value; } }
function dedupeBy(values, key) { const map = new Map(); for (const value of values) if (!map.has(key(value))) map.set(key(value), value); return [...map.values()]; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function boundedInt(value, min, max, label) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer between ${min} and ${max}`); return number; }
function nativeTransportFamily() { return process.platform === "linux" ? "GnuTLS/wget" : process.platform === "win32" ? "Schannel/curl.exe" : process.platform === "darwin" ? "macOS native curl" : process.platform; }

function spawnBytes(command, args, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; let bytes = 0; let stderr = ""; let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(reject, new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes > maxBytes) { child.kill("SIGKILL"); finish(reject, new Error(`${command} response exceeded ${maxBytes} bytes`)); } else chunks.push(chunk); });
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => code === 0 ? finish(resolve, Buffer.concat(chunks)) : finish(reject, new Error(`${command} failed (${code}): ${stderr.trim() || "no stderr"}`)));
  });
}

function selfTest() {
  if (REFERER !== "https://www.staffsmoorlands.gov.uk/article/568/Search-and-track-planning-applications") throw new Error("official planning guide self-test failed");
  const html = `<table><tr><td><a href="/portal/servlets/ApplicationSearchServlet?PKID=42">SMD/2022/0556</a></td><td>Alton Towers, Farley Lane</td><td>Approved ride layout and landscaping</td></tr></table>`;
  const apps = extractApplications(html, SEEDS[0]);
  if (apps.length !== 1 || apps[0].reference !== "SMD/2022/0556") throw new Error("application parser self-test failed");
  const docs = extractDocumentLinks(`<a href="/portal/servlets/AttachmentShowServlet?ImageName=9">Approved Site Plan</a><a href="/comment.pdf">Neighbour comment</a>`, apps[0].url);
  if (docs.length !== 2 || docs[0].role !== "site-plan" || docs[0].rejected) throw new Error("document classifier self-test failed");
  const manifest = { entries: [] };
  pushEntry(manifest, null);
  if (manifest.entries.length !== 0) throw new Error("empty entry guard self-test failed");
  console.log("planning prefetch self-test passed");
}

main().catch(async (error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
