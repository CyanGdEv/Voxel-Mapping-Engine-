#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

function documentKey(document) {
  return canonicalUrl(document?.url || document?.transportUrl || document?.finalUrl || '');
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
      invalidEntriesRemoved: 0
    };
    await writeFile(path.join(outputRoot, 'runtime-report.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  }

  await cp(inputRoot, outputRoot, { recursive: true });

  const entryMap = new Map();
  let duplicateEntriesRemoved = 0;
  let invalidEntriesRemoved = 0;
  for (const raw of Array.isArray(manifest.entries) ? manifest.entries : []) {
    const key = canonicalUrl(raw?.url || raw?.finalUrl || raw?.transportUrl || '');
    if (!key) {
      invalidEntriesRemoved += 1;
      continue;
    }
    const candidate = { ...raw, url: key };
    if (candidate.finalUrl) candidate.finalUrl = canonicalUrl(candidate.finalUrl) || candidate.finalUrl;
    const current = entryMap.get(key);
    if (!current) entryMap.set(key, candidate);
    else {
      duplicateEntriesRemoved += 1;
      if (entryScore(candidate, inputRoot) > entryScore(current, inputRoot)) entryMap.set(key, candidate);
    }
  }

  const entries = [...entryMap.values()];
  const documentEntries = new Map(
    entries
      .filter((entry) => entry.kind === 'document' && entry.file && existsSync(path.join(inputRoot, entry.file)))
      .map((entry) => [canonicalUrl(entry.url), entry])
  );

  const applications = [];
  let linkedDocuments = 0;
  for (const raw of Array.isArray(manifest.applications) ? manifest.applications : []) {
    if (!raw || raw.failure) continue;
    const reference = raw.reference || null;
    const appUrl = canonicalUrl(raw.url || raw.transportUrl || raw.applicationUrl || '');
    if (!appUrl) continue;
    const documents = dedupeDocuments([...(raw.documents || []), ...(raw.downloadedDocuments || [])]);
    const linked = documents.filter((document) => {
      const entry = documentEntries.get(documentKey(document));
      if (!entry) return false;
      return !entry.applicationReference || !reference || entry.applicationReference === reference;
    });
    if (!linked.length) continue;
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
    warnings: [
      ...(Array.isArray(manifest.warnings) ? manifest.warnings : []),
      ...(duplicateEntriesRemoved ? [`Runtime normalization removed ${duplicateEntriesRemoved} duplicate canonical prefetch entr${duplicateEntriesRemoved === 1 ? 'y' : 'ies'}.`] : []),
      ...(invalidEntriesRemoved ? [`Runtime normalization removed ${invalidEntriesRemoved} invalid prefetch entr${invalidEntriesRemoved === 1 ? 'y' : 'ies'}.`] : []),
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
    invalidEntriesRemoved
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
  const app = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet?PKID=123';
  const doc = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/AttachmentShowServlet?ImageName=plan.pdf';
  await writeFile(path.join(input, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    status: 'usable',
    liveApplications: 1,
    documentsDownloaded: 1,
    applications: [{
      reference: 'SMD/TEST',
      url: app,
      documents: [{ url: doc }],
      downloadedDocuments: [{ url: doc, bytes: 14 }]
    }],
    entries: [
      { url: 'http://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet', file: 'files/app.html', kind: 'search-page' },
      { url: 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet', file: 'files/app.html', kind: 'search-page' },
      { url: app, file: 'files/app.html', kind: 'application-page', applicationReference: 'SMD/TEST' },
      { url: doc, file: 'files/plan.pdf', kind: 'document', applicationReference: 'SMD/TEST', bytes: 14 }
    ]
  }, null, 2));
  const report = await prepare(input, output);
  if (report.status !== 'ready' || report.applications !== 1 || report.documents < 1 || report.duplicateEntriesRemoved !== 1) {
    throw new Error(`self-test failed: ${JSON.stringify(report)}`);
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
