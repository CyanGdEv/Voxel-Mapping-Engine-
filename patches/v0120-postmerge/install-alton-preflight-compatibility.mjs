#!/usr/bin/env node
// TPMAP_ALTON_POSTMERGE_PREFLIGHT_COMPATIBILITY_V2
// Repairs final assembled Phase 34/35 preparation state without weakening source authority.

import path from 'node:path';
import { readFile, writeFile, readdir } from 'node:fs/promises';

const args=process.argv.slice(2);
const gi=args.indexOf('--generator');
const generator=gi>=0?path.resolve(args[gi+1]):null;
const validateOnly=args.includes('--validate-only');
const selfTest=args.includes('--self-test');
if(selfTest) selfTestTransforms();
else if(!generator) throw new Error('--generator is required');
else await install(generator,validateOnly);

const IMPLEMENTATIONS=new Set([
  'vertical-evidence-engine.mjs','terrain-surface-model.mjs','building-roof-reconstruction.mjs',
  'building-roof-plane-decomposition.mjs','building-roof-planning-constraints.mjs','vegetation-reconstruction.mjs',
  'ride-vertical-profile.mjs','ride-3d-geometry.mjs','ride-support-reconstruction.mjs','ride-terrain-interaction.mjs',
  'ride-excavation-mask.mjs','ride-excavation-compiler.mjs','ride-graph-compiler.mjs','terrain-morphology.mjs',
  'terrain-planning-structure-association.mjs','terrain-structure-compiler.mjs','terrain-steep-bank-treatment.mjs',
  'terrain-tunnel-portal-reconciliation.mjs','retaining-wall-detail.mjs','terrain-qa.mjs','block-state-transport.mjs'
]);

async function install(root,validate){
  const verticalFile=path.join(root,'src/lib/vertical-evidence-engine.mjs');
  const pipelineFile=path.join(root,'src/lib/pipeline.mjs');
  if(!validate){
    await writeFile(verticalFile,repairVerticalEngine(await readFile(verticalFile,'utf8')));
    await writeFile(pipelineFile,repairPipeline(await readFile(pipelineFile,'utf8')));
    await repairGeneratedTestImports(root);
  }
  const vertical=await readFile(verticalFile,'utf8');
  const pipeline=await readFile(pipelineFile,'utf8');
  validateVertical(vertical);
  validatePipeline(pipeline);
  await validateGeneratedTestImports(root);
  console.log(JSON.stringify({status:validate?'validated':'installed',marker:'TPMAP_ALTON_POSTMERGE_PREFLIGHT_COMPATIBILITY_V2'}));
}

export function repairVerticalEngine(source){
  let out=source;
  out=repairFinite(out);
  out=ensureImports(out);
  out=canonicalizeStages(out);
  if(!out.includes('TPMAP_ALTON_POSTMERGE_VERTICAL_INTEGRATION_V2')){
    const marker='// TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1';
    if(!out.includes(marker)) throw new Error('Alton compatibility: Phase 34 vertical marker missing');
    out=out.replace(marker,marker+'\nconst TPMAP_ALTON_POSTMERGE_VERTICAL_INTEGRATION_V2 = true;');
  }
  validateVertical(out);
  return out;
}

function repairFinite(source){
  const fixed=`function finite(value) {\n  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;\n  const n = Number(value);\n  return Number.isFinite(n) ? n : null;\n}`;
  const fn=/function\s+finite\s*\(\s*value\s*\)\s*\{[\s\S]*?\n\}/m;
  const match=source.match(fn);
  if(!match) throw new Error('Alton compatibility: vertical finite() function missing');
  if(match[0].includes('value === null || value === undefined')) return source;
  if(!/Number\s*\(\s*value\s*\)/.test(match[0])) throw new Error('Alton compatibility: unexpected vertical finite() implementation');
  return source.replace(fn,fixed);
}

