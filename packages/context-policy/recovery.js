import {readConstraintSnapshot} from './delegated-policy.js';
import {createState,claim} from './policy.js';
const projections=new WeakMap();


export function recoverConstraints(session){
 if(!session||typeof session!=='object')return null;
 const array=Array.isArray(session.events)?session.events:null;
 if(!array&&typeof session.snapshotEvents!=='function')return null;
 const end=array?.length??session.seq;
 let p=projections.get(session);
 if(!p||Number.isInteger(end)&&end<p.offset){p={offset:0,state:createState(),active:false,inherited:{},pending:{'next-turn':[],'next-step':[]}};projections.set(session,p);}
 const events=array?array.slice(p.offset):session.snapshotEvents(p.offset,end);
 for(const e of events){
  if(e.type==='turn/start'){p.state=createState();p.inherited={};p.state.turn=e.data.turn;p.active=true;}
  else if(e.type==='turn/end'){p.state=createState();p.inherited={};p.active=false;}
  else if(e.type==='agent/inbox/spliced'){
   const d=e.data,queue=p.pending[d.target];if(!queue)continue;
   const removed=queue.splice(d.start,d.removedCount??0,...(d.inserted??[]));

   if(p.active&&d.outcome!=='canceled')for(const message of removed)claim(p.state,{turn:p.state.turn,message,sessionId:session.id});
  }else if(p.active&&e.type==='user/message'){claim(p.state,{turn:p.state.turn,message:e.data,sessionId:session.id});const inherited=readConstraintSnapshot(e.data,session.id,p.state.turn);if(inherited)for(const k of ['blocked','memoryBlocked','knowledgeBlocked'])p.inherited[k] ||= inherited[k];}
 }
 p.offset+=events.length;

 const s=createState();s.turn=p.state.turn;s.blocked=p.state.blocked;s.memoryBlocked=p.state.memoryBlocked;s.knowledgeBlocked=p.state.knowledgeBlocked;
 s.hasUser=p.state.hasUser;for(const k of ['blocked','memoryBlocked','knowledgeBlocked'])s[k] ||= Boolean(p.inherited[k]);
 return s;
}
