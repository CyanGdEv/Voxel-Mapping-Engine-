#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MARKER = 'TPMAP_PHASE31_UNIVERSAL_PLANNING_AUTHORITY_V1';
const GENERIC_LINE_ROLE = 'site-plan-linear-candidate';
const GENERIC_AREA_ROLE = 'site-or-building-footprint-candidate';

function parseArgs(argv) {
  const out = { selfTest: false, generator: null, validateOnly: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--self-test') out.selfTest = true;
    else if (arg === '--generator') out.generator = argv[++i];
    else if (arg === '--validate-only') out.validateOnly = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return out;
}

function insertIntoSupportedRoleMap(text) {
  if (text.includes(`['${GENERIC_LINE_ROLE}'`) || text.includes(`[\"${GENERIC_LINE_ROLE}\"`)) return text;
  const start = text.indexOf('const SUPPORTED_VECTOR_ROLES = new Map([');
  if (start < 0) throw new Error('Phase 31 could not locate SUPPORTED_VECTOR_ROLES');
  const end = text.indexOf(']);', start);
  if (end < 0) throw new Error('Phase 31 could not locate end of SUPPORTED_VECTOR_ROLES');
  const before = text.slice(0, end).replace(/\s*$/, '');
  const tail = text.slice(end);
  const needsComma = !before.trimEnd().endsWith(',');
  const addition = `${needsComma ? ',' : ''}\n  [\"${GENERIC_LINE_ROLE}\", { kind: \"path\", subtype: \"planning-context-path\", geometry: \"line\", priority: 70, contextual: true }],\n  [\"${GENERIC_AREA_ROLE}\", { kind: \"building\", subtype: \"planning-context-building\", geometry: \"area\", priority: 68, contextual: true }]\n`;
  return before + addition + tail;
}

export function transformPlanningVectorFusion(text) {
  let out = insertIntoSupportedRoleMap(text);

  const oldFields = `        planning_requires_existing_osm_target: state.requiresExistingTarget,\n        planning_allow_gap_fill: state.gapFillAllowed,`;
  const newFields = `        // Phase 31: broad site-plan linework is useful as replacement geometry only\n        // when another source already tells us what the feature is. This lets an\n        // accurate plan redraw an OSM path/building without guessing that every\n        // kerb, wall or outline is itself a path/building. Explicitly semantic\n        // planning vectors retain the Phase 30 authoritative gap-fill policy.\n        planning_requires_existing_osm_target: mapping.contextual ? true : state.requiresExistingTarget,\n        planning_allow_gap_fill: mapping.contextual ? false : state.gapFillAllowed,\n        planning_contextual_geometry: Boolean(mapping.contextual),\n        planning_context_role: mapping.contextual ? role : null,`;
  if (!out.includes('planning_contextual_geometry: Boolean(mapping.contextual)')) {
    if (!out.includes(oldFields)) throw new Error('Phase 31 planning fusion policy-field anchor missing');
    out = out.replace(oldFields, newFields);
  }

  if (!out.includes(MARKER)) {
    const anchor = 'const SUPPORTED_VECTOR_ROLES = new Map([';
    out = out.replace(anchor, `// ${MARKER}\n${anchor}`);
  }
  return out;
}

export function transformSourceFusion(text) {
  let out = text;
  if (!out.includes('const contextualGeometry = booleanTag(tags.planning_contextual_geometry);')) {
    const anchor = '  const privateUseOnly = booleanTag(tags.planning_private_use_only);\n';
    if (!out.includes(anchor)) throw new Error('Phase 31 source-fusion contextual policy anchor missing');
    out = out.replace(anchor, `${anchor}  const contextualGeometry = booleanTag(tags.planning_contextual_geometry);\n`);
  }

  if (!out.includes('contextualGeometry, explicitlyAuthoritative')) {
    const alternatives = [
      '    requiresExistingTarget, privateUseOnly, planningVectorDataset, explicitlyAuthoritative\n',
      '    requiresExistingTarget, privateUseOnly, planningVectorDataset\n'
    ];
    const found = alternatives.find((value) => out.includes(value));
    if (!found) throw new Error('Phase 31 source-fusion policy return anchor missing');
    const replacement = found.includes('explicitlyAuthoritative')
      ? '    requiresExistingTarget, privateUseOnly, planningVectorDataset, contextualGeometry, explicitlyAuthoritative\n'
      : '    requiresExistingTarget, privateUseOnly, planningVectorDataset, contextualGeometry\n';
    out = out.replace(found, replacement);
  }

  // Contextual candidates deliberately keep requiresExistingTarget=true and
  // planning_allow_gap_fill=false. Existing Phase 30 authority therefore uses
  // the plan geometry to replace a compatible OSM target, inherits its useful
  // metadata, and cannot create an unsupported feature from anonymous linework.
  return out;
}

export function transformReport(text) {
  if (text.includes('Planning contextual authority:')) return text;
  const anchor = '- Planning vector fusion: ${sources.supplemental?.evidence?.["planning-documents"]?.vectorFusion?.promoted ?? 0} candidate(s) promoted to authority gates;';
  const index = text.indexOf(anchor);
  if (index < 0) return text;
  const lineEnd = text.indexOf('\n', index);
  if (lineEnd < 0) return text;
  const addition = `\n- Planning contextual authority: generic site-plan lines/footprints are target-only repair geometry; OSM may provide semantics but cannot retain conflicting geometry once a verified planning target is accepted.`;
  return text.slice(0, lineEnd) + addition + text.slice(lineEnd);
}

function validateInstalled(planning, source) {
  const requiredPlanning = [
    MARKER,
    GENERIC_LINE_ROLE,
    GENERIC_AREA_ROLE,
    'planning_contextual_geometry: Boolean(mapping.contextual)',
    'planning_requires_existing_osm_target: mapping.contextual ? true : state.requiresExistingTarget',
    'planning_allow_gap_fill: mapping.contextual ? false : state.gapFillAllowed'
  ];
  for (const token of requiredPlanning) {
    if (!planning.includes(token)) throw new Error(`Phase 31 planning-vector-fusion validation failed: ${token}`);
  }
  if (!source.includes('const contextualGeometry = booleanTag(tags.planning_contextual_geometry);')) {
    throw new Error('Phase 31 source-fusion validation failed: contextualGeometry policy missing');
  }
  if (!source.includes('contextualGeometry')) throw new Error('Phase 31 source-fusion validation failed: contextualGeometry not returned');
}

async function install(generator, validateOnly = false) {
  if (!generator) throw new Error('--generator is required');
  const planningPath = path.join(generator, 'src/lib/planning-vector-fusion.mjs');
  const sourcePath = path.join(generator, 'src/lib/source-fusion.mjs');
  const reportPath = path.join(generator, 'src/lib/report.mjs');
  const [planningText, sourceText, reportText] = await Promise.all([
    readFile(planningPath, 'utf8'),
    readFile(sourcePath, 'utf8'),
    readFile(reportPath, 'utf8')
  ]);

  const planningOut = transformPlanningVectorFusion(planningText);
  const sourceOut = transformSourceFusion(sourceText);
  const reportOut = transformReport(reportText);
  validateInstalled(planningOut, sourceOut);

  if (!validateOnly) {
    await Promise.all([
      writeFile(planningPath, planningOut),
      writeFile(sourcePath, sourceOut),
      writeFile(reportPath, reportOut)
    ]);
  }
  console.log(JSON.stringify({
    phase: 31,
    marker: MARKER,
    validateOnly,
    contextualRoles: [GENERIC_LINE_ROLE, GENERIC_AREA_ROLE],
    policy: 'verified generic site-plan geometry may replace compatible OSM geometry but cannot gap-fill without semantic classification'
  }));
}

async function selfTest() {
  const fixturePlanning = `const SUPPORTED_VECTOR_ROLES = new Map([\n  [\"access-path-centerline-candidate\", { kind: \"path\", subtype: \"planning-access-path\", geometry: \"line\", priority: 100 }]\n]);\nfunction x(mapping, state) { return {\n        planning_requires_existing_osm_target: state.requiresExistingTarget,\n        planning_allow_gap_fill: state.gapFillAllowed,\n        planning_authoritative: true\n}; }\n`;
  const fixtureSource = `function planningFeaturePolicy(tags) {\n  const privateUseOnly = booleanTag(tags.planning_private_use_only);\n  const planningVectorDataset = true;\n  const explicitlyAuthoritative = true;\n  return {\n    requiresExistingTarget, privateUseOnly, planningVectorDataset, explicitlyAuthoritative\n  };\n}\nfunction booleanTag(v) { return Boolean(v); }\n`;
  const transformedPlanning = transformPlanningVectorFusion(fixturePlanning);
  const transformedSource = transformSourceFusion(fixtureSource);
  validateInstalled(transformedPlanning, transformedSource);
  if ((transformedPlanning.match(new RegExp(GENERIC_LINE_ROLE, 'g')) || []).length !== 1) {
    throw new Error('Phase 31 self-test duplicated generic line role');
  }
  if ((transformPlanningVectorFusion(transformedPlanning).match(new RegExp(GENERIC_LINE_ROLE, 'g')) || []).length !== 1) {
    throw new Error('Phase 31 transform is not idempotent');
  }

  const temp = await mkdtemp(path.join(tmpdir(), 'tpmap-phase31-'));
  try {
    await mkdir(path.join(temp, 'src/lib'), { recursive: true });
    await writeFile(path.join(temp, 'src/lib/planning-vector-fusion.mjs'), fixturePlanning);
    await writeFile(path.join(temp, 'src/lib/source-fusion.mjs'), fixtureSource);
    await writeFile(path.join(temp, 'src/lib/report.mjs'), 'export const report = true;\n');
    await install(temp, false);
    const installed = await readFile(path.join(temp, 'src/lib/planning-vector-fusion.mjs'), 'utf8');
    if (!installed.includes(MARKER)) throw new Error('Phase 31 self-test install did not persist marker');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  console.log('Phase 31 universal planning authority self-test passed');
}

const args = parseArgs(process.argv);
if (args.selfTest) await selfTest();
else await install(args.generator, args.validateOnly);
