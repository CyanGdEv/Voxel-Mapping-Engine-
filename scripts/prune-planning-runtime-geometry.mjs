#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { readFile, rm, writeFile } from 'node:fs/promises';

const DRAWING_ROLES = new Set([
  'site-plan', 'location-plan', 'block-plan', 'masterplan', 'general-arrangement',
  'landscape-plan', 'access-plan', 'ride-layout', 'track-layout',
  'terrain-or-drainage', 'floor-plan', 'roof-plan', 'elevation', 'section', 'lighting-plan'
]);

const NON_GEOMETRY_ROLES = new Set([
  'document', 'decision-notice', 'officer-report', 'committee-report',
  'application-form', 'consultation', 'correspondence'
]);

const DRAWING_TEXT = /\b(site|block|location|master|landscape|planting|access|floor|roof|elevation|section|drainage|levels?|topograph(?:y|ical)?|ride|track|layout|general arrangement|ga|drawing|plan)\b/i;

// Narrative/report documents can be accidentally assigned geometry-looking
// roles by title classifiers (for example "Design and Access Statement" as
// access-plan). Keep those documents in the durable evidence cache, but never
// feed them into expensive vector/raster geometry extraction.
const NARRATIVE_TEXT = /\b(?:design\s*(?:and|&)\s*access\s*statement|design[_\s-]*access[_\s-]*statement|planning\s*statement|supporting\s*statement|method\s*statement|drainage\s*statement|flood\s*risk\s*assessment|landscape\s*(?:and|&)\s*visual\s*impact\s*assessment|visual\s*impact\s*assessment|environmental\s*(?:impact\s*)?(?:statement|assessment|information)|heritage\s*(?:statement|assessment)|ecolog(?:y|ical)\s*(?:report|assessment)|arboricultural\s*(?:report|assessment)|transport\s*(?:statement|assessment)|noise\s*assessment|statement|report|assessment|appraisal|addendum)\b/i;

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) await selfTest();
else await selectRuntimeGeometry(options.directory);

function parseArgs(argv) {
  const options = { directory: 'planning-prefetch-selected', selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--self-test') options.selfTest = true;
    else if (token === '--directory') options.directory = argv[++index];
    else throw new Error(`Unknown option ${token}`);
  }
  return options;
}

export function isGeometryDrawingDocument(document) {
  if (!document || document.rejected === true) return false;
  const role = String(document.role || '').trim().toLowerCase();
  const text = documentText(document);
  if (NARRATIVE_TEXT.test(text)) return false;
  if (NON_GEOMETRY_ROLES.has(role)) return false;
  if (DRAWING_ROLES.has(role)) return true;
  return DRAWING_TEXT.test(text);
}

