
const RELATIVE = /今天|昨天|明天|后天|前天|今晚|昨晚|明早|本周|这周|下周|上周|本月|下个月|上个月|今年|明年|去年|目前|当前|暂时|临时|最新|\b(?:today|yesterday|tomorrow|tonight|currently|temporary|latest|(?:next|last|this)\s+(?:week|month|year))\b/i
export function validTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8640000000000000
}
export function timeReferences(item) {
  const evidence=(item.evidence ?? []).filter(e=>validTimestamp(e.at) && e.source !== 'human-review')
  if(evidence.some(e=>e.proposalId))return evidence
  const matching=evidence.filter(e=>e.source===item.source)
  return matching.length ? matching : evidence
}
export function temporalMetadata(item) {
  const evidence=timeReferences(item)
  const times=[...new Set(evidence.map(e=>e.at))]
  const recorded=item.recordedAt ?? item.versions?.find(v=>v.kind==='create')?.at
  const reference=times[0] ?? recorded
  const parts=[]
  if(times.length>1) {
    parts.push('referenceTime=multiple',`referenceRange=${new Date(Math.min(...times)).toISOString()}..${new Date(Math.max(...times)).toISOString()}`,'referenceBasis=multiple-inputs')
  } else if(validTimestamp(reference))parts.push(`referenceTime=${new Date(reference).toISOString()}`,`referenceBasis=${evidence.length && evidence.every(e=>e.referenceBasis!=='recorded-fallback')?'evidence':'recorded-fallback'}`)
  else if(RELATIVE.test(item.text ?? ''))parts.push('referenceTime=unknown')
  const zones=[...new Set(evidence.map(e=>e.timeZone).filter(Boolean))]
  if(zones.length)parts.push(`timeZone=${zones.length===1?String(zones[0]).replace(/[\r\n;\[\]]/g,' '):'multiple'}`)
  if(validTimestamp(item.expiresAt))parts.push(`expiresAt=${new Date(item.expiresAt).toISOString()}`)
  if(RELATIVE.test(item.text ?? ''))parts.push('timeStatus=verify-current')
  return parts.length ? '; '+parts.join('; ') : ''
}
export function validateExpiry(value) {
  if(value !== null && value !== undefined && !validTimestamp(value))throw new TypeError('expiresAt must be a non-negative finite epoch timestamp or null')
}

export function sameHistoricalStatement(a,b) {
  if(a.text!==b.text)return false
  if(!RELATIVE.test(a.text ?? ''))return true
  const anchor=x=>{const refs=timeReferences(x);return refs.length===1?refs[0].at:refs.length>1?undefined:x.firstSeen ?? x.recordedAt}
  const left=anchor(a),right=anchor(b)
  return validTimestamp(left)&&left===right
}

export function humanInputEvidence(events) {
  let start=0
  for(let i=events.length-1;i>=0;i--)if(events[i]?.type==='turn/start'){start=i;break}
  return events.slice(start).filter(e=>e.type==='user/message'&&e.data?.source?.kind==='user'&&validTimestamp(e.time)).map(e=>({eventSeq:e.seq,source:'human',at:e.time,...(e.data.source.clientTimeZone?{timeZone:e.data.source.clientTimeZone}:{})}))
}
