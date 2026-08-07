#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";

const OFFICIAL_HOST = "publicaccess.staffsmoorlands.gov.uk";
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const GEOMETRY_NOISE = /\b(assessment|statement|report|heritage|archaeolog|ecolog|noise|transport|visual impact|lvia|environmental|design and access|supporting|covering letter|consultation|representation|application form|certificate|fee|privacy|photograph|photo|appendix)\b/i;
const HARD_REJECT = /\b(refused drawing|superseded|obsolete|withdrawn)\b/i;

function parseArgs(argv) {
  const out = {
    directory: null,
    selfTest: false,
    dryRun: false,
    maxDocuments: 1200,
    maxBytes: 150 * 1024 * 1024,
    reserveBytes: 24 * 1024 * 1024,
    maxAdditional: 80,
    perApplication: 8
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--self-test") out.selfTest = true;
    else if (key === "--dry-run") out.dryRun = true;
    else if (key === "--directory") out.directory = argv[++i];
    else if (key === "--max-documents") out.maxDocuments = bounded(argv[++i], 1, 2000);
    else if (key === "--max-mb") out.maxBytes = bounded(argv[++i], 1, 250) * 1024 * 1024;
    else if (key === "--reserve-mb") out.reserveBytes = bounded(argv[++i], 0, 100) * 1024 * 1024;
    else if (key === "--max-additional") out.maxAdditional = bounded(argv[++i], 0, 500);
    else if (key === "--per-application") out.perApplication = bounded(argv[++i], 1, 24);
    else throw new Error(`Unknown option ${key}`);
  }
  return out;
}

const options = parseArgs(process.argv);
if (options.selfTest) {
  await selfTest();
} else {
  if (!options.directory) throw new Error("Usage: refine-planning-prefetch-geometry.mjs --directory <planning-prefetch> [options]");
  await refine(path.resolve(options.directory), options);
}

