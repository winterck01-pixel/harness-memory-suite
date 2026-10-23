import {createHash} from 'node:crypto'
import {parse} from '../vendor/acorn.mjs'

const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x)
const hash=v=>createHash('sha256').update(canonical(v)??'null').digest('hex')
const safeName=v=>typeof v==='string'&&/^[A-Za-z_$][\w$]{0,127}$/.test(v)
const ref=e=>({seq:e.seq,eventHash:hash(e)})
const args=e=>{try{const a=e.data?.arguments;return typeof a==='string'?JSON.parse(a):a}catch{return null}}
const member=n=>n?.type==='MemberExpression'&&!n.optional&&n.object?.type==='Identifier'&&n.object.name==='tools'&&(!n.computed?n.property?.name:n.property?.type==='Literal'?n.property.value:null)

// Arguments must be inert JSON-shaped literals, not merely free of selected
// dangerous names. Evaluating a nested expression could throw the matching
// TypeError before the alleged target invocation ever takes place.
function jsonLiteral(n){
 if(!n)return false
 if(n.type==='Literal')return n.value===null||typeof n.value==='string'||typeof n.value==='boolean'||typeof n.value==='number'&&Number.isFinite(n.value)
 if(n.type==='UnaryExpression')return n.operator==='-'&&n.prefix===true&&n.argument?.type==='Literal'&&typeof n.argument.value==='number'&&Number.isFinite(n.argument.value)
 if(n.type==='ArrayExpression')return n.elements.every(jsonLiteral)
 if(n.type==='ObjectExpression')return n.properties.every(p=>p.type==='Property'&&p.kind==='init'&&!p.method&&!p.computed&&!p.shorthand&&(p.key?.type==='Identifier'||p.key?.type==='Literal'&&(typeof p.key.value==='string'||typeof p.key.value==='number'&&Number.isFinite(p.key.value)))&&jsonLiteral(p.value))
 return false
}

// Deliberately conservative: only unconditional, direct top-level tool calls
// can establish an attempted invocation. Text, dead branches, callbacks,
// catch-and-print and hand-thrown TypeErrors do not certify this mechanism.
function attemptedAfterActivation(code,target){
 if(typeof code!=='string'||code.length>20000)return false
 try{
  const ast=parse(code,{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true})
  const calls=[]
  const expression=n=>{
   if(n?.type==='AwaitExpression')return expression(n.argument)
   if(n?.type!=='CallExpression'||n.optional)return false
   const name=member(n.callee)
   if(name){if(!safeName(name)||n.arguments.length!==1||n.arguments[0]?.type!=='ObjectExpression'||!jsonLiteral(n.arguments[0]))return false;calls.push(name);return true}
   return n.callee?.type==='MemberExpression'&&!n.callee.computed&&n.callee.object?.name==='console'&&n.callee.property?.name==='log'&&n.arguments.every(jsonLiteral)
  }
  // Reject hidden program structure anywhere, including tool arguments.
  const scan=n=>{
   if(!n||typeof n!=='object')return
   if(['ThrowStatement','TryStatement','IfStatement','ConditionalExpression','LogicalExpression','SwitchStatement','ForStatement','ForOfStatement','ForInStatement','WhileStatement','DoWhileStatement','FunctionExpression','FunctionDeclaration','ArrowFunctionExpression','AssignmentExpression','UpdateExpression','ImportExpression','ChainExpression'].includes(n.type))throw Error('conditional-or-mutable-source')
   for(const v of Object.values(n))if(Array.isArray(v))v.forEach(scan);else if(v&&typeof v==='object')scan(v)
  }
  scan(ast)
  for(const [index,s]of ast.body.entries()){
   if(s.type==='EmptyStatement')continue
   if(s.type==='ExpressionStatement'||s.type==='ReturnStatement'){
    if(s.type==='ReturnStatement'&&index!==ast.body.length-1)return false
    if(!expression(s.expression??s.argument))return false
   }else if(s.type==='VariableDeclaration'&&['const','let'].includes(s.kind)){
    for(const d of s.declarations)if(d.id?.type!=='Identifier'||['tools','console'].includes(d.id.name)||!expression(d.init))return false
   }else return false
  }
  return calls.length===2&&calls[0]==='activate_tool_group'&&calls[1]===target
 }catch{return false}
}
function outerResult(e){
 const m=e.data?.message??{},blocks=m.content??[],r=Array.isArray(blocks)?blocks.find(x=>x?.type==='tool-result'):null
 const id=m.toolCallId??m.source?.callId??r?.callId
 const error=m.isError===true||r?.isError===true
 const text=Array.isArray(blocks)?blocks.map(b=>b?.type==='text'?b.text??'':b?.type==='tool-result'&&typeof b.content==='string'?b.content:'').join('\n'):''
 const match=error&&text.match(/(?:TypeError:\s*)?tools\.([A-Za-z_$][\w$]{0,127}) is not a function\b/)
 return {id,error,target:match?.[1]??null}
}
function dispatchPair(rows,result,root,name){
 const d=result.data??{}
 if(result.type!=='tool/ptc-dispatch'||d.rootCallId!==root||d.name!==name||d.isError!==false||typeof d.subCallId!=='string'||!d.subCallId)return null
 const starts=rows.filter(e=>e.type==='tool/ptc-dispatch-start'&&e.seq<result.seq&&e.data?.rootCallId===root&&e.data?.subCallId===d.subCallId&&e.data?.name===name)
 return starts.length===1?starts[0]:null
}
function acknowledged(e,target){
 const a=args(e)
 if(!Array.isArray(a?.tools)||!a.tools.includes(target)||!Array.isArray(e.data?.content))return false
 return e.data.content.some(b=>{if(b?.type!=='text'||typeof b.text!=='string')return false;try{const v=JSON.parse(b.text);return v.availableOnNextStep===true&&Array.isArray(v.enabled)&&v.enabled.includes(target)}catch{return false}})
}

