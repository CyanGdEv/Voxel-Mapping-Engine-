#!/usr/bin/env node
// Fail-closed product gate for player-facing worlds. A syntactically valid
// .mcworld is not a successful park reconstruction if the source evidence was
// dropped, only marker buildings were emitted, or only a tiny fraction of the
// requested park reached the Bedrock database.
import path from 'node:path';
import { readFile, writeFile, stat } from 'node:fs/promises';

const args=parseArgs(process.argv.slice(2));
if(args.selfTest){await selfTest();process.exit(0);}
if(!args.output||!args.world||!args.preset) throw new Error('--output, --world and --preset are required');
const result=await validateWorld(args);
console.log(JSON.stringify(result));
if(result.status!=='passed') process.exitCode=4;

function parseArgs(argv){
  const o={expectedChunks:null};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--self-test')o.selfTest=true;
    else if(a==='--output')o.output=argv[++i];
    else if(a==='--world')o.world=argv[++i];
    else if(a==='--preset')o.preset=argv[++i];
    else if(a==='--expected-chunks')o.expectedChunks=Number(argv[++i]);
    else throw new Error(`Unknown option ${a}`);
  }
  return o;
}

async function readJson(root,name){
  try{return JSON.parse(await readFile(path.join(root,name),'utf8'));}catch{return null;}
}
function finite(...values){for(const v of values){const n=Number(v);if(Number.isFinite(n))return n;}return null;}
function text(...values){for(const v of values){if(v!==null&&v!==undefined&&String(v).trim())return String(v).trim();}return null;}

export async function validateWorld(options){
  const root=path.resolve(options.output);
  const world=path.resolve(options.world);
  const worldInfo=await stat(world);
  const [manifest,build,extraction,fusion,evidence]=await Promise.all([
    readJson(root,'world-manifest.json'),readJson(root,'build-result.json'),readJson(root,'planning-vector-extraction.json'),readJson(root,'planning-vector-fusion.json'),readJson(root,'evidence.json')
  ]);
  const alton=options.preset==='alton-towers';
  const failures=[];
  const warnings=[];
  const worldBytes=worldInfo.size;
  const chunkCount=finite(manifest?.chunks,manifest?.chunkCount,manifest?.stats?.chunks,build?.chunks,build?.world?.chunks);
  const expected=Number.isFinite(options.expectedChunks)&&options.expectedChunks>0?options.expectedChunks:null;
  const minimumChunks=expected?Math.max(512,Math.floor(expected*0.45)):(alton?3500:128);
  const extracted=finite(extraction?.featuresAccepted,extraction?.acceptedFeatures,extraction?.summary?.featuresAccepted);
  const promoted=finite(fusion?.promoted,fusion?.featuresPromoted,fusion?.summary?.promoted,fusion?.evidence?.promoted);
  const fusionStatus=text(fusion?.status,fusion?.summary?.status);
  const buildingMode=text(build?.buildingOutput?.mode,manifest?.buildingOutput?.mode,manifest?.meta?.buildingMode,build?.buildingMode);
  const ride=build?.rideOutput||build?.rides||build?.ride||{};
  const rideTracks=finite(ride?.trackFeatures,ride?.tracks,build?.stats?.rideTrackFeatures);
  const ride3d=finite(ride?.profiledTrackFeatures,ride?.profileBlocks,ride?.supportFrames,evidence?.verticalResolution?.rideVerticalProfiles?.resolved,evidence?.verticalResolution?.ridesResolved);

  if(!worldInfo.isFile()) failures.push('world-not-file');
  if(alton&&worldBytes<5*1024*1024) failures.push(`world-too-small:${worldBytes}`);
  if(chunkCount===null) failures.push('world-chunk-count-missing');
  else if(chunkCount<minimumChunks) failures.push(`world-chunk-coverage-too-small:${chunkCount}<${minimumChunks}`);

  if(alton){
    if(!extraction) failures.push('planning-vector-extraction-report-missing');
    if(!fusion) failures.push('planning-vector-fusion-report-missing');
    if(extracted!==null&&extracted>=100&&(promoted===null||promoted<=0)) failures.push(`planning-extracted-but-none-promoted:${extracted}`);
    if(fusionStatus==='no-features-promoted') failures.push('planning-fusion-no-features-promoted');
    if(buildingMode==='markers') failures.push('building-output-still-marker-mode');
    if(!buildingMode) warnings.push('building-mode-not-reported');
    if(rideTracks!==null&&rideTracks>=10&&(ride3d===null||ride3d<=0)) failures.push(`ride-output-plan-only:${rideTracks}`);
  }

  const result={
    schemaVersion:1,
    policy:'tpmap-player-world-completeness-v1',
    status:failures.length?'failed':'passed',
    preset:options.preset,
    world:{path:path.basename(world),bytes:worldBytes},
    metrics:{chunkCount,expectedChunks:expected,minimumChunks,planningExtracted:extracted,planningPromoted:promoted,planningFusionStatus:fusionStatus,buildingMode,rideTrackFeatures:rideTracks,ride3dEvidence:ride3d},
    failures,warnings
  };
  await writeFile(path.join(root,'world-completeness.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}

async function selfTest(){
  const {mkdtemp,rm,mkdir,writeFile}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const root=await mkdtemp(path.join(tmpdir(),'tpmap-completeness-'));
  try{
    await mkdir(root,{recursive:true});
    const world=path.join(root,'park.mcworld');
    await writeFile(world,Buffer.alloc(6*1024*1024));
    await writeFile(path.join(root,'world-manifest.json'),JSON.stringify({chunks:5000}));
    await writeFile(path.join(root,'build-result.json'),JSON.stringify({buildingOutput:{mode:'solid'},rideOutput:{trackFeatures:20,profiledTrackFeatures:4}}));
    await writeFile(path.join(root,'planning-vector-extraction.json'),JSON.stringify({featuresAccepted:500}));
    await writeFile(path.join(root,'planning-vector-fusion.json'),JSON.stringify({status:'promoted',promoted:200}));
    const good=await validateWorld({output:root,world,preset:'alton-towers',expectedChunks:6000});
    if(good.status!=='passed')throw new Error(`completeness self-test rejected good world: ${good.failures}`);
    await writeFile(path.join(root,'planning-vector-fusion.json'),JSON.stringify({status:'no-features-promoted',promoted:0}));
    const bad=await validateWorld({output:root,world,preset:'alton-towers',expectedChunks:6000});
    if(bad.status!=='failed'||!bad.failures.some((x)=>x.startsWith('planning-extracted-but-none-promoted')))throw new Error('completeness self-test accepted zero-promotion world');
    console.log('generated world completeness self-test passed');
  }finally{await rm(root,{recursive:true,force:true});}
}