async function refine(directory, config) {
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.status !== "usable") {
    console.log(JSON.stringify({ status: "skipped", reason: `manifest-${manifest.status || "unknown"}` }));
    return;
  }

  manifest.entries ||= [];
  manifest.applications ||= [];
  const report = {
    schemaVersion: 1,
    status: "complete",
    strategy: "geometry-first-balanced-refinement",
    applicationsInspected: 0,
    candidatesDiscovered: 0,
    candidatesSelected: 0,
    rolesCorrected: 0,
    lowValueDocumentsEvicted: 0,
    lowValueBytesEvicted: 0,
    additionalDocumentsDownloaded: 0,
    additionalBytesDownloaded: 0,
    downloadFailures: [],
    perApplication: [],
    warnings: []
  };

  // Correct known role inflation before deciding what to retain. A report containing
  // "new ride" must never become a ride-layout unless its title is actually a drawing.
  for (const application of manifest.applications) {
    for (const document of application.downloadedDocuments || []) {
      const classified = classifyDrawing(document.text || document.label || "");
      if (document.role !== classified.role) {
        document.role = classified.role;
        document.score = classified.score;
        document.state = classified.state;
        report.rolesCorrected += 1;
      }
    }
  }

  // Keep space for high-value geometry. Only evict obvious narrative/report material;
  // never evict an actual drawing, application page, or status evidence.
  const reserveTarget = Math.max(0, config.maxBytes - config.reserveBytes);
  let totalBytes = sumDownloadedBytes(manifest);
  if (totalBytes > reserveTarget) {
    const evictable = [];
    for (const application of manifest.applications) {
      for (const document of application.downloadedDocuments || []) {
        const classified = classifyDrawing(document.text || "");
        if (!classified.evictable) continue;
        evictable.push({ application, document, classified });
      }
    }
    evictable.sort((a, b) => a.classified.score - b.classified.score || b.document.bytes - a.document.bytes);
    for (const item of evictable) {
      if (totalBytes <= reserveTarget) break;
      const bytes = Number(item.document.bytes) || 0;
      removeDocumentFromManifest(manifest, item.application, item.document);
      totalBytes -= bytes;
      report.lowValueDocumentsEvicted += 1;
      report.lowValueBytesEvicted += bytes;
      if (!config.dryRun) await removeUnreferencedFile(directory, manifest, item.document.sha256);
    }
  }

  const downloadedUrls = new Set(
    manifest.applications.flatMap((application) => (application.downloadedDocuments || []).map((document) => canonicalUrl(document.url || document.transportUrl)))
  );

  const downloadPlans = [];
  for (const application of manifest.applications) {
    const pageEntry = bestApplicationPage(manifest.entries, application.reference);
    if (!pageEntry?.file) continue;
    let html;
    try {
      html = await readFile(path.join(directory, pageEntry.file), "utf8");
    } catch (error) {
      report.warnings.push(`${application.reference || "unknown"}: application page missing: ${error.message}`);
      continue;
    }
    report.applicationsInspected += 1;
    const candidates = extractGeometryCandidates(html);
    report.candidatesDiscovered += candidates.length;
    const selected = selectBalancedGeometry(candidates, config.perApplication);
    report.candidatesSelected += selected.length;
    const applicationReport = {
      reference: application.reference || null,
      discovered: candidates.length,
      selected: selected.map((candidate) => ({
        imageName: candidate.imageName,
        label: candidate.label,
        role: candidate.role,
        state: candidate.state,
        score: candidate.score,
        alreadyDownloaded: downloadedUrls.has(canonicalUrl(candidate.url))
      })),
      downloaded: 0,
      failures: []
    };

    for (const candidate of selected) {
      const existing = (application.downloadedDocuments || []).find((document) =>
        canonicalUrl(document.url || document.transportUrl) === canonicalUrl(candidate.url)
      );
      if (existing) {
        existing.text = candidate.label;
        existing.role = candidate.role;
        existing.state = candidate.state;
        existing.score = candidate.score;
      }
    }

    const missing = selected.filter((candidate) => !downloadedUrls.has(canonicalUrl(candidate.url)));
    downloadPlans.push({
      application,
      pageEntry,
      applicationReport,
      missing,
      cookies: new Map(),
      sessionReady: false
    });
    report.perApplication.push(applicationReport);
  }

  // Download in balanced rounds across applications. This is important for large parks:
  // one application with dozens of attachments must not consume the geometry budget
  // before other rides/areas receive their highest-value site/layout drawing.
  if (!config.dryRun && config.maxAdditional > 0) {
    for (let rank = 0; rank < config.perApplication; rank += 1) {
      for (const plan of downloadPlans) {
        const candidate = plan.missing[rank];
        if (!candidate) continue;
        if (report.additionalDocumentsDownloaded >= config.maxAdditional) break;
        if (Number(manifest.documentsDownloaded || 0) >= config.maxDocuments) break;
        if (totalBytes >= config.maxBytes) break;

        if (!plan.sessionReady) {
          plan.sessionReady = true;
          try {
            const transportApplicationUrl = toOfficialHttp(
              plan.application.transportUrl || plan.application.url ||
              plan.pageEntry.transportUrl || plan.pageEntry.url
            );
            await fetchOfficial(transportApplicationUrl, {
              cookies: plan.cookies,
              referer: "https://www.staffsmoorlands.gov.uk/article/568/Search-and-track-planning-applications",
              maxBytes: 5 * 1024 * 1024,
              accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"
            });
          } catch (error) {
            report.warnings.push(`${plan.application.reference || "unknown"}: session refresh failed: ${error.message}`);
          }
        }

        try {
          const remaining = Math.max(1, config.maxBytes - totalBytes);
          const fetched = await fetchOfficial(toOfficialHttp(candidate.url), {
            cookies: plan.cookies,
            referer: toOfficialHttp(
              plan.application.transportUrl || plan.application.url ||
              plan.pageEntry.transportUrl || plan.pageEntry.url
            ),
            maxBytes: Math.min(MAX_FILE_BYTES, remaining),
            accept: "application/pdf,image/png,image/jpeg,image/tiff;q=0.9,*/*;q=0.1"
          });
          const mime = sniff(fetched.data);
          if (!allowedMime(mime)) throw new Error(`unsupported MIME ${mime}`);
          const sha256 = hash(fetched.data);
          const relative = `files/${sha256}${extensionFor(mime)}`;
          await mkdir(path.join(directory, "files"), { recursive: true });
          await writeFile(path.join(directory, relative), fetched.data);
          const publicUrl = canonicalUrl(candidate.url);
          const transportUrl = toOfficialHttp(candidate.url);
          const entry = {
            url: publicUrl,
            finalUrl: publicUrl,
            transportUrl,
            file: relative,
            kind: "document",
            applicationReference: plan.application.reference || null,
            bytes: fetched.data.length,
            sha256,
            mime,
            transport: "node-http-phase30b-geometry-refiner",
            tlsVerification: "legacy-http-official-host"
          };
          if (!manifest.entries.some((existing) => canonicalUrl(existing.url || existing.transportUrl) === publicUrl)) {
            manifest.entries.push(entry);
          }
          plan.application.downloadedDocuments ||= [];
          plan.application.downloadedDocuments.push({
            url: publicUrl,
            transportUrl,
            role: candidate.role,
            state: candidate.state,
            text: candidate.label,
            score: candidate.score,
            bytes: fetched.data.length,
            sha256,
            mime
          });
          plan.application.documents ||= [];
          if (!plan.application.documents.some((existing) => canonicalUrl(existing.url || existing.transportUrl) === publicUrl)) {
            plan.application.documents.push({
              url: publicUrl,
              transportUrl,
              role: candidate.role,
              state: candidate.state,
              text: candidate.label,
              score: candidate.score,
              rejected: false
            });
          }
          downloadedUrls.add(publicUrl);
          totalBytes += fetched.data.length;
          manifest.documentsDownloaded = Number(manifest.documentsDownloaded || 0) + 1;
          manifest.totalBytes = totalBytes;
          report.additionalDocumentsDownloaded += 1;
          report.additionalBytesDownloaded += fetched.data.length;
          plan.applicationReport.downloaded += 1;
        } catch (error) {
          const failure = `${plan.application.reference || "unknown"} ${candidate.label}: ${error.message}`;
          report.downloadFailures.push(failure);
          plan.applicationReport.failures.push(failure);
        }
      }
      if (report.additionalDocumentsDownloaded >= config.maxAdditional ||
          Number(manifest.documentsDownloaded || 0) >= config.maxDocuments ||
          totalBytes >= config.maxBytes) break;
    }
  }

  manifest.totalBytes = sumDownloadedBytes(manifest);
  manifest.documentsDownloaded = manifest.applications.reduce((sum, application) => sum + (application.downloadedDocuments || []).length, 0);
  manifest.geometryRefinement = {
    schemaVersion: 1,
    status: "complete",
    strategy: report.strategy,
    candidatesDiscovered: report.candidatesDiscovered,
    candidatesSelected: report.candidatesSelected,
    rolesCorrected: report.rolesCorrected,
    lowValueDocumentsEvicted: report.lowValueDocumentsEvicted,
    additionalDocumentsDownloaded: report.additionalDocumentsDownloaded,
    additionalBytesDownloaded: report.additionalBytesDownloaded,
    report: "geometry-refinement.json"
  };
  if (!config.dryRun) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(path.join(directory, "geometry-refinement.json"), JSON.stringify(report, null, 2) + "\n");
  }

  console.log(JSON.stringify({
    status: report.status,
    applications: report.applicationsInspected,
    candidates: report.candidatesDiscovered,
    selected: report.candidatesSelected,
    rolesCorrected: report.rolesCorrected,
    evicted: report.lowValueDocumentsEvicted,
    downloaded: report.additionalDocumentsDownloaded,
    documentsNow: manifest.documentsDownloaded,
    bytesNow: manifest.totalBytes,
    dryRun: config.dryRun
  }));
}

