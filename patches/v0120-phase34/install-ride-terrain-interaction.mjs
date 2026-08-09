#!/usr/bin/env node
// TPMAP_PHASE34_RIDE_TERRAIN_INTERACTION_INSTALLER
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
const here=path.dirname(fileURLToPath(import.meta.url)); const args=process.argv.slice(2); const i=args.indexOf("--generator"); const generator=i>=0?path.resolve(args[i+1]):null; const validateOnly=args.includes("--validate-only"); const selfTest=args.includes("--self-test");
if(selfTest) selfTestTransform(); else if(!generator) throw new Error("--generator is required"); else await install(generator,validateOnly);

async function install(root,validate){
  const moduleFile=path.join(root,"src/lib/ride-terrain-interaction.mjs"),testFile=path.join(root,"test/ride-terrain-interaction.test.mjs"),verticalFile=path.join(root,"src/lib/vertical-evidence-engine.mjs");
  if(!validate){
    await writeFile(moduleFile,await readFile(path.join(here,"ride-terrain-interaction.mjs"),"utf8"));
    await writeFile(testFile,await readFile(path.join(here,"ride-terrain-interaction.test.mjs"),"utf8"));
    await writeFile(verticalFile,transformVerticalEngine(await readFile(verticalFile,"utf8")));
  }
  const moduleSource=await readFile(moduleFile,"utf8"),testSource=await readFile(testFile,"utf8"),verticalSource=await readFile(verticalFile,"utf8");
  for(const t of ["TPMAP_PHASE34_RIDE_TERRAIN_INTERACTION_V1","classifyRideTerrainInteractions","validateRideTerrainInteractions"]) if(!moduleSource.includes(t)) throw new Error(`Phase 34 ride terrain module missing ${t}`);
  if(!testSource.includes("classifies elevated near-grade cutting and tunnel samples")) throw new Error("Phase 34 ride terrain tests incomplete");
  validateVerticalEngine(verticalSource);
  console.log(JSON.stringify({status:validate?"validated":"installed",marker:"TPMAP_PHASE34_RIDE_TERRAIN_INTERACTION_V1"}));
}

export function transformVerticalEngine(source){
  if(source.includes("TPMAP_PHASE34_RIDE_TERRAIN_INTERACTION_INTEGRATION")) return source;
  let out=replaceOnce(source,
    'import { reconstructRideSupports, validateRideSupportReconstructions } from "./ride-support-reconstruction.mjs";',
    'import { reconstructRideSupports, validateRideSupportReconstructions } from "./ride-support-reconstruction.mjs";\nimport { classifyRideTerrainInteractions, validateRideTerrainInteractions } from "./ride-terrain-interaction.mjs";\nconst TPMAP_PHASE34_RIDE_TERRAIN_INTERACTION_INTEGRATION = true;',
    "ride terrain import");
  out=replaceOnce(out,
    '  diagnostics.ride3dGeometry = ride3dGeometry;\n  const rideSupportReconstruction = reconstructRideSupports(graph, options);',
    '  diagnostics.ride3dGeometry = ride3dGeometry;\n  const rideTerrainInteraction = classifyRideTerrainInteractions(graph, options.verticalSources || null, options);\n  validateRideTerrainInteractions(graph);\n  diagnostics.rideTerrainInteraction = rideTerrainInteraction;\n  const rideSupportReconstruction = reconstructRideSupports(graph, options);',
    "ride terrain stage");
  validateVerticalEngine(out); return out;
}
function validateVerticalEngine(s){for(const t of ["TPMAP_PHASE34_RIDE_TERRAIN_INTERACTION_INTEGRATION","classifyRideTerrainInteractions(graph, options.verticalSources || null, options)","validateRideTerrainInteractions(graph)","diagnostics.rideTerrainInteraction = rideTerrainInteraction"])if(!s.includes(t))throw new Error(`Phase 34 ride terrain integration missing ${t}`); const ride=s.indexOf("buildRide3dGeometry(graph, options)"),terrain=s.indexOf("classifyRideTerrainInteractions(graph, options.verticalSources || null, options)"),support=s.indexOf("reconstructRideSupports(graph, options)");if(!(ride>=0&&terrain>ride&&support>terrain))throw new Error("Phase 34 ride terrain interaction must run after ride 3D and before support reconstruction");}
function replaceOnce(source,before,after,label){if(source.includes(after))return source;const first=source.indexOf(before);if(first<0)throw new Error(`Phase 34 ride terrain anchor missing: ${label}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`Phase 34 ride terrain anchor ambiguous: ${label}`);return source.slice(0,first)+after+source.slice(first+before.length);}
function selfTestTransform(){const sample=['import { reconstructRideSupports, validateRideSupportReconstructions } from "./ride-support-reconstruction.mjs";','export function solveParkVerticalEvidence(graph, options = {}) {','  const diagnostics = {};','  const ride3dGeometry = buildRide3dGeometry(graph, options);','  diagnostics.ride3dGeometry = ride3dGeometry;','  const rideSupportReconstruction = reconstructRideSupports(graph, options);','}'].join("\n");const a=transformVerticalEngine(sample),b=transformVerticalEngine(a);if(a!==b)throw new Error("Phase 34 ride terrain transform not idempotent");validateVerticalEngine(a);console.log("Phase 34 ride terrain interaction installer self-test passed");}
