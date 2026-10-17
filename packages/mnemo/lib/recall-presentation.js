import {sourceLabel, usable} from './reliability.js'
import {memoryBody} from './relevance.js'


function humanRevision(item) {
  if(item.trust!=='confirmed'||item.reviewSeq!==item.activeSeq)return false
  const active=(item.versions??[]).find(v=>v.seq===item.activeSeq)
  if(!active||active.text!==item.text||!['revise','revert'].includes(active.kind)||!/^Human approved (?:replace|rollback): /.test(active.reason??''))return false

  return (item.evidence??[]).some(e=>e.source==='human-review'&&e.at===active.at&&e.reason===active.reason)
}
function derivation(engine,item,walk={path:new Set(),remaining:512},depth=0) {
  if(depth>=32||walk.remaining--<=0||walk.path.has(item.id))return {approved:false,stale:true,sources:[]}
  if(humanRevision(item))return {approved:false,humanRevised:true,stale:false,sources:[]}
  const ids=[...new Set((item.evidence??[]).map(e=>e.proposalId).filter(Boolean))]
  if(!ids.length)return {approved:false,stale:false,sources:[]}
  walk.path.add(item.id)
  try {
    const proposals=ids.map(id=>engine.log.proposals.get(id))
    const valid=proposals.every(p=>p && p.scope===item.scope && p.status==='accepted'
      && ['gist-compress','skill-compile','retro-plan'].includes(p.proposalKind)
      && p.text===item.text && p.sourceRevisions?.length
      && p.sourceRevisions.every(r=>{
        const src=engine.log.items.get(r.id)


        return src && src.scope===item.scope && (r.scope===undefined||r.scope===item.scope)
          && usable(src) && src.activeSeq===r.seq
          && (src.reviewSeq??null)===(r.reviewSeq??null)
          && !derivation(engine,src,walk,depth+1).stale
      }))
    return {approved:valid && item.trust==='confirmed',stale:!valid,
      sources:valid?[...new Set(proposals.flatMap(p=>p.sourceRevisions.map(r=>r.id)))]:[]}
  } finally {walk.path.delete(item.id)}
}
function excerpt(text,max) {
  const chars=Array.from(text)
  return chars.length<=max?text:chars.slice(0,max).join('')+'…（摘录截断；view=raw 可读原文）'
}
export function presentRecall(engine,hits,{scope,allProjects=false,view='conclusions',limit=5}={}) {
  if(!['conclusions','raw'].includes(view))throw Error('Recall view must be conclusions or raw')
  const rows=[]
  for(const h of hits) {
    let item=engine.log.items.get(h.id)
    if(!item && h.pointer) {
      const pointers=engine.staging?.pointers??[]
      const pos=pointers.findIndex((p,i)=>'pointer:'+(p.id??`${p.at??'na'}:${i}`)===h.id)
      const p=pointers[pos]
      if(!p || (!allProjects && p.scope!==scope))continue
      item={id:h.id,text:p.topic??p.text??'',scope:p.scope,source:p.source??'agent',trust:'unverified',recordedAt:p.at,activeSeq:'pointer',pointer:true}
    }
    if(!item || item.archived || !usable(item) || (!allProjects && item.scope!==scope))continue
    const derived=derivation(engine,item)
    if(view!=='raw' && derived.stale)continue
    const score=Number.isFinite(h.score)?h.score:Number.isFinite(h.r)?h.r:0
    rows.push({h,item,derived,score})
  }
  const best=Math.max(0,...rows.map(r=>r.score))

  if(view!=='raw')rows.sort((a,b)=>Number(b.derived.approved && b.score>=best*.8)-Number(a.derived.approved && a.score>=best*.8))
  return rows.slice(0,limit).map(({h,item,derived,score})=>{
    const label=item.pointer?'线索，原始内容已丢弃':derived.humanRevised?(view==='raw'?'原文，人工确认修订':'人工确认修订'):view==='raw'?'原文':derived.approved?'已批准提炼':'原始记录，尚未提炼'
    const body=memoryBody(item)
    const historical=view!=='raw'&&body!==item.text?'; 历史记录；现状待核验；历史授权不代表本次授权':''
    const partial=Number.isFinite(h.parts?.topic)&&h.parts.topic<.5?'; 部分匹配，未覆盖内容需另行核实':''
    const text=view==='raw'?item.text:excerpt(body,derived.approved?600:240)
    const trace=derived.sources.length?`; 来源=${derived.sources.join(',')}`:''
    const warning=derived.stale?'; 来源已变化，此派生记录须重新核验':''
    return {id:h.id,score,text:`[${label}; version=${item.activeSeq}${trace}${warning}${historical}${partial}] ${sourceLabel({...item,text})}`}
  })
}
