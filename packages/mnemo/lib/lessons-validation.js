import {createHash} from 'node:crypto'

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const binding=l=>digest([l.type,l.signature,l.scope,l.tool??null,l.trigger,l.advice])
const CONTRACTS=[
 {id:'edit-read-before-write-v1',pattern:/file has not been read|(?:文件|目标).{0,12}(?:未读取|尚未读取|没有读取)/i,
  trigger:'edit 报 file has not been read，目标文件尚未读取',
  advice:'先 read 读取当前目标文件，再根据刚读取的内容执行 edit；目标内容变化时重新 read 后再尝试。'},
 {id:'edit-reread-stale-v1',pattern:/file changed since (?:it was )?(?:last )?read|(?:文件|内容).{0,12}(?:读取后|已).{0,8}(?:变化|改变)/i,
  trigger:'edit 报 file changed since it was read，目标内容已变化',
  advice:'先 read 重新读取当前目标文件，再根据最新内容更新 edit 的匹配文本；不要沿用变化前的旧文本重试。'},
]

/** Verify a narrow, observed tool contract. Free-form model prose is never the
 * verified instruction: the returned lesson uses the matching contract template.
 * A failed edit, a successful read and a successful edit must all address the
 * same explicit target, in order, with no later failed edit for that target. */
export function verifyRecordedLesson(lesson,pack){
 if(!lesson?.signature||lesson.type==='method'||(lesson.scope==='tool'&&lesson.tool!=='edit'))return null
 const rows=Array.isArray(pack?.window)?pack.window:[],failures=Array.isArray(pack?.failures)?pack.failures:[]
 for(const failure of failures.filter(f=>f.signature===lesson.signature&&f.tool==='edit')){
  const failed=rows.find(r=>r.seq===failure.seq&&r.failed&&r.tool==='edit'&&r.targetKey)
  if(!failed)continue
  const contract=CONTRACTS.find(c=>c.pattern.test(String(failed.result??'')))
  if(!contract)continue
  const after=rows.filter(r=>r.seq>failed.seq&&r.targetKey===failed.targetKey).sort((a,b)=>a.seq-b.seq)
  const read=after.find(r=>r.tool==='read'&&!r.failed)
  if(!read)continue
  const success=after.find(r=>r.seq>read.seq&&r.tool==='edit'&&!r.failed)
  if(!success||after.some(r=>r.seq>success.seq&&r.tool==='edit'&&r.failed))continue
  const verified={...lesson,type:'fix',trigger:contract.trigger,advice:contract.advice,confidence:'high'}
  const verification={kind:'tool-contract',version:1,contract:contract.id,signature:lesson.signature,targetKey:failed.targetKey,
   sequences:[failed.seq,read.seq,success.seq],binding:binding(verified),
   proposal:{type:lesson.type,trigger:lesson.trigger,advice:lesson.advice,confidence:lesson.confidence}}
  return {lesson:verified,verification}
 }
 return null
}

/** Keep a proof bound to exactly the canonical instruction it verified. */
export function verificationMatches(lesson,verification){
 return verification?.kind==='tool-contract'&&verification.version===1&&CONTRACTS.some(c=>c.id===verification.contract)&&verification.binding===binding(lesson)
}
