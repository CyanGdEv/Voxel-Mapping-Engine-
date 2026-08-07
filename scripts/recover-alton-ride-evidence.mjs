#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export const ALTON_RIDE_EVIDENCE_RECOVERY_POLICY = 'alton-ride-evidence-recovery-v1';

const OFFICIAL_HOSTS = new Set([
  'publicaccess.staffsmoorlands.gov.uk',
  'www.staffsmoorlands.gov.uk'
]);
const SUPPORT_HOSTS = new Set([
  'towerstimes.co.uk',
  'www.towerstimes.co.uk',
  'themeparkguide.co.uk',
  'www.themeparkguide.co.uk'
]);
const ARCHIVE_HOST = 'web.archive.org';
const MAJOR_INDEX = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/MajorContentiousDevelopmentservlet';
const NEMESIS_OFFICIAL = 'https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet?PKID=157904';
const MEDIA_EXT = /\.(?:pdf|png|jpe?g|tiff?)(?:$|[?#])/i;
const REJECT_MEDIA = /(?:logo|favicon|icon|avatar|emoji|sprite|spinner|placeholder|advert|banner|facebook|twitter|instagram|youtube|tiktok|cookie|consent|analytics)/i;
const DRAWING_TEXT = /\b(?:site|block|location|master|landscape|planting|access|floor|roof|elevation|section|drainage|levels?|topograph(?:y|ical)?|ride|track|layout|general arrangement|ga|drawing|plan|support|foundation|retaining|tunnel)\b/i;
const REFERENCE = /\bSMD\/\d{4}\/\d{3,4}\b/i;
const MAX_PER_SOURCE = 28;
const MIN_MEDIA_BYTES = 10_000;

const RIDES = [
  {
    id: 'th13teen',
    displayName: 'TH13TEEN',
    aliases: ['th13teen', 'thirteen', 'sw6', 'corkscrew replacement'],
    proposalMatcher: /replacement rollercoaster|replacement roller coaster|station buildings.*landscap/i,
    preferredRole: 'ride-layout',
    sourcePages: [
      { url: 'https://www.towerstimes.co.uk/history/the-drawing-board/th13teen/', sourceClass: 'historical-plan-mirror', role: 'ride-layout' }
    ]
  },
  {
    id: 'the-smiler',
    displayName: 'The Smiler',
    aliases: ['the smiler', 'smiler', 'sw7'],
    officialReference: 'SMD/2011/1051',
    proposalMatcher: /installation of new rollercoaster|installation of new roller coaster/i,
    preferredRole: 'ride-layout',
    sourcePages: [
      { url: 'https://www.towerstimes.co.uk/history/the-drawing-board/the-smiler/', sourceClass: 'historical-plan-mirror', role: 'ride-layout' }
    ]
  },
  {
    id: 'nemesis-reborn',
    displayName: 'Nemesis Reborn',
    aliases: ['nemesis reborn', 'nemesis', 'retrack'],
    officialUrl: NEMESIS_OFFICIAL,
    proposalMatcher: /lawfulness.*maintenance.*nemesis|maintenance works.*nemesis/i,
    preferredRole: 'ride-layout',
    sourcePages: [
      { url: 'https://www.towerstimes.co.uk/history/the-drawing-board/nemesis-reborn/', sourceClass: 'historical-plan-mirror', role: 'ride-layout' },
      { url: 'https://themeparkguide.co.uk/news-page/Alton-Towers-Submits-Planning-Application-For-Nemesis-Changes', sourceClass: 'historical-application-corroboration', role: 'ride-layout' }
    ]
  },
  {
    id: 'congo-river-rapids',
    displayName: 'Congo River Rapids',
    aliases: ['congo river rapids', 'grand canyon rapids', 'katanga canyon'],
    preferredRole: 'site-plan',
    sourcePages: [
      { url: 'https://www.towerstimes.co.uk/history/the-drawing-board/katanga-canyon-gloomy-wood/', sourceClass: 'historical-plan-mirror', role: 'site-plan' },
      { url: 'https://www.towerstimes.co.uk/history/construction-archive/congo-river-rapids-construction/', sourceClass: 'historical-construction-corroboration', role: 'construction-reference' }
    ]
  }
];

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) await selfTest();
else await recover(options);

function parseArgs(argv) {
  const out = { directory: 'planning-prefetch-output', maxDocuments: 1200, maxBytes: 150 * 1024 * 1024, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--self-test') out.selfTest = true;
    else if (key === '--directory') out.directory = argv[++index];
    else if (key === '--max-documents') out.maxDocuments = boundedInt(argv[++index], 1, 2000, 'max documents');
    else if (key === '--max-mb') out.maxBytes = boundedInt(argv[++index], 1, 250, 'max MB') * 1024 * 1024;
    else throw new Error(`Unknown option ${key}`);
  }
  return out;
}

async function recover({ directory, maxDocuments, maxBytes }) {
  const root = path.resolve(directory);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await mkdir(path.join(root, 'files'), { recursive: true });

  const existingUrls = new Set((manifest.entries || []).map((entry) => canonicalUrl(entry?.url)).filter(Boolean));
  const existingHashes = new Set((manifest.entries || []).map((entry) => entry?.sha256).filter(Boolean));
  const recovery = {
    schemaVersion: 1,
    policy: ALTON_RIDE_EVIDENCE_RECOVERY_POLICY,
    generatedAt: new Date().toISOString(),
    privateUseOnly: true,
    rawDocumentsRedistributable: false,
    authorityPolicy: 'official-live-or-official-archive-may-anchor; historical mirrors and construction imagery are corroboration-only',
    targets: {},
    warnings: []
  };

  let majorHtml = null;
  try {
    majorHtml = (await fetchBuffer(MAJOR_INDEX, 7 * 1024 * 1024)).toString('utf8');
  } catch (error) {
    recovery.warnings.push(`official major-application index unavailable: ${error.message}`);
  }

  for (const ride of RIDES) {
    const target = recovery.targets[ride.id] = {
      displayName: ride.displayName,
      officialReference: ride.officialReference || null,
      officialApplicationUrl: ride.officialUrl || null,
      officialSourceRecovered: false,
      officialArchiveRecovered: false,
      supportingSourcesRecovered: [],
      documentsRecovered: 0,
      bytesRecovered: 0,
      warnings: []
    };

    let official = null;
    if (majorHtml) official = discoverOfficialApplication(majorHtml, ride, MAJOR_INDEX);
    if (!official && ride.officialUrl) official = { url: ride.officialUrl, reference: ride.officialReference || null, status: null, proposal: ride.displayName };
    if (official) {
      target.officialApplicationUrl = official.url;
      target.officialReference = official.reference || target.officialReference;
      try {
        const pageBytes = await fetchBuffer(official.url, 7 * 1024 * 1024);
        const html = pageBytes.toString('utf8');
        target.officialReference ||= html.match(REFERENCE)?.[0] || null;
        target.officialSourceRecovered = true;
        const liveCandidates = extractOfficialDocumentCandidates(html, official.url, ride.preferredRole);
        await recoverCandidates({ root, manifest, ride, target, candidates: liveCandidates, sourcePage: official.url, sourceClass: 'official-live', application: official, existingUrls, existingHashes, maxDocuments, maxBytes });
        if (!liveCandidates.length) {
          const archived = await recoverOfficialArchive({ root, manifest, ride, target, official, existingUrls, existingHashes, maxDocuments, maxBytes });
          if (archived > 0) target.officialArchiveRecovered = true;
        }
      } catch (error) {
        target.warnings.push(`official application recovery failed: ${error.message}`);
        try {
          const archived = await recoverOfficialArchive({ root, manifest, ride, target, official, existingUrls, existingHashes, maxDocuments, maxBytes });
          if (archived > 0) target.officialArchiveRecovered = true;
        } catch (archiveError) {
          target.warnings.push(`official archive recovery failed: ${archiveError.message}`);
        }
      }
    }

    for (const source of ride.sourcePages) {
      if (budgetFull(manifest, maxDocuments, maxBytes)) break;
      try {
        const html = (await fetchBuffer(source.url, 10 * 1024 * 1024)).toString('utf8');
        const candidates = extractMediaCandidates(html, source.url, source.role)
          .slice(0, MAX_PER_SOURCE);
        const before = target.documentsRecovered;
        await recoverCandidates({ root, manifest, ride, target, candidates, sourcePage: source.url, sourceClass: source.sourceClass, application: official, existingUrls, existingHashes, maxDocuments, maxBytes });
        if (target.documentsRecovered > before) target.supportingSourcesRecovered.push(source.url);
      } catch (error) {
        target.warnings.push(`${source.sourceClass} unavailable: ${error.message}`);
      }
    }
  }

  manifest.rideEvidenceRecovery = recovery;
  manifest.rideEvidenceRecoveryPolicy = ALTON_RIDE_EVIDENCE_RECOVERY_POLICY;
  manifest.liveApplications = Array.isArray(manifest.applications) ? manifest.applications.filter((application) => !application.failure).length : 0;
  manifest.documentsDownloaded = countDownloadedDocuments(manifest.applications);
  manifest.totalBytes = (manifest.entries || [])
    .filter((entry) => entry.kind === 'document')
    .reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);
  if (manifest.applicationSelection) manifest.applicationSelection.retainedApplications = manifest.liveApplications;
  manifest.warnings = [
    ...(Array.isArray(manifest.warnings) ? manifest.warnings : []),
    ...recovery.warnings,
    ...Object.entries(recovery.targets).flatMap(([id, target]) => target.warnings.map((warning) => `ride evidence ${id}: ${warning}`))
  ];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(root, 'ride-evidence-recovery.json'), JSON.stringify(recovery, null, 2) + '\n');

  console.log(JSON.stringify({
    policy: recovery.policy,
    targets: Object.fromEntries(Object.entries(recovery.targets).map(([id, target]) => [id, {
      official: target.officialSourceRecovered,
      officialArchive: target.officialArchiveRecovered,
      documentsRecovered: target.documentsRecovered,
      supportingSources: target.supportingSourcesRecovered.length
    }])),
    applications: manifest.liveApplications,
    documents: manifest.documentsDownloaded,
    bytes: manifest.totalBytes
  }));
}

