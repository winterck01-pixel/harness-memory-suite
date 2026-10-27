import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,delimiter} from 'node:path'
import {fileURLToPath} from 'node:url'
import {signatureOf} from '../lib/lessons-signature.js'

const tools=fileURLToPath(new URL('../tools/',import.meta.url))
// Only synthetic JSONL is read. A local decoder fixture avoids system zstd and real sessions.
function fixture(t,sessions){
 const dir=mkdtempSync(join(tmpdir(),'mnemo-cli-safety-')),archives=join(dir,'archives'),bin=join(dir,'bin')
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 mkdirSync(archives);mkdirSync(bin)
 writeFileSync(join(bin,'zstd'),`#!${process.execPath}\nconst fs=require('node:fs');const path=process.argv[3];const text=fs.readFileSync(path,'utf8');if(text==='BROKEN'){process.stderr.write('decoder failed: '+path);process.exit(1)}process.stdout.write(text);\n`,{mode:0o700})
 for(const [i,rows] of sessions.entries()){
  const session=join(archives,'synthetic-session-'+i);mkdirSync(session)
  writeFileSync(join(session,'session.v4.jsonl.zstd'),typeof rows==='string'?rows:rows.map(e=>JSON.stringify(e)).join('\n')+'\n')
 }
 const snapshot=()=>Object.fromEntries(readdirSync(archives).sort().map(n=>[n,readFileSync(join(archives,n,'session.v4.jsonl.zstd'),'utf8')]))
 const before=snapshot()
 const run=(name,args=[])=>spawnSync(process.execPath,[join(tools,name+'.mjs'),...args],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:bin+delimiter+process.env.PATH}})
 const unchanged=()=>assert.deepEqual(snapshot(),before,'CLI must preserve source archives')
 return {dir,archives,run,unchanged}
}
function transcript({error='Error: permission denied',args={path:'/fixture/target.txt'},nextArgs=args,mode='direct',turn=1}={}){
 const rows=[];let seq=0
 const emit=(type,data)=>rows.push({seq:++seq,type,data:{turn,...data}})
 const pair=(id,name,arguments_,text,isError)=>{
  if(mode==='ptc')emit('tool/ptc-dispatch',{subCallId:id,name,arguments:arguments_,content:[{type:'text',text}],isError})
  else{
   emit('tool/call',{callId:id,name,arguments:JSON.stringify(arguments_)})
   emit('tool/result',{message:{toolCallId:id,isError,content:[{type:'text',text}]}})
  }
 }
 pair('fail','edit',args,error,true)
 pair('read','read',nextArgs,'Example exit_code: 2\n[exit code: 2]',false)
 pair('retry','edit',args,'updated',false)
 return rows
}
const repeated=options=>[1,2].map(()=>[...transcript({...options,turn:1}),...transcript({...options,turn:2})])
const ok=result=>{assert.equal(result.status,0,result.stderr);return result.stdout}
const summary=stdout=>JSON.parse(stdout.split('\n')[0])
const noValues=(text,values)=>values.forEach((value,i)=>assert.ok(!text.toLowerCase().includes(value.toLowerCase()),'synthetic sensitive value '+i+' leaked'))

test('CLI evidence scrubs complete arguments, errors, norm and next-ok before clipping',t=>{
 const password='one two private tail',basic='dXNlcjpzeW50aGV0aWM=',apiKey='synthetic-api-value'
 const args={path:'/fixture/target.txt',command:'curl --password="'+password+'" --api-key='+apiKey,Authorization:'Basic '+basic}
 const f=fixture(t,repeated({args,nextArgs:args,error:'Error: permission denied; Authorization: Basic '+basic+'\npassword="'+password+'"'}))
 const out=ok(f.run('p0-evidence',[f.archives]))
 assert.match(out,/n=4 sessions=2 tool=edit/)
 for(const field of ['fail-args:','err:','norm:','next-ok: read'])assert.ok(out.includes(field),field)
 noValues(out,[password,'private tail',basic,apiKey,f.archives,'synthetic-session-'])
 assert.match(out,/\[redacted\]/)
 assert.match(out,/\/fixture\/target\.txt/,'local diagnostic argument paths keep their meaning')
 f.unchanged()
})

test('CLI evidence scrubs private key bodies before the signature helper truncates snippets',t=>{
 const privateBody='SYNTHETIC_PRIVATE_KEY_BODY_'+('ABCD'.repeat(100))
 const pem=(edge)=>['-----'+edge,'PRIVATE KEY-----'].join(' ')
 const f=fixture(t,repeated({error:'Error: permission denied\n'+pem('BEGIN')+'\n'+privateBody+'\n'+pem('END')}))
 const out=ok(f.run('p0-evidence',[f.archives]))
 assert.match(out,/n=4 sessions=2/)
 noValues(out,['SYNTHETIC_PRIVATE_KEY_BODY','ABCD'])
 f.unchanged()
})

test('CLI signatures scrub the full message before normalization',t=>{
 const basic='dXNlcjpzeW50aGV0aWM='
 const f=fixture(t,repeated({error:'Error: permission denied; Authorization: Basic '+basic+'; password=one two private tail'}))
 const out=ok(f.run('p0-signatures',[f.archives]))
 assert.deepEqual(summary(out),{sessions:2,turns:4,failTurns:4,fixTurns:4,distinctSignatures:1,repeatedSignatures:1})
 noValues(out,[basic,'private tail',f.archives,'synthetic-session-'])
 assert.match(out,/edit permission error: permission denied/)
 f.unchanged()
})

