
export function migrateState(state, legacy, scope) {
  if (!state) return state
  const next=structuredClone(state)
  for(const entry of [...(next.staging?.pending??[]),...(next.staging?.pointers??[])])if(entry.scope===legacy)entry.scope=scope
  for(const job of next.backlog?.items??[])if(job.payload?.scope===legacy)job.payload.scope=scope
  if(next.staging?.scopeStats) {
    const stats=new Map(next.staging.scopeStats), old=stats.get(legacy)
    if(old) {
      const target=stats.get(scope)??{offers:0,count:[],doc:[],protected:[]}
      const add=(a,b)=>{const m=new Map(a);for(const[k,v]of b)m.set(k,(m.get(k)??0)+v);return [...m]}
      stats.set(scope,{offers:target.offers+old.offers,count:add(target.count,old.count),doc:add(target.doc,old.doc),protected:[...new Set([...target.protected,...old.protected])]});stats.delete(legacy)
      next.staging.scopeStats=[...stats]
    }
  }
  return next
}
