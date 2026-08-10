#!/usr/bin/env node
// TPMAP_PHASE35_TERRAIN_MORPHOLOGY_INSTALLER
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2); const i=args.indexOf('--generator');
const generator=i>=0?path.resolve(args[i+1]):null; const validateOnly=args.includes('--validate-only'); const selfTest=args.includes('--self-test');
if(selfTest) selfTestTransform(); else if(!generator) throw new Error('--generator is required'); else await install(generator,validateOnly);

async function install(root,validate){
  const moduleFile=path.join(root,'src/lib/terrain-morphology.mjs');
  const testFile=path.join(root,'test/terrain-morphology.test.mjs');
  const verticalFile=path.join(root,'src/lib/vertical-evidence-engine.mjs');
  if(!validate){
    await writeFile(moduleFile,await readFile(path.join(here,'terrain-morphology.mjs'),'utf8'));
    await writeFile(testFile,await readFile(path.join(here,'terrain-morphology.test.mjs'),'utf8'));
    await writeFile(verticalFile,transformVerticalEngine(await readFile(verticalFile,'utf8')));
  }
  const moduleSource=await readFile(moduleFile,'utf8'), testSource=await readFile(testFile,'utf8'), verticalSource=await readFile(verticalFile,'utf8');
  for(const t of ['TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1','classifyTerrainMorphology','validateTerrainMorphology']) if(!moduleSource.includes(t)) throw new Error(`Phase 35 terrain morphology module missing ${t}`);
  for(const t of ['flat DTM stays level','near vertical break produces explicit cliff structure groups','missing DTM is unresolved']) if(!testSource.includes(t)) throw new Error(`Phase 35 terrain morphology tests missing ${t}`);
  validateVerticalEngine(verticalSource);
  console.log(JSON.stringify({status:validate?'validated':'installed',marker:'TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1'}));
}

export function transformVerticalEngine(source){
  if(source.includes('TPMAP_PHASE35_TERRAIN_MORPHOLOGY_INTEGRATION')) return source;
  let out=replaceOnce(source,
    'import { buildTerrainSurfaceModel, validateTerrainSurfaceModel } from "./terrain-surface-model.mjs";',
    'import { buildTerrainSurfaceModel, validateTerrainSurfaceModel } from "./terrain-surface-model.mjs";\nimport { classifyTerrainMorphology, validateTerrainMorphology } from "./terrain-morphology.mjs";\nconst TPMAP_PHASE35_TERRAIN_MORPHOLOGY_INTEGRATION = true;',
    'terrain morphology import');
  // Later Phase 34 building/vegetation stages legitimately sit between terrain
  // surface resolution and ride reconstruction. Anchor only on the terrain
  // surface diagnostic, not on obsolete immediate adjacency with ride profiles.
  out=replaceOnce(out,
    '  diagnostics.terrainSurfaceModel = terrainSurfaceModel;',
    '  diagnostics.terrainSurfaceModel = terrainSurfaceModel;\n  const terrainMorphology = classifyTerrainMorphology(graph, options.verticalSources || null, options);\n  validateTerrainMorphology(graph);\n  diagnostics.terrainMorphology = terrainMorphology;',
    'terrain morphology stage');
  validateVerticalEngine(out); return out;
}
function validateVerticalEngine(source){
  for(const t of ['TPMAP_PHASE35_TERRAIN_MORPHOLOGY_INTEGRATION','classifyTerrainMorphology(graph, options.verticalSources || null, options)','validateTerrainMorphology(graph)','diagnostics.terrainMorphology = terrainMorphology']) if(!source.includes(t)) throw new Error(`Phase 35 terrain morphology integration missing ${t}`);
  const surface=source.indexOf('buildTerrainSurfaceModel(graph, options.verticalSources || null, options)');
  const morphology=source.indexOf('classifyTerrainMorphology(graph, options.verticalSources || null, options)');
  const rides=source.indexOf('solveRideVerticalProfiles(graph, options)');
  if(!(surface>=0&&morphology>surface&&rides>morphology)) throw new Error('Phase 35 terrain morphology must run after DTM/DSM surface separation and before ride reconstruction');
}
function replaceOnce(source,before,after,label){if(source.includes(after))return source;const first=source.indexOf(before);if(first<0)throw new Error(`Phase 35 terrain morphology anchor missing: ${label}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`Phase 35 terrain morphology anchor ambiguous: ${label}`);return source.slice(0,first)+after+source.slice(first+before.length);}
function selfTestTransform(){const sample=['import { buildTerrainSurfaceModel, validateTerrainSurfaceModel } from "./terrain-surface-model.mjs";','export function solve(){','  const terrainSurfaceModel = buildTerrainSurfaceModel(graph, options.verticalSources || null, options);','  validateTerrainSurfaceModel(graph);','  diagnostics.terrainSurfaceModel = terrainSurfaceModel;','  const buildingRoofReconstruction = reconstructBuildingRoofs(graph, options.verticalSources || null, options);','  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);','}'].join('\n');const a=transformVerticalEngine(sample),b=transformVerticalEngine(a);if(a!==b)throw new Error('Phase 35 terrain morphology transform not idempotent');validateVerticalEngine(a);console.log('Phase 35 terrain morphology installer self-test passed');}
