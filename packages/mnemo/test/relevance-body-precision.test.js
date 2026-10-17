import {test} from 'node:test'
import assert from 'node:assert/strict'
import {retrieve, rankCandidates} from '../lib/retrieve.js'
const row=(id,text,description='',label='Nimbus')=>({id,text,entities:['nimbus'],cues:[],evidence:[{source:'codex-memory-import',sourceProjectLabel:label,sourceProjectDescription:description}]})
const find=(text,candidates,entities=['nimbus'])=>retrieve({text,candidates,entities,priorOf:()=>1}).map(x=>x.item.id)
test('project descriptions cannot supply missing body operations',()=>{
 const operation=row('operation','Backup checksum migrate.'),generic=row('generic','Platform service deploy.','backup migration')
 assert.deepEqual(find('Nimbus 备份 迁移',[operation,generic]),['operation'])
 assert.deepEqual(find('Nimbus backup migration',[generic]),[])
})
test('a matched body facet is a partial lead while a wholly wrong topic abstains',()=>{
 const checksum=row('checksum','Checksum verification.')
 for(const text of ['Nimbus 校验和 invoice currency','Nimbus checksum 发票 币种']){
  const result=retrieve({text,candidates:[checksum],entities:['nimbus']})
  assert.equal(result[0]?.item.id,'checksum')
  assert.ok(result[0].parts.topic>0&&result[0].parts.topic<.5)
 }
 assert.deepEqual(find('Nimbus invoice currency',[checksum]),[])
})
test('different body facets can be recalled together without claiming full coverage',()=>{
 const candidates=[row('backup','Backup checksum verification.'),row('billing','Invoice currency reconciliation.'),row('graphics','Render alpha output.')]
 const result=retrieve({text:'Nimbus backup checksum invoice currency render alpha',candidates,entities:['nimbus']})
 assert.deepEqual(new Set(result.map(x=>x.item.id)),new Set(['backup','billing','graphics']))
 assert.ok(result.every(x=>x.parts.topic>0&&x.parts.topic<.5))
})
test('unknown Chinese instructions have bounded denominator while explicit missing concepts still count',()=>{
 const item=row('backup','Backup checksum migrate.')
 const instructions='请给我一份排查清单再阐述缘由评估风险执行细节完成以后有没有遗漏以及后续建议'
 assert.deepEqual(find(`Nimbus ${instructions} 备份迁移`,[item]),['backup'])
 assert.deepEqual(find(`Nimbus ${instructions} 发票币种`,[item]),[])
 const partial=retrieve({text:'Nimbus checksum invoice currency',candidates:[item],entities:['nimbus']})
 assert.equal(partial[0]?.item.id,'backup')
 assert.ok(partial[0].parts.topic<.5)
 const unanchored=row('operations','Backup checksum migrate snapshot.')
 assert.deepEqual(find(`${instructions} 备份校验和迁移快照`,[unanchored],[]),['operations'])
})
test('body document frequencies prefer rare operation over ubiquitous platform side topics',()=>{
 const rare=row('rare','Checksum verification.'),common=row('common','Platform service deploy.')
 const distractors=Array.from({length:30},(_,i)=>row('d'+i,'Platform service deploy.'))
 const candidates=[common,rare,...distractors]
 const ranked=rankCandidates({text:'Nimbus checksum platform service',entities:['nimbus'],candidates})
 assert.equal(ranked[0].item.id,'rare')
})
test('canonical separators preserve explicit project role and original word boundaries',()=>{
 for(const [label,entity] of [['Redwood Observatory','redwood.observatory'],['redwood observatory','redwood_observatory'],['redwood-observatory','redwood.observatory'],['/workspace/projects/redwood-observatory','redwood.observatory'],['北辰天文台','北辰天文台']]){
  const item={...row('optics','Telescope optics require collimation.','',label),entities:[entity]}
  assert.deepEqual(find(`${label} invoice currency`,[item],[entity]),[],label)
  assert.deepEqual(find(`${label} telescope optics`,[item],[entity]),['optics'],label)
 }
 const subject={...row('disks','Use resilient disks.','','Orchard observatory'),entities:['hard']}
 assert.deepEqual(find('hard',[subject],['hard']),['disks'])
})
test('request actions and generic containers qualify concrete subjects across domains',()=>{
 for(const [id,body,query,missing] of [
  ['receipts','Invoice reconciliation records original currency.','重构一下发票模块 source historical test code request','Refactor module source historical test code request.'],
  ['graphics','Render output retains the alpha channel.','refactor render module request code test source historical','Refactor module request code test source historical.'],
 ]){
  const item=row(id,body)
  assert.deepEqual(find(query,[item],[]),[id],id)
  assert.deepEqual(find(query,[row('missing',missing)],[]),[],id+' missing concrete subject')
 }
})
test('context-only queries retain their own body contract without promoting historical envelopes',()=>{
 assert.deepEqual(find('refactor module',[row('architecture','Refactor the module boundaries.')],[]),['architecture'])
 const wrapped={...row('wrapped','[Codex历史笔记；现状待核验；历史授权不代表本次授权]\n项目分组：Nimbus\nTelescope optics require collimation.')}
 assert.deepEqual(find('historical source invoice',[wrapped]),[])
})
test('precise implementation identifiers retain recall under generic request modifiers',()=>{
 const item={...row('implementation','Split sample_module.cpp into modules.'),cues:['C++','refactor']}
 assert.deepEqual(find('帮我重构一下 C++ 那个大文件',[item],[]),['implementation'])
 assert.deepEqual(find('refactor job_nonce_527 file',[row('nonce','Reconciliation uses job_nonce_527.')],[]),['nonce'])
})
test('frequent Chinese instruction fragments stay bounded and literal-only Chinese still needs real overlap',()=>{
 const prose='甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'
 const candidates=[row('operation','Backup migration.'),row('prose',prose)]
 assert.deepEqual(find(`Nimbus ${prose} 备份迁移`,candidates),['operation'])
 assert.deepEqual(find('壬癸子丑寅卯',[row('literal','壬癸子丑寅卯')],[]),['literal'])
 assert.deepEqual(find('壬癸子丑寅卯',[row('wrong','甲乙丙丁戊己')],[]),[])
})
test('named description identities bridge platform requests to independent body operations',()=>{
 for(const name of ['Astrolabe','Borealis-Desk','MacOS','ToolSuite','k42']){
  const operation={...row('operation','Checksum verification.','','/workspace/chats/chat-17'),entities:[],evidence:[{source:'codex-memory-import',sourceProjectLabel:'/workspace/chats/chat-17',sourceProjectDescription:`${name} platform checksum migration backup`}]}
  const generic={...operation,id:'generic',text:'Generic service availability.'}
  const text=`${name} checksum invoice currency render alpha 甲乙丙丁戊己庚辛壬癸子丑寅卯`
  assert.deepEqual(find(text,[operation,generic],[]),['operation'],name)
  assert.deepEqual(find(`${name} invoice currency`,[generic],[]),[],name+' description cannot supply topic')
 }
})
test('rare explicit body concepts support cross-language partial leads without a platform identity',()=>{
 const item={...row('rare','Checksum verification.','','/workspace/chats/chat-17'),entities:[]}
 const candidates=[item,...Array.from({length:30},(_,i)=>({...row('platform'+i,'Astrolabe platform service deploy.','','/workspace/chats/chat-'+i),entities:[]}))]
 const text='Astrolabe 校验和 发票 币种 渲染 甲乙丙丁戊己庚辛壬癸'
 const result=retrieve({text,candidates,entities:[]})
 assert.equal(result[0]?.item.id,'rare')
 assert.ok(result[0].parts.topic>=.16&&result[0].parts.topic<.32)
 assert.deepEqual(find('Astrolabe invoice currency',[item],[]),[])
 assert.deepEqual(find('Astrolabe invoice currency render alpha',[{...item,text:'Astrolabe'}],[]),[])
 assert.deepEqual(find('invoice currency 甲乙丙丁',[{...item,text:'甲乙丙丁'}],[]),[])
})
