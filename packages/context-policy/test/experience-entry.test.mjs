import test from 'node:test'
import assert from 'node:assert/strict'
import {BASE,createState,claim,select,denial,activate,release} from '../policy.js'
const toolNames=['mnemo_recall','mnemo_experience','mnemo_private','read','generate_image','activate_tool_group']
const tools=toolNames.map(name=>({name,description:'fixture'}))
const claimed=(text,source='user')=>{const s=createState();claim(s,{turn:1,message:{source:{kind:source},content:[{type:'text',text}]}});s.catalog=new Map(tools.map(t=>[t.name,t]));return s}

test('ordinary user and schedule turns expose the two memory entry points only',()=>{
 for(const source of ['user','schedule']){
  const s=claimed('处理表格并复用适用的成功经验',source),chosen=select(s,tools)
  assert.ok(BASE.has('mnemo_experience'))
  assert.deepEqual(chosen.map(t=>t.name),['mnemo_recall','mnemo_experience','activate_tool_group'])
  assert.equal(denial(s,'mnemo_experience'),undefined)
  for(const name of ['mnemo_private','read','generate_image'])assert.match(denial(s,name),/NOT_LOADED/)
 }
})
for(const text of ['本轮不要使用记忆','Do not read memories.','不要调用任何工具'])test(`user prohibition still wins: ${text}`,()=>{
 const s=claimed(text)
 assert.ok(!select(s,tools).some(t=>t.name==='mnemo_experience'))
 assert.match(denial(s,'mnemo_experience'),/USER_DISABLED/)
 assert.throws(()=>activate(s,null,['mnemo_experience']),/USER_DISABLED|UNAVAILABLE_OR_DISABLED/)
})
test('base entry does not manufacture a tool hidden by the permitted catalog',()=>{
 const s=claimed('处理表格'),without=tools.filter(t=>t.name!=='mnemo_experience')
 assert.ok(!select(s,without).some(t=>t.name==='mnemo_experience'))
})
test('phase release preserves base entries while removing extended tools',()=>{
 const s=claimed('处理表格')
 activate(s,null,['read']);assert.ok(select(s,tools).some(t=>t.name==='read'))
 release(s)
 assert.deepEqual(select(s,tools).map(t=>t.name),['mnemo_recall','mnemo_experience','activate_tool_group'])
})
test('next turn removes prior prohibition but changes no other activation defaults',()=>{
 const s=claimed('本轮不要使用记忆');select(s,tools)
 claim(s,{turn:2,message:{source:{kind:'user'},content:[{type:'text',text:'处理下一份表格'}]}})
 assert.deepEqual(select(s,tools).map(t=>t.name),['mnemo_recall','mnemo_experience','activate_tool_group'])
})
