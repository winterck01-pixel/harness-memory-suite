import {candidateFingerprint} from './evaluation.js'


export function normalizeSourceRevisions(revisions,scope) {
 if(typeof scope!=='string'||!scope||!Array.isArray(revisions)||!revisions.length)return null
 const byId=new Map()
 for(const row of revisions){
  if(!row||typeof row.id!=='string'||!row.id||!Number.isSafeInteger(row.seq)||row.seq<0||(row.scope!==undefined&&row.scope!==scope))return null
  const reviewSeq=row.reviewSeq??null
  if(reviewSeq!==null&&(!Number.isSafeInteger(reviewSeq)||reviewSeq<0))return null
  const value={id:row.id,seq:row.seq,reviewSeq},previous=byId.get(row.id)
  if(previous&&(previous.seq!==value.seq||previous.reviewSeq!==value.reviewSeq))return null
  byId.set(row.id,value)
 }
 return [...byId.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
}
export function sourceRevisionKey(revisions,scope) {
 const normalized=normalizeSourceRevisions(revisions,scope)
 return normalized?candidateFingerprint({scope,revisions:normalized}):null
}