function extractGeometryCandidates(html) {
  const result = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href\s*=\s*["']javascript:AppBlobImage\(\s*['"]?(\d+)['"]?\s*\);?["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const imageName = match[1];
    const label = stripHtml(match[2]);
    if (!imageName || !label || seen.has(imageName)) continue;
    seen.add(imageName);
    const classified = classifyDrawing(label);
    if (classified.score <= 0) continue;
    result.push({
      imageName,
      label,
      url: `https://${OFFICIAL_HOST}/portal/servlets/AttachmentShowServlet?ImageName=${encodeURIComponent(imageName)}`,
      ...classified
    });
  }
  return result.sort((a, b) => b.score - a.score || a.imageName.localeCompare(b.imageName));
}

function classifyDrawing(label) {
  const text = String(label || "").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const noise = GEOMETRY_NOISE.test(lower);
  if (!text || HARD_REJECT.test(lower)) return { role: "document", state: "unknown", score: -1000, evictable: true };

  let role = "document";
  let score = 0;

  const explicitDrawing = /\b(plan|layout|general arrangement|drawing|section|elevation)\b/i.test(text);
  const explicitRide = /\b(roller\s*coaster|rollercoaster|coaster|ride|track|sw8|wickerman|wicker man)\b/i.test(text);
  if (!noise && explicitRide && explicitDrawing) {
    role = "ride-layout";
    score = 460;
  } else if (/\b(path|access|circulation|pedestrian|footpath|route)\b/i.test(text) &&
      (explicitDrawing || /\bproposal(?:s)?\b/i.test(text)) && !noise) {
    role = "access-plan";
    score = 445;
  } else if (/\b(proposed\s+site\s+plan|site\s+plan\s+proposed)\b/i.test(text) && !noise) {
    role = "site-plan";
    score = 430;
  } else if (/\b(proposed\s+block\s+plan|block\s+plan\s+proposed)\b/i.test(text) && !noise) {
    role = "block-plan";
    score = 420;
  } else if (/\b(landscape|planting|woodland|tree)\b/i.test(text) && /\b(plan|layout)\b/i.test(text) && !noise) {
    role = "landscape-plan";
    score = 410;
  } else if (/\b(site\s+plan\s+setup|site\s+plan\s+setup\s+and\s+demolitions|demolition|site\s+set\s*up)\b/i.test(text) && !noise) {
    role = "site-plan";
    score = 390;
  } else if (/\b(existing\s+site\s+plan|site\s+plan\s+existing)\b/i.test(text) && !noise) {
    role = "site-plan";
    score = 380;
  } else if (/\b(existing\s+block\s+plan|block\s+plan\s+existing)\b/i.test(text) && !noise) {
    role = "block-plan";
    score = 370;
  } else if (/\b(topograph|levels?|groundworks?|drainage|earthworks?|contour)\b/i.test(text) && explicitDrawing && !noise) {
    role = "terrain-or-drainage";
    score = 360;
  } else if (/\bfloor\b/i.test(text) && /\bplan\b/i.test(text) && !noise) {
    role = "floor-plan";
    score = 345;
  } else if (/\broof\b/i.test(text) && /\bplan\b/i.test(text) && !noise) {
    role = "floor-plan";
    score = 335;
  } else if (/\bsection\b/i.test(text) && !noise) {
    role = "section";
    score = 325;
  } else if (/\belevation\b/i.test(text) && !noise) {
    role = "elevation";
    score = 315;
  } else if (/\blocation\s+plan\b/i.test(text) && !noise) {
    role = "location-plan";
    score = 250;
  } else if (/\bsite\s+plan\b/i.test(text) && !noise) {
    role = "site-plan";
    score = 300;
  } else if (/\bblock\s+plan\b/i.test(text) && !noise) {
    role = "block-plan";
    score = 290;
  } else if (explicitDrawing && !noise) {
    role = "document";
    score = 120;
  }

  if (noise) score = Math.min(score, -200);
  const state =
    /\bas[- ]?built|constructed|completed|current\b/i.test(text) ? "as-built" :
    /\bexisting\b/i.test(text) ? "existing" :
    /\bproposed\b/i.test(text) ? "proposed" :
    /\bapproved\b/i.test(text) ? "approved" :
    "unknown";

  return { role, state, score, evictable: noise || score <= 0 };
}

