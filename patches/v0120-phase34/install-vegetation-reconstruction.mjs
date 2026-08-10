#!/usr/bin/env node
// TPMAP_PHASE34_VEGETATION_RECONSTRUCTION_INSTALLER
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
const here=path.dirname(fileURLToPath(import.meta.url)); const args=process.argv.slice(2); const i=args.indexOf("--generator"); const generator=i>=0?path.resolve(args[i+1]):null; const validateOnly=args.includes("--validate-only"); const selfTest=args.includes("--self-test");
if(selfTest) selfTestTransform(); else if(!generator) throw new Error("--generator is required"); else await install(generator,validateOnly);

async function install(root,validate){
  const moduleFile=path.join(root,"src/lib/vegetation-reconstruction.mjs");
  const testFile=path.join(root,"test/vegetation-reconstruction.test.mjs");
  const verticalFile=path.join(root,"src/lib/vertical-evidence-engine.mjs");
  if(!validate){
    await writeFile(moduleFile,await readFile(path.join(here,"vegetation-reconstruction.mjs"),"utf8"));
    await writeFile(testFile,await readFile(path.join(here,"vegetation-reconstruction.test.mjs"),"utf8"));
    await writeFile(verticalFile,transformVerticalEngine(await readFile(verticalFile,"utf8")));
  }
  const moduleSource=await readFile(moduleFile,"utf8"),testSource=await readFile(testFile,"utf8"),verticalSource=await readFile(verticalFile,"utf8");
  for(const t of ["TPMAP_PHASE34_VEGETATION_RECONSTRUCTION_V1","reconstructVegetation","validateVegetationReconstructions"]) if(!moduleSource.includes(t)) throw new Error(`Phase 34 vegetation module missing ${t}`);
  if(!testSource.includes("generic ground-only sampler never fabricates canopy top")) throw new Error("Phase 34 vegetation tests incomplete");
  validateVerticalEngine(verticalSource);
  console.log(JSON.stringify({status:validate?"validated":"installed",marker:"TPMAP_PHASE34_VEGETATION_RECONSTRUCTION_V1"}));
}

export function transformVerticalEngine(source){
  if(source.includes("TPMAP_PHASE34_VEGETATION_INTEGRATION")) return source;
  let out=replaceOnce(source,'import { buildTerrainSurfaceModel, validateTerrainSurfaceModel } from "./terrain-surface-model.mjs";','import { buildTerrainSurfaceModel, validateTerrainSurfaceModel } from "./terrain-surface-model.mjs";\nimport { reconstructVegetation, validateVegetationReconstructions } from "./vegetation-reconstruction.mjs";\nconst TPMAP_PHASE34_VEGETATION_INTEGRATION = true;',"vegetation import");
  // Buildings and roof constraints are installed before vegetation. Insert at the
  // stable ride-profile boundary so vegetation remains after those object stages
  // while still preceding all ride geometry/support reconstruction.
  out=replaceOnce(out,'  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);','  const vegetationReconstruction = reconstructVegetation(graph, options.verticalSources || null, options);\n  validateVegetationReconstructions(graph);\n  diagnostics.vegetationReconstruction = vegetationReconstruction;\n  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);',"vegetation stage");
  validateVerticalEngine(out); return out;
}
function validateVerticalEngine(s){for(const t of ["TPMAP_PHASE34_VEGETATION_INTEGRATION","reconstructVegetation(graph, options.verticalSources || null, options)","validateVegetationReconstructions(graph)","diagnostics.vegetationReconstruction = vegetationReconstruction"])if(!s.includes(t))throw new Error(`Phase 34 vegetation integration missing ${t}`);const terrain=s.indexOf("buildTerrainSurfaceModel(graph, options.verticalSources || null, options)"),building=s.indexOf("reconstructBuildingRoofs(graph, options.verticalSources || null, options)"),veg=s.indexOf("reconstructVegetation(graph, options.verticalSources || null, options)"),ride=s.indexOf("solveRideVerticalProfiles(graph, options)");if(!(terrain>=0&&veg>terrain&&ride>veg&&(building<0||veg>building)))throw new Error("Phase 34 vegetation must run after terrain/building stages and before ride profiles");}
function replaceOnce(source,before,after,label){if(source.includes(after))return source;const first=source.indexOf(before);if(first<0)throw new Error(`Phase 34 vegetation anchor missing: ${label}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`Phase 34 vegetation anchor ambiguous: ${label}`);return source.slice(0,first)+after+source.slice(first+before.length);}
function selfTestTransform(){const sample=['import { buildTerrainSurfaceModel, validateTerrainSurfaceModel } from "./terrain-surface-model.mjs";','export function solveParkVerticalEvidence(graph, options = {}) {','  const diagnostics = {};','  const terrainSurfaceModel = buildTerrainSurfaceModel(graph, options.verticalSources || null, options);','  validateTerrainSurfaceModel(graph);','  diagnostics.terrainSurfaceModel = terrainSurfaceModel;','  const buildingRoofReconstruction = reconstructBuildingRoofs(graph, options.verticalSources || null, options);','  const rideVerticalProfiles = solveRideVerticalProfiles(graph, options);','}'].join("\n");const a=transformVerticalEngine(sample),b=transformVerticalEngine(a);if(a!==b)throw new Error("Phase 34 vegetation transform not idempotent");validateVerticalEngine(a);console.log("Phase 34 vegetation installer self-test passed");}
