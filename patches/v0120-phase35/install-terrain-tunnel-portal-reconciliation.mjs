#!/usr/bin/env node
// TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_INSTALLER
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),i=args.indexOf('--generator'),generator=i>=0?path.resolve(args[i+1]):null,validateOnly=args.includes('--validate-only'),selfTest=args.includes('--self-test');
if(selfTest)selfTestTransform();else if(!generator)throw new Error('--generator is required');else await install(generator,validateOnly);

async function install(root,validate){
  const moduleFile=path.join(root,'src/lib/terrain-tunnel-portal-reconciliation.mjs');
  const testFile=path.join(root,'test/terrain-tunnel-portal-reconciliation.test.mjs');
  const pipelineFile=path.join(root,'src/lib/pipeline.mjs');
  if(!validate){
    await writeFile(moduleFile,await readFile(path.join(here,'terrain-tunnel-portal-reconciliation.mjs'),'utf8'));
    await writeFile(testFile,await readFile(path.join(here,'terrain-tunnel-portal-reconciliation.test.mjs'),'utf8'));
    await writeFile(pipelineFile,transformPipeline(await readFile(pipelineFile,'utf8')));
  }
  const m=await readFile(moduleFile,'utf8'),t=await readFile(testFile,'utf8'),p=await readFile(pipelineFile,'utf8');
  for(const token of ['TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_V1','reconcileTerrainWithRideExcavation','validateTerrainTunnelPortalReconciliation'])if(!m.includes(token))throw new Error(`Phase 35 portal module missing ${token}`);
  for(const token of ['verified tunnel splits only overlapping phase-6 terrain and emits no air','portal mouth detection uses first and last verified tunnel measures','no overlap is exact compilation no-op','unverified mask marker fails closed before mutation'])if(!t.includes(token))throw new Error(`Phase 35 portal tests missing ${token}`);
  validatePipeline(p); console.log(JSON.stringify({status:validate?'validated':'installed',marker:'TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_V1'}));
}

export function transformPipeline(source){
  if(source.includes('TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_PIPELINE'))return source;
  let out=replaceOnce(source,
    'import { applyTerrainStructuresToCompilation, validateTerrainStructureCompilation } from "./terrain-structure-compiler.mjs";',
    'import { applyTerrainStructuresToCompilation, validateTerrainStructureCompilation } from "./terrain-structure-compiler.mjs";\nimport { reconcileTerrainWithRideExcavation, validateTerrainTunnelPortalReconciliation } from "./terrain-tunnel-portal-reconciliation.mjs";\nconst TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_PIPELINE = true;',
    'portal reconciliation import');
  out=replaceOnce(out,
    '  validateTerrainStructureCompilation(compilation, terrainStructureCompilation);\n  const rideExcavationCompilation = applyRideExcavationToCompilation(compilation, rideExcavationMask);',
    '  validateTerrainStructureCompilation(compilation, terrainStructureCompilation);\n  const terrainTunnelPortalReconciliation = reconcileTerrainWithRideExcavation(compilation, rideExcavationMask, options);\n  validateTerrainTunnelPortalReconciliation(compilation, rideExcavationMask, terrainTunnelPortalReconciliation);\n  const rideExcavationCompilation = applyRideExcavationToCompilation(compilation, rideExcavationMask);',
    'portal reconciliation stage');
  out=replaceOnce(out,
    '    terrainStructureCompilation,\n    rideExcavationCompilation,',
    '    terrainStructureCompilation,\n    terrainTunnelPortalReconciliation,\n    rideExcavationCompilation,',
    'portal reconciliation evidence');
  validatePipeline(out); return out;
}
function validatePipeline(source){
  for(const t of ['TPMAP_PHASE35_TUNNEL_PORTAL_RECONCILIATION_PIPELINE','reconcileTerrainWithRideExcavation(compilation, rideExcavationMask, options)','validateTerrainTunnelPortalReconciliation(compilation, rideExcavationMask, terrainTunnelPortalReconciliation)','terrainTunnelPortalReconciliation,'])if(!source.includes(t))throw new Error(`Phase 35 portal pipeline missing ${t}`);
  const terrain=source.indexOf('applyTerrainStructuresToCompilation(compilation, reconstructionGraph, options)');
  const portal=source.indexOf('reconcileTerrainWithRideExcavation(compilation, rideExcavationMask, options)');
  const excavation=source.indexOf('applyRideExcavationToCompilation(compilation, rideExcavationMask)');
  const ride=source.indexOf('applyRideGraphToCompilation(compilation, reconstructionGraph, options)');
  if(!(terrain>=0&&portal>terrain&&excavation>portal&&ride>excavation))throw new Error('Phase 35 portal reconciliation must run after terrain phase 6 and before Phase 34 excavation/ride compilation');
}
function replaceOnce(source,before,after,label){if(source.includes(after))return source;const first=source.indexOf(before);if(first<0)throw new Error(`Phase 35 portal anchor missing: ${label}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`Phase 35 portal anchor ambiguous: ${label}`);return source.slice(0,first)+after+source.slice(first+before.length);}
function selfTestTransform(){const sample=['import { applyTerrainStructuresToCompilation, validateTerrainStructureCompilation } from "./terrain-structure-compiler.mjs";','function build(){','  const terrainStructureCompilation = applyTerrainStructuresToCompilation(compilation, reconstructionGraph, options);','  validateTerrainStructureCompilation(compilation, terrainStructureCompilation);','  const rideExcavationCompilation = applyRideExcavationToCompilation(compilation, rideExcavationMask);','  const rideGraphCompilation = applyRideGraphToCompilation(compilation, reconstructionGraph, options);','  const evidence={','    terrainStructureCompilation,','    rideExcavationCompilation,','  };','}'].join('\n');const a=transformPipeline(sample),b=transformPipeline(a);if(a!==b)throw new Error('Phase 35 portal transform not idempotent');validatePipeline(a);console.log('Phase 35 tunnel portal reconciliation installer self-test passed');}
