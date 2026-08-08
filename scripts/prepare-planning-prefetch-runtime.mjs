#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DRAWING_ROLES = new Set([
  'site-plan', 'location-plan', 'block-plan', 'masterplan', 'general-arrangement',
  'landscape-plan', 'access-plan', 'ride-layout', 'track-layout',
  'terrain-or-drainage', 'floor-plan', 'roof-plan', 'elevation', 'section', 'lighting-plan'
]);
const DRAWING_TEXT = /\b(site|block|location|master|landscape|planting|access|floor|roof|elevation|section|drainage|levels?|topograph(?:y|ical)?|ride|track|layout|general arrangement|ga|drawing|plan)\b/i;
const NON_DRAWING_TEXT = /\b(decision|officer report|committee report|application form|certificate|notice|consultation|representation|correspondence|email|fee|privacy)\b/i;

// Phase 26's planning-prefetch reader is intentionally an official-portal cache.
// Targeted ride recovery may enrich the persisted artifact with private-use,
// corroboration-only mirrors, but those support-host entries must not cross into
// the generator-facing prefetch manifest or the fail-closed loader will reject
// the complete artifact. Keep the runtime boundary explicit and narrow.
const OFFICIAL_PREFETCH_HOSTS = new Set([
  'publicaccess.staffsmoorlands.gov.uk',
  'www.staffsmoorlands.gov.uk'
]);

function argsOf(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--self-test') out.selfTest = true;
    else if (token.startsWith('--')) out[token.slice(2)] = argv[++i];
  }
  return out;
}

function canonicalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.hostname === 'publicaccess.staffsmoorlands.gov.uk') url.protocol = 'https:';
    const sorted = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
    url.search = '';
    for (const [key, val] of sorted) url.searchParams.append(key, val);
    return url.toString();
  } catch {
    return null;
  }
}

function runtimePrefetchUrl(value) {
  const canonical = canonicalUrl(value);
  if (!canonical) return null;
  try {
    return OFFICIAL_PREFETCH_HOSTS.has(new URL(canonical).hostname.toLowerCase()) ? canonical : null;
  } catch {
    return null;
  }
}

function documentKey(document) {
  return runtimePrefetchUrl(document?.url || document?.transportUrl || document?.finalUrl || '');
}

function entryScore(entry, root) {
  let score = 0;
  if (entry?.kind === 'document') score += 1000;
  else if (entry?.kind === 'application-page') score += 500;
  else if (entry?.kind === 'search-page') score += 100;
  if (entry?.applicationReference) score += 80;
  if (entry?.sha256) score += 20;
  if (entry?.bytes > 0) score += 10;
  if (entry?.file && existsSync(path.join(root, entry.file))) score += 200;
  return score;
}

function dedupeDocuments(documents) {
  const map = new Map();
  for (const document of documents || []) {
    const key = documentKey(document);
    if (!key) continue;
    const candidate = { ...document, url: key };
    const current = map.get(key);
    if (!current || Number(candidate.score || 0) > Number(current.score || 0) || Number(candidate.bytes || 0) > Number(current.bytes || 0)) {
      map.set(key, candidate);
    }
  }
  return [...map.values()];
}

function isDrawingDocument(document) {
  if (!document || document.rejected === true) return false;
  const role = String(document.role || '').trim().toLowerCase();
  if (DRAWING_ROLES.has(role)) return true;
  if (['document', 'decision-notice', 'officer-report', 'committee-report'].includes(role)) return false;
  const text = `${document.text || ''} ${document.title || ''} ${document.name || ''} ${document.url || ''}`;
  return DRAWING_TEXT.test(text) && !NON_DRAWING_TEXT.test(text);
}

