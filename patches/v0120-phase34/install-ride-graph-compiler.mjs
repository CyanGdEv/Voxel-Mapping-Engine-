#!/usr/bin/env node
// TPMAP_PHASE34_RIDE_GRAPH_COMPILER_INSTALLER
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),i=args.indexOf("--generator"),generator=i>=0?path.resolve(args[i+1]):null,validateOnly=args.includes("--validate-only"),selfTest=args.includes("--self-test");
if(selfTest) selfTestTransform(); else if(!generator) throw new Error("--generator is required"); else await install(generator,validateOnly);

async function install(root,validate){
  const moduleFile=path.join(root,"src/lib/ride-graph-compiler.mjs"),testFile=path.join(root,"test/ride-graph-compiler.test.mjs"),pipelineFile=path.join(root,"src/lib/pipeline.mjs");
  if(!validate){await writeFile(moduleFile,await readFile(path.join(here,"ride-graph-compiler.mjs"),"utf8"));await writeFile(testFile,await readFile(path.join(here,"ride-graph-compiler.test.mjs"),"utf8"));await writeFile(pipelineFile,transformPipeline(await readFile(pipelineFile,"utf8")));}
  const moduleSource=await readFile(moduleFile,"utf8"),testSource=await readFile(testFile,"utf8"),pipelineSource=await readFile(pipelineFile,"utf8");
  for(const t of ["TPMAP_PHASE34_RIDE_GRAPH_COMPILER_V1","applyRideGraphToCompilation","validateRideGraphCompilation"]) if(!moduleSource.includes(t)) throw new Error(`Phase 34 ride graph compiler module missing ${t}`);
  for(const t of ["preserves high crossing","compiler datum","portal stone bricks survive","exact compilation no-op","OSM-derived graph ride fails closed"]) if(!testSource.includes(t)) throw new Error(`Phase 34 ride graph compiler tests missing ${t}`);
  validatePipeline(pipelineSource); console.log(JSON.stringify({status:validate?"validated":"installed",marker:"TPMAP_PHASE34_RIDE_GRAPH_COMPILER_V1"}));
}
export function transformPipeline(source){
  if(source.includes("TPMAP_PHASE34_RIDE_GRAPH_COMPILER_PIPELINE")) return source;
  let out=replaceOnce(source,'import { applyRideExcavationToCompilation, validateRideExcavationCompilation } from "./ride-excavation-compiler.mjs";','import { applyRideExcavationToCompilation, validateRideExcavationCompilation } from "./ride-excavation-compiler.mjs";\nimport { applyRideGraphToCompilation, validateRideGraphCompilation } from "./ride-graph-compiler.mjs";\nconst TPMAP_PHASE34_RIDE_GRAPH_COMPILER_PIPELINE = true;',"ride graph compiler import");
  out=replaceOnce(out,'  validateRideExcavationCompilation(compilation, rideExcavationCompilation);','  validateRideExcavationCompilation(compilation, rideExcavationCompilation);\n  const rideGraphCompilation = applyRideGraphToCompilation(compilation, reconstructionGraph, options);\n  validateRideGraphCompilation(compilation, rideGraphCompilation);',"ride graph compiler stage");
  out=replaceOnce(out,'    rideExcavationCompilation,\n    accuracy,','    rideExcavationCompilation,\n    rideGraphCompilation,\n    accuracy,',"ride graph compiler evidence");
  validatePipeline(out);return out;
}
function validatePipeline(s){for(const t of ["TPMAP_PHASE34_RIDE_GRAPH_COMPILER_PIPELINE","applyRideGraphToCompilation(compilation, reconstructionGraph, options)","validateRideGraphCompilation(compilation, rideGraphCompilation)","rideGraphCompilation,"])if(!s.includes(t))throw new Error(`Phase 34 ride graph compiler pipeline missing ${t}`);const excavation=s.indexOf("validateRideExcavationCompilation(compilation, rideExcavationCompilation)"),graph=s.indexOf("applyRideGraphToCompilation(compilation, reconstructionGraph, options)");if(!(excavation>=0&&graph>excavation))throw new Error("Phase 34 graph ride compiler must run after excavation compilation");}
function replaceOnce(source,before,after,label){if(source.includes(after))return source;const first=source.indexOf(before);if(first<0)throw new Error(`Phase 34 ride graph compiler anchor missing: ${label}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`Phase 34 ride graph compiler anchor ambiguous: ${label}`);return source.slice(0,first)+after+source.slice(first+before.length);}
function selfTestTransform(){const sample=['import { applyRideExcavationToCompilation, validateRideExcavationCompilation } from "./ride-excavation-compiler.mjs";','async function build(){','  const compilation = {};','  const rideExcavationCompilation = applyRideExcavationToCompilation(compilation, rideExcavationMask);','  validateRideExcavationCompilation(compilation, rideExcavationCompilation);','  const evidence={','    rideExcavationCompilation,','    accuracy,','  };','}'].join("\n");const a=transformPipeline(sample),b=transformPipeline(a);if(a!==b)throw new Error("Phase 34 ride graph compiler transform not idempotent");validatePipeline(a);console.log("Phase 34 ride graph compiler installer self-test passed");}