function ensureImports(source){
  const marker='// TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1';
  if(!source.includes(marker)) throw new Error('Alton compatibility: vertical marker missing');
  const imports=[
    'import { buildTerrainSurfaceModel, validateTerrainSurfaceModel } from "./terrain-surface-model.mjs";',
    'import { classifyTerrainMorphology, validateTerrainMorphology } from "./terrain-morphology.mjs";',
    'import { associatePlanningTerrainStructures, validatePlanningTerrainStructures } from "./terrain-planning-structure-association.mjs";',
    'import { reconstructBuildingRoofs, validateBuildingReconstructions } from "./building-roof-reconstruction.mjs";',
    'import { decomposeBuildingRoofPlanes, validateBuildingRoofPlaneDecompositions } from "./building-roof-plane-decomposition.mjs";',
    'import { applyBuildingRoofPlanningConstraints, validateBuildingRoofPlanningConstraints } from "./building-roof-planning-constraints.mjs";',
    'import { reconstructVegetation, validateVegetationReconstructions } from "./vegetation-reconstruction.mjs";'
  ];
  const missing=imports.filter(line=>!source.includes(line));
  return missing.length?source.replace(marker,marker+'\n'+missing.join('\n')):source;
}

function canonicalizeStages(source){
  const ride='  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);';
  if(!source.includes(ride)) throw new Error('Alton compatibility: ride profile stage missing');
  const blocks=[
    [
      '  const terrainSurfaceModel = buildTerrainSurfaceModel(graph, options.verticalSources || null, options);',
      '  validateTerrainSurfaceModel(graph);','  diagnostics.terrainSurfaceModel = terrainSurfaceModel;'
    ],[
      '  const terrainMorphology = classifyTerrainMorphology(graph, options.verticalSources || null, options);',
      '  validateTerrainMorphology(graph);','  diagnostics.terrainMorphology = terrainMorphology;'
    ],[
      '  const terrainPlanningAssociation = associatePlanningTerrainStructures(graph, options);',
      '  validatePlanningTerrainStructures(graph);','  diagnostics.terrainPlanningAssociation = terrainPlanningAssociation;'
    ],[
      '  const buildingRoofReconstruction = reconstructBuildingRoofs(graph, options.verticalSources || null, options);',
      '  validateBuildingReconstructions(graph);','  diagnostics.buildingRoofReconstruction = buildingRoofReconstruction;'
    ],[
      '  const buildingRoofPlaneDecomposition = decomposeBuildingRoofPlanes(graph, options);',
      '  validateBuildingRoofPlaneDecompositions(graph);','  diagnostics.buildingRoofPlaneDecomposition = buildingRoofPlaneDecomposition;'
    ],[
      '  const buildingRoofPlanningConstraints = applyBuildingRoofPlanningConstraints(graph, options);',
      '  validateBuildingRoofPlanningConstraints(graph);','  diagnostics.buildingRoofPlanningConstraints = buildingRoofPlanningConstraints;'
    ],[
      '  const vegetationReconstruction = reconstructVegetation(graph, options.verticalSources || null, options);',
      '  validateVegetationReconstructions(graph);','  diagnostics.vegetationReconstruction = vegetationReconstruction;'
    ]
  ];
  let out=source;
  for(const lines of blocks){
    const escaped=lines.map(line=>escapeRegExp(line)).join('\\s*\\n\\s*');
    out=out.replace(new RegExp(escaped+'\\s*\\n?','g'),'');
  }
  const canonical=blocks.map(lines=>lines.join('\n')).join('\n');
  return out.replace(ride,canonical+'\n'+ride);
}

export function repairPipeline(source){
  let out=source;
  out=out.replace(/solveParkVerticalEvidence\(reconstructionGraph,\s*options\)/g,
    'solveParkVerticalEvidence(reconstructionGraph, { ...options, verticalSources: sources })');
  if(!out.includes('verticalSources: sources')) throw new Error('Alton compatibility: vertical source handoff missing');
  if(!out.includes('TPMAP_ALTON_POSTMERGE_PIPELINE_COMPATIBILITY_V2')){
    const anchor='const TPMAP_PHASE34_VERTICAL_EVIDENCE_PIPELINE = true;';
    out=out.includes(anchor)?out.replace(anchor,anchor+'\nconst TPMAP_ALTON_POSTMERGE_PIPELINE_COMPATIBILITY_V2 = true;'):
      'const TPMAP_ALTON_POSTMERGE_PIPELINE_COMPATIBILITY_V2 = true;\n'+out;
  }
  validatePipeline(out); return out;
}