async function selectRuntimeGeometry(directory) {
  const root = path.resolve(directory);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.status !== 'usable') {
    const report = { schemaVersion: 1, status: 'not-usable', applications: 0, documents: 0, documentsWithheld: 0, narrativeDocumentsWithheld: 0 };
    await writeFile(path.join(root, 'runtime-geometry-selection.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
    return report;
  }

  const applications = [];
  const retainedDocumentKeys = new Set();
  const retainedDocumentUrls = new Set();
  let inputDocuments = 0;
  let narrativeDocumentsWithheld = 0;
  let nonGeometryDocumentsWithheld = 0;
  let applicationsWithoutGeometry = 0;

  for (const application of Array.isArray(manifest.applications) ? manifest.applications : []) {
    const downloaded = Array.isArray(application?.downloadedDocuments) ? application.downloadedDocuments : [];
    inputDocuments += downloaded.length;
    const retainedDownloaded = [];
    for (const document of downloaded) {
      if (isGeometryDrawingDocument(document)) {
        retainedDownloaded.push(document);
        addDocumentIdentity(document, retainedDocumentKeys, retainedDocumentUrls);
      } else {
        if (NARRATIVE_TEXT.test(documentText(document))) narrativeDocumentsWithheld += 1;
        else nonGeometryDocumentsWithheld += 1;
      }
    }
    if (!retainedDownloaded.length) {
      applicationsWithoutGeometry += 1;
      continue;
    }

    const allowedUrls = new Set(retainedDownloaded.flatMap(documentUrls));
    const documents = (Array.isArray(application?.documents) ? application.documents : []).filter((document) => {
      if (!isGeometryDrawingDocument(document)) return false;
      const urls = documentUrls(document);
      return !urls.length || urls.some((url) => allowedUrls.has(url));
    });
    applications.push({ ...application, documents, downloadedDocuments: retainedDownloaded });
  }

  const originalEntries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const entries = originalEntries.filter((entry) => {
    if (entry?.kind !== 'document') return true;
    const sha = normalizedSha(entry?.sha256);
    if (sha && retainedDocumentKeys.has(sha)) return true;
    return documentUrls(entry).some((url) => retainedDocumentUrls.has(url));
  });

  const retainedFiles = new Set(entries.map((entry) => entry?.file).filter(Boolean));
  for (const entry of originalEntries) {
    if (entry?.kind !== 'document' || !entry?.file || retainedFiles.has(entry.file)) continue;
    await removeInside(root, entry.file);
  }

  const documentsDownloaded = applications.reduce((sum, application) => sum + application.downloadedDocuments.length, 0);
  const totalBytes = entries
    .filter((entry) => entry?.kind === 'document')
    .reduce((sum, entry) => sum + positiveNumber(entry?.bytes), 0);
  const status = applications.length > 0 && documentsDownloaded > 0 ? 'usable' : 'disabled';
  const report = {
    schemaVersion: 1,
    status,
    policy: 'geometry-drawings-runtime-v2',
    inputApplications: Array.isArray(manifest.applications) ? manifest.applications.length : 0,
    applications: applications.length,
    inputDocuments,
    documents: documentsDownloaded,
    documentsWithheld: Math.max(0, inputDocuments - documentsDownloaded),
    narrativeDocumentsWithheld,
    nonGeometryDocumentsWithheld,
    applicationsWithoutGeometry,
    totalBytes
  };

  const updated = {
    ...manifest,
    status,
    liveApplications: status === 'usable' ? applications.length : 0,
    documentsDownloaded: status === 'usable' ? documentsDownloaded : 0,
    totalBytes: status === 'usable' ? totalBytes : 0,
    applications: status === 'usable' ? applications : [],
    entries,
    applicationSelection: {
      ...(manifest.applicationSelection || {}),
      runtimeGeometryPolicy: report.policy,
      runtimeInputDocuments: inputDocuments,
      runtimeGeometryDocuments: documentsDownloaded,
      runtimeDocumentsWithheld: report.documentsWithheld,
      runtimeNarrativeDocumentsWithheld: narrativeDocumentsWithheld,
      runtimeApplicationsWithoutGeometryRemoved: applicationsWithoutGeometry
    },
    warnings: [
      ...(Array.isArray(manifest.warnings) ? manifest.warnings : []),
      ...(report.documentsWithheld ? [`Runtime geometry selection withheld ${report.documentsWithheld} non-drawing planning document${report.documentsWithheld === 1 ? '' : 's'} from vector/raster extraction; durable planning evidence remains unchanged.`] : [])
    ]
  };

  await writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
  await writeFile(path.join(root, 'runtime-geometry-selection.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  return report;
}

function documentText(document) {
  return `${document?.text || ''} ${document?.title || ''} ${document?.name || ''}`.replace(/[_-]+/g, ' ');
}

function addDocumentIdentity(document, keys, urls) {
  const sha = normalizedSha(document?.sha256);
  if (sha) keys.add(sha);
  for (const url of documentUrls(document)) urls.add(url);
}

function normalizedSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(sha) ? sha : null;
}

function documentUrls(document) {
  return [...new Set([document?.url, document?.finalUrl, document?.transportUrl].map(canonicalDocumentUrl).filter(Boolean))];
}

function canonicalDocumentUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    const params = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
    url.search = '';
    for (const [key, val] of params) url.searchParams.append(key, val);
    return url.toString();
  } catch {
    return null;
  }
}

