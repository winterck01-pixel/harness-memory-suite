import test from 'node:test'
import assert from 'node:assert/strict'
import {selectCaptureText} from '../lib/capture-policy.js'
import {memoryOptOut as memoryBlocked} from '../lib/context-policy.js'
import {memoryOptOut as hostBlocked} from '../../context-policy/memory-policy.js'

test('recognition requests do not accidentally prohibit memory lookup or capture',()=>{
 for(const prefix of ['', '请', '请先', '本轮请先', '先检查表格，']){
  const lookup=prefix+'识别并使用适用记忆完成表格合并'
  assert.equal(memoryBlocked(lookup),false,lookup)
  assert.equal(hostBlocked(lookup),false,lookup)
  const capture=prefix+'识别并记录可复用记忆'
  assert.equal(selectCaptureText(capture).hasOptOut,false,capture)
 }
})

test('recognition masking does not erase a later prohibition or noun followed by 别',()=>{
 for(const text of ['识别字段，本轮不要使用记忆','请识别格式，但别使用记忆','这个别使用记忆','知识别用于记忆']){
  assert.equal(memoryBlocked(text),true,text)
  assert.equal(hostBlocked(text),true,text)
 }
 for(const text of ['识别字段，本轮不要保存记忆','请识别内容，但别记录到长期记忆','这个别保存记忆']){
  assert.equal(selectCaptureText(text).hasOptOut,true,text)
 }
})
