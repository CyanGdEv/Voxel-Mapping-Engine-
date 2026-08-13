#!/usr/bin/env node
// TPMAP_PHASE36_PLANNING_FUSION_PRODUCTION_CALIBRATION
// Preserve provenance/status/licence gates while calibrating semantic planning
// geometry to the confidence scale actually emitted by the extractor.
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const MARKER='TPMAP_PHASE36_PLANNING_FUSION_PRODUCTION_CALIBRATION';
const FILE='src/lib/planning-vector-fusion.mjs';
const args=process.argv.slice(2);
const gi=args.indexOf('--generator');
const generator=gi>=0?path.resolve(args[gi+1]):null;
const validateOnly=args.includes('--validate-only');
const selfTest=args.includes('--self-test');
if(selfTest) selfTestTransform();
else if(!generator) throw new Error('--generator is required');
else await install(generator,validateOnly);

async function install(root,validate){
  const file=path.join(root,FILE);
  if(!validate) await writeFile(file,transformFusion(await readFile(file,'utf8')));
  validateFusion(await readFile(file,'utf8'));
  console.log(JSON.stringify({status:validate?'validated':'installed',marker:MARKER}));
}

export function transformFusion(source){
  if(source.includes(MARKER)){validateFusion(source);return source;}
  let out=source;

  const currentGateBefore=`    const confidence = clamp01(Number(properties.confidence));\n    if (confidence < config.minConfidence) {\n      evidence.rejectedConfidence += 1;\n      recordDecision(evidence, candidate, { action: "withheld-confidence", role, confidence });\n      continue;\n    }\n    const rmseM = Number(properties.georeference_rmse_m);`;
  const currentGateAfter=`    const confidence = clamp01(Number(properties.confidence));\n    const rmseM = Number(properties.georeference_rmse_m);\n    const confidenceGate = planningFusionConfidenceGate(properties, confidence, rmseM, config);\n    if (!confidenceGate.allowed) {\n      evidence.rejectedConfidence += 1;\n      recordDecision(evidence, candidate, { action: "withheld-confidence", role, confidence, effectiveMinConfidence: confidenceGate.minConfidence, calibration: confidenceGate.reason });\n      continue;\n    }`;
  const legacyGateBefore=`    const confidence = clamp01(Number(properties.confidence));\n    if (confidence < config.minConfidence) {\n      evidence.rejectedConfidence += 1;\n      recordDecision(evidence, entry, "rejected-confidence", { confidence });\n      continue;\n    }\n\n    const rmseM = Number(properties.georeference_rmse_m);`;
  const legacyGateAfter=`    const confidence = clamp01(Number(properties.confidence));\n    const rmseM = Number(properties.georeference_rmse_m);\n    const confidenceGate = planningFusionConfidenceGate(properties, confidence, rmseM, config);\n    if (!confidenceGate.allowed) {\n      evidence.rejectedConfidence += 1;\n      recordDecision(evidence, entry, "rejected-confidence", { confidence, effectiveMinConfidence: confidenceGate.minConfidence, calibration: confidenceGate.reason });\n      continue;\n    }`;
  out=replaceOneVariant(out,[
    [currentGateBefore,currentGateAfter],
    [legacyGateBefore,legacyGateAfter]
  ],'confidence gate');

  const currentSizeBefore=`function sizeEligible(properties, geometryType, config) {\n  if (geometryType === "line") return Number(properties.length_m) >= config.minLineLengthM;\n  return Number(properties.area_m2) >= config.minAreaM2;\n}`;
  const currentSizeAfter=`function sizeEligible(properties, geometryType, config) {\n  const semantic = hasPlanningSemanticEvidence(properties);\n  if (geometryType === "line") {\n    const minimum = semantic ? Math.min(config.minLineLengthM, 2) : config.minLineLengthM;\n    return Number(properties.length_m) >= minimum;\n  }\n  const minimum = semantic ? Math.min(config.minAreaM2, 4) : config.minAreaM2;\n  return Number(properties.area_m2) >= minimum;\n}`;
  const legacySizeBefore=`function sizeEligible(properties, geometryType, config) {\n  if (geometryType === "Point" || geometryType === "MultiPoint") return true;\n  if (geometryType === "LineString" || geometryType === "MultiLineString") {\n    return Number(properties.length_m) >= config.minLineLengthM;\n  }\n  return Number(properties.area_m2) >= config.minAreaM2;\n}`;
  const legacySizeAfter=`function sizeEligible(properties, geometryType, config) {\n  if (geometryType === "Point" || geometryType === "MultiPoint") return true;\n  const semantic = hasPlanningSemanticEvidence(properties);\n  if (geometryType === "LineString" || geometryType === "MultiLineString") {\n    const minimum = semantic ? Math.min(config.minLineLengthM, 2) : config.minLineLengthM;\n    return Number(properties.length_m) >= minimum;\n  }\n  const minimum = semantic ? Math.min(config.minAreaM2, 4) : config.minAreaM2;\n  return Number(properties.area_m2) >= minimum;\n}`;
  out=replaceOneVariant(out,[
    [currentSizeBefore,currentSizeAfter],
    [legacySizeBefore,legacySizeAfter]
  ],'semantic size gate');

  // In production/gated/private modes an accepted approved drawing is allowed
  // to supply missing geometry. Review/off modes remain non-authoritative.
  out=replaceOnce(out,'    const authoritative = mode === "authoritative";','    const authoritative = !["off", "review"].includes(mode);','approved planning authority');

  const insertAt=out.indexOf('function planningState(');
  if(insertAt<0) throw new Error('Phase 36 planning fusion calibration: planningState anchor missing');
  const helpers=`const ${MARKER} = true;\n\nfunction planningFusionConfidenceGate(properties, confidence, rmseM, config) {\n  let minimum = config.minConfidence;\n  let reason = "configured";\n  if (hasPlanningSemanticEvidence(properties) && Number.isFinite(rmseM)) {\n    const state = String(properties.document_state || properties.application_status || "").toLowerCase();\n    const current = ["approved","granted","implemented","existing","as-built","as_built"].some((token) => state.includes(token)) || ["approved","granted","implemented"].includes(String(properties.application_status || "").toLowerCase());\n    if (rmseM <= 0.5 && current) { minimum = Math.min(minimum, 0.70); reason = "semantic-current-high-georef"; }\n    else if (rmseM <= 1.0) { minimum = Math.min(minimum, 0.72); reason = "semantic-high-georef"; }\n  }\n  return { allowed: confidence >= minimum, minConfidence: minimum, reason };\n}\n\nfunction hasPlanningSemanticEvidence(properties) {\n  if (!properties || typeof properties !== "object") return false;\n  const semantic = properties.planning_semantic_class || properties.semantic_class || properties.planning_geometry_role || properties.geometry_role || properties.semantic_label;\n  if (!semantic) return false;\n  const text = String(semantic).trim().toLowerCase();\n  return Boolean(text) && !["unknown","unclassified","generic","linework"].includes(text);\n}\n\n`;
  out=out.slice(0,insertAt)+helpers+out.slice(insertAt);
  validateFusion(out);return out;
}