function selectBalancedGeometry(candidates, limit) {
  const selected = [];
  const seenRoleState = new Set();
  // First pass preserves geometry diversity: e.g. proposed+existing site plan,
  // ride layout, paths, landscape, levels and building drawings.
  for (const candidate of candidates) {
    const key = `${candidate.role}:${candidate.state}`;
    if (seenRoleState.has(key)) continue;
    selected.push(candidate);
    seenRoleState.add(key);
    if (selected.length >= limit) return selected;
  }
  for (const candidate of candidates) {
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function bestApplicationPage(entries, reference) {
  return entries.find((entry) => entry.kind === "application-page" && entry.applicationReference === reference) || null;
}

function removeDocumentFromManifest(manifest, application, document) {
  const targetUrl = canonicalUrl(document.url || document.transportUrl);
  application.downloadedDocuments = (application.downloadedDocuments || []).filter((item) =>
    canonicalUrl(item.url || item.transportUrl) !== targetUrl
  );
  application.documents = (application.documents || []).filter((item) =>
    canonicalUrl(item.url || item.transportUrl) !== targetUrl
  );
  manifest.entries = (manifest.entries || []).filter((entry) =>
    !(entry.kind === "document" && entry.applicationReference === application.reference &&
      canonicalUrl(entry.url || entry.transportUrl) === targetUrl)
  );
}

async function removeUnreferencedFile(directory, manifest, sha256) {
  if (!sha256) return;
  const stillReferenced = manifest.entries.some((entry) => entry.sha256 === sha256);
  if (stillReferenced) return;
  const files = [
    path.join(directory, "files", `${sha256}.pdf`),
    path.join(directory, "files", `${sha256}.png`),
    path.join(directory, "files", `${sha256}.jpg`),
    path.join(directory, "files", `${sha256}.tif`)
  ];
  for (const file of files) {
    try { await unlink(file); } catch {}
  }
}

function sumDownloadedBytes(manifest) {
  return manifest.applications.reduce((total, application) =>
    total + (application.downloadedDocuments || []).reduce((sum, document) => sum + (Number(document.bytes) || 0), 0), 0);
}

function fetchOfficial(value, options) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname.toLowerCase() !== OFFICIAL_HOST || (url.port && url.port !== "80")) {
    throw new Error(`URL outside exact official HTTP host: ${value}`);
  }
  return new Promise((resolve, reject) => {
    const headers = {
      Host: OFFICIAL_HOST,
      Accept: options.accept,
      "Accept-Language": "en-GB,en;q=0.9",
      "Cache-Control": "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    };
    if (options.referer) headers.Referer = options.referer;
    if (options.cookies?.size) headers.Cookie = [...options.cookies.entries()].map(([name, cookie]) => `${name}=${cookie}`).join("; ");
    const request = http.get({
      protocol: "http:",
      hostname: OFFICIAL_HOST,
      port: 80,
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: 45_000
    }, (response) => {
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
        if (index > 0 && options.cookies) options.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > options.maxBytes) request.destroy(new Error(`response exceeded ${options.maxBytes} bytes`));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ data: Buffer.concat(chunks) }));
    });
    request.on("timeout", () => request.destroy(new Error("HTTP request timed out")));
    request.on("error", reject);
  });
}

