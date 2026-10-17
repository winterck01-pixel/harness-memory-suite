import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {MemoryEngine} from '../lib/engine.js'
import {Maintenance} from '../lib/maintenance.js'
import {runRetro,commitProposal} from '../lib/retrospect.js'

function rig() {
  const dir=mkdtempSync(join(tmpdir(),'mnemo-retro-'))
  const engine=new MemoryEngine({dir})
  engine.start('audit')
  return {dir,engine}
}

const planAnswer=(items)=>({
  retro:{text:'本阶段完成了记忆插件迭代；教训是先跑测试再热更新。下一步：补复盘闭环。',
    citations:[{id:items[0].id,quote:items[0].text.slice(0,6)}]},
  skill:{text:'1. 改完代码先跑全量测试。\n2. 新版本目录绕开 ESM 缓存后再热更新。',
    citations:[{id:items[items.length-1].id,quote:items[items.length-1].text.slice(0,6)}]},
})

test('retro-plan job writes two durable proposals with verbatim citations',async()=>{
 const {dir,engine}=rig()
 try {
  const a=engine.remember({text:'完成了复盘闭环设计',scope:'A',source:'human'})
  const b=engine.remember({text:'热更新必须换版本目录',scope:'A',source:'agent'})
  const m=new Maintenance(engine,async()=>planAnswer([a,b].map(id=>engine.log.items.get(id.id))))
  const out=await m.process({id:'b-test1',kind:'retro-plan',payload:{ids:[a.id,b.id]}},{scope:'A'})
  assert.deepEqual(out.proposalIds,['b-test1','b-test1s'])
  const retro=engine.log.proposals.get('b-test1')
  const skill=engine.log.proposals.get('b-test1s')
  assert.equal(retro.proposalKind,'retro-plan')
  assert.equal(skill.proposalKind,'skill-compile')
  assert.equal(retro.status,'pending')

  const m2=new Maintenance(engine,async()=>{throw Error('must not be called')})
  const again=await m2.process({id:'b-test1',kind:'retro-plan',payload:{ids:[a.id,b.id]}},{scope:'A'})
  assert.equal(again.deduplicated,true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('retro-plan rejects non-verbatim citation quotes',async()=>{
 const {dir,engine}=rig()
 try {
  const a=engine.remember({text:'完成了复盘闭环设计',scope:'A',source:'human'})
  const b=engine.remember({text:'热更新必须换版本目录',scope:'A',source:'agent'})
  const answer=planAnswer([engine.log.items.get(a.id),engine.log.items.get(b.id)])
  answer.retro.citations=[{id:a.id,quote:'根本没写过的引用'}]
  const m=new Maintenance(engine,async()=>answer)
  await assert.rejects(m.process({id:'b-x',kind:'retro-plan',payload:{ids:[a.id,b.id]}},{scope:'A'}),/not verbatim/)
  assert.equal(engine.log.proposals.size,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('full retro flow: approval writes confirmed episode and skill memories',async()=>{
 const {dir,engine}=rig()
 try {
  const a=engine.remember({text:'完成了复盘闭环设计',scope:'A',source:'human'})
  const b=engine.remember({text:'热更新必须换版本目录',scope:'A',source:'agent'})
  const m=new Maintenance(engine,async()=>planAnswer([engine.log.items.get(a.id),engine.log.items.get(b.id)]))
  const asked=[]
  const result=await runRetro({engine,maintenance:m,scope:'A',
    ask:async(request)=>{asked.push(request);return {answers:[
      {id:'retro',selected:['按方案写入复盘']},
      {id:'skill',selected:['按方案提炼技能']},
    ]}}})
  assert.equal(result.status,'committed')
  const retroMem=engine.log.items.get(result.retro.id)
  const skillMem=engine.log.items.get(result.skill.id)
  assert.equal(retroMem.kind,'episode')
  assert.equal(retroMem.trust,'confirmed')
  assert.equal(skillMem.kind,'skill')
  assert.equal(skillMem.trust,'confirmed')
  assert.ok(retroMem.evidence.some(e=>e.proposalId&&e.quote),'evidence links to proposal')
  assert.equal(engine.log.proposals.get(result.retro.proposalId).status,'accepted')
  assert.equal(engine.log.proposals.get(result.skill.proposalId).status,'accepted')

  const [request]=asked
  assert.equal(request.questions.length,2)
  assert.equal(request.questions[0].intent.kind,'plan-review')
  assert.ok(request.questions[0].detail.includes('复盘'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('discussion feedback lands as a human-revised version on top of the draft',async()=>{
 const {dir,engine}=rig()
 try {
  const a=engine.remember({text:'完成了复盘闭环设计',scope:'A',source:'human'})
  const b=engine.remember({text:'热更新必须换版本目录',scope:'A',source:'agent'})
  const m=new Maintenance(engine,async()=>planAnswer([engine.log.items.get(a.id),engine.log.items.get(b.id)]))
  const result=await runRetro({engine,maintenance:m,scope:'A',
    ask:async()=>({answers:[
      {id:'retro',selected:[],custom:'复盘里补一条：模型输出一律先人工确认再落库。'},
      {id:'skill',selected:['跳过技能']},
    ]})})
  assert.equal(result.status,'committed')
  assert.ok(result.retro.revised)
  assert.equal(result.skill,null)
  const mem=engine.log.items.get(result.retro.id)
  assert.equal(mem.trust,'confirmed')
  assert.ok(mem.text.includes('## 讨论修订（人工）'))
  assert.ok(mem.text.includes('先人工确认再落库'))
  assert.equal(mem.versions.length,1,'atomic approval keeps a single create version with the merged text')

  const skippedId=result.skipped[0]
  assert.equal(engine.log.proposals.get(skippedId).status,'pending')
  const manual=engine.acceptProposal(skippedId,{scope:'A'})
  assert.equal(engine.log.items.get(manual.id).kind,'skill')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('unavailable asker leaves the library untouched (fail-closed plan-only)',async()=>{
 const {dir,engine}=rig()
 try {
  const a=engine.remember({text:'完成了复盘闭环设计',scope:'A',source:'human'})
  const b=engine.remember({text:'热更新必须换版本目录',scope:'A',source:'agent'})
  const m=new Maintenance(engine,async()=>planAnswer([engine.log.items.get(a.id),engine.log.items.get(b.id)]))
  const before=engine.log.items.size
  const result=await runRetro({engine,maintenance:m,scope:'A',
    ask:async()=>{throw Error('userQuestions service unavailable')}})
  assert.equal(result.status,'plan-only')
  assert.match(result.askError,/unavailable/)
  assert.equal(engine.log.items.size,before,'no memory written without a human answer')
  assert.equal(engine.log.proposals.get(result.retro.id).status,'pending')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('commitProposal refuses unknown or already-closed proposals',async()=>{
 const {dir,engine}=rig()
 try {
  assert.throws(()=>commitProposal(engine,'b-nope',{scope:'A'}),/Unknown proposal/)
  const a=engine.remember({text:'完成了复盘闭环设计',scope:'A',source:'human'})
  const m=new Maintenance(engine,async()=>({retro:{text:'x',citations:[{id:a.id,quote:'完成了复盘闭环设计'.slice(0,6)}]},skill:{text:'y',citations:[{id:a.id,quote:'完成了复盘闭环设计'.slice(0,6)}]}}))
  const out=await m.process({id:'b-c',kind:'retro-plan',payload:{ids:[a.id]}},{scope:'A'})
  engine.acceptProposal(out.proposalId,{scope:'A'})
  assert.throws(()=>commitProposal(engine,out.proposalId,{scope:'A',revision:'再改一下'}),/not open/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
