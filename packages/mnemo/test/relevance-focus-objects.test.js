import {test} from 'node:test'
import assert from 'node:assert/strict'
import {relevanceTokens} from '../lib/relevance.js'
import {retrieve} from '../lib/retrieve.js'
const row=(id,text)=>({id,text,entities:['northstar'],evidence:[{source:'codex-memory-import',sourceProjectLabel:'Northstar'}]})
const find=(text,rows)=>retrieve({text,candidates:rows,entities:['northstar']}).map(x=>x.item.id)
test('longest compound concepts survive both languages and retain useful parents',()=>{
 for(const surface of ['首尾帧','first-last frame','first/last frame'])assert.ok(relevanceTokens(surface).has('@boundaryframe'),surface)
 for(const surface of ['文件管理器','file manager','file-manager'])assert.ok(relevanceTokens(surface).has('@filemanager'),surface)
})
test('feature focus cannot be supplied by generic editor state facets',()=>{
 const rows=[row('feature','First-last frame mode persists.'),row('facet','Editor state uses cache invalidation.')]
 for(const q of ['Northstar 首尾帧 模式 编辑器 状态','Northstar first-last frame mode editor state'])assert.deepEqual(find(q,rows),['feature'])
})
test('tool objects separate identical storage operations and preserve individual facets',()=>{
 const rows=[row('cut','File manager cut shortcut.'),row('paste','File-manager paste into a target folder.'),row('cloud','Cloud storage moves files and folders.')]
 for(const q of ['Northstar 文件管理器 剪切 复制 粘贴 移动 文件夹','Northstar file manager cut copy paste move folder'])assert.deepEqual(new Set(find(q,rows)),new Set(['cut','paste']))
})
test('screen unlocking is distinct from authentication and historical permission',()=>{
 const rows=[row('screen','Screen unlock requires current permission.'),row('bridge','Authorization for an authentication bridge was historical.')]
 for(const q of ['Northstar 解锁 授权','Northstar unlock authorization'])assert.deepEqual(find(q,rows),['screen'])
})
test('adoption boundaries use body governance evidence, not automatic notifications',()=>{
 const rows=[row('policy','Keep propose-only and frozen until paired held-out outcomes exist.'),row('mechanism','Memory governance uses explicit adoption approval.'),row('notice','Memory automatic notifications report service status.')]
 for(const q of ['Northstar 记忆 自动 采纳 治理','Northstar memory automatic adoption governance'])assert.deepEqual(new Set(find(q,rows)),new Set(['policy','mechanism']))
})
test('independent objects retain legitimate partial records',()=>{
 const rows=[row('bill','Invoice records original currency.'),row('graphics','Render alpha channel.'),row('wrong','Automatic editor state.')]
 assert.deepEqual(new Set(find('Northstar invoice currency render alpha',rows)),new Set(['bill','graphics']))
})
test('cue and description discovery cannot supply a missing body object',()=>{
 const item={...row('hint','Move files into a folder.'),cues:['file manager'],evidence:[{source:'codex-memory-import',sourceProjectLabel:'Northstar',sourceProjectDescription:'File manager copy cut paste'}]}
 assert.deepEqual(find('Northstar file manager move folder',[item]),[])
})
test('a missing object remains missing without any named project or identity route',()=>{
 const rows=[row('wrong','Editor state mode.'),row('object','First-last frame editor mode.')]
 const ids=retrieve({text:'首尾帧 编辑器 状态 模式',candidates:rows,entities:[]}).map(x=>x.item.id)
 assert.deepEqual(ids,['object'])
})
test('compound matching preserves identifiers containing ordinary concept words',()=>{
 for(const id of ['sample_module.cpp','file-manager_nonce_839','invoice_render_v4'])assert.ok(relevanceTokens(id).has(id),id)
})

test('operation intent rejects container-only side branches and keeps omitted-container facets',()=>{
 const rows=[row('trash','File manager trash restores deleted files.'),row('clipboard','Copy may be pasted repeatedly; successful cut clears clipboard.'),row('target','A same-directory move is unchanged; same-name copy uses unique name.')]
 assert.deepEqual(new Set(find('Northstar file manager cut copy paste move',rows)),new Set(['clipboard','target']))
})
test('configuration facets support partial frame evidence without admitting generic editor state',()=>{
 const rows=[row('mode','The frame_mode and image_input_mode paths diverged; check request builder.'),row('decision','Unify state/capability decision before individual adapters.'),row('editor','Editor state has cache invalidation.')]
 assert.deepEqual(new Set(find('Northstar first-last frame mode state editor capability',rows)),new Set(['mode','decision']))
})
test('ordinary adoption and frozen render outcomes are not memory governance',()=>{
 const rows=[row('invoice','Adopt strict invoice formats.'),row('render','The frozen render outcome is retained.')]
 assert.deepEqual(find('Northstar governance',rows),[])
 assert.deepEqual(find('Northstar memory governance',rows),[])
})

test('transfer qualifiers do not suppress a separate requested object',()=>{
 const rows=[row('invoice','Invoice records original currency.'),row('clipboard','File manager cut copy paste move.')]
 for(const query of ['Northstar file manager cut copy paste move invoice currency','Northstar 文件管理器 剪切 复制 发票 币种'])assert.deepEqual(new Set(find(query,rows)),new Set(['invoice','clipboard']))
})

test('independent configuration partial survives an unrelated transfer facet',()=>{
 const rows=[row('decision','Unify state/capability decision before individual adapters.'),row('clipboard','File manager cut copy paste move.')]
 const q='Northstar first-last frame mode state editor capability file manager cut copy paste move'
 assert.deepEqual(new Set(find(q,rows)),new Set(['decision','clipboard']))
})

test('scattered capability and checkout state do not establish a configuration decision',()=>{
 const rows=[row('decision','Unify the state/capability decision before individual adapters.'),row('routing','The capability registry contains a routing model; recheck current checkout state.')]
 assert.deepEqual(find('Northstar first-last frame mode state editor capability',rows),['decision'])
})

test('configuration decision support shares case normalization with body concepts',()=>{
 for(const body of ['Unify the state/capability Decision before individual adapters.','STATE/CAPABILITY DECISION before individual adapters.'])assert.deepEqual(find('Northstar first-last frame mode state editor capability',[row('decision',body)]),['decision'])
})