async function repairGeneratedTestImports(root){
  const testDir=path.join(root,'test');
  for(const name of await readdir(testDir)){
    if(!name.endsWith('.test.mjs')) continue;
    const file=path.join(testDir,name); let source=await readFile(file,'utf8');
    source=source.replace(/from\s+(['"])\.\/([A-Za-z0-9._-]+\.mjs)\1/g,(whole,q,moduleName)=>
      IMPLEMENTATIONS.has(moduleName)?`from ${q}../src/lib/${moduleName}${q}`:whole);
    await writeFile(file,source);
  }
}

async function validateGeneratedTestImports(root){
  const testDir=path.join(root,'test');
  for(const name of await readdir(testDir)){
    if(!name.endsWith('.test.mjs')) continue;
    const source=await readFile(path.join(testDir,name),'utf8');
    const bad=[...source.matchAll(/from\s+['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]/g)]
      .map(m=>m[1]).filter(moduleName=>IMPLEMENTATIONS.has(moduleName));
    if(bad.length) throw new Error(`Alton compatibility: ${name} still imports test-local ${bad.join(',')}`);
  }
}

function validateVertical(source){
  const required=[
    'TPMAP_ALTON_POSTMERGE_VERTICAL_INTEGRATION_V2','value === null || value === undefined',
    'buildTerrainSurfaceModel(graph, options.verticalSources || null, options)',
    'classifyTerrainMorphology(graph, options.verticalSources || null, options)',
    'associatePlanningTerrainStructures(graph, options)',
    'reconstructBuildingRoofs(graph, options.verticalSources || null, options)',
    'decomposeBuildingRoofPlanes(graph, options)','applyBuildingRoofPlanningConstraints(graph, options)',
    'reconstructVegetation(graph, options.verticalSources || null, options)','solveRideVerticalProfiles(graph, options)'
  ];
  for(const token of required) if(!source.includes(token)) throw new Error(`Alton compatibility: vertical engine missing ${token}`);
  const order=required.slice(2).map(token=>source.indexOf(token));
  for(let i=1;i<order.length;i++) if(!(order[i]>order[i-1])) throw new Error('Alton compatibility: Phase 34/35 vertical ordering invalid');
  const finiteBlock=source.match(/function\s+finite\s*\(\s*value\s*\)\s*\{[\s\S]*?\n\}/m)?.[0]||'';
  if(!finiteBlock.includes('value === null || value === undefined')) throw new Error('Alton compatibility: finite() still maps null through Number()');
}
function validatePipeline(source){if(!source.includes('verticalSources: sources'))throw new Error('Alton compatibility: pipeline does not pass vertical sources');}
function escapeRegExp(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

function selfTestTransforms(){
  const vertical=[
    '// TPMAP_PHASE34_VERTICAL_EVIDENCE_ENGINE_V1','import { solveRideVerticalProfiles } from "./ride-vertical-profile.mjs";',
    'export function solveParkVerticalEvidence(graph, options={}) {','  const diagnostics={};',
    '  const buildingRoofReconstruction = reconstructBuildingRoofs(graph, options.verticalSources || null, options);',
    '  validateBuildingReconstructions(graph);','  diagnostics.buildingRoofReconstruction = buildingRoofReconstruction;',
    '  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);','  return diagnostics;','}',
    'function finite(value) {','  const n = Number(value);','  return Number.isFinite(n) ? n : null;','}'
  ].join('\n');
  const repaired=repairVerticalEngine(vertical); if(repaired!==repairVerticalEngine(repaired))throw new Error('Alton compatibility: vertical repair not idempotent');
  const pipeline='const TPMAP_PHASE34_VERTICAL_EVIDENCE_PIPELINE = true;\nconst verticalResolution = solveParkVerticalEvidence(reconstructionGraph, options);';
  const p=repairPipeline(pipeline);if(p!==repairPipeline(p))throw new Error('Alton compatibility: pipeline repair not idempotent');
  console.log('Alton post-merge preflight compatibility v2 self-test passed');
}
