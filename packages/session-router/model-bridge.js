import {symbols} from '@deepseek-ai/cordis';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const HASH='fb0f7b96130f595db20809eeb77a195b05f4a039f931d1e67692f1f74a4dd269';
const reject=()=>{throw Error('session creation: explicit model compatibility unavailable');};


function selectionRevision(session){
 const events=Array.isArray(session.events)?session.events:session.snapshotEvents?.(0,session.seq);
 if(!Array.isArray(events))throw Error('model switch: events unavailable');
 return events.filter(e=>e.type==='model/selection').length;
}
export function makeModelBridge(ctx){
 let available=false;
 const controller=ctx.sessionController,agents=controller?.agents;


 const identity=value=>value?.[symbols.original]??value;
 const owner=identity(controller);
 try{
  const entry=fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-api-session-controller'));
  const pkg=JSON.parse(readFileSync(join(dirname(entry),'../package.json'),'utf8'));
  available=pkg.name==='@deepseek-ai/dsh-api-session-controller'&&((pkg.version==='0.2.0-rc.2'&&createHash('sha256').update(readFileSync(entry)).digest('hex')===HASH)||(pkg.version==='0.2.1-alpha.2'&&createHash('sha256').update(readFileSync(entry)).digest('hex')==='d2a460ebb593c46eff54758470092bed50be249e9d0dde10275d216c088a6e8b'))&&['serializeImageAdmission','selectForNextRequest','selectionFor'].every(k=>typeof agents?.[k]==='function')&&typeof ctx.sessionProjections?.stateOf==='function'&&typeof ctx.llm?.resolveCallConfig==='function';
 }catch{}
 const requireAvailable=()=>{if(!available||identity(ctx.sessionController)!==owner||controller.agents!==agents)reject();};
 return {get available(){return available;},requireAvailable,
  async validate(input){
   requireAvailable();
   const catalog=await controller.modelCatalog();
   const model=catalog.groups.find(g=>g.id===input.provider)?.models.find(m=>m.id===input.model);
   if(!model)throw Error('session creation: provider/model not in configured chat catalog');
   if(input.reasoningEffort!==undefined&&!model.reasoning?.efforts.some(e=>e.id===input.reasoningEffort))throw Error('session creation: reasoning effort not advertised for model');
   const resolved=await ctx.llm.resolveCallConfig(input);
   if(resolved.provider!==input.provider||resolved.model!==input.model)throw Error('session creation: model resolver changed route');
   return {provider:resolved.provider,model:resolved.model,...resolved.reasoningEffort===undefined?{}:{reasoningEffort:String(resolved.reasoningEffort)}};
  },
  snapshot(id){return {agent:ctx.agents.get(id),session:ctx.sessions.get(id),seq:ctx.sessions.get(id)?.seq};},
  async commit(id,selection,guard,snapshot){
   requireAvailable();const {agent,session,seq}=snapshot;
   if(!agent||agent.session!==session||!Number.isSafeInteger(seq))throw Error('session creation: model target unavailable');
   return agents.serializeImageAdmission(agent,async()=>{
    requireAvailable();guard();
    const state=ctx.sessionProjections.stateOf(session,'modelSelection');
    if(ctx.agents.get(id)!==agent||ctx.sessions.get(id)!==session||agent.status!=='idle'||session.seq!==seq||!Array.isArray(agent.inbox?.nextTurn)||!Array.isArray(agent.inbox?.nextStep)||agent.inbox.nextTurn.length||agent.inbox.nextStep.length||session.requestHeader()!==undefined||state?.pending!==null||state?.lastUsed!==null)throw Error('session creation: model target changed; selection preserved');

    agents.selectionFor(agent);
    agents.selectForNextRequest(agent,selection);
    const after=ctx.sessionProjections.stateOf(session,'modelSelection');
    if(JSON.stringify(after?.pending)!==JSON.stringify(selection)||JSON.stringify(agents.selectionFor(agent).current)!==JSON.stringify(selection))throw Error('session creation: native selection behavior mismatch');
    if(!await ctx.sessions.flush(session))throw Error('session creation: model durability unavailable');
   });
  },
  switchSnapshot(id){
   requireAvailable();const agent=ctx.agents.get(id),session=ctx.sessions.get(id);
   if(!agent||agent.session!==session)throw Error('model switch: caller unavailable');
   return {agent,session,revision:selectionRevision(session),selection:JSON.stringify(agents.selectionFor(agent).current),pending:ctx.sessionProjections.stateOf(session,'modelSelection')?.pending};
  },
  async switchCurrent(id,selection,guard,snapshot){
   requireAvailable();const {agent,session,revision}=snapshot;
   return agents.serializeImageAdmission(agent,async()=>{
    requireAvailable();guard();
    if(ctx.agents.get(id)!==agent||ctx.sessions.get(id)!==session||agent.session!==session||agent.status!=='running'||snapshot.pending!==null||selectionRevision(session)!==revision||JSON.stringify(agents.selectionFor(agent).current)!==snapshot.selection)throw Error('model switch: concurrent selection changed; preserved');
    agents.selectForNextRequest(agent,selection);
    const after=ctx.sessionProjections.stateOf(session,'modelSelection');
    if(JSON.stringify(after?.pending)!==JSON.stringify(selection)||JSON.stringify(agents.selectionFor(agent).current)!==JSON.stringify(selection))throw Error('model switch: native selection behavior mismatch');
    if(!await ctx.sessions.flush(session))throw Error('model switch: durability unavailable');
   });
  },
  current(id){
   try{const session=ctx.sessions.get(id);if(!session)return null;const s=ctx.sessionProjections.stateOf(session,'modelSelection');const picked=s?.pending??s?.lastUsed;return picked?{provider:picked.provider,model:picked.model,...picked.reasoningEffort===undefined?{}:{reasoningEffort:picked.reasoningEffort}}:null;}catch{return null;}
  }
 };
}
