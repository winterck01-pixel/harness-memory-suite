import test from 'node:test'
import assert from 'node:assert/strict'
import {buildEvidence,finalizeEvidence,scrubEvidenceText,containsEvidenceSecret} from '../lib/lessons-evidence.js'
import {collectToolResults,failureFromEvent,scanFailures} from '../lib/lessons-signature.js'
import {verifyRecordedLesson} from '../lib/lessons-validation.js'

function events(mode='direct'){
 const rows=[];let seq=0
 const emit=(type,data)=>rows.push({seq:++seq,type,data})
 const pair=(id,tool,result,isError=false,args={path:'/fixture/A.txt'})=>{
  if(mode==='ptc'){
   emit('tool/ptc-dispatch-start',{rootCallId:'root',parentCallId:'root',subCallId:id,name:tool,arguments:args})
   emit('tool/ptc-dispatch',{rootCallId:'root',parentCallId:'root',subCallId:id,name:tool,arguments:args,isError,content:[{type:'text',text:result}]})
  }else{
   emit('tool/call',{callId:id,name:tool,arguments:JSON.stringify(args)})
   emit('tool/result',{message:{toolCallId:id,isError,content:[{type:'text',text:result}]}})
  }
 }
 return {rows,pair,emit}
}

for(const mode of ['direct','ptc']){
 test(`omissions: ${mode} actual evidence redacts complete quoted credentials before clipping`,()=>{
  const x=events(mode),password='one two three four',escaped='alpha "quoted phrase" \\ omega',basic='dXNlcjpzeW50aGV0aWM=',bearer='short-token'
  const credentials={password,credentials:{secret:escaped},Authorization:'Basic '+basic,'Proxy-Authorization':'Bearer '+bearer}
  x.pair('read','read','1| '+JSON.stringify(credentials),false,{path:'/fixture/A.txt',...credentials})
  const text=JSON.stringify(buildEvidence(x.rows))
  for(const privateValue of [password,'two three four','quoted phrase','omega',basic,bearer])assert.ok(!text.includes(privateValue),privateValue)
  assert.ok(text.includes('[redacted]'))
 })
 test(`omissions: ${mode} document exit_code is content and a valid recovery remains verified`,()=>{
  const x=events(mode)
  x.pair('fail','edit','Error: file has not been read',true)
  x.pair('read','read','1| troubleshooting example: exit_code: 1\n2| Process exited with code 2')
  x.pair('fixed','edit','edited')
  const pack=buildEvidence(x.rows),read=pack.window.find(w=>w.tool==='read')
  assert.equal(read.failed,false)
  assert.deepEqual(pack.failures.map(f=>f.tool),['edit'])
  assert.ok(verifyRecordedLesson({type:'fix',signature:pack.failures[0].signature,scope:'tool',tool:'edit',trigger:'edit failed before read',advice:'read then edit'},pack))
 })
 test(`omissions: ${mode} real shell tail status still distinguishes failed commands`,()=>{
  for(const tool of ['bash','pwsh']){
   const x=events(mode)
   x.pair('one',tool,'not available\n[exit code: 2]',false,{command:'grep needle fixture.txt'})
   const row=collectToolResults(x.rows)[0]
   assert.equal(row.failed,true)
   assert.equal(scanFailures(x.rows).failures.length,1)
  }
 })
}

test('omissions: final feedback and all prose fields use full-value redaction with a hard budget',()=>{
 const credentials='password: "one two three four"\nAuthorization: Basic dXNlcjpzeW50aGV0aWM='
 const evidence={goal:credentials,window:[{seq:1,tool:'read',args:credentials,result:credentials,failed:false}],finalAnswer:credentials}
 for(const maxChars of [6000,900,256]){
  const pack=finalizeEvidence(evidence,{maxChars,nextUserMessage:credentials,triggerReasons:['correction']}),text=JSON.stringify(pack)
  assert.ok(!text.includes('two three four'))
  assert.ok(!text.includes('dXNlcjpzeW50aGV0aWM='))
  assert.ok(text.length<=maxChars)
 }
})

test('omissions: quoted escapes, short values and header schemes cannot leak suffixes',()=>{
 const samples=[
  ['{"password":"first \\"quote\\" and tail"}','and tail'],
  ["secret='short words with \\'quote\\' tail'",'tail'],
  ['{"api_key":"x"}','"x"'],
  ['password=one two three four\nordinary=retained','two three four'],
  ['Authorization: Basic dXNlcjpzeW50aGV0aWM=','dXNlcjpzeW50aGV0aWM='],
  ['proxy-authorization: Bearer short-token','short-token'],
 ]
 for(const [input,needle] of samples){
  assert.equal(containsEvidenceSecret(input),true,input)
  const scrubbed=scrubEvidenceText(input)
  assert.ok(!scrubbed.includes(needle),scrubbed)
  assert.equal(scrubEvidenceText(scrubbed),scrubbed,'redaction must be idempotent')
 }
})

test('omissions: ordinary fields and labels are not sensitive assignments',()=>{
 const input='{"passwordPolicy":"minimum length","secret_count":3,"author":"Reader","path":"/fixture/A.txt","text":"Basic setup instructions"}'
 assert.equal(scrubEvidenceText(input),input)
 assert.equal(containsEvidenceSecret(input),false)
})

