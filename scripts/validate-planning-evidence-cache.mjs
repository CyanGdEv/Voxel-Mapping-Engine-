#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const REQUIRED_APPLICATION_POLICY = 'drawing-bearing-only';
const REQUIRED_APPLICATION_CAP = 500;
const REQUIRED_RIDE_RECOVERY_POLICY = 'alton-ride-evidence-recovery-v1';
const REQUIRED_RIDE_TARGETS = ['th13teen', 'the-smiler', 'nemesis-reborn', 'congo-river-rapids'];

function parseArgs(argv) {
  const options = { maxAgeHours: 24, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--self-test') options.selfTest = true;
    else if (token === '--input') options.input = argv[++i];
    else if (token === '--output') options.output = argv[++i];
    else if (token === '--max-age-hours') options.maxAgeHours = Number(argv[++i]);
    else throw new Error(`Unknown option ${token}`);
  }
  return options;
}

function cacheAgeHours(generatedAt, now = Date.now()) {
  const generated = Date.parse(generatedAt || '');
  if (!Number.isFinite(generated)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - generated) / 3_600_000);
}

function freshness(generatedAt, maxAgeHours, now = Date.now()) {
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error('max-age-hours must be a positive number');
  const ageHours = cacheAgeHours(generatedAt, now);
  return { ageHours, fresh: Number.isFinite(ageHours) && ageHours <= maxAgeHours };
}

function hasCurrentApplicationSelection(manifest) {
  return manifest?.applicationSelection?.policy === REQUIRED_APPLICATION_POLICY
    && Number(manifest?.applicationSelection?.maxApplications) >= REQUIRED_APPLICATION_CAP;
}

function hasCurrentRideRecovery(manifest) {
  if (manifest?.rideEvidenceRecoveryPolicy !== REQUIRED_RIDE_RECOVERY_POLICY) return false;
  const targets = manifest?.rideEvidenceRecovery?.targets;
  if (!targets || typeof targets !== 'object') return false;
  return REQUIRED_RIDE_TARGETS.every((id) => targets[id] && typeof targets[id] === 'object');
}

async function validate(options) {
  if (!options.input || !options.output) throw new Error('Usage: validate-planning-evidence-cache.mjs --input <dir> --output <dir> [--max-age-hours 24]');
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  const manifestPath = path.join(input, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`planning cache unavailable: ${error.message}`);
    return 3;
  }

  const { ageHours, fresh } = freshness(manifest.generatedAt, options.maxAgeHours);
  if (!fresh) {
    console.error(`planning cache stale: ageHours=${Number.isFinite(ageHours) ? ageHours.toFixed(2) : 'invalid'} maxAgeHours=${options.maxAgeHours}`);
    return 4;
  }

  if (!hasCurrentApplicationSelection(manifest)) {
    console.error(`planning cache uses superseded application selection; required policy=${REQUIRED_APPLICATION_POLICY} maxApplications>=${REQUIRED_APPLICATION_CAP}`);
    return 7;
  }

  if (!hasCurrentRideRecovery(manifest)) {
    console.error(`planning cache predates targeted Alton ride recovery; required policy=${REQUIRED_RIDE_RECOVERY_POLICY} targets=${REQUIRED_RIDE_TARGETS.join(',')}`);
    return 8;
  }

  const normalizer = path.resolve('scripts/prepare-planning-prefetch-runtime.mjs');
  const result = spawnSync(process.execPath, [normalizer, '--input', input, '--output', output], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) return result.status || 5;

  const reportPath = path.join(output, 'runtime-report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const validation = {
    schemaVersion: 1,
    status: report.status === 'ready' ? 'usable' : 'rejected',
    checkedAt: new Date().toISOString(),
    sourceGeneratedAt: manifest.generatedAt,
    ageHours: Number(ageHours.toFixed(3)),
    maxAgeHours: options.maxAgeHours,
    applicationSelectionPolicy: manifest.applicationSelection.policy,
    applicationSelectionCap: Number(manifest.applicationSelection.maxApplications),
    rideEvidenceRecoveryPolicy: manifest.rideEvidenceRecoveryPolicy,
    rideEvidenceTargets: REQUIRED_RIDE_TARGETS,
    applications: report.applications || 0,
    documents: report.documents || 0,
    duplicateEntriesRemoved: report.duplicateEntriesRemoved || 0,
    invalidEntriesRemoved: report.invalidEntriesRemoved || 0
  };
  await writeFile(path.join(output, 'cache-validation.json'), JSON.stringify(validation, null, 2) + '\n');
  console.log(JSON.stringify(validation));
  return validation.status === 'usable' ? 0 : 6;
}

function selfTest() {
  const now = Date.parse('2026-08-07T12:00:00Z');
  const recent = freshness('2026-08-07T02:00:00Z', 24, now);
  const stale = freshness('2026-08-05T02:00:00Z', 24, now);
  const invalid = freshness('not-a-date', 24, now);
  if (!recent.fresh || recent.ageHours !== 10) throw new Error('recent cache freshness test failed');
  if (stale.fresh || stale.ageHours !== 58) throw new Error('stale cache freshness test failed');
  if (invalid.fresh || Number.isFinite(invalid.ageHours)) throw new Error('invalid cache freshness test failed');
  if (!hasCurrentApplicationSelection({ applicationSelection: { policy: 'drawing-bearing-only', maxApplications: 500 } })) throw new Error('current drawing application selection test failed');
  if (hasCurrentApplicationSelection({ applicationSelection: { policy: 'drawing-bearing-only', maxApplications: 300 } })) throw new Error('legacy application cap rejection test failed');
  if (hasCurrentApplicationSelection({})) throw new Error('missing application selection rejection test failed');
  const currentRecovery = {
    rideEvidenceRecoveryPolicy: REQUIRED_RIDE_RECOVERY_POLICY,
    rideEvidenceRecovery: { targets: Object.fromEntries(REQUIRED_RIDE_TARGETS.map((id) => [id, {}])) }
  };
  if (!hasCurrentRideRecovery(currentRecovery)) throw new Error('current ride recovery policy test failed');
  if (hasCurrentRideRecovery({ rideEvidenceRecoveryPolicy: REQUIRED_RIDE_RECOVERY_POLICY, rideEvidenceRecovery: { targets: { 'the-smiler': {} } } })) throw new Error('incomplete ride recovery target rejection test failed');
  if (hasCurrentRideRecovery({})) throw new Error('missing ride recovery policy rejection test failed');
  console.log('planning evidence cache freshness, application-policy, and ride-recovery self-test passed');
}

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) selfTest();
else process.exitCode = await validate(options);