test('CLI aggregation is stable across credential changes and retains clean failure/recovery classification',t=>{
 const sessions=['alpha credential','beta credential'].map(password=>[...transcript({turn:1,error:'Error: permission denied; password='+password}),...transcript({turn:2,error:'Error: permission denied; password='+password})])
 const f=fixture(t,sessions)
 const out=ok(f.run('p0-signatures',[f.archives]))
 assert.equal(summary(out).distinctSignatures,1)
 assert.equal(summary(out).fixTurns,4)
 const evidence=ok(f.run('p0-evidence',[f.archives]))
 assert.match(evidence,/n=4 sessions=2/)
 assert.match(evidence,new RegExp(signatureOf('edit','Error: permission denied; password=[redacted]').signature))
 const clean=fixture(t,[transcript(),transcript({mode:'ptc'})])
 const cleanOut=ok(clean.run('p0-signatures',[clean.archives]))
 assert.deepEqual(summary(cleanOut),{sessions:2,turns:2,failTurns:2,fixTurns:2,distinctSignatures:1,repeatedSignatures:1})
 assert.match(cleanOut,/2 2 edit permission error: permission denied/)
 f.unchanged();clean.unchanged()
})

for(const name of ['p0-evidence','p0-signatures'])test('CLI '+name+' with unreadable archives does not expose source paths through decoder stderr',t=>{
 const f=fixture(t,['BROKEN'])
 const result=f.run(name,[f.archives]);ok(result)
 assert.equal(result.stderr,'')
 noValues(result.stdout,[f.archives,'synthetic-session-'])
 f.unchanged()
})

function batchFixture(t,behavior){
 const sessions=['alpha','beta','gamma','delta'].map(word=>transcript({error:'Error: '+word+' operation failed'}))
 const f=fixture(t,sessions),adapter=join(f.dir,'adapter.mjs'),log=join(f.dir,'calls.jsonl'),out=join(f.dir,'proposals.json'),imported=join(f.dir,'imported')
 writeFileSync(adapter,`import {appendFileSync,writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(imported)},'yes');\nexport async function complete(messages){appendFileSync(${JSON.stringify(log)},JSON.stringify(messages)+'\\n');const pack=JSON.parse(messages[1].content);${behavior}}\n`)
 const run=args=>f.run('p0-batch',['--sessions',f.archives,'--adapter',adapter,'--out',out,...args])
 const calls=()=>{try{return readFileSync(log,'utf8').trim().split('\n').length}catch{return 0}}
 return {...f,adapter,imported,out,run,calls}
}

test('CLI batch default call budget counts empty responses and reports dispatched calls',t=>{
 const f=batchFixture(t,`return {text:JSON.stringify({lessons:[]})}`)
 const result=f.run(['--limit','2']),stats=summary(ok(result))
 assert.equal(f.calls(),2)
 assert.equal(stats.calls,2);assert.equal(stats.maxCalls,2);assert.equal(stats.proposals,0)
 assert.equal(JSON.parse(readFileSync(f.out,'utf8')).lessons.length,0)
 f.unchanged()
})

test('CLI batch explicit call budget counts rejected responses without retry and scrubs stderr',t=>{
 const basic='dXNlcjpzeW50aGV0aWM='
 const f=batchFixture(t,`throw new Error('Authorization: Basic ${basic}; password="one two private tail"; failed')`)
 const result=f.run(['--limit','3','--max-calls','1']),stats=summary(ok(result))
 assert.equal(f.calls(),1)
 assert.equal(stats.calls,1);assert.equal(stats.maxCalls,1);assert.equal(stats.proposals,0)
 noValues(result.stderr,[basic,'private tail',f.archives])
 assert.match(result.stderr,/\[redacted\]/)
 f.unchanged()
})

test('CLI batch one response cannot exceed the proposal limit',t=>{
 const f=batchFixture(t,`return JSON.stringify({lessons:Array.from({length:5},()=>({type:'pitfall',signature:pack.failures[0].signature,trigger:'operation failed',advice:'inspect command arguments',scope:'tool',tool:'edit',confidence:'med'}))})`)
 const stats=summary(ok(f.run(['--limit','2','--max-calls','4'])))
 assert.equal(stats.proposals,2)
 assert.equal(f.calls(),1)
 assert.equal(stats.calls,1);assert.equal(stats.maxCalls,4);assert.equal(stats.proposals,2)
 const lessons=JSON.parse(readFileSync(f.out,'utf8')).lessons
 assert.equal(lessons.length,2);assert.ok(lessons.every(l=>l.approved===false))
 f.unchanged()
})

test('CLI batch rejects invalid budgets before loading the adapter',t=>{
 for(const flag of ['--limit','--max-calls'])for(const value of ['0','-1','1.5','NaN','Infinity','9007199254740992','']){
  const f=batchFixture(t,`return JSON.stringify({lessons:[]})`)
  const result=f.run([flag,value])
  assert.notEqual(result.status,0,flag+' must reject invalid budget')
  assert.equal(f.calls(),0)
  assert.throws(()=>readFileSync(f.imported),'invalid budget must not import adapter')
  assert.throws(()=>readFileSync(f.out),'invalid budget must not write proposals')
  assert.match(result.stderr,new RegExp(flag+' must be a positive safe integer'))
  f.unchanged()
 }
})
