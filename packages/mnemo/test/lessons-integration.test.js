import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {apply} from '../index.js'

async function host(t,config={}){
 const dir=mkdtempSync(join(tmpdir(),'mnemo-lessons-int-')),rows=[],listeners=new Map(),prompts=[]
 const session={id:'lessons-session',header:{cwd:'/fixture/lessons'},get seq(){return rows.length},snapshotEvents:(a,b)=>rows.filter(e=>e.seq>=a&&e.seq<b)}
 const llm={stream:async function*(req){prompts.push(req);yield {type:'text-delta',index:0,text:JSON.stringify({lessons:[{type:'fix',signature:JSON.parse(JSON.parse(req.messages[0].content[0].text).data ? JSON.stringify(JSON.parse(req.messages[0].content[0].text).data) : '{}').failures?.[0]?.signature,trigger:'edit 报 file has not been read',advice:'先 read 目标文件,再 edit',scope:'tool',tool:'edit',confidence:'high'}]})};yield {type:'finish',reason:{kind:'stop'}}}}
 const services={sessions:{get:id=>id===session.id?session:null},llm,agentDefaultModel:{currentSelection:()=>({provider:'p',model:'m'})},tools:{register(){}}}
 const ctx={get:name=>services[name],provide:(name,value)=>services[name]=value,effect:fn=>fn(),on:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);return()=>{listeners.set(name,listeners.get(name).filter(x=>x!==fn))}}}
 await apply(ctx,{dir,injectMode:'off',verbose:false,lessons:{enabled:true,holdoutRate:0,idleMs:3600000,...config}})
 const api=services.mnemo;t.after(async()=>{await api.detach();rmSync(dir,{recursive:true,force:true})})
 const emit=(type,data)=>{const e={type,seq:rows.length,time:1000+rows.length,data};rows.push(e);for(const fn of listeners.get('session/event')??[])fn(session,e);return e}
 const assemble=async()=>{const assembly={contexts:[]};for(const fn of listeners.get('system-prompt/assemble')??[])await fn(assembly,{agent:{session}},async()=>assembly);return assembly}
 return {dir,api,session,emit,assemble,prompts}
}
const ERR='error: cannot modify "a.txt": file has not been read'
function failingTurn(f,turn,file){
 f.emit('turn/start',{turn})
 f.emit('user/message',{turn,content:[{type:'text',text:'edit the file '+file}]})
 f.emit('tool/call',{turn,callId:'e'+turn,name:'edit',arguments:JSON.stringify({path:file})})
 f.emit('tool/result',{turn,message:{toolCallId:'e'+turn,isError:true,content:[{type:'text',text:ERR.replace('a.txt',file)}]}})
 f.emit('tool/call',{turn,callId:'r'+turn,name:'read',arguments:JSON.stringify({path:file})})
 f.emit('tool/result',{turn,message:{toolCallId:'r'+turn,isError:false,content:[{type:'text',text:'contents'}]}})
 f.emit('tool/call',{turn,callId:'f'+turn,name:'edit',arguments:JSON.stringify({path:file})})
 f.emit('tool/result',{turn,message:{toolCallId:'f'+turn,isError:false,content:[{type:'text',text:'edited'}]}})
 f.emit('assistant/message',{turn,message:{content:[{type:'text',text:'done'}]}})
}

test('disabled by default: no lessons engine, no ledger',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-lessons-off-')),listeners=new Map(),services={sessions:{get(){return null}}}
 const ctx={get:n=>services[n],provide:(n,v)=>services[n]=v,effect:fn=>fn(),on:(n,fn)=>{(listeners.get(n)??listeners.set(n,[]).get(n)).push(fn);return()=>{}}}
 await apply(ctx,{dir,injectMode:'off',verbose:false})
 t.after(async()=>{await services.mnemo.detach();rmSync(dir,{recursive:true,force:true})})
 assert.equal(services.mnemo.lessons,null);assert.equal(existsSync(join(dir,'lessons')),false)
})

test('real plugin: failure turn -> extraction -> injected on same error next turn',async t=>{
 const f=await host(t)
 await f.assemble()                           // a prompt is assembled before the turn ends, which records the session route
 failingTurn(f,1,'a.txt');f.emit('turn/end',{turn:1,reason:{kind:'completed'}})
 assert.equal(f.api.lessons.store.state.queue.length,1)
 f.emit('turn/start',{turn:2});f.emit('user/message',{turn:2,content:[{type:'text',text:'next task please'}]})
 await f.api.lessons.idle()
 assert.equal(f.prompts.length,1);assert.equal(f.api.lessons.store.list().length,1)
 // New turn hits the same error; the next assembly carries the lesson
 f.emit('tool/call',{turn:2,callId:'x',name:'edit',arguments:'{}'})
 f.emit('tool/result',{turn:2,message:{toolCallId:'x',isError:true,content:[{type:'text',text:ERR.replace('a.txt','b.txt')}]}})
 const a=await f.assemble()
 const ctxs=a.contexts.filter(c=>c.name==='mnemo-lessons');assert.equal(ctxs.length,1);assert.match(ctxs[0].text,/先 read/)
 assert.equal(f.api.report().lessons.lessons,1)
 // Opt-out turns are never queued
 f.emit('turn/start',{turn:3});f.emit('user/message',{turn:3,content:[{type:'text',text:'不要记住这次'}]})
})

