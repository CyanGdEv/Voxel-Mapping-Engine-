#!/usr/bin/env node
// TPMAP_PHASE34_RIDE_EXCAVATION_MASK_INSTALLER
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2); const i=args.indexOf("--generator");
const generator=i>=0?path.resolve(args[i+1]):null; const validateOnly=args.includes("--validate-only"); const selfTest=args.includes("--self-test");
if(selfTest) selfTestTransform(); else if(!generator) throw new Error("--generator is required"); else await install(generator,validateOnly);

async function install(root,validate){
  const moduleFile=path.join(root,"src/lib/ride-excavation-mask.mjs");
  const testFile=path.join(root,"test/ride-excavation-mask.test.mjs");
  const pipelineFile=path.join(root,"src/lib/pipeline.mjs");
  if(!validate){
    await writeFile(moduleFile,await readFile(path.join(here,"ride-excavation-mask.mjs"),"utf8"));
    await writeFile(testFile,await readFile(path.join(here,"ride-excavation-mask.test.mjs"),"utf8"));
    await writeFile(pipelineFile,transformPipeline(await readFile(pipelineFile,"utf8")));
  }
  const moduleSource=await readFile(moduleFile,"utf8"), testSource=await readFile(testFile,"utf8"), pipelineSource=await readFile(pipelineFile,"utf8");
  for(const t of ["TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1","buildRideExcavationMask","validateRideExcavationMask"]) if(!moduleSource.includes(t)) throw new Error(`Phase 34 excavation mask module missing ${t}`);
  if(!testSource.includes("unresolved ride samples are exact no-op")) throw new Error("Phase 34 excavation mask tests incomplete");
  validatePipeline(pipelineSource);
  console.log(JSON.stringify({status:validate?"validated":"installed",marker:"TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1"}));
}

export function transformPipeline(source){
  if(source.includes("TPMAP_PHASE34_RIDE_EXCAVATION_MASK_PIPELINE")) return source;
  let out=replaceOnce(source,
    'import { solveParkVerticalEvidence, validateVerticalResolution } from "./vertical-evidence-engine.mjs";',
    'import { solveParkVerticalEvidence, validateVerticalResolution } from "./vertical-evidence-engine.mjs";\nimport { buildRideExcavationMask, validateRideExcavationMask } from "./ride-excavation-mask.mjs";\nconst TPMAP_PHASE34_RIDE_EXCAVATION_MASK_PIPELINE = true;',
    "excavation mask import");
  out=replaceOnce(out,
    '  validateVerticalResolution(reconstructionGraph);\n  const reconstructionCompileMap = reconstructionCompilerMap(map);',
    '  validateVerticalResolution(reconstructionGraph);\n  const rideExcavationMask = buildRideExcavationMask(reconstructionGraph, options);\n  validateRideExcavationMask(reconstructionGraph);\n  const reconstructionCompileMap = reconstructionCompilerMap(map);',
    "excavation mask stage");
  out=replaceOnce(out,
    '    verticalResolution,\n    accuracy,',
    '    verticalResolution,\n    rideExcavationMask: rideExcavationMask.diagnostics,\n    accuracy,',
    "excavation mask evidence");
  validatePipeline(out); return out;
}
function validatePipeline(s){
  for(const t of ["TPMAP_PHASE34_RIDE_EXCAVATION_MASK_PIPELINE","buildRideExcavationMask(reconstructionGraph, options)","validateRideExcavationMask(reconstructionGraph)","rideExcavationMask: rideExcavationMask.diagnostics"]) if(!s.includes(t)) throw new Error(`Phase 34 excavation mask pipeline missing ${t}`);
  const vertical=s.indexOf("validateVerticalResolution(reconstructionGraph)");
  const mask=s.indexOf("buildRideExcavationMask(reconstructionGraph, options)");
  const boundary=s.indexOf("const reconstructionCompileMap = reconstructionCompilerMap(map)");
  if(!(vertical>=0&&mask>vertical&&boundary>mask)) throw new Error("Phase 34 excavation mask must be built after vertical/interaction solving and before compiler boundary");
}
function replaceOnce(source,before,after,label){if(source.includes(after))return source;const first=source.indexOf(before);if(first<0)throw new Error(`Phase 34 excavation mask anchor missing: ${label}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`Phase 34 excavation mask anchor ambiguous: ${label}`);return source.slice(0,first)+after+source.slice(first+before.length);}
function selfTestTransform(){const sample=['import { solveParkVerticalEvidence, validateVerticalResolution } from "./vertical-evidence-engine.mjs";','async function build(){','  const verticalResolution = solveParkVerticalEvidence(reconstructionGraph, options);','  validateVerticalResolution(reconstructionGraph);','  const reconstructionCompileMap = reconstructionCompilerMap(map);','  const evidence={','    verticalResolution,','    accuracy,','  };','}'].join("\n");const a=transformPipeline(sample),b=transformPipeline(a);if(a!==b)throw new Error("Phase 34 excavation mask transform not idempotent");validatePipeline(a);console.log("Phase 34 excavation mask installer self-test passed");}
