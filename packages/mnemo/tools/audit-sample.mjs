// Weekly human audit. Usage:
//   node tools/audit-sample.mjs sample [--n 20] [--out audit.md] [--dir lessonsDir]
//   node tools/audit-sample.mjs apply audit.md [--dir lessonsDir]
//      "- [x] retire <id>"  -> state retired      "- [x] approve <id>" -> candidate becomes active
// Changes are written under the ledger's writer lock with a fresh state timestamp, so a running
// engine adopts them on its next refresh/save instead of overwriting them.
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {LessonStore} from '../lib/lessons.js'
const [,,cmd,fileArg]=process.argv
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:d}
const dir=arg('dir',join(homedir(),'.dsh/mnemo/lessons'))
const store=new LessonStore({directory:dir})
const line=l=>`### ${l.id}\n- 状态:${l.state}${l.review?.needsHuman?'(需人工)':''}${l.review?.reason?` · 原因:${l.review.reason}`:''} · 类型:${l.type} · 置信度:${l.confidence} · support ${l.stats.support} · 注入 ${l.stats.injected} · 复发 ${l.stats.recurAfterInject}\n- 情境:${l.trigger}\n- 建议:${l.advice}\n- [ ] 正确  - [ ] 可迁移  - [ ] 无害\n${l.state==='candidate'?`- [ ] approve ${l.id}\n`:''}- [ ] retire ${l.id}\n`
if(cmd==='sample'){
 const n=Number(arg('n',20)),all=store.list().filter(l=>!l.seed&&l.state!=='retired')
 const review=all.filter(l=>l.state==='candidate'&&l.review?.needsHuman),rest=all.filter(l=>!review.includes(l))
 for(let i=rest.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rest[i],rest[j]]=[rest[j],rest[i]]}
 const out=arg('out','audit-'+new Date().toISOString().slice(0,10)+'.md'),pick=rest.slice(0,n)
 writeFileSync(out,`# Lessons 抽检\n勾选 "retire" 会停用该条;勾选 "approve" 会把候选转为可用。\n\n## 需人工审核的候选(${review.length} 条,全部列出)\n\n${review.map(line).join('\n')}\n## 随机抽检(${all.length} 条非 seed 中抽 ${pick.length})\n\n${pick.map(line).join('\n')}`)
 console.log('wrote',out,'review',review.length,'sampled',pick.length)
}else if(cmd==='apply'){
 if(!fileArg||!existsSync(fileArg))throw Error('audit file not found')
 const md=readFileSync(fileArg,'utf8')
 const ids=re=>[...md.matchAll(re)].map(m=>m[1])
 const retire=ids(/^- \[x\] retire (\S+)/gim),approve=ids(/^- \[x\] approve (\S+)/gim)
 const res=store.update((state,s)=>{
  let r=0,a=0
  for(const id of retire){const l=state.lessons[id];if(l&&(l.state!=='retired'||l.stateBy!=='audit'||l.retiredBy!=='audit')){s.setState(l,'retired','audit',{retiredAt:s.now(),retiredBy:'audit'});r++}}
  for(const id of approve){const l=state.lessons[id];if(l&&l.state==='candidate'&&!retire.includes(id)){s.setState(l,'active','audit',{promotedBy:'human'});l.review={...(l.review??{}),needsHuman:false,approvedAt:s.now()};a++}}
  return {retired:r,approved:a}
 })
 console.log(JSON.stringify(res))
}else{console.log('usage: sample | apply <file>');process.exit(1)}