test('lessons never throw into the host when the model call fails',async t=>{
 const f=await host(t)
 f.prompts.length=0
 await f.assemble()
 // Break the model service after startup
 f.api.lessons.generate=async()=>{throw Error('model down')}
 failingTurn(f,1,'a.txt');f.emit('turn/end',{turn:1,reason:{kind:'completed'}})
 f.emit('turn/start',{turn:2});f.emit('user/message',{turn:2,content:[{type:'text',text:'next'}]})
 await f.api.lessons.idle()
 assert.equal(f.api.lessons.stats.errors,1);assert.equal(f.api.lessons.store.list().length,0)
})

const ptcStep=(f,id,name,text,isError=false)=>{
 const data={turn:1,rootCallId:'root',parentCallId:'root',subCallId:id,name,arguments:{path:'a.txt'}}
 f.emit('tool/ptc-dispatch-start',data)
 f.emit('tool/ptc-dispatch',{...data,isError,content:[{type:'text',text}]})
}

test('host PTC recovery preserves document content as success and redacts the actual extractor request',async t=>{
 const f=await host(t),before=structuredClone(f.api.engine.safety)
 await f.assemble()
 f.emit('turn/start',{turn:1});f.emit('user/message',{turn:1,content:[{type:'text',text:'更新示例文件'}]})
 f.emit('tool/call',{turn:1,callId:'root',name:'run_code',arguments:'{}'})
 ptcStep(f,'failed','edit',ERR,true)
 ptcStep(f,'read','read','Documentation: exit_code: 1\n{"password":"one two three four","Authorization":"Basic dXNlcjpzeW50aGV0aWM="}')
 ptcStep(f,'retry','edit','edited')
 f.emit('tool/result',{turn:1,message:{toolCallId:'root',isError:false,content:[{type:'text',text:'completed'}]}})
 f.emit('turn/end',{turn:1,reason:{kind:'completed'}})
 f.emit('turn/start',{turn:2});f.emit('user/message',{turn:2,content:[{type:'text',text:'下一项'}]})
 await f.api.lessons.idle()
 assert.equal(f.prompts.length,1)
 const request=JSON.stringify(f.prompts[0]);assert.ok(!request.includes('one two three four'));assert.ok(!request.includes('dXNlcjpzeW50aGV0aWM='))
 const pack=JSON.parse(f.prompts[0].messages[0].content[0].text).data
 assert.equal(pack.window.find(w=>w.tool==='read').failed,false)
 assert.equal(pack.failures.length,1);assert.equal(pack.failures[0].tool,'edit')
 const learned=f.api.lessons.store.list();assert.equal(learned.length,1);assert.equal(learned[0].state,'active');assert.equal(learned[0].verification.kind,'tool-contract')
 assert.deepEqual(f.api.engine.safety,before,'lessons processing must not change the ordinary memory safety state')
})

test('host successful PTC task is collected as a method candidate without automatic injection',async t=>{
 const f=await host(t,{injectOpening:true}),packs=[]
 f.api.lessons.generate=async(_system,pack)=>{packs.push(pack);return {lessons:[{type:'method',trigger:'检查独立报表结构',advice:'逐份核对报表结构，然后汇总一致性检查结果。',scope:'project',confidence:'high'}]}}
 await f.assemble()
 f.emit('turn/start',{turn:1});f.emit('user/message',{turn:1,content:[{type:'text',text:'检查独立报表结构'}]})
 f.emit('tool/call',{turn:1,callId:'root',name:'run_code',arguments:'{}'})
 for(let i=0;i<5;i++)ptcStep(f,'read-'+i,'read','valid report '+i)
 f.emit('tool/result',{turn:1,message:{toolCallId:'root',isError:false,content:[{type:'text',text:'checked'}]}})
 f.emit('turn/end',{turn:1,reason:{kind:'completed'}})
 assert.equal(f.api.lessons.store.state.queue[0].toolCalls,5)
 f.emit('turn/start',{turn:2});f.emit('user/message',{turn:2,content:[{type:'text',text:'再检查独立报表结构'}]})
 await f.api.lessons.idle()
 assert.equal(packs.length,1);assert.deepEqual(packs[0].triggerReasons,['method'])
 const learned=f.api.lessons.store.list();assert.equal(learned.length,1);assert.equal(learned[0].state,'candidate');assert.equal(learned[0].review.needsHuman,true)
 assert.equal((await f.assemble()).contexts.filter(c=>c.name==='mnemo-lessons').length,0)
})