async function removeInside(root, relative) {
  const absolute = path.resolve(root, relative);
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) throw new Error(`refusing to remove planning runtime file outside selected directory: ${relative}`);
  await rm(absolute, { force: true });
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

async function selfTest() {
  const { mkdtemp, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-planning-runtime-geometry-'));
  try {
    await mkdir(path.join(root, 'files'), { recursive: true });
    const examples = [
      ['site-plan', '373-95-7B Site Plan Proposed showing Woodland path', true],
      ['access-plan', 'Proposed Access Plan', true],
      ['general-arrangement', 'General Arrangement Plan', true],
      ['ride-layout', 'SW8 Ride Layout Drawing', true],
      ['access-plan', 'Design Access Statement_Feb 18_ Part 1 of 2', false],
      ['ride-layout', 'Landscape and Visual Impact Assessment - New Ride Part 1', false],
      ['terrain-or-drainage', '7271-FRA_DRAINAGE STATEMENT - REV P10', false],
      ['floor-plan', 'Roof Weights and Environmental Information', false],
      ['decision-notice', 'Decision notice', false]
    ];
    for (const [role, text, expected] of examples) {
      if (isGeometryDrawingDocument({ role, text }) !== expected) throw new Error(`geometry policy self-test failed role=${role} text=${text}`);
    }

    const planSha = 'a'.repeat(64), statementSha = 'b'.repeat(64), decisionSha = 'c'.repeat(64);
    for (const name of ['plan.pdf', 'statement.pdf', 'decision.pdf']) await writeFile(path.join(root, 'files', name), '%PDF-1.4\n%%EOF');
    const planUrl = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/AttachmentShowServlet?ImageName=1';
    const statementUrl = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/AttachmentShowServlet?ImageName=2';
    const decisionUrl = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/AttachmentShowServlet?ImageName=3';
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      status: 'usable',
      liveApplications: 1,
      documentsDownloaded: 3,
      totalBytes: 30,
      applications: [{
        reference: 'SMD/TEST',
        documents: [
          { role: 'site-plan', text: 'Proposed Site Plan', url: planUrl },
          { role: 'access-plan', text: 'Design and Access Statement', url: statementUrl },
          { role: 'decision-notice', text: 'Decision notice', url: decisionUrl }
        ],
        downloadedDocuments: [
          { role: 'site-plan', text: 'Proposed Site Plan', url: planUrl, sha256: planSha },
          { role: 'access-plan', text: 'Design and Access Statement', url: statementUrl, sha256: statementSha },
          { role: 'decision-notice', text: 'Decision notice', url: decisionUrl, sha256: decisionSha }
        ]
      }],
      entries: [
        { kind: 'document', file: 'files/plan.pdf', url: planUrl, sha256: planSha, bytes: 10 },
        { kind: 'document', file: 'files/statement.pdf', url: statementUrl, sha256: statementSha, bytes: 10 },
        { kind: 'document', file: 'files/decision.pdf', url: decisionUrl, sha256: decisionSha, bytes: 10 }
      ]
    }));
    const report = await selectRuntimeGeometry(root);
    if (report.documents !== 1 || report.narrativeDocumentsWithheld !== 1 || report.nonGeometryDocumentsWithheld !== 1) throw new Error(`runtime selection accounting failed: ${JSON.stringify(report)}`);
    const selected = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    if (selected.documentsDownloaded !== 1 || selected.entries.filter((entry) => entry.kind === 'document').length !== 1) throw new Error('runtime selection manifest pruning failed');
    console.log('planning runtime geometry selector self-test passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
