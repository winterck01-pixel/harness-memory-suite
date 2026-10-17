import { selectCaptureText } from './capture-policy.js'

export function currentTurnEvents(source, expectedTurn) {
 const events = Array.isArray(source) ? source : source?.events
 if (Array.isArray(events)) {
  if (!events.length) return []
  for(let i=events.length-1;i>=0;i--){
   const event=events[i]
   if(event?.type==='turn/start'){
    if(expectedTurn!=null && event.data?.turn!=null && event.data.turn!==expectedTurn)return []
    return events.slice(i)
   }
  }
  return []
 }


 return readCurrentTurnEvents(source, expectedTurn)
}


export function readCurrentTurnEvents(session, expectedTurn, {chunkSize=128} = {}) {
 const end=typeof session?.seq==='number'?session.seq:0
 if(typeof session?.snapshotEvents!=='function')return []
 const chunks=[]
 for(let to=end;to>0;){
  const from=Math.max(0,to-chunkSize)
  const chunk=session.snapshotEvents(from,to) ?? []
  for(let i=chunk.length-1;i>=0;i--){
   if(chunk[i]?.type==='turn/start'){
    if(expectedTurn!=null && chunk[i].data?.turn!=null && chunk[i].data.turn!==expectedTurn)return []
    return [...chunk.slice(i),...chunks.reverse().flat()]
   }
  }
  chunks.push(chunk);to=from
 }
 return []
}

export function captureDisabled(text) { return selectCaptureText(text).hasOptOut }
