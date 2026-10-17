import { randomUUID } from 'node:crypto'


const DEFAULTS = { maxSessions:100, maxExposuresPerSession:200, maxDeclarationsPerSession:200, maxTrialsPerSession:20, maxTurnsPerSession:100 }
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k)
const clone=x=>structuredClone(x)
function object(x,keys) {
  if (!x || typeof x!=='object' || Array.isArray(x) || Object.keys(x).some(k=>!keys.includes(k))) throw new TypeError('Invalid ledger fields')
}
function str(x,name,max=512) { if(typeof x!=='string'||!x.trim()||x.length>max) throw new TypeError(`Invalid ${name}`);return x }
function ctx(a,turn=true) { str(a.session,'session');str(a.scope,'scope');if(turn||own(a,'turn'))str(a.turn,'turn') }
function entry(a) {str(a.id,'id');if(!Number.isSafeInteger(a.version)||a.version<1)throw new TypeError('Invalid version');str(a.binding,'binding',4096)}
const key=(s,p)=>JSON.stringify([s,p])
const trim=(a,n)=>{if(a.length>n)a.splice(0,a.length-n)}
export class TaskMemoryLedger {
  constructor(options={}) {
    object(options,Object.keys(DEFAULTS));this.options={...DEFAULTS,...options}
    for(const [k,v]of Object.entries(this.options))if(!Number.isSafeInteger(v)||v<1||v>10000)throw new TypeError(`Invalid ${k}`)
    this.options.maxTrialsPerSession=Math.min(20,this.options.maxTrialsPerSession)
    this.sessions=new Map()
  }
  _get(a,create=false) {
    ctx(a,false);const k=key(a.session,a.scope);let s=this.sessions.get(k)
    if(!s&&create){s={session:a.session,scope:a.scope,currentTurn:null,turns:[],exposures:[],declarations:[],outcomes:[],trials:[]};this.sessions.set(k,s);while(this.sessions.size>this.options.maxSessions)this.sessions.delete(this.sessions.keys().next().value)}
    return s
  }
  _current(a) {const s=this._get(a);if(!s||s.currentTurn!==a.turn)throw new Error('Unknown or stale task exposure');return s}
  expose(a) {
    object(a,['session','scope','turn','items']);ctx(a)
    if(!Array.isArray(a.items)||a.items.length>this.options.maxExposuresPerSession)throw new TypeError('Invalid items')
    for(const i of a.items){object(i,['id','version','binding']);entry(i)}

    const s0=this._get(a);const seen=new Map()
    for(const i of a.items){const k=key(i.id,i.version);const prev=seen.get(k)||s0?.exposures.find(e=>e.turn===a.turn&&e.id===i.id&&e.version===i.version);if(prev&&prev.binding!==i.binding)throw new Error('Conflicting exposure binding');seen.set(k,i)}
    if(s0&&s0.currentTurn!==a.turn&&s0.turns.includes(a.turn))throw new Error('Retired exposure turn')
    if(s0?.currentTurn===a.turn&&new Set([...s0.exposures.filter(e=>e.turn===a.turn).map(e=>key(e.id,e.version)),...a.items.map(i=>key(i.id,i.version))]).size>this.options.maxExposuresPerSession)throw new Error('Current turn exposure limit')
    const s=this._get(a,true)
    if(s.currentTurn!==a.turn){s.currentTurn=a.turn;s.turns.push(a.turn);trim(s.turns,this.options.maxTurnsPerSession)}
    const result=a.items.map(i=>{
      let e=s.exposures.find(e=>e.turn===a.turn&&e.id===i.id&&e.version===i.version)
      if(!e){e={...clone(i),turn:a.turn,receipt:randomUUID()};s.exposures.push(e)}
      return {id:e.id,version:e.version,binding:e.binding,receipt:e.receipt}
    })
    s.exposures=s.exposures.filter(e=>s.turns.includes(e.turn))
    trim(s.exposures,this.options.maxExposuresPerSession)
    const retained=new Set(s.exposures.map(e=>e.receipt));s.declarations=s.declarations.filter(d=>retained.has(d.receipt))

    s.outcomes=s.outcomes.filter(o=>s.turns.includes(o.turn))
    s.trials=s.trials.filter(t=>s.turns.includes(t.turn))
    return result
  }
  references(a) {
    object(a,['session','scope','turn','ids']);ctx(a)
    if(!Array.isArray(a.ids)||a.ids.length>this.options.maxExposuresPerSession)throw new TypeError('Invalid reference ids')
    a.ids.forEach(id=>str(id,'id'));const s=this._get(a);if(!s||s.currentTurn!==a.turn)return []
    const ids=new Set(a.ids);return s.exposures.filter(e=>e.turn===a.turn&&ids.has(e.id)).map(e=>({id:e.id,version:e.version,binding:e.binding,receipt:e.receipt}))
  }
  _action(a,action) {
    object(a,['session','scope','turn','id','version','binding','receipt','reason','callId']);ctx(a)
    str(a.id,'id');if(!Number.isSafeInteger(a.version)||a.version<1)throw new TypeError('Invalid version')
    str(a.receipt,'receipt');str(a.reason,'reason',1000);if(own(a,'callId'))str(a.callId,'callId');if(own(a,'binding'))str(a.binding,'binding',4096)
    const s=this._current(a),e=s.exposures.find(e=>e.receipt===a.receipt&&e.turn===a.turn&&e.id===a.id&&e.version===a.version)
    if(!e||(own(a,'binding')&&e.binding!==a.binding))throw new Error('Unknown or mismatched exposure receipt')
    const prev=s.declarations.find(d=>d.receipt===a.receipt&&d.action===action)
    if(prev)return {ok:true,duplicate:true,action,id:a.id,version:a.version}


    if(s.declarations.length>=this.options.maxDeclarationsPerSession)throw new Error('Task declaration limit')
    s.declarations.push({turn:a.turn,id:a.id,version:a.version,receipt:a.receipt,action,reason:a.reason,...(a.callId?{callId:a.callId}:{})})
    return {ok:true,duplicate:false,action,id:a.id,version:a.version}
  }
  declare(a){return this._action(a,'declare')}
  reject(a){return this._action(a,'reject')}
  outcome(a) {
    object(a,['session','scope','turn','failed','toolError']);ctx(a)
    if(typeof a.failed!=='boolean'||typeof a.toolError!=='boolean')throw new TypeError('Runtime outcome booleans required')


    const s=this._get(a)
    if(!s||!s.turns.includes(a.turn))throw new Error('Unknown runtime outcome turn')
    const prev=s.outcomes.find(o=>o.turn===a.turn)
    if(prev){if(prev.failed!==a.failed||prev.toolError!==a.toolError)throw new Error('Conflicting runtime outcome');return {ok:true,duplicate:true}}


    s.outcomes=s.outcomes.filter(o=>s.turns.includes(o.turn))
    s.outcomes.push({turn:a.turn,failed:a.failed,toolError:a.toolError})
    return {ok:true,duplicate:false}
  }
  trial(a) {
    object(a,['session','scope','turn','text','eventRef']);ctx(a);str(a.text,'text',100000);str(a.eventRef,'eventRef',2048)
    const s=this._get(a);if(!s||!s.turns.includes(a.turn))throw new Error('Unknown trial turn')
    const text=a.text.slice(0,1000),prev=s.trials.find(t=>t.eventRef===a.eventRef)
    if(prev){if(prev.turn!==a.turn||prev.text!==text)throw new Error('Conflicting trial event reference');return {ok:true,duplicate:true}}
    const sameSession=[...this.sessions.values()].filter(v=>v.session===a.session)
    while(sameSession.reduce((n,v)=>n+v.trials.length,0)>=this.options.maxTrialsPerSession){const oldest=sameSession.find(v=>v.trials.length);oldest.trials.shift()}
    s.trials.push({turn:a.turn,text,eventRef:a.eventRef})
    return {ok:true,duplicate:false}
  }
  policy(a) {
    object(a,['session','scope','turn']);ctx(a,false);const s=this._get(a),suppressed=new Map();let failureStreak=0
    if(s){for(const d of s.declarations)if(d.action==='reject')suppressed.set(key(d.id,d.version),{id:d.id,version:d.version})


      const outcomes=new Map(s.outcomes.map(o=>[o.turn,o]))
      for(let i=s.turns.length-1;i>=0;i--){const o=outcomes.get(s.turns[i]);if(!o)continue;if(!o.failed&&!o.toolError)break;failureStreak++}}
    return {...this.status(a),failureStreak,suppressed:[...suppressed.values()]}
  }
  status(a) {
    object(a,['session','scope','turn']);ctx(a,false);const s=this._get(a)
    return {exposedCount:s?.exposures.length||0,declaredCount:s?.declarations.filter(d=>d.action==='declare').length||0,rejectedCount:s?.declarations.filter(d=>d.action==='reject').length||0,trialCount:s?.trials.length||0,outcomeCount:s?.outcomes.length||0,turnCount:s?.turns.length||0}
  }
  toJSON(){return {schemaVersion:1,sessions:clone([...this.sessions.values()])}}
  load(data) {


    const loaded=TaskMemoryLedger.load(data,this.options);this.sessions=loaded.sessions;return this
  }
  static load(data,options={}) {
    if(typeof data==='string'){if(data.length>20000000)throw new TypeError('Ledger snapshot too large');data=JSON.parse(data)}
    object(data,['schemaVersion','sessions']);if(data.schemaVersion!==1||!Array.isArray(data.sessions))throw new TypeError('Invalid ledger snapshot')
    const l=new TaskMemoryLedger(options);if(data.sessions.length>l.options.maxSessions)throw new TypeError('Ledger session limit')
    const receipts=new Set()
    for(const s of data.sessions){
      object(s,['session','scope','currentTurn','turns','exposures','declarations','outcomes','trials']);ctx(s,false);str(s.currentTurn,'currentTurn')
      for(const k of ['turns','exposures','declarations','outcomes','trials'])if(!Array.isArray(s[k]))throw new TypeError('Invalid snapshot array')
      const bounds={turns:l.options.maxTurnsPerSession,exposures:l.options.maxExposuresPerSession,declarations:l.options.maxDeclarationsPerSession,outcomes:l.options.maxTurnsPerSession,trials:l.options.maxTrialsPerSession}
      for(const [k,n]of Object.entries(bounds))if(s[k].length>n)throw new TypeError('Ledger snapshot limit')
      s.turns.forEach(t=>str(t,'turn'));if(new Set(s.turns).size!==s.turns.length||s.turns.at(-1)!==s.currentTurn)throw new TypeError('Invalid current turn')
      const ids=new Set()
      for(const e of s.exposures){object(e,['id','version','binding','turn','receipt']);entry(e);str(e.turn,'turn');if(!s.turns.includes(e.turn))throw new TypeError('Unknown exposure turn');if(typeof e.receipt!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(e.receipt)||receipts.has(e.receipt))throw new TypeError('Invalid receipt');receipts.add(e.receipt);const k=JSON.stringify([e.turn,e.id,e.version]);if(ids.has(k))throw new TypeError('Duplicate exposure');ids.add(k)}
      const actions=new Set()
      for(const d of s.declarations){object(d,['turn','id','version','receipt','action','reason','callId']);str(d.reason,'reason',1000);if(own(d,'callId'))str(d.callId,'callId');if(!['declare','reject'].includes(d.action))throw new TypeError('Invalid declaration action');const e=s.exposures.find(e=>e.receipt===d.receipt&&e.turn===d.turn&&e.id===d.id&&e.version===d.version);if(!e)throw new TypeError('Orphan declaration');const k=key(d.receipt,d.action);if(actions.has(k))throw new TypeError('Duplicate declaration');actions.add(k)}
      const outcomes=new Set();for(const o of s.outcomes){object(o,['turn','failed','toolError']);str(o.turn,'turn');if(typeof o.failed!=='boolean'||typeof o.toolError!=='boolean'||outcomes.has(o.turn))throw new TypeError('Invalid runtime outcome');outcomes.add(o.turn)}
      const events=new Set();for(const t of s.trials){object(t,['turn','text','eventRef']);str(t.turn,'turn');str(t.text,'text',1000);str(t.eventRef,'eventRef',2048);if(events.has(t.eventRef))throw new TypeError('Duplicate trial event');events.add(t.eventRef)}
      const k=key(s.session,s.scope);if(l.sessions.has(k))throw new TypeError('Duplicate task scope');l.sessions.set(k,clone(s))
    }
    const trialCounts=new Map();for(const s of l.sessions.values()){const n=(trialCounts.get(s.session)||0)+s.trials.length;if(n>l.options.maxTrialsPerSession)throw new TypeError('Ledger session trial limit');trialCounts.set(s.session,n)}
    return l
  }
}
export const createTaskMemoryLedger=options=>new TaskMemoryLedger(options)