test('omissions: quoted JSON arguments remain parseable after field redaction',()=>{
 const source={path:'/fixture/A.txt',password:'one two three',nested:{secret:'alpha "quoted" omega'},Authorization:'Basic dXNlcjpzeW50aGV0aWM='}
 const parsed=JSON.parse(scrubEvidenceText(JSON.stringify(source)))
 assert.equal(parsed.path,source.path)
 assert.equal(parsed.password,'[redacted]')
 assert.equal(parsed.nested.secret,'[redacted]')
 assert.equal(parsed.Authorization,'[redacted]')
})

test('omissions: successful tools cannot fail based on quoted shell status',()=>{
 for(const name of ['read','search','web_fetch','run_code']){
  const x=events();x.pair('one',name,'example\n[exit code: 9]')
  assert.equal(collectToolResults(x.rows)[0].failed,false,name)
  assert.equal(scanFailures(x.rows).failures.length,0,name)
 }
 for(const text of ['exit_code: 2','example\n[exit code: 2]\nmore output','example\n[exit code: 0]']){
  const x=events();x.pair('one','bash',text)
  assert.equal(collectToolResults(x.rows)[0].failed,false,text)
 }
})

test('omissions: explicit tool error remains a failure even when text has no error words',()=>{
 const x=events();x.pair('one','read','operation refused',true)
 assert.equal(collectToolResults(x.rows)[0].failed,true)
 assert.ok(failureFromEvent(x.rows.at(-1),()=>({name:'read'})))
})

test('omissions: serialized JSON inside log strings is masked across the actual pack',()=>{
 const password='one two \"secret quote\"\nthree four',token='dXNlcjpzeW50aGV0aWM='
 const inner=JSON.stringify({password,Authorization:'Basic '+token}),outer=JSON.stringify({payload:inner})
 const x=events('ptc')
 x.emit('user/message',{content:[{type:'text',text:outer}]})
 x.pair('read','read','1| '+outer,false,{path:'/fixture/A.txt',payload:inner})
 x.emit('assistant/message',{content:[{type:'text',text:outer}]})
 const pack=finalizeEvidence(buildEvidence(x.rows),{nextUserMessage:outer})
 for(const field of [pack.goal,pack.window[0].args,pack.window[0].result,pack.finalAnswer,pack.nextUserMessage]){
  assert.ok(!field.includes('secret quote'),field)
  assert.ok(!field.includes('three four'),field)
  assert.ok(!field.includes(token),field)
  assert.ok(field.includes('[redacted]'),field)
 }
 const decoded=JSON.parse(JSON.parse(pack.window[0].args).payload)
 assert.equal(decoded.password,'[redacted]')
 assert.equal(decoded.Authorization,'[redacted]')
})

test('omissions: unterminated quoted secrets are masked before evidence truncation',()=>{
 const input='password="one two three, four five\nmore private text'
 const x=events();x.pair('read','read',input)
 const text=JSON.stringify(buildEvidence(x.rows,{maxChars:6000}))
 assert.ok(!text.includes('four five'))
 assert.ok(!text.includes('private text'))
})

test('omissions: CLI credential flags in serialized tool arguments are fully masked',()=>{
 for(const flag of ['--password="one two three"','--api-key=fixture-secret-value',"-password 'one two three'",'--password "one two three"']){
  const x=events();x.pair('one','bash','done',false,{command:'curl '+flag+' https://example.invalid'})
  const text=JSON.stringify(buildEvidence(x.rows))
  assert.ok(!text.includes('two three'),text)
  assert.ok(!text.includes('fixture-secret-value'),text)
  assert.ok(text.includes('[redacted]'))
 }
 const ordinary='curl --password-policy=minimum --secret-count=3 https://example.invalid'
 assert.equal(scrubEvidenceText(ordinary),ordinary)
})

test('omissions: persistent shell output uses its own complete final-line contract',()=>{
 for(const [tool,text] of [['bash','[Command finished with exit code 7]'],['bash','output\n[Command finished with exit code 7]'],['pwsh','[exit code: 7]']]){
  const x=events('ptc');x.pair('one',tool,text)
  assert.equal(collectToolResults(x.rows)[0].failed,true,text)
  assert.equal(scanFailures(x.rows).failures.length,1,text)
 }
 for(const tool of ['read','search','run_code'])for(const text of ['[Command finished with exit code 7]','[exit code: 7]']){
  const x=events();x.pair('one',tool,text)
  assert.equal(collectToolResults(x.rows)[0].failed,false,tool+' '+text)
 }
 for(const text of ['[Command finished with exit code 0]','example [Command finished with exit code 7]','[Command finished with exit code 7]\nmore output']){
  const x=events();x.pair('one','bash',text)
  assert.equal(collectToolResults(x.rows)[0].failed,false,text)
 }
})

test('omissions: encoded shell commands remain valid JSON after repeated evidence finalization',()=>{
 const credential=['fixture','secret','value'].join('-')
 const command=`curl --password="one two three" --api-key="${credential}" https://example.invalid`
 const x=events();x.pair('one','bash','done',false,{command,path:'/fixture/A.txt'})
 const first=buildEvidence(x.rows),second=finalizeEvidence(first)
 for(const pack of [first,second]){
  const args=JSON.parse(pack.window[0].args)
  assert.equal(args.path,'/fixture/A.txt')
  assert.ok(args.command.includes('[redacted]'))
  assert.ok(args.command.includes('https://example.invalid'),'quoted secrets must not swallow ordinary URL arguments')
  assert.ok(!args.command.includes('two three'))
  assert.ok(!args.command.includes('fixture-secret-value'))
 }
 assert.equal(first.window[0].args,second.window[0].args)
})