async function prepare(input, output) {
  const inputRoot = path.resolve(input);
  const outputRoot = path.resolve(output);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const manifestPath = path.join(inputRoot, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    const fallback = {
      schemaVersion: 1,
      status: 'disabled',
      generatedAt: new Date().toISOString(),
      runner: 'runtime-normalizer-no-planning',
      tlsVerification: null,
      liveApplications: 0,
      documentsDownloaded: 0,
      totalBytes: 0,
      applications: [],
      entries: [],
      attempts: [],
      warnings: [`Planning runtime manifest was unavailable: ${error.message}`]
    };
    await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify(fallback, null, 2) + '\n');
    const report = {
      schemaVersion: 1,
      status: 'not-ready',
      reason: `manifest-unreadable: ${error.message}`,
      applications: 0,
      documents: 0,
      duplicateEntriesRemoved: 0,
      invalidEntriesRemoved: 0,
      nonOfficialEntriesRemoved: 0,
      applicationsOutsideOfficialHostsRemoved: 0,
      applicationsWithoutDrawingsRemoved: 0
    };
    await writeFile(path.join(outputRoot, 'runtime-report.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  }

  await cp(inputRoot, outputRoot, { recursive: true });

  let duplicateEntriesRemoved = 0;
  let invalidEntriesRemoved = 0;
  let nonOfficialEntriesRemoved = 0;
  let applicationsOutsideOfficialHostsRemoved = 0;
  let applicationsWithoutDrawingsRemoved = 0;
  const candidates = [];
  for (const raw of Array.isArray(manifest.entries) ? manifest.entries : []) {
    const rawUrl = canonicalUrl(raw?.url || raw?.finalUrl || raw?.transportUrl || '');
    if (!rawUrl) {
      invalidEntriesRemoved += 1;
      continue;
    }
    const key = runtimePrefetchUrl(rawUrl);
    if (!key) {
      nonOfficialEntriesRemoved += 1;
      continue;
    }
    const candidate = { ...raw, url: key };
    if (candidate.finalUrl) {
      const finalUrl = runtimePrefetchUrl(candidate.finalUrl);
      if (!finalUrl) {
        nonOfficialEntriesRemoved += 1;
        continue;
      }
      candidate.finalUrl = finalUrl;
    }
    if (candidate.transportUrl) {
      const transportUrl = runtimePrefetchUrl(candidate.transportUrl);
      if (!transportUrl) {
        nonOfficialEntriesRemoved += 1;
        continue;
      }
      candidate.transportUrl = transportUrl;
    }
    candidates.push(candidate);
  }
  candidates.sort((a, b) => entryScore(b, inputRoot) - entryScore(a, inputRoot));

  const usedAliases = new Set();
  const entries = [];
  for (const candidate of candidates) {
    const aliases = [...new Set(
      [candidate.url, candidate.finalUrl, candidate.transportUrl]
        .map(runtimePrefetchUrl)
        .filter(Boolean)
    )];
    if (aliases.some((alias) => usedAliases.has(alias))) {
      duplicateEntriesRemoved += 1;
      continue;
    }
    entries.push(candidate);
    for (const alias of aliases) usedAliases.add(alias);
  }

  const documentEntries = new Map(
    entries
      .filter((entry) => entry.kind === 'document' && entry.file && existsSync(path.join(inputRoot, entry.file)))
      .map((entry) => [runtimePrefetchUrl(entry.url), entry])
  );

  const applications = [];
  let linkedDocuments = 0;
  for (const raw of Array.isArray(manifest.applications) ? manifest.applications : []) {
    if (!raw || raw.failure) continue;
    const reference = raw.reference || null;
    const rawAppUrl = canonicalUrl(raw.url || raw.transportUrl || raw.applicationUrl || '');
    if (!rawAppUrl) continue;
    const appUrl = runtimePrefetchUrl(rawAppUrl);
    if (!appUrl) {
      applicationsOutsideOfficialHostsRemoved += 1;
      continue;
    }
    const documents = dedupeDocuments([...(raw.documents || []), ...(raw.downloadedDocuments || [])]);
    const linked = documents.filter((document) => {
      const entry = documentEntries.get(documentKey(document));
      if (!entry) return false;
      return !entry.applicationReference || !reference || entry.applicationReference === reference;
    });
    if (!linked.length) continue;
    const linkedDrawings = linked.filter(isDrawingDocument);
    if (!linkedDrawings.length) {
      applicationsWithoutDrawingsRemoved += 1;
      continue;
    }
    linkedDocuments += linked.length;
    applications.push({
      ...raw,
      url: appUrl,
      documents: dedupeDocuments(raw.documents || []).filter((document) => linked.some((item) => documentKey(item) === documentKey(document))),
      downloadedDocuments: dedupeDocuments(raw.downloadedDocuments || []).filter((document) => linked.some((item) => documentKey(item) === documentKey(document)))
    });
  }

  const ready = manifest.status === 'usable' && applications.length > 0 && linkedDocuments > 0;
  const sanitized = {
    ...manifest,
    status: ready ? 'usable' : 'disabled',
    liveApplications: ready ? applications.length : 0,
    documentsDownloaded: ready ? linkedDocuments : 0,
    applications: ready ? applications : [],
    entries,
    applicationSelection: {
      ...(manifest.applicationSelection || {}),
      policy: 'drawing-bearing-only',
      maxApplications: Number.isFinite(Number(manifest?.applicationSelection?.maxApplications))
        ? Number(manifest.applicationSelection.maxApplications)
        : null,
      retainedApplications: ready ? applications.length : 0,
      runtimeApplicationsWithoutDownloadedDrawingsRemoved: applicationsWithoutDrawingsRemoved,
      runtimeApplicationsOutsideOfficialHostsRemoved: applicationsOutsideOfficialHostsRemoved
    },
    warnings: [
      ...(Array.isArray(manifest.warnings) ? manifest.warnings : []),
      ...(duplicateEntriesRemoved ? [`Runtime normalization removed ${duplicateEntriesRemoved} duplicate canonical prefetch entr${duplicateEntriesRemoved === 1 ? 'y' : 'ies'}.`] : []),
      ...(invalidEntriesRemoved ? [`Runtime normalization removed ${invalidEntriesRemoved} invalid prefetch entr${invalidEntriesRemoved === 1 ? 'y' : 'ies'}.`] : []),
      ...(nonOfficialEntriesRemoved ? [`Runtime normalization withheld ${nonOfficialEntriesRemoved} non-official prefetch entr${nonOfficialEntriesRemoved === 1 ? 'y' : 'ies'} from the Phase 26 official-portal runtime cache.`] : []),
      ...(applicationsOutsideOfficialHostsRemoved ? [`Runtime normalization withheld ${applicationsOutsideOfficialHostsRemoved} recovery-only application${applicationsOutsideOfficialHostsRemoved === 1 ? '' : 's'} outside the official planning hosts from Phase 26 runtime ingestion.`] : []),
      ...(applicationsWithoutDrawingsRemoved ? [`Runtime normalization removed ${applicationsWithoutDrawingsRemoved} application${applicationsWithoutDrawingsRemoved === 1 ? '' : 's'} without a downloaded drawing.`] : []),
      ...(!ready ? ['Prefetch was not bridge-ready after runtime normalization; planning ingestion must remain disabled for this build.'] : [])
    ]
  };

  await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify(sanitized, null, 2) + '\n');
  const report = {
    schemaVersion: 1,
    status: ready ? 'ready' : 'not-ready',
    sourceStatus: manifest.status || 'unknown',
    applications: applications.length,
    documents: linkedDocuments,
    entries: entries.length,
    duplicateEntriesRemoved,
    invalidEntriesRemoved,
    nonOfficialEntriesRemoved,
    applicationsOutsideOfficialHostsRemoved,
    applicationsWithoutDrawingsRemoved
  };
  await writeFile(path.join(outputRoot, 'runtime-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

async function selfTest() {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'planning-runtime-'));
  const input = path.join(root, 'input');
  const output = path.join(root, 'output');
  await mkdir(path.join(input, 'files'), { recursive: true });
  await writeFile(path.join(input, 'files', 'app.html'), '<html></html>');
  await writeFile(path.join(input, 'files', 'plan.pdf'), '%PDF-1.4\n%%EOF');
  await writeFile(path.join(input, 'files', 'decision.pdf'), '%PDF-1.4\n%%EOF');
  await writeFile(path.join(input, 'files', 'mirror.jpg'), '0123456789abcdef');
  const app = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet?PKID=123';
  const appTextOnly = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet?PKID=124';
  const doc = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/AttachmentShowServlet?ImageName=plan.pdf';
  const decision = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/AttachmentShowServlet?ImageName=decision.pdf';
  const supportPage = 'https://www.towerstimes.co.uk/history/the-drawing-board/th13teen/';
  const supportDoc = 'https://www.towerstimes.co.uk/wp-content/uploads/2022/02/thirteenproposedplan-250x166.jpg';
  await writeFile(path.join(input, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    status: 'usable',
    liveApplications: 3,
    documentsDownloaded: 4,
    applications: [
      {
        reference: 'SMD/TEST',
        url: app,
        documents: [
          { url: doc, role: 'site-plan' },
          { url: supportDoc, role: 'ride-layout', sourceAuthority: 'corroboration-only' }
        ],
        downloadedDocuments: [
          { url: doc, role: 'site-plan', bytes: 14 },
          { url: supportDoc, role: 'ride-layout', bytes: 16, sourceAuthority: 'corroboration-only' }
        ]
      },
      {
        reference: 'SMD/TEXT',
        url: appTextOnly,
        documents: [{ url: decision, role: 'decision-notice' }],
        downloadedDocuments: [{ url: decision, role: 'decision-notice', bytes: 14 }]
      },
      {
        reference: 'RECOVERED/TH13TEEN',
        url: supportPage,
        recoveryOnlyApplication: true,
        documents: [{ url: supportDoc, role: 'ride-layout', sourceAuthority: 'corroboration-only' }],
        downloadedDocuments: [{ url: supportDoc, role: 'ride-layout', bytes: 16, sourceAuthority: 'corroboration-only' }]
      }
    ],
    entries: [
      { url: 'http://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet', file: 'files/app.html', kind: 'search-page' },
      { url: 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet', file: 'files/app.html', kind: 'search-page' },
      { url: app, file: 'files/app.html', kind: 'application-page', applicationReference: 'SMD/TEST' },
      { url: appTextOnly, file: 'files/app.html', kind: 'application-page', applicationReference: 'SMD/TEXT' },
      { url: doc, file: 'files/plan.pdf', kind: 'document', applicationReference: 'SMD/TEST', bytes: 14 },
      { url: decision, file: 'files/decision.pdf', kind: 'document', applicationReference: 'SMD/TEXT', bytes: 14 },
      { url: supportPage, file: 'files/app.html', kind: 'application-page', applicationReference: 'RECOVERED/TH13TEEN' },
      { url: supportDoc, file: 'files/mirror.jpg', kind: 'document', applicationReference: 'RECOVERED/TH13TEEN', bytes: 16, sourceAuthority: 'corroboration-only' }
    ]
  }, null, 2));
  const report = await prepare(input, output);
  if (
    report.status !== 'ready' ||
    report.applications !== 1 ||
    report.documents !== 1 ||
    report.duplicateEntriesRemoved !== 1 ||
    report.nonOfficialEntriesRemoved !== 2 ||
    report.applicationsOutsideOfficialHostsRemoved !== 1 ||
    report.applicationsWithoutDrawingsRemoved !== 1
  ) {
    throw new Error(`self-test failed: ${JSON.stringify(report)}`);
  }
  const sanitized = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  if (sanitized.applicationSelection?.policy !== 'drawing-bearing-only' || sanitized.applicationSelection?.maxApplications !== null) {
    throw new Error('drawing-bearing runtime selection self-test failed');
  }
  const runtimeUrls = [
    ...(sanitized.entries || []).flatMap((entry) => [entry.url, entry.finalUrl, entry.transportUrl]),
    ...(sanitized.applications || []).flatMap((application) => [
      application.url,
      application.transportUrl,
      application.applicationUrl,
      ...(application.documents || []).flatMap((document) => [document.url, document.transportUrl, document.finalUrl]),
      ...(application.downloadedDocuments || []).flatMap((document) => [document.url, document.transportUrl, document.finalUrl])
    ])
  ].filter(Boolean);
  if (runtimeUrls.some((value) => !runtimePrefetchUrl(value))) {
    throw new Error(`non-official URL escaped runtime normalization: ${JSON.stringify(runtimeUrls)}`);
  }
  if (JSON.stringify(sanitized).includes('thirteenproposedplan-250x166.jpg')) {
    throw new Error('support-host recovery document escaped the official prefetch runtime boundary');
  }
  console.log('planning runtime prefetch normalization self-test passed');
}

const args = argsOf(process.argv);
if (args.selfTest) await selfTest();
else {
  if (!args.input || !args.output) {
    throw new Error('Usage: prepare-planning-prefetch-runtime.mjs --input <dir> --output <dir>');
  }
  const report = await prepare(args.input, args.output);
  console.log(JSON.stringify(report));
  process.exitCode = report.status === 'ready' ? 0 : 3;
}
