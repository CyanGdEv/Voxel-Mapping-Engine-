#!/usr/bin/env node
// TPMAP_PHASE35_RETAINING_WALL_DETAIL_INSTALLER
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),i=args.indexOf('--generator'),generator=i>=0?path.resolve(args[i+1]):null,validateOnly=args.includes('--validate-only'),selfTest=args.includes('--self-test');
if(selfTest)selfTestTransform();else if(!generator)throw new Error('--generator is required');else await install(generator,validateOnly);

async function install(root,validate){
  const moduleFile=path.join(root,'src/lib/retaining-wall-detail.mjs');
  const testFile=path.join(root,'test/retaining-wall-detail.test.mjs');
  const pipelineFile=path.join(root,'src/lib/pipeline.mjs');
  if(!validate){
    await writeFile(moduleFile,await readFile(path.join(here,'retaining-wall-detail.mjs'),'utf8'));
    await writeFile(testFile,await readFile(path.join(here,'retaining-wall-detail.test.mjs'),'utf8'));
    await writeFile(pipelineFile,transformPipeline(await readFile(pipelineFile,'utf8')));
  }
  const m=await readFile(moduleFile,'utf8'),t=await readFile(testFile,'utf8'),p=await readFile(pipelineFile,'utf8');
  for(const token of ['TPMAP_PHASE35_RETAINING_WALL_DETAIL_V1','applyRetainingWallDetailToCompilation','validateRetainingWallDetailCompilation'])if(!m.includes(token))throw new Error(`Phase 35 retaining-wall module missing ${token}`);
  for(const token of ['explicit material refines wall body while DTM keeps vertical extent','explicit thickness expands only axis-aligned wall normal','explicit coping replaces the measured top course without height growth','no explicit planning detail is exact no-op'])if(!t.includes(token))throw new Error(`Phase 35 retaining-wall tests missing ${token}`);
  validatePipeline(p);console.log(JSON.stringify({status:validate?'validated':'installed',marker:'TPMAP_PHASE35_RETAINING_WALL_DETAIL_V1'}));
}

export function transformPipeline(source){
  if(source.includes('TPMAP_PHASE35_RETAINING_WALL_DETAIL_PIPELINE'))return source;
  let out=replaceOnce(source,
    'import { applySteepBankTreatmentToCompilation, validateSteepBankTreatmentCompilation } from "./terrain-steep-bank-treatment.mjs";',
    'import { applyRetainingWallDetailToCompilation, validateRetainingWallDetailCompilation } from "./retaining-wall-detail.mjs";\nimport { applySteepBankTreatmentToCompilation, validateSteepBankTreatmentCompilation } from "./terrain-steep-bank-treatment.mjs";\nconst TPMAP_PHASE35_RETAINING_WALL_DETAIL_PIPELINE = true;',
    'retaining-wall import');
  out=replaceOnce(out,
    '  validateTerrainStructureCompilation(compilation, terrainStructureCompilation);\n  const steepBankTreatmentCompilation = applySteepBankTreatmentToCompilation(compilation, reconstructionGraph, options);',
    '  validateTerrainStructureCompilation(compilation, terrainStructureCompilation);\n  const retainingWallDetailCompilation = applyRetainingWallDetailToCompilation(compilation, reconstructionGraph, options);\n  validateRetainingWallDetailCompilation(compilation, retainingWallDetailCompilation);\n  const steepBankTreatmentCompilation = applySteepBankTreatmentToCompilation(compilation, reconstructionGraph, options);',
    'retaining-wall stage');
  out=replaceOnce(out,
    '    terrainStructureCompilation,\n    steepBankTreatmentCompilation,',
    '    terrainStructureCompilation,\n    retainingWallDetailCompilation,\n    steepBankTreatmentCompilation,',
    'retaining-wall evidence');
  validatePipeline(out);return out;
}
function validatePipeline(source){
  for(const t of ['TPMAP_PHASE35_RETAINING_WALL_DETAIL_PIPELINE','applyRetainingWallDetailToCompilation(compilation, reconstructionGraph, options)','validateRetainingWallDetailCompilation(compilation, retainingWallDetailCompilation)','retainingWallDetailCompilation,'])if(!source.includes(t))throw new Error(`Phase 35 retaining-wall pipeline missing ${t}`);
  const terrain=source.indexOf('applyTerrainStructuresToCompilation(compilation, reconstructionGraph, options)');
  const wall=source.indexOf('applyRetainingWallDetailToCompilation(compilation, reconstructionGraph, options)');
  const bank=source.indexOf('applySteepBankTreatmentToCompilation(compilation, reconstructionGraph, options)');
  const portal=source.indexOf('reconcileTerrainWithRideExcavation(compilation, rideExcavationMask, options)');
  if(!(terrain>=0&&wall>terrain&&bank>wall&&portal>bank))throw new Error('Phase 35 retaining-wall detail must run after terrain structures and before steep-bank/portal reconciliation');
}
function replaceOnce(source,before,after,label){if(source.includes(after))return source;const first=source.indexOf(before);if(first<0)throw new Error(`Phase 35 retaining-wall anchor missing: ${label}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`Phase 35 retaining-wall anchor ambiguous: ${label}`);return source.slice(0,first)+after+source.slice(first+before.length);}
function selfTestTransform(){const sample=['import { applySteepBankTreatmentToCompilation, validateSteepBankTreatmentCompilation } from "./terrain-steep-bank-treatment.mjs";','function build(){','  const terrainStructureCompilation = applyTerrainStructuresToCompilation(compilation, reconstructionGraph, options);','  validateTerrainStructureCompilation(compilation, terrainStructureCompilation);','  const steepBankTreatmentCompilation = applySteepBankTreatmentToCompilation(compilation, reconstructionGraph, options);','  const terrainTunnelPortalReconciliation = reconcileTerrainWithRideExcavation(compilation, rideExcavationMask, options);','  const evidence={','    terrainStructureCompilation,','    steepBankTreatmentCompilation,','  };','}'].join('\n');const a=transformPipeline(sample),b=transformPipeline(a);if(a!==b)throw new Error('Phase 35 retaining-wall transform not idempotent');validatePipeline(a);console.log('Phase 35 retaining-wall detail installer self-test passed');}
