#!/usr/bin/env node
// TPMAP_PHASE35_STEEP_BANK_TREATMENT_INSTALLER
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),i=args.indexOf('--generator'),generator=i>=0?path.resolve(args[i+1]):null,validateOnly=args.includes('--validate-only'),selfTest=args.includes('--self-test');
if(selfTest)selfTestTransform();else if(!generator)throw new Error('--generator is required');else await install(generator,validateOnly);

async function install(root,validate){
  const moduleFile=path.join(root,'src/lib/terrain-steep-bank-treatment.mjs');
  const testFile=path.join(root,'test/terrain-steep-bank-treatment.test.mjs');
  const pipelineFile=path.join(root,'src/lib/pipeline.mjs');
  if(!validate){
    await writeFile(moduleFile,await readFile(path.join(here,'terrain-steep-bank-treatment.mjs'),'utf8'));
    await writeFile(testFile,await readFile(path.join(here,'terrain-steep-bank-treatment.test.mjs'),'utf8'));
    await writeFile(pipelineFile,transformPipeline(await readFile(pipelineFile,'utf8')));
  }
  const m=await readFile(moduleFile,'utf8'),t=await readFile(testFile,'utf8'),p=await readFile(pipelineFile,'utf8');
  for(const token of ['TPMAP_PHASE35_STEEP_BANK_TREATMENT_V2','applySteepBankTreatmentToCompilation','validateSteepBankTreatmentCompilation','weirdo_direction'])if(!m.includes(token))throw new Error(`Phase 35 steep-bank module missing ${token}`);
  for(const token of ['cardinal DTM normal emits correctly stateful stair','diagonal DTM normal falls back to slab','engineered cutting is never treated as natural steep bank','treatment never emits air','invalid morphology marker fails closed before mutation'])if(!t.includes(token))throw new Error(`Phase 35 steep-bank tests missing ${token}`);
  validatePipeline(p); console.log(JSON.stringify({status:validate?'validated':'installed',marker:'TPMAP_PHASE35_STEEP_BANK_TREATMENT_V2'}));
}

export function transformPipeline(source){
  if(source.includes('TPMAP_PHASE35_STEEP_BANK_TREATMENT_PIPELINE'))return source;
  let out=replaceOnce(source,
    'import { reconcileTerrainWithRideExcavation, validateTerrainTunnelPortalReconciliation } from "./terrain-tunnel-portal-reconciliation.mjs";',
    'import { applySteepBankTreatmentToCompilation, validateSteepBankTreatmentCompilation } from "./terrain-steep-bank-treatment.mjs";\nimport { reconcileTerrainWithRideExcavation, validateTerrainTunnelPortalReconciliation } from "./terrain-tunnel-portal-reconciliation.mjs";\nconst TPMAP_PHASE35_STEEP_BANK_TREATMENT_PIPELINE = true;',
    'steep-bank import');
  out=replaceOnce(out,
    '  validateTerrainStructureCompilation(compilation, terrainStructureCompilation);\n  const terrainTunnelPortalReconciliation = reconcileTerrainWithRideExcavation(compilation, rideExcavationMask, options);',
    '  validateTerrainStructureCompilation(compilation, terrainStructureCompilation);\n  const steepBankTreatmentCompilation = applySteepBankTreatmentToCompilation(compilation, reconstructionGraph, options);\n  validateSteepBankTreatmentCompilation(compilation, steepBankTreatmentCompilation);\n  const terrainTunnelPortalReconciliation = reconcileTerrainWithRideExcavation(compilation, rideExcavationMask, options);',
    'steep-bank stage');
  out=replaceOnce(out,
    '    terrainStructureCompilation,\n    terrainTunnelPortalReconciliation,',
    '    terrainStructureCompilation,\n    steepBankTreatmentCompilation,\n    terrainTunnelPortalReconciliation,',
    'steep-bank evidence');
  validatePipeline(out); return out;
}
function validatePipeline(source){
  for(const t of ['TPMAP_PHASE35_STEEP_BANK_TREATMENT_PIPELINE','applySteepBankTreatmentToCompilation(compilation, reconstructionGraph, options)','validateSteepBankTreatmentCompilation(compilation, steepBankTreatmentCompilation)','steepBankTreatmentCompilation,'])if(!source.includes(t))throw new Error(`Phase 35 steep-bank pipeline missing ${t}`);
  const terrain=source.indexOf('applyTerrainStructuresToCompilation(compilation, reconstructionGraph, options)');
  const bank=source.indexOf('applySteepBankTreatmentToCompilation(compilation, reconstructionGraph, options)');
  const portal=source.indexOf('reconcileTerrainWithRideExcavation(compilation, rideExcavationMask, options)');
  const excavation=source.indexOf('applyRideExcavationToCompilation(compilation, rideExcavationMask)');
  if(!(terrain>=0&&bank>terrain&&portal>bank&&excavation>portal))throw new Error('Phase 35 steep-bank treatment must run after terrain structures and before portal reconciliation/excavation');
}
function replaceOnce(source,before,after,label){if(source.includes(after))return source;const first=source.indexOf(before);if(first<0)throw new Error(`Phase 35 steep-bank anchor missing: ${label}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`Phase 35 steep-bank anchor ambiguous: ${label}`);return source.slice(0,first)+after+source.slice(first+before.length);}
function selfTestTransform(){const sample=['import { reconcileTerrainWithRideExcavation, validateTerrainTunnelPortalReconciliation } from "./terrain-tunnel-portal-reconciliation.mjs";','function build(){','  const terrainStructureCompilation = applyTerrainStructuresToCompilation(compilation, reconstructionGraph, options);','  validateTerrainStructureCompilation(compilation, terrainStructureCompilation);','  const terrainTunnelPortalReconciliation = reconcileTerrainWithRideExcavation(compilation, rideExcavationMask, options);','  const rideExcavationCompilation = applyRideExcavationToCompilation(compilation, rideExcavationMask);','  const evidence={','    terrainStructureCompilation,','    terrainTunnelPortalReconciliation,','  };','}'].join('\n');const a=transformPipeline(sample),b=transformPipeline(a);if(a!==b)throw new Error('Phase 35 steep-bank transform not idempotent');validatePipeline(a);console.log('Phase 35 steep-bank treatment installer self-test passed');}