function toOfficialHttp(value) {
  const url = new URL(value);
  if (url.hostname.toLowerCase() !== OFFICIAL_HOST) throw new Error(`URL outside official host: ${value}`);
  url.protocol = "http:";
  url.port = "";
  return url.toString();
}

function canonicalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === OFFICIAL_HOST) {
      url.protocol = "https:";
      url.port = "";
    }
    url.hash = "";
    return url.toString();
  } catch {
    return String(value);
  }
}

function sniff(bytes) {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 4 && ((bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42 && bytes[3] === 0) ||
      (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && bytes[3] === 42))) return "image/tiff";
  return "application/octet-stream";
}
function allowedMime(mime) { return ["application/pdf", "image/png", "image/jpeg", "image/tiff"].includes(mime); }
function extensionFor(mime) { return mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : mime === "image/jpeg" ? ".jpg" : ".tif"; }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function stripHtml(value) { return String(value).replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim(); }
function bounded(value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`value must be between ${min} and ${max}`);
  return number;
}

async function selfTest() {
  const fixture = `
  <table>
    <tr><td><a href="javascript:AppBlobImage('1');">Existing Site Plan</a></td></tr>
    <tr><td><a href="javascript:AppBlobImage('2');">Proposed Site Plan</a></td></tr>
    <tr><td><a href="javascript:AppBlobImage('3');">Proposed Block Plan</a></td></tr>
    <tr><td><a href="javascript:AppBlobImage('4');">Landscape Site Plan</a></td></tr>
    <tr><td><a href="javascript:AppBlobImage('5');">Landscape and Visual Impact Assessment - New Ride Part 2</a></td></tr>
    <tr><td><a href="javascript:AppBlobImage('6');">SW8 path proposals</a></td></tr>
    <tr><td><a href="javascript:AppBlobImage('7');">New Rollercoaster Track Layout Plan</a></td></tr>
  </table>`;
  const candidates = extractGeometryCandidates(fixture);
  const labels = new Set(candidates.map((candidate) => candidate.label));
  for (const required of ["Existing Site Plan", "Proposed Site Plan", "Proposed Block Plan", "Landscape Site Plan", "SW8 path proposals", "New Rollercoaster Track Layout Plan"]) {
    if (!labels.has(required)) throw new Error(`self-test failed to retain ${required}`);
  }
  if (labels.has("Landscape and Visual Impact Assessment - New Ride Part 2")) {
    throw new Error("self-test misclassified narrative LVIA as geometry");
  }
  const ride = candidates.find((candidate) => candidate.label === "New Rollercoaster Track Layout Plan");
  if (ride?.role !== "ride-layout") throw new Error(`self-test expected ride-layout, got ${ride?.role}`);
  const pathCandidate = candidates.find((candidate) => candidate.label === "SW8 path proposals");
  if (!pathCandidate) {
    const classified = classifyDrawing("SW8 path proposals");
    if (classified.role !== "access-plan" || classified.score <= 0) {
      throw new Error(`self-test expected SW8 path proposals to classify as access-plan: ${JSON.stringify(classified)}`);
    }
  }
  const chosen = selectBalancedGeometry(candidates, 6);
  if (!chosen.some((candidate) => candidate.label === "Proposed Site Plan") ||
      !chosen.some((candidate) => candidate.label === "Existing Site Plan")) {
    throw new Error("self-test did not retain existing/proposed site-plan pair");
  }
  console.log("Phase 30B geometry-first planning refinement self-test passed");
}
