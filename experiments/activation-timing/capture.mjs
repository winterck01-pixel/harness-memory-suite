import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ActivationLearningPipeline,fingerprint} from './pipeline/index.mjs';

// These files are the original review inputs, not live approval-state snapshots.
function initialCandidate(candidate){
 const {frozenHash,...value}=structuredClone(candidate);
 return {...value,status:'proposed',humanReview:'pending',agentReview:'pending'};
}
function packetFor(candidate){return {candidateId:candidate.id,candidateVersion:candidate.version,contentHash:candidate.contentHash,
 reviewPacketHash:candidate.reviewPacketHash,contractFingerprint:candidate.contractFingerprint,
 sourceFingerprint:candidate.sourceFingerprint,evidenceRefs:candidate.evidenceRefs,
 observation:candidate.observation,instruction:candidate.instruction,applicability:candidate.applicability,
 scope:'isolated-sandbox-evaluation-only',humanReview:'pending',productionEligible:false};}
async function validateExisting(path,expected){
 let existing;
 try {existing=JSON.parse(await readFile(path,'utf8'));}
 catch(error){if(error.code==='ENOENT')return false;throw new Error(`Capture artifact unreadable: ${path}`,{cause:error});}
 if(fingerprint(existing)!==fingerprint(expected))throw new Error(`Capture artifact conflict: ${path}`);
 return true;
}
async function ensureArtifact(path,value){
 try {await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
 catch(error){if(error.code!=='EEXIST')throw error;await validateExisting(path,value);}
}
export async function capture({reportPath,stateDirectory,outputDirectory}){
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 if(report.kind!=='actual-host-contract-reproduction')throw Error('Actual host reproduction required');
 const source=report.episodes.find(e=>e.id==='activation-observed');
 if(!source?.events?.length)throw Error('Missing timing source');
 const pipeline=new ActivationLearningPipeline({directory:stateDirectory});
 const consumption=pipeline.ingest(source.events,{consent:true});
 const candidate=pipeline.propose({sourceId:source.id,taskId:source.id});
 if(!candidate.id||!candidate.contentHash||!candidate.reviewPacketHash)throw Error('Complete source did not produce a candidate');
 const original=initialCandidate(candidate),packet=packetFor(original);
 const candidatePath=join(outputDirectory,'candidate.json'),packetPath=join(outputDirectory,'review-packet.json');
 // Validate every existing artifact before filling gaps. A stale or edited output
 // must never be silently replaced, including after approval or freeze.
 await validateExisting(candidatePath,original);await validateExisting(packetPath,packet);
 await mkdir(outputDirectory,{recursive:true});
 await ensureArtifact(candidatePath,original);await ensureArtifact(packetPath,packet);
 return {consumption,candidate,packet,pipeline};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 const [reportPath,stateDirectory,outputDirectory]=process.argv.slice(2);
 if(!reportPath||!stateDirectory||!outputDirectory)throw Error('Usage: capture.mjs REPORT STATE_DIRECTORY OUTPUT_DIRECTORY (private paths outside repository)');
 const {consumption,packet}=await capture({reportPath,stateDirectory,outputDirectory});
 console.log(JSON.stringify({consumption,...packet}));
}
