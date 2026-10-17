import{test}from'node:test'
import assert from'node:assert/strict'
import{retrieve,rankCandidates,signalScore,pointerCandidates}from'../lib/retrieve.js'
import{memoryBody,relevanceTokens}from'../lib/relevance.js'
const envelope='[Codex历史笔记；现状待核验；历史授权不代表本次授权]\n项目分组：Nimbus deployment operations\n'
const row=(id,body,label='Nimbus deployment operations')=>({id,text:envelope+body,cues:[],entities:[],source:'agent',trust:'unverified',evidence:[{source:'codex-memory-import',sourceProjectLabel:label}]})
const items=[row('service','Nimbus deployment requires verifying the listener port and service identity.'),row('billing','Receipt reconciliation records original currency.','Atlas invoice operations')]
const find=(text,options={})=>retrieve({text,candidates:items,...options})
test('historical envelope is a derived field, exact source evidence is required',()=>{
 assert.equal(memoryBody(items[0]),'Nimbus deployment requires verifying the listener port and service identity.')
 assert.equal(memoryBody({...items[0],evidence:[]}),items[0].text)
 assert.equal(memoryBody({...items[0],text:'[unrelated warning]\nProject: Nimbus\nbody'}),'[unrelated warning]\nProject: Nimbus\nbody')
})
test('project identity alone cannot admit every historical note',()=>{
 assert.deepEqual(find('Nimbus'),[])
 assert.deepEqual(find('历史 授权'),[])
})
test('finite engineering concepts bridge Chinese intent to English body',()=>{
 assert.deepEqual(find('Nimbus 的监听端口该怎么核验？').map(x=>x.item.id),['service'])
 assert.deepEqual(find('Atlas 收据的币种怎样核对？').map(x=>x.item.id),['billing'])
})
test('long query instructions do not erase anchor plus local topic evidence',()=>{
 assert.deepEqual(find('请给我一份简短的排查清单，先解释缘由，再逐步说明风险，Nimbus 的监听端口该怎么核验，完成以后继续检查有没有遗漏？').map(x=>x.item.id),['service'])
})
test('vocabulary substrings in supplied cues cannot invent body relevance',()=>{
 const target={id:'x',text:'Hard disks are replaced annually.',cues:['hard'],entities:[]}
 assert.deepEqual(retrieve({text:'orchard flower colors',cues:['hard'],candidates:[target]}),[])
 assert.ok(!relevanceTokens('orchard').has('hard'))
})
test('trust and prior only rank relevant candidates',()=>{
 const item=items[0]
 const low=signalScore({text:'Nimbus 端口',item,priorOf:()=>0})
 const high=signalScore({text:'Nimbus 端口',item:{...item,source:'human',trust:'reported'},priorOf:()=>1})
 assert.equal(low.parts.signal,high.parts.signal);assert.ok(high.score>low.score)
 assert.deepEqual(find('microscopic beetle taxonomy',{priorOf:()=>1}),[])
})
test('null and punctuation-only queries abstain while pinned contract remains explicit',()=>{
 for(const text of ['',null,'?!'])assert.deepEqual(find(text),[])
 const pin={id:'pinned',text:'retain original files',kind:'rule',pinned:true}
 assert.equal(retrieve({text:'',candidates:[pin]})[0].score,1)
})
test('precise identifiers admit but a source description alone stays a semantic candidate',()=>{
 const x=row('identifier','Uses job_nonce_842 for reconciliation.')
 assert.equal(retrieve({text:'job_nonce_842',candidates:[x]})[0].item.id,'identifier')
 const y={...row('description','This operational note must be verified.'),evidence:[{source:'codex-memory-import',sourceProjectLabel:'Nimbus infrastructure',sourceProjectDescription:'listener deployment port'}]}
 assert.deepEqual(retrieve({text:'Nimbus 监听 端口',candidates:[y]}),[])
 assert.equal(rankCandidates({text:'Nimbus 监听 端口',candidates:[y]})[0].item.id,'description')
})
test('shared rankCandidates includes rejected rows for semantic judging, not direct admission',()=>{
 const ranked=rankCandidates({text:'Nimbus 端口',candidates:items})
 assert.equal(ranked.length,2);assert.equal(ranked[0].item.id,'service')
 assert.equal(find('Nimbus 端口').length,1)
})
test('pointer score remains discounted and pointer trust is never promoted',()=>{
 const p=pointerCandidates([{topic:'Nimbus deployment listener port',cues:['deployment'],scope:'p',source:'human'}],{text:'监听端口',scope:'p'})
 assert.equal(p.length,1);assert.equal(p[0].item.trust,'unverified');assert.equal(p[0].pointer,true)
})
test('absolute-path and lowercase compound labels contribute bounded project anchors',()=>{
 for(const label of ['/workspace/workspaces/nebula-console','nebula-console remote maintenance']){
  const it=row('path','Requires confirming the listener port.',label)
  assert.equal(retrieve({text:'nebula-console 端口',candidates:[it]})[0]?.item.id,'path')
  assert.deepEqual(retrieve({text:'nebula-console',candidates:[it]}),[])
 }
})
test('unrelated low-coverage words cannot be rescued by trust or exact long word length',()=>{
 const it={id:'partial',text:'cobalt umber iris violet willow nebula alpha beta gamma delta',source:'human',trust:'confirmed'}
 assert.deepEqual(retrieve({text:'cobalt umber engine turbine copper nickel iron zinc beryl citrine',candidates:[it],priorOf:()=>1}),[])
})
