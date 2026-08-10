#!/usr/bin/env node
// TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_INSTALLER
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2); const i=args.indexOf('--generator');
const generator=i>=0?path.resolve(args[i+1]):null; const validateOnly=args.includes('--validate-only'); const selfTest=args.includes('--self-test');
if(selfTest) selfTestTransform(); else if(!generator) throw new Error('--generator is required'); else await install(generator,validateOnly);
async function install(root,validate){
  const moduleFile=path.join(root,'src/lib/terrain-planning-structure-association.mjs');
  const testFile=path.join(root,'test/terrain-planning-structure-association.test.mjs');
  const verticalFile=path.join(root,'src/lib/vertical-evidence-engine.mjs');
  if(!validate){
    await writeFile(moduleFile,await readFile(path.join(here,'terrain-planning-structure-association.mjs'),'utf8'));
    await writeFile(testFile,await readFile(path.join(here,'terrain-planning-structure-association.test.mjs'),'utf8'));
    await writeFile(verticalFile,transformVerticalEngine(await readFile(verticalFile,'utf8')));
  }
  const m=await readFile(moduleFile,'utf8'), t=await readFile(testFile,'utf8'), v=await readFile(verticalFile,'utf8');
  for(const token of ['TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1','associatePlanningTerrainStructures','validatePlanningTerrainStructures']) if(!m.includes(token)) throw new Error(`Phase 35 planning terrain association module missing ${token}`);
  for(const token of ['planning retaining wall promotes nearby DTM cliff','generic fence near cliff does not become retaining wall','planning cutting and embankment remain distinct']) if(!t.includes(token)) throw new Error(`Phase 35 planning terrain tests missing ${token}`);
  validateVerticalEngine(v);
  console.log(JSON.stringify({status:validate?'validated':'installed',marker:'TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1'}));
}
export function transformVerticalEngine(source){
  if(source.includes('TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_INTEGRATION')) return source;
  let out=replaceOnce(source,
    'import { classifyTerrainMorphology, validateTerrainMorphology } from "./terrain-morphology.mjs";',
    'import { classifyTerrainMorphology, validateTerrainMorphology } from "./terrain-morphology.mjs";\nimport { associatePlanningTerrainStructures, validatePlanningTerrainStructures } from "./terrain-planning-structure-association.mjs";\nconst TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_INTEGRATION = true;',
    'planning terrain association import');
  out=replaceOnce(out,
    '  diagnostics.terrainMorphology = terrainMorphology;',
    '  diagnostics.terrainMorphology = terrainMorphology;\n  const terrainPlanningAssociation = associatePlanningTerrainStructures(graph, options);\n  validatePlanningTerrainStructures(graph);\n  diagnostics.terrainPlanningAssociation = terrainPlanningAssociation;',
    'planning terrain association stage');
  validateVerticalEngine(out); return out;
}
function validateVerticalEngine(source){
  for(const token of ['TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_INTEGRATION','associatePlanningTerrainStructures(graph, options)','validatePlanningTerrainStructures(graph)','diagnostics.terrainPlanningAssociation = terrainPlanningAssociation']) if(!source.includes(token)) throw new Error(`Phase 35 planning terrain integration missing ${token}`);
  const morphology=source.indexOf('classifyTerrainMorphology(graph, options.verticalSources || null, options)');
  const association=source.indexOf('associatePlanningTerrainStructures(graph, options)');
  const rides=source.indexOf('solveRideVerticalProfiles(graph, options)');
  if(!(morphology>=0&&association>morphology&&rides>association)) throw new Error('Phase 35 planning terrain association must run after morphology and before ride reconstruction');
}
function replaceOnce(source,before,after,label){if(source.includes(after))return source;const first=source.indexOf(before);if(first<0)throw new Error(`Phase 35 planning terrain anchor missing: ${label}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`Phase 35 planning terrain anchor ambiguous: ${label}`);return source.slice(0,first)+after+source.slice(first+before.length);}
function selfTestTransform(){const sample=['import { classifyTerrainMorphology, validateTerrainMorphology } from "./terrain-morphology.mjs";','function solve(){','  const terrainMorphology = classifyTerrainMorphology(graph, options.verticalSources || null, options);','  validateTerrainMorphology(graph);','  diagnostics.terrainMorphology = terrainMorphology;','  const buildingRoofReconstruction = reconstructBuildingRoofs(graph, options.verticalSources || null, options);','  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);','}'].join('\n');const a=transformVerticalEngine(sample),b=transformVerticalEngine(a);if(a!==b)throw new Error('Phase 35 planning terrain transform not idempotent');validateVerticalEngine(a);console.log('Phase 35 planning terrain association installer self-test passed');}
