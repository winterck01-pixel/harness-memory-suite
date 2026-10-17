import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {parseSource,functionNode,namedStatement,nodes,unique} from './source-ast.mjs'
const source=await readFile(new URL('../client/main.jsx',import.meta.url),'utf8')
const panel=functionNode(parseSource(source),'FilemanPanel')
const transferSource=['transfer','stageClipboard'].map(name=>{const n=namedStatement(panel.body.body,name);return source.slice(n.start,n.end)}).join('\n')
const shortcutEffect=unique(panel.body.body.filter(n=>n.type==='ExpressionStatement' && n.expression.type==='CallExpression' && n.expression.callee.name==='useEffect' && nodes(n.expression.arguments[0],call=>call.type==='CallExpression' && call.callee.type==='MemberExpression' && call.callee.object.name==='window' && call.callee.property.name==='addEventListener' && call.arguments[0]?.value==='keydown' && call.arguments[1]?.name==='onKey').length===1),'keyboard shortcut effect')
const shortcutSource=source.slice(shortcutEffect.start,shortcutEffect.end)
function harness(results){
 const state={calls:[],clipboard:null,notice:null,destination:null}
 const ctx={clipboard:null,useCallback:fn=>fn,cwd:'/target',writable:true,inTrash:false,mutationRef:{current:null},mountedRef:{current:true},allowLeave:()=>true,
 mutate:async(route,body)=>{state.calls.push({route,body});if(results instanceof Error)throw results;return {results}},setBatchReport:()=>{},setNotice:n=>state.notice=n,setClipboard:v=>state.clipboard=v,setDestination:v=>state.destination=v,setDestinationError:()=>{},refresh:()=>{},t:x=>x,fileClipboard:null}
 vm.createContext(ctx)
 vm.runInContext(transferSource+'\nthis.stage=stageClipboard;this.run=transfer;',ctx)
 return {state,ctx}
}
test('copy stages paths without a request and survives selection changes',()=>{
 const {state,ctx}=harness([]);const entries=[{path:'/source/a',name:'a'}]
 ctx.stage('copy',entries);entries[0].path='/changed'
 assert.equal(state.calls.length,0);assert.equal(state.clipboard.entries[0].path,'/source/a')
})
test('cut paste uses stored source and target; successful cut clears clipboard',async()=>{
 const {state,ctx}=harness([{path:'/target/a',ok:true}]);ctx.stage('move',[{path:'/source/a'}])
 await ctx.run('move',state.clipboard.entries,'/target',true)
 assert.equal(state.calls[0].body.paths[0],'/source/a');assert.equal(state.calls[0].body.dest,'/target');assert.equal(state.clipboard,null)
})
test('partial move keeps only failed sources; uncertain response keeps all sources',async()=>{
 const {state,ctx}=harness([{ok:true},{ok:false,error:'denied'}]);ctx.stage('move',[{path:'/source/a'},{path:'/source/b'}]);await ctx.run('move',state.clipboard.entries,'/target',true)
 assert.equal(state.clipboard.entries.length,1);assert.equal(state.clipboard.entries[0].path,'/source/b')
 const h=harness(new Error('connection lost'));h.ctx.stage('move',[{path:'/source/a'}]);await h.ctx.run('move',h.state.clipboard.entries,'/target',true);assert.equal(h.state.clipboard.entries.length,1)
})
test('copy can paste repeatedly to explicitly selected folders',async()=>{
 const {state,ctx}=harness([{ok:true}]);ctx.stage('copy',[{path:'/source/a'}]);await ctx.run('copy',state.clipboard.entries,'/one',true);await ctx.run('copy',state.clipboard.entries,'/two',true)
 assert.equal(state.calls.length,2);assert.equal(state.calls[1].body.dest,'/two');assert.equal(state.clipboard.entries.length,1)
})
test('file shortcuts dispatch copy/cut/paste while text fields keep native editing',()=>{
 let handler; const calls=[]
 class HTMLElement {constructor(tag='DIV'){this.tagName=tag}closest(){return null}}
 const ctx={HTMLElement,useEffect:fn=>fn(),window:{addEventListener:(name,fn)=>handler=fn},viewer:null,destination:null,knowledgeMode:false,mutationRef:{current:null},infoEntry:null,prompt:null,confirming:null,editing:false,writable:true,inTrash:false,clipboard:{entries:[{path:'/source/a'}]},selectedEntries:[{path:'/source/a'}],stageClipboard:route=>calls.push(route),pasteClipboard:()=>calls.push('paste'),askRemove:()=>{},listing:{},navigate:()=>{},openEntry:()=>{},saveDraft:()=>{}}
 vm.createContext(ctx)
 vm.runInContext(shortcutSource,ctx)
 for(const modifier of ['ctrlKey','metaKey'])for(const key of ['c','x','v'])handler({key,[modifier]:true,target:new HTMLElement(),preventDefault(){}})
 assert.deepEqual(calls,['copy','move','paste','copy','move','paste'])
 for(const target of [new HTMLElement('INPUT'),new HTMLElement('TEXTAREA'),Object.assign(new HTMLElement(),{isContentEditable:true})]) {
  for(const key of ['c','x','v'])handler({key,metaKey:true,target,preventDefault(){throw Error('must not intercept text')}})
 }
 assert.equal(calls.length,6)
 for(const key of ['c','x','v'])handler({key,ctrlKey:true,altKey:true,target:new HTMLElement(),preventDefault(){throw Error('must not intercept Alt-modified shortcuts')}})
 ctx.writable=false
 for(const key of ['c','x','v'])handler({key,ctrlKey:true,target:new HTMLElement(),preventDefault(){throw Error('must not intercept in read-only mode')}})
 ctx.writable=true;ctx.inTrash=true
 for(const key of ['c','x','v'])handler({key,ctrlKey:true,target:new HTMLElement(),preventDefault(){throw Error('must not intercept in trash')}})
 assert.equal(calls.length,6)
})
