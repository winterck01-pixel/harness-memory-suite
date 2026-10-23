import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {SessionStore} from '@deepseek-ai/dsh-session'
import {SessionQueryEngine} from '@deepseek-ai/dsh-session-query'
import {createExecutionSourceReader} from '../lib/execution-source-reader.js'

test('installed Host cold observation prepares an unpublished source using only read handles',async()=>{
 const ctx=new Context();let reader,opens=0,closes=0,revision='r1',exists=true
 const sessionFiber=await ctx.plugin(SessionStore,{})
 const sessions=ctx.get('sessions'),id='success-reader-cold-host'
 const header=sessions.prepare(id,{meta:{cwd:'/fixture/success-reader',createdAt:1}}).header
 const persistence={identity:Symbol('fixture-storage'),
  stat:async target=>target===id&&exists?{header,revision}:undefined,
  open:async(target,access)=>{
   assert.equal(target,id);assert.equal(access,'read');opens++
   return {header,inheritedEventCount:0,read:async()=>({events:[],eventState:'detached'}),close:async()=>{closes++}}
  },
 }
 ctx.provide('sessionPersistence',persistence)
 const queryFiber=await ctx.plugin(SessionQueryEngine,{preparedSessionCacheSize:2})
 try{
  reader=createExecutionSourceReader({getSessions:()=>sessions,getSessionQuery:()=>ctx.get('sessionQuery'),getPersistence:()=>persistence})
  const first=await reader.resolveSession(id)
  assert.ok(first);assert.equal(first.id,id);assert.equal(first.seq,0);assert.deepEqual(first.snapshotEvents(),[])
  assert.equal(sessions.get(id),undefined,'the official read must never publish the prepared Session')
  assert.equal(ctx.get('agents'),undefined,'no Agent service or model is needed')
  assert.equal(await reader.resolveSession(id),first)
  assert.equal(opens,1,'unchanged revision reuses the official cold cache')
  assert.equal(closes,1)
  revision='r2';assert.notEqual(await reader.resolveSession(id),first);assert.equal(opens,2);assert.equal(closes,2)
  exists=false;assert.equal(await reader.resolveSession(id),null);assert.equal(reader.currentSession(id),null)
 }finally{
  reader?.dispose();await queryFiber.dispose();await sessionFiber.dispose()
 }
})
