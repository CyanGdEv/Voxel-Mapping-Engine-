#!/usr/bin/env node
// TPMAP_PHASE36_TREE_RECONSTRUCTION_V2_HANDOFF
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
const args=process.argv.slice(2),gi=args.indexOf("--generator"),root=gi>=0?path.resolve(args[gi+1]):null;
const validateOnly=args.includes("--validate-only"),selfTest=args.includes("--self-test"),MARKER="TPMAP_PHASE36_TREE_RECONSTRUCTION_V2_HANDOFF";
if(selfTest)runSelfTest();else if(!root)throw new Error("--generator is required");else await install(root,validateOnly);

async function install(root,validate){
  const file=path.join(root,"src/lib/vegetation-reconstruction.mjs");
  if(!validate)await writeFile(file,transform(await readFile(file,"utf8")));
  validateSource(await readFile(file,"utf8"));
  console.log(JSON.stringify({status:validate?"validated":"installed",marker:MARKER}));
}
export function transform(source){
  if(source.includes(MARKER)){validateSource(source);return source;}
  const before='    Object.defineProperty(node, "vegetationReconstruction", { enumerable: false, configurable: true, value: result });';
  const after=`${before}\n    // ${MARKER}: explicit graph-to-compiler cutover for vegetation only.\n    if (node.sourceFeature && typeof node.sourceFeature === "object") Object.defineProperty(node.sourceFeature, "vegetationReconstruction", { enumerable: false, configurable: true, value: result });`;
  const at=source.indexOf(before);
  if(at<0||source.indexOf(before,at+before.length)>=0)throw new Error("Tree V2 Phase 34 handoff anchor missing or ambiguous");
  const out=source.slice(0,at)+after+source.slice(at+before.length);validateSource(out);return out;
}
function validateSource(source){for(const token of [MARKER,'Object.defineProperty(node.sourceFeature, "vegetationReconstruction"','enumerable: false'])if(!source.includes(token))throw new Error(`Tree V2 handoff missing ${token}`);}
function runSelfTest(){const sample='const result={};\n    Object.defineProperty(node, "vegetationReconstruction", { enumerable: false, configurable: true, value: result });';const a=transform(sample),b=transform(a);if(a!==b)throw new Error("Tree V2 handoff is not idempotent");validateSource(a);console.log("Tree V2 evidence handoff self-test passed");}