function validateFusion(source){
  for(const token of [MARKER,'planningFusionConfidenceGate(properties, confidence, rmseM, config)','effectiveMinConfidence','Math.min(config.minLineLengthM, 2)','Math.min(config.minAreaM2, 4)','hasPlanningSemanticEvidence(properties)','const authoritative = !["off", "review"].includes(mode);']) if(!source.includes(token)) throw new Error(`Phase 36 planning fusion calibration missing ${token}`);
  if(!source.includes('rejectedProvenance')||!source.includes('rejectedLicense')||!source.includes('planningState')) throw new Error('Phase 36 planning fusion calibration must preserve downstream authority/provenance gates');
}
function replaceOnce(source,before,after,label){const i=source.indexOf(before);if(i<0)throw new Error(`Phase 36 planning fusion calibration anchor missing: ${label}`);if(source.indexOf(before,i+before.length)>=0)throw new Error(`Phase 36 planning fusion calibration anchor ambiguous: ${label}`);return source.slice(0,i)+after+source.slice(i+before.length);}
function replaceOneVariant(source,variants,label){
  const matches=variants.map(([before])=>source.indexOf(before)).filter((index)=>index>=0);
  if(matches.length!==1) throw new Error(`Phase 36 planning fusion calibration ${label} expected exactly one supported anchor variant, found ${matches.length}`);
  const variant=variants.find(([before])=>source.indexOf(before)>=0);
  return replaceOnce(source,variant[0],variant[1],label);
}
function selfTestTransform(){
  const currentSample=['async function fuse(candidate, properties, config, evidence, role) {','    const confidence = clamp01(Number(properties.confidence));','    if (confidence < config.minConfidence) {','      evidence.rejectedConfidence += 1;','      recordDecision(evidence, candidate, { action: "withheld-confidence", role, confidence });','      continue;','    }','    const rmseM = Number(properties.georeference_rmse_m);','}','function sizeEligible(properties, geometryType, config) {','  if (geometryType === "line") return Number(properties.length_m) >= config.minLineLengthM;','  return Number(properties.area_m2) >= config.minAreaM2;','}','function planningState(applicationStatus, documentState, mode) {','  if (APPROVED_STATUS.test(applicationStatus)) {','    const authoritative = mode === "authoritative";','  }','}','const rejectedProvenance=true, rejectedLicense=true;'].join('\n');
  const currentA=transformFusion(currentSample),currentB=transformFusion(currentA);if(currentA!==currentB)throw new Error('Phase 36 current-source transform is not idempotent');validateFusion(currentA);

  const legacySample=['async function fuse(entry, properties, config, evidence) {','    const confidence = clamp01(Number(properties.confidence));','    if (confidence < config.minConfidence) {','      evidence.rejectedConfidence += 1;','      recordDecision(evidence, entry, "rejected-confidence", { confidence });','      continue;','    }','','    const rmseM = Number(properties.georeference_rmse_m);','}','function sizeEligible(properties, geometryType, config) {','  if (geometryType === "Point" || geometryType === "MultiPoint") return true;','  if (geometryType === "LineString" || geometryType === "MultiLineString") {','    return Number(properties.length_m) >= config.minLineLengthM;','  }','  return Number(properties.area_m2) >= config.minAreaM2;','}','function planningState(applicationStatus, documentState, mode) {','  if (APPROVED_STATUS.test(applicationStatus)) {','    const authoritative = mode === "authoritative";','  }','}','const rejectedProvenance=true, rejectedLicense=true;'].join('\n');
  const legacyA=transformFusion(legacySample),legacyB=transformFusion(legacyA);if(legacyA!==legacyB)throw new Error('Phase 36 legacy-source transform is not idempotent');validateFusion(legacyA);
  console.log('Phase 36 planning fusion production calibration self-test passed for current and legacy source shapes');
}