function discoverOfficialApplication(html, ride, baseUrl) {
  const rows = String(html).match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const text = stripHtml(row);
    const reference = text.match(REFERENCE)?.[0] || null;
    const matchesReference = ride.officialReference && reference?.toUpperCase() === ride.officialReference.toUpperCase();
    const matchesProposal = ride.proposalMatcher?.test(text) && /alton towers/i.test(text);
    if (!matchesReference && !matchesProposal) continue;
    const links = extractLinks(row, baseUrl);
    const application = links.find((link) => /ApplicationSearchServlet\?PKID=/i.test(link.url));
    if (!application) continue;
    return { url: application.url, reference: reference || ride.officialReference || null, status: inferStatus(text), proposal: text.slice(0, 1600) };
  }
  return null;
}

function extractOfficialDocumentCandidates(html, baseUrl, preferredRole) {
  const candidates = extractMediaCandidates(html, baseUrl, preferredRole);
  const raw = String(html);
  for (const match of raw.matchAll(/AttachmentShowServlet\?[^\s"'<>]+/gi)) {
    try {
      const url = new URL(decodeHtml(match[0]), baseUrl).toString();
      candidates.push({ url, text: match[0], role: inferRole(match[0], preferredRole), score: 180 });
    } catch {}
  }
  for (const match of raw.matchAll(/AppBlobImage\(\s*["']([^"']+)["']/gi)) {
    const token = decodeHtml(match[1]).trim();
    try {
      const url = /^https?:/i.test(token)
        ? token
        : new URL(`/portal/servlets/AttachmentShowServlet?ImageName=${encodeURIComponent(token)}`, baseUrl).toString();
      candidates.push({ url, text: token, role: inferRole(token, preferredRole), score: 175 });
    } catch {}
  }
  return dedupeCandidates(candidates).sort((a, b) => b.score - a.score);
}

function extractMediaCandidates(html, baseUrl, preferredRole) {
  const candidates = [];
  for (const link of extractLinks(html, baseUrl)) {
    if (!isMediaUrl(link.url)) continue;
    const text = `${link.text} ${link.url}`;
    if (REJECT_MEDIA.test(text)) continue;
    candidates.push({ url: link.url, text: link.text, role: inferRole(text, preferredRole), score: mediaScore(text, preferredRole) });
  }
  const raw = decodeHtml(String(html));
  const mediaPattern = /(?:src|data-src|data-lazy-src|href)\s*=\s*["']([^"']+\.(?:pdf|png|jpe?g|tiff?)(?:\?[^"']*)?)["']/gi;
  for (const match of raw.matchAll(mediaPattern)) {
    try {
      const url = new URL(match[1], baseUrl).toString();
      if (!isMediaUrl(url) || REJECT_MEDIA.test(url)) continue;
      candidates.push({ url, text: path.basename(new URL(url).pathname), role: inferRole(url, preferredRole), score: mediaScore(url, preferredRole) });
    } catch {}
  }
  const srcsetPattern = /(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi;
  for (const match of raw.matchAll(srcsetPattern)) {
    for (const item of match[1].split(',')) {
      const token = item.trim().split(/\s+/)[0];
      try {
        const url = new URL(token, baseUrl).toString();
        if (!isMediaUrl(url) || REJECT_MEDIA.test(url)) continue;
        candidates.push({ url, text: path.basename(new URL(url).pathname), role: inferRole(url, preferredRole), score: mediaScore(url, preferredRole) - 5 });
      } catch {}
    }
  }
  return dedupeCandidates(candidates).sort((a, b) => b.score - a.score);
}

async function recoverOfficialArchive(context) {
  const { official, target } = context;
  if (!official?.url) return 0;
  const snapshots = await cdxSnapshots(official.url);
  let recovered = 0;
  for (const snapshot of snapshots.slice(0, 3)) {
    if (budgetFull(context.manifest, context.maxDocuments, context.maxBytes)) break;
    const archivedPage = `https://${ARCHIVE_HOST}/web/${snapshot.timestamp}id_/${official.url}`;
    try {
      const html = (await fetchBuffer(archivedPage, 10 * 1024 * 1024)).toString('utf8');
      const originalCandidates = extractOfficialDocumentCandidates(html, official.url, context.ride.preferredRole);
      const archivedCandidates = originalCandidates.map((candidate) => ({
        ...candidate,
        originalUrl: candidate.url,
        url: `https://${ARCHIVE_HOST}/web/${snapshot.timestamp}id_/${candidate.url}`,
        score: candidate.score + 10
      }));
      const before = target.documentsRecovered;
      await recoverCandidates({ ...context, candidates: archivedCandidates, sourcePage: archivedPage, sourceClass: 'official-web-archive' });
      recovered += target.documentsRecovered - before;
      if (recovered > 0) break;
    } catch (error) {
      target.warnings.push(`archive snapshot ${snapshot.timestamp} failed: ${error.message}`);
    }
  }
  return recovered;
}

async function cdxSnapshots(url) {
  const query = new URL(`https://${ARCHIVE_HOST}/cdx/search/cdx`);
  query.searchParams.set('url', url);
  query.searchParams.set('output', 'json');
  query.searchParams.set('filter', 'statuscode:200');
  query.searchParams.append('filter', 'mimetype:text/html');
  query.searchParams.set('fl', 'timestamp,original,statuscode,mimetype,digest');
  query.searchParams.set('collapse', 'digest');
  query.searchParams.set('limit', '8');
  const data = JSON.parse((await fetchBuffer(query.toString(), 2 * 1024 * 1024)).toString('utf8'));
  if (!Array.isArray(data) || data.length < 2) return [];
  return data.slice(1).map((row) => ({ timestamp: row[0], original: row[1] })).filter((item) => /^\d{14}$/.test(item.timestamp)).reverse();
}

async function recoverCandidates({ root, manifest, ride, target, candidates, sourcePage, sourceClass, application, existingUrls, existingHashes, maxDocuments, maxBytes }) {
  const sourceAuthority = sourceClass.startsWith('official') ? 'official-origin' : 'corroboration-only';
  const applicationRecord = getOrCreateApplication(manifest, ride, application, sourcePage, target);
  let attempted = 0;
  for (const candidate of candidates) {
    if (attempted >= MAX_PER_SOURCE || budgetFull(manifest, maxDocuments, maxBytes)) break;
    attempted += 1;
    const canonical = canonicalUrl(candidate.url);
    if (!canonical || existingUrls.has(canonical)) continue;
    try {
      const bytes = await fetchBuffer(candidate.url, Math.min(15 * 1024 * 1024, Math.max(1, maxBytes - Number(manifest.totalBytes || 0))));
      if (bytes.length < MIN_MEDIA_BYTES) continue;
      const mime = sniffMime(bytes, candidate.url);
      if (!mime) continue;
      const digest = sha256(bytes);
      if (existingHashes.has(digest)) continue;
      const relative = `files/${digest}${extensionForMime(mime)}`;
      await writeFile(path.join(root, relative), bytes);
      const role = candidate.role || ride.preferredRole;
      const doc = {
        url: canonical,
        originalUrl: candidate.originalUrl || null,
        text: candidate.text || `${ride.displayName} recovered drawing`,
        role,
        score: Math.max(Number(candidate.score || 0), sourceAuthority === 'official-origin' ? 180 : 120),
        rejected: false,
        rideEvidenceRide: ride.id,
        recoverySourceClass: sourceClass,
        recoverySourcePage: sourcePage,
        sourceAuthority,
        privateUseRestricted: true,
        rawDocumentRedistributable: false,
        corroborationRequired: sourceAuthority !== 'official-origin'
      };
      applicationRecord.documents ||= [];
      applicationRecord.downloadedDocuments ||= [];
      applicationRecord.documents.push(doc);
      applicationRecord.downloadedDocuments.push({ ...doc, bytes: bytes.length, sha256: digest, mime });
      manifest.entries ||= [];
      manifest.entries.push({
        url: canonical,
        finalUrl: canonical,
        file: relative,
        kind: 'document',
        applicationReference: applicationRecord.reference || null,
        bytes: bytes.length,
        sha256: digest,
        mime,
        source: 'alton-ride-evidence-recovery',
        rideEvidenceRide: ride.id,
        recoverySourceClass: sourceClass,
        sourceAuthority,
        privateUseRestricted: true,
        rawDocumentRedistributable: false
      });
      existingUrls.add(canonical);
      existingHashes.add(digest);
      target.documentsRecovered += 1;
      target.bytesRecovered += bytes.length;
      manifest.documentsDownloaded = Number(manifest.documentsDownloaded || 0) + 1;
      manifest.totalBytes = Number(manifest.totalBytes || 0) + bytes.length;
    } catch (error) {
      target.warnings.push(`${sourceClass} document ${candidate.url}: ${error.message}`);
    }
  }
}

function getOrCreateApplication(manifest, ride, official, sourcePage, target) {
  manifest.applications ||= [];
  const officialReference = target.officialReference || ride.officialReference || official?.reference || null;
  let application = officialReference
    ? manifest.applications.find((item) => String(item?.reference || '').toUpperCase() === officialReference.toUpperCase())
    : null;
  if (!application) {
    application = manifest.applications.find((item) => {
      const haystack = `${item?.reference || ''} ${item?.proposal || ''} ${item?.title || ''} ${item?.rideEvidenceRide || ''}`.toLowerCase();
      return item?.rideEvidenceRide === ride.id || ride.aliases.some((alias) => haystack.includes(alias));
    });
  }
  if (!application) {
    application = {
      reference: officialReference || `RECOVERED/${ride.id.toUpperCase()}`,
      status: official?.status || 'unknown',
      proposal: official?.proposal || `${ride.displayName} historical ride evidence recovery`,
      url: official?.url || sourcePage,
      documents: [],
      downloadedDocuments: [],
      rideEvidenceRide: ride.id,
      recoveryOnlyApplication: !official,
      privateUseRestricted: true,
      rawDocumentRedistributable: false,
      worldEligibility: official ? 'normal-planning-gates' : 'corroboration-required'
    };
    manifest.applications.push(application);
  }
  application.rideEvidenceRide ||= ride.id;
  application.rideEvidenceRecoveryPolicy = ALTON_RIDE_EVIDENCE_RECOVERY_POLICY;
  if (official?.url) application.officialApplicationUrl ||= official.url;
  if (officialReference && String(application.reference || '').startsWith('RECOVERED/')) application.reference = officialReference;
  return application;
}

function budgetFull(manifest, maxDocuments, maxBytes) {
  return Number(manifest.documentsDownloaded || 0) >= maxDocuments || Number(manifest.totalBytes || 0) >= maxBytes;
}

function countDownloadedDocuments(applications) {
  return (applications || []).reduce((sum, application) => sum + (Array.isArray(application?.downloadedDocuments) ? application.downloadedDocuments.length : 0), 0);
}

async function fetchBuffer(url, maxBytes) {
  const parsed = validateSourceUrl(url);
  if (OFFICIAL_HOSTS.has(parsed.hostname.toLowerCase())) return fetchOfficial(url, maxBytes);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Voxel-Mapping-Engine/1.0 ride-evidence-recovery', accept: '*/*' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`response exceeded ${maxBytes} bytes`);
    validateSourceUrl(response.url || url);
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

function fetchOfficial(url, maxBytes) {
  const parsed = validateSourceUrl(url);
  if (!OFFICIAL_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error('official transport used for non-official host');
  const command = process.platform === 'win32' ? 'curl.exe' : process.platform === 'linux' ? 'wget' : '/usr/bin/curl';
  for (const insecure of [false, true]) {
    let args;
    if (process.platform === 'linux') {
      args = ['--quiet', '--max-redirect=3', '--timeout=30', '--tries=2', '--header=Accept-Language: en-GB,en;q=0.9', '--output-document=-'];
      if (insecure) args.push('--no-check-certificate');
      args.push(url);
    } else {
      args = ['--fail', '--location', '--max-redirs', '3', '--proto', '=https', '--proto-redir', '=https', '--retry', '2', '--connect-timeout', '30', '--max-time', '60', '--compressed', '--silent', '--show-error'];
      if (process.platform === 'win32') args.push('--ssl-no-revoke');
      if (insecure) args.push('--insecure');
      args.push(url);
    }
    const result = spawnSync(command, args, { encoding: null, maxBuffer: maxBytes + 1024 * 1024, timeout: 75_000 });
    if (!result.error && result.status === 0 && result.stdout?.length) {
      const buffer = Buffer.from(result.stdout);
      if (buffer.length > maxBytes) throw new Error(`official response exceeded ${maxBytes} bytes`);
      return buffer;
    }
  }
  throw new Error(`official transport failed for ${url}`);
}

function validateSourceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`non-HTTPS recovery URL rejected: ${value}`);
  const host = url.hostname.toLowerCase();
  if (!OFFICIAL_HOSTS.has(host) && !SUPPORT_HOSTS.has(host) && host !== ARCHIVE_HOST) throw new Error(`recovery URL outside allowlist: ${value}`);
  return url;
}

function isMediaUrl(value) {
  try {
    const url = validateSourceUrl(value);
    if (REJECT_MEDIA.test(url.pathname)) return false;
    return MEDIA_EXT.test(`${url.pathname}${url.search}`) || /AttachmentShowServlet/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

function extractLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const raw = decodeHtml(match[1] || match[2] || match[3] || '').trim();
    if (!raw || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    try {
      const url = new URL(raw, baseUrl).toString();
      validateSourceUrl(url);
      links.push({ url, text: stripHtml(match[4] || '') });
    } catch {}
  }
  return links;
}

function inferRole(text, fallback = 'site-plan') {
  const value = String(text).toLowerCase();
  if (/ride|track|coaster|support|foundation|tunnel/.test(value)) return 'ride-layout';
  if (/landscap|planting|katanga|gloomy/.test(value)) return 'landscape-plan';
  if (/access|path|circulation/.test(value)) return 'access-plan';
  if (/drainage|level|topograph/.test(value)) return 'terrain-or-drainage';
  if (/elevation/.test(value)) return 'elevation';
  if (/section/.test(value)) return 'section';
  if (/floor/.test(value)) return 'floor-plan';
  if (/roof/.test(value)) return 'roof-plan';
  if (/block/.test(value)) return 'block-plan';
  if (/site|location|layout|master|general arrangement|drawing|plan/.test(value)) return fallback === 'ride-layout' ? 'ride-layout' : 'site-plan';
  return fallback;
}

function mediaScore(text, fallback) {
  let score = fallback === 'ride-layout' ? 110 : 100;
  if (DRAWING_TEXT.test(text)) score += 40;
  if (/approved|as[- ]?built|existing|proposed/i.test(text)) score += 20;
  if (/wp-content\/uploads/i.test(text)) score += 5;
  return score;
}

function dedupeCandidates(values) {
  const map = new Map();
  for (const value of values) {
    const key = canonicalUrl(value?.url);
    if (!key) continue;
    const candidate = { ...value, url: key };
    const current = map.get(key);
    if (!current || Number(candidate.score || 0) > Number(current.score || 0)) map.set(key, candidate);
  }
  return [...map.values()];
}

function canonicalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    const sorted = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
    url.search = '';
    for (const [key, val] of sorted) url.searchParams.append(key, val);
    return url.toString();
  } catch {
    return null;
  }
}

function sniffMime(bytes, url) {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 4 && ((bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42 && bytes[3] === 0) || (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && bytes[3] === 42))) return 'image/tiff';
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg' : ['.tif', '.tiff'].includes(ext) ? 'image/tiff' : null;
}

function extensionForMime(mime) {
  return mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : mime === 'image/jpeg' ? '.jpg' : mime === 'image/tiff' ? '.tif' : '.bin';
}
function inferStatus(text) { const value = String(text).toLowerCase(); if (/withdrawn|invalid|returned/.test(value)) return 'withdrawn'; if (/refused|dismissed/.test(value)) return 'refused'; if (/approved|permission granted|consent granted|lawful/.test(value)) return 'approved'; if (/pending|consultation|awaiting/.test(value)) return 'pending'; return 'unknown'; }
function stripHtml(value) { return decodeHtml(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function decodeHtml(value) { return String(value).replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function boundedInt(value, min, max, label) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer between ${min} and ${max}`); return number; }

async function selfTest() {
  const rowHtml = `
    <table>
      <tr><td>SMD/2011/1051</td><td>Alton Towers</td><td>Demolition of Existing Structures and Installation of New Rollercoaster</td><td>Planning Permission - Approved</td><td><a href="/portal/servlets/ApplicationSearchServlet?PKID=111">View</a></td></tr>
      <tr><td>SMD/2008/9999</td><td>Alton Towers</td><td>A replacement rollercoaster, erection of station buildings and landscaping works</td><td>Planning Permission - Approved</td><td><a href="/portal/servlets/ApplicationSearchServlet?PKID=222">View</a></td></tr>
    </table>`;
  const smiler = discoverOfficialApplication(rowHtml, RIDES.find((ride) => ride.id === 'the-smiler'), MAJOR_INDEX);
  const thirteen = discoverOfficialApplication(rowHtml, RIDES.find((ride) => ride.id === 'th13teen'), MAJOR_INDEX);
  if (smiler?.reference !== 'SMD/2011/1051' || !smiler.url.includes('PKID=111')) throw new Error('Smiler official discovery self-test failed');
  if (thirteen?.reference !== 'SMD/2008/9999' || !thirteen.url.includes('PKID=222')) throw new Error('TH13TEEN official discovery self-test failed');

  const mirrorHtml = `
    <a href="https://www.towerstimes.co.uk/wp-content/uploads/2022/01/sw7-site-plan.jpg">Approved Site Plan</a>
    <img data-src="/wp-content/uploads/2022/01/track-layout.png" />
    <img src="/wp-content/uploads/logo.png" />`;
  const media = extractMediaCandidates(mirrorHtml, 'https://www.towerstimes.co.uk/history/the-drawing-board/the-smiler/', 'ride-layout');
  if (media.length !== 2 || !media.every((item) => item.role === 'ride-layout')) throw new Error(`media extraction self-test failed: ${JSON.stringify(media)}`);

  const root = await mkdtemp(path.join(os.tmpdir(), 'alton-ride-recovery-'));
  try {
    await mkdir(path.join(root, 'files'), { recursive: true });
    const manifest = { status: 'usable', applications: [], entries: [], liveApplications: 0, documentsDownloaded: 0, totalBytes: 0, applicationSelection: { policy: 'drawing-bearing-only', maxApplications: 500 } };
    const target = { officialReference: 'SMD/2011/1051' };
    const app = getOrCreateApplication(manifest, RIDES.find((ride) => ride.id === 'the-smiler'), smiler, 'https://www.towerstimes.co.uk/history/the-drawing-board/the-smiler/', target);
    if (app.reference !== 'SMD/2011/1051' || app.worldEligibility !== 'normal-planning-gates') throw new Error('official application merge self-test failed');
    const congo = getOrCreateApplication(manifest, RIDES.find((ride) => ride.id === 'congo-river-rapids'), null, 'https://www.towerstimes.co.uk/history/the-drawing-board/katanga-canyon-gloomy-wood/', { officialReference: null });
    if (congo.worldEligibility !== 'corroboration-required' || !congo.reference.startsWith('RECOVERED/')) throw new Error('corroboration application safety self-test failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  if (ALTON_RIDE_EVIDENCE_RECOVERY_POLICY !== 'alton-ride-evidence-recovery-v1') throw new Error('policy marker self-test failed');
  console.log('Alton ride evidence recovery self-test passed');
}
