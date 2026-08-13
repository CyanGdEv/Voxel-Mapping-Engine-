#!/usr/bin/env node
// TPMAP_PHASE36_PLAYER_WORLD_PLANNING_QA_SUPPRESSION
// Planning provenance stays attached to promoted features and diagnostics, but
// production world geometry must use its semantic/material compiler rather than
// the pink/orange planning review overlay.
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
const args=process.argv.slice(2),gi=args.indexOf("--generator"),root=gi>=0?path.resolve(args[gi+1]):null;
const validateOnly=args.includes("--validate-only"),selfTest=args.includes("--self-test"),MARKER="TPMAP_PHASE36_PLAYER_WORLD_PLANNING_QA_SUPPRESSION";
if(selfTest)runSelfTest();else if(!root)throw new Error("--generator is required");else await install(root,validateOnly);

async function install(root,validate){
  const file=path.join(root,"src/lib/planning-vector-fusion.mjs");
  if(!validate)await writeFile(file,transform(await readFile(file,"utf8")));
  validateSource(await readFile(file,"utf8"));
  console.log(JSON.stringify({status:validate?"validated":"installed",marker:MARKER}));
}
export function transform(source){
  if(source.includes(MARKER)){validateSource(source);return source;}
  let out=source;
  const qa='        planning_qa: true,';
  const block='        planning_qa_block: "minecraft:pink_wool",';
  const qaAt=out.indexOf(qa),blockAt=out.indexOf(block);
  if(qaAt<0||out.indexOf(qa,qaAt+qa.length)>=0)throw new Error("Planning QA suppression anchor planning_qa missing or ambiguous");
  if(blockAt<0||out.indexOf(block,blockAt+block.length)>=0)throw new Error("Planning QA suppression anchor planning_qa_block missing or ambiguous");
  out=out.replace(qa,'        planning_qa: false,\n        planning_qa_metadata_retained: true,');
  out=out.replace(block,'        planning_qa_block: null,');
  const insert=out.indexOf('function planningState(');
  if(insert<0)throw new Error("Planning QA suppression planningState anchor missing");
  out=out.slice(0,insert)+`const ${MARKER} = true;\n\n`+out.slice(insert);
  validateSource(out);return out;
}
function validateSource(s){for(const token of [MARKER,'planning_qa: false','planning_qa_metadata_retained: true','planning_qa_block: null'])if(!s.includes(token))throw new Error(`Planning QA suppression missing ${token}`);if(s.includes('planning_qa: true'))throw new Error("Player world planning QA overlay is still enabled");}
function runSelfTest(){const sample=['const f={','        planning_qa: true,','        planning_qa_block: "minecraft:pink_wool",','};','function planningState(){}'].join('\n');const a=transform(sample),b=transform(a);if(a!==b)throw new Error("Planning QA suppression is not idempotent");validateSource(a);console.log("Player-world planning QA suppression self-test passed");}
