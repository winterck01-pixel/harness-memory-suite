import test from 'node:test'
import assert from 'node:assert/strict'
import {buildEvidence,finalizeEvidence} from '../lib/lessons-evidence.js'
import {scanFailures} from '../lib/lessons-signature.js'

function transcript(mode='ordinary',target='/fixture/A.txt'){
 let seq=0;const rows=[],emit=(type,data)=>rows.push({type,seq:++seq,data})
 const pair=(id,tool,path,result,isError=false)=>{
  const args={path}
  if(mode==='ptc'){
   emit('tool/ptc-dispatch-start',{subCallId:id,name:tool,arguments:args})
   emit('tool/ptc-dispatch',{subCallId:id,isError,content:[{type:'text',text:result}]})
  }else{
   emit('tool/call',{callId:id,name:tool,arguments:JSON.stringify(args)})
   emit('tool/result',{message:{content:[{type:'tool-result',callId:id,isError,content:result}]}})
  }
 }
 pair('failed','edit',target,'Error: file has not been read',true)
 pair('read','read',target,'contents')
 pair('retry','edit',target,'edited')
 return {rows,pair}
}

test('closeout: PTC subtool failures retain cited evidence and target association',()=>{
 const {rows}=transcript('ptc'),pack=buildEvidence(rows),scan=scanFailures(rows)
 assert.equal(scan.failures.length,1)
 assert.equal(pack.failures.length,1)
 assert.equal(pack.window.length,3)
 assert.equal(pack.failures[0].signature,scan.failures[0].signature)
 assert.ok(pack.window.every(w=>w.targetKey&&w.targetKey===pack.window[0].targetKey))
 assert.equal(pack.failures[0].fixed,true)
 assert.ok(!pack.window[0].targetKey.includes('/fixture'))
})

test('closeout: ordinary embedded tool-result callId has the same evidence as PTC',()=>{
 const a=buildEvidence(transcript().rows),b=buildEvidence(transcript('ptc').rows)
 assert.equal(a.failures.length,1)
 assert.deepEqual(a.window.map(({seq,tool,failed,targetKey})=>({seq,tool,failed,targetKey})),b.window.map(({seq,tool,failed,targetKey})=>({seq,tool,failed,targetKey})))
 assert.equal(a.failures[0].signature,b.failures[0].signature)
})

test('closeout: a different or unknown target cannot count as a recovered failure',()=>{
 const {rows}=transcript();rows.splice(2)
 rows.push({type:'tool/call',seq:3,data:{callId:'other',name:'edit',arguments:JSON.stringify({path:'/fixture/B.txt'})}},{type:'tool/result',seq:4,data:{message:{toolCallId:'other',isError:false,content:[{type:'text',text:'edited'}]}}})
 assert.equal(scanFailures(rows).failures[0].fixed,false)
 const unknown=rows.map(e=>e.type==='tool/call'?{...e,data:{...e.data,arguments:'{}'}}:e)
 assert.equal(scanFailures(unknown).failures[0].fixed,false)
})

test('closeout: the final transmitted pack includes feedback and reasons within the same budget',()=>{
 let seq=0;const ev=(type,data)=>({type,seq:++seq,data})
 const events=[ev('user/message',{content:[{type:'text',text:'G'.repeat(800)}]})]
 for(let i=0;i<6;i++)events.push(ev('tool/call',{callId:'c'+i,name:'tool'+i,arguments:'{}'}),ev('tool/result',{message:{toolCallId:'c'+i,isError:true,content:[{type:'text',text:'Error: failure '+i+' '+'x'.repeat(590)}]}}))
 for(const maxChars of [6000,2500,1200,800]){
  const pack=buildEvidence(events,{maxChars}),before=JSON.stringify(pack)
  const sent=finalizeEvidence(pack,{maxChars,nextUserMessage:'错了'+'N'.repeat(398),triggerReasons:['repeat','correction']})
  assert.ok(JSON.stringify(sent).length<=maxChars,`${maxChars}: ${JSON.stringify(sent).length}`)
  assert.equal(JSON.stringify(pack),before,'finalization must not mutate the queued evidence')
  for(const f of sent.failures)assert.ok(sent.window.some(w=>w.failed&&w.seq===f.seq),'signature must cite retained evidence')
 }
})

test('closeout: final feedback is scrubbed and withheld feedback stays null',()=>{
 const pack=buildEvidence(transcript('ptc').rows,{nextUser:'old feedback'})
 const text=JSON.stringify(finalizeEvidence(pack,{nextUserMessage:'api_key='+'sk-'+'SYNTHETICabcdefghijklmnopqrst',triggerReasons:['correction']}))
 assert.ok(!text.includes('sk-SYNTHETIC'))
 assert.equal(finalizeEvidence(pack,{nextUserMessage:null}).nextUserMessage,null)
})

test('closeout: clipping a recovery result cannot leave fixed or uncited signatures behind',()=>{
 const pack=buildEvidence(transcript().rows)
 const clipped=finalizeEvidence({...pack,window:pack.window.filter(w=>w.failed)},{maxChars:1200})
 assert.equal(clipped.failures.length,1)
 assert.equal(clipped.failures[0].fixed,false)
 assert.ok(clipped.window.every(w=>w.failed))
})

test('closeout: PTC result arguments without a start event preserve evidence and redact JSON secrets',()=>{
 const password=['SYNTHETIC','PASSWORD','VALUE'].join('_')
 const rows=[{seq:1,type:'tool/ptc-dispatch',data:{subCallId:'sub',name:'read',arguments:{path:'/fixture/A.txt',password},isError:true,content:[{type:'text',text:'Error: file not found'}]}}]
 const pack=buildEvidence(rows)
 assert.equal(pack.failures.length,1)
 assert.equal(pack.window[0].tool,'read')
 assert.ok(pack.window[0].targetKey)
 assert.ok(!JSON.stringify(pack).includes(password))
})

test('closeout: a later same-target failure invalidates an earlier successful retry',()=>{
 const {rows,pair}=transcript('ptc');pair('again','edit','/fixture/A.txt','Error: file has not been read',true)
 const scan=scanFailures(rows),pack=buildEvidence(rows)
 assert.ok(scan.failures.every(f=>!f.fixed))
 assert.equal(pack.failures[0].fixed,false)
 assert.equal(pack.failures[0].seq,rows.at(-1).seq)
})
