#!/usr/bin/env node
// TPMAP_PHASE36_PLAYER_WORLD_PLANNING_QA_SUPPRESSION
// Preserve planning_qa provenance and its regression tests. Only the actual
// player-world CLI invocation disables the visual QA overlay, so planning data
// still passes through its normal semantic/material compiler.
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
const args=process.argv.slice(2),gi=args.indexOf("--generator"),root=gi>=0?path.resolve(args[gi+1]):null;
const validateOnly=args.includes("--validate-only"),selfTest=args.includes("--self-test"),MARKER="TPMAP_PHASE36_PLAYER_WORLD_PLANNING_QA_SUPPRESSION";
if(selfTest)runSelfTest();else if(!root)throw new Error("--generator is required");else await install(root,validateOnly);

async function install(root,validate){
  const file=path.join(root,"src/lib/raster.mjs");
  if(!validate)await writeFile(file,transform(await readFile(file,"utf8")));
  validateSource(await readFile(file,"utf8"));
  console.log(JSON.stringify({status:validate?"validated":"installed",marker:MARKER}));
}
export function transform(source){
  if(source.includes(MARKER)){validateSource(source);return source;}
  const anchor='function isPlanningQaFeature(feature) {';
  const at=source.indexOf(anchor);
  if(at<0||source.indexOf(anchor,at+anchor.length)>=0)throw new Error("Planning QA suppression raster anchor missing or ambiguous");
  const inject=`${anchor}\n  // ${MARKER}\n  if (typeof process !== "undefined" && process.env?.TPMAP_PLAYER_WORLD_DISABLE_PLANNING_QA === "1") return false;`;
  const out=source.slice(0,at)+inject+source.slice(at+anchor.length);
  validateSource(out);return out;
}
function validateSource(s){for(const token of [MARKER,'TPMAP_PLAYER_WORLD_DISABLE_PLANNING_QA === "1"','function isPlanningQaFeature(feature) {'])if(!s.includes(token))throw new Error(`Planning QA suppression missing ${token}`);}
function runSelfTest(){const sample='function isPlanningQaFeature(feature) { return feature?.tags?.planning_qa === true; }';const a=transform(sample),b=transform(a);if(a!==b)throw new Error("Planning QA suppression is not idempotent");validateSource(a);console.log("Player-world planning QA suppression self-test passed");}