/** Classify fixed, already validated native events; never executes source code.
 * This is observational mechanism evidence, not permission or causal proof.
 */
export function identifyActivationTiming(events){
 const insufficient=()=>({status:'insufficient-evidence'})
 if(!Array.isArray(events)||!events.length||events.length>10000)return insufficient()
 const groups=[];let active=null
 for(let i=0;i<events.length;i++){
  const e=events[i]
  if(!e||!Number.isSafeInteger(e.seq)||e.seq<0||i&&e.seq!==events[i-1].seq+1)return insufficient()
  if(e.type==='turn/start'){
   if(active&&!active.ended)return insufficient()
   if(e.data?.turn==null)return insufficient()
   active={turn:e.data.turn,rows:[],ended:false};groups.push(active)
  }
  if(!active)return insufficient()
  if(active.ended)return insufficient()
  if(e.data?.turn!=null&&e.data.turn!==active.turn)return insufficient()
  active.rows.push(e)
  if(e.type==='turn/end')active.ended=true
 }
 const matches=[]
 for(const group of groups){
  if(!group.ended)continue
  const rows=group.rows
  for(const failure of rows.filter(e=>e.type==='tool/result')){
   const result=outerResult(failure),target=result.target
   if(!target||!safeName(target)||target==='activate_tool_group')continue
   const outers=rows.filter(e=>e.type==='tool/call'&&e.data?.name==='run_code'&&e.data?.callId===result.id&&e.seq<failure.seq)
   if(outers.length!==1)continue
   const outer=outers[0],root=outer.data.callId
   if(!attemptedAfterActivation(args(outer)?.code,target))continue
   const activations=rows.filter(e=>e.seq>outer.seq&&e.seq<failure.seq&&acknowledged(e,target)&&dispatchPair(rows,e,root,'activate_tool_group'))
   if(activations.length!==1)continue
   const activation=activations[0],start=dispatchPair(rows,activation,root,'activate_tool_group')
   if(start.seq<=outer.seq||!Array.isArray(args(start)?.tools)||!args(start).tools.includes(target))continue
   let repair={status:'unobserved'}
   for(const r of rows.filter(e=>e.seq>failure.seq&&dispatchPair(rows,e,e.data?.rootCallId,target))){
    const newRoot=r.data.rootCallId
    if(newRoot===root)continue
    const calls=rows.filter(e=>e.type==='tool/call'&&e.data?.name==='run_code'&&e.data?.callId===newRoot&&e.seq>failure.seq&&e.seq<r.seq)
    const endings=rows.filter(e=>e.type==='tool/result'&&e.seq>r.seq&&outerResult(e).id===newRoot&&!outerResult(e).error)
    const repairStart=dispatchPair(rows,r,newRoot,target)
    if(calls.length===1&&endings.length===1&&repairStart.seq>calls[0].seq){repair={status:'observed',outerCall:ref(calls[0]),dispatchStart:ref(repairStart),dispatch:ref(r),outerResult:ref(endings[0])};break}
   }
   matches.push({status:'matched',kind:'activation-timing',targetTool:target,turnHash:hash(String(group.turn)),evidence:{outerCall:ref(outer),activationStart:ref(start),activation:ref(activation),failure:ref(failure)},repair})
  }
 }
 return matches.length===1?matches[0]:insufficient()
}
