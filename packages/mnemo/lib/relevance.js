import { normalizeSurface } from './entity.js'


const STOP = new Set(('a an the this that these those i we you it its our your to of in on at as by for from with and or but is are was were be been being have has had do does did can could should would will may might must need needs use using used please help give short concise practical explain explanation before after then also just only now how what which why when where without anything something any each all more most than very into about against through project projects request task checks check review checklist confirm verify verification preserve original').split(' '))
const GROUPS = {
 backup:['backup','backups','备份'], checksum:['checksum','checksums','校验和'], snapshot:['snapshot','snapshots','快照'], retention:['retention','轮换'],
 invoice:['invoice','invoices','发票'], receipt:['receipt','receipts','收据','凭证'], currency:['currency','currencies','币种','原币'],
 render:['render','renders','rendering','渲染'], export:['export','exports','导出'], alpha:['alpha','透明通道','透明背景'], resolution:['resolution','分辨率'],
 deploy:['deploy','deployment','部署','发布'], port:['port','ports','端口'], listener:['listener','监听'], service:['service','服务'],
 file:['file','files','文件'], folder:['folder','folders','directory','directories','目录','文件夹'], filemanager:['file manager','file-manager','fileman','文件管理器'],
 cut:['cut','剪切'], copy:['copy','copies','复制'], paste:['paste','粘贴'], move:['move','moving','移动'], shortcut:['shortcut','shortcuts','快捷键'],
 category:['category','categories','classification','分类'], tag:['tag','tags','标签'], ranking:['ranking','rankings','排行榜','榜单'], platform:['platform','平台'],
 frame:['frame','frames','帧'], boundaryframe:['first-last frame','first/last frame','first last frame','first-last','first/last','首尾帧','首帧','尾帧'], mode:['mode','模式'], persist:['persist','persistence','persisted','保存','持久化'],
 generate:['generate','generation','生成'], capability:['capability','capabilities','能力'], editor:['editor','编辑器'], drag:['drag','reorder','拖动','拖拽','换位'],
 memory:['memory','memories','记忆'], automatic:['automatic','automatically','自动'], adopt:['adopt','adoption','采纳'], governance:['governance','治理'], frozen:['frozen','freeze','冻结'],
 authorization:['authorization','授权'], permission:['permission','permissions','权限'], unlock:['unlock','unlocked','解锁'], lock:['lock','locked','锁屏'], historical:['historical','history','历史'],
 refactor:['refactor','重构'], module:['module','模块'], login:['login','authentication','鉴权','登录'], migrate:['migrate','migration','迁移'], script:['script','脚本'],
 retry:['retry','retries','重试'], idempotency:['idempotent','idempotency','幂等'], database:['database','数据库'],
 video:['video','视频'], image:['image','图片','图像'], download:['download','下载'], upload:['upload','上传'], playback:['playback','播放'],
 test:['test','testing','测试'], code:['code','代码'], state:['state','状态'], request:['request','请求'], model:['model','模型'],
 cache:['cache','缓存'], secret:['secret','credential','凭据','密钥'], scope:['scope','作用域'], source:['source','来源'],
}


const CONTEXT_CONCEPTS=new Set(['@refactor','@module','@request','@code','@test','@source','@historical'])
const LATIN = /[a-z0-9][a-z0-9_+#.\/-]*/g
const aliases=new Map()
for(const [key,words] of Object.entries(GROUPS)) for(const word of words) if(/^[a-z]/.test(word)) aliases.set(word,'@'+key)
const CJK=/[\u4e00-\u9fff]+/g
const normalize=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/\bmacos\b/g,'mac')


const surfaces=Object.entries(GROUPS).flatMap(([key,words])=>words.map(word=>({word,token:'@'+key}))).sort((a,b)=>b.word.length-a.word.length).map(({word,token})=>{
 const escaped=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),latin=/^[a-z]/.test(word)
 return {token,pattern:new RegExp((latin?'(?<![a-z0-9_+#./-])':'')+escaped+(latin?'(?![a-z0-9_+#./-])':''),'g')}
})
const PARENTS={'@boundaryframe':['@frame'],'@filemanager':['@file']}
export function relevanceTokens(text) {
 const s=normalize(text), tokens=new Set()
 let remaining=s
 for(const {token,pattern} of surfaces){
  remaining=remaining.replace(pattern,()=>{tokens.add(token);return ' '})
 }
 for(const raw of remaining.match(LATIN)??[]){const word=raw.replace(/[.\/-]+$/,'');if(STOP.has(word)||!word)continue;tokens.add(aliases.get(word)??word);for(const part of word.split(/[_./-]+/)){if(part!==word&&!STOP.has(part)&&part.length>=2)tokens.add(aliases.get(part)??part)}}
 remaining=remaining.replace(/帮我|请你|一下|给我|如何|怎么|怎样|为什么|列出|一份|简短|逐步|解释|说明|先只|需要|继续|检查|确认|有效|之前|之后|现在|可以|应该|哪些|几个|处理|不要|代码/g,' ')
 for(const run of remaining.match(CJK)??[])for(let i=0;i<run.length-1;i++)tokens.add('zh:'+run.slice(i,i+2))
 for(const [child,parents] of Object.entries(PARENTS))if(tokens.has(child))for(const parent of parents)tokens.add(parent)


 const proposal=/\bpropose[- ]only\b|仅提议|仅建议|只提议/.test(s)
 const validation=/\bheld[- ]out\b|\boutcomes?\b|留出|配对结果/.test(s)
 const memoryDecision=tokens.has('@memory')&&tokens.has('@adopt')
 const candidateDecision=proposal&&tokens.has('@frozen')&&validation
 if(memoryDecision||candidateDecision)tokens.add('@governance')
 return tokens
}


const OBJECTS=new Set(['backup','checksum','snapshot','retention','invoice','receipt','currency','render','alpha','resolution','filemanager','category','tag','ranking','boundaryframe','memory','governance','unlock','lock','database','video','image','cache','secret'].map(x=>'@'+x))

const FACETS={
 '@boundaryframe':['@frame','@mode','@editor','@state','@persist','@cache'],
 '@filemanager':['@file','@folder','@cut','@copy','@paste','@move','@shortcut','@upload','@download'],
 '@governance':['@memory','@adopt','@frozen','@automatic','@authorization','@permission'],
 '@unlock':['@lock','@authorization','@permission','@login'],
}
function focusTopics(topics){
 const focus=new Set(topics.filter(t=>OBJECTS.has(t)))
 for(const [object,facets] of Object.entries(FACETS))if(focus.has(object))for(const facet of facets)focus.delete(facet)
 return focus
}

export function memoryBody(item) {
 const text=String(item?.text??'')
 if(!(item?.evidence??[]).some(e=>e?.source==='codex-memory-import'))return text
 const lines=text.split('\n')
 if(/^\[Codex(?:历史笔记；现状待核验；历史授权不代表本次授权| historical; verify current)\]$/i.test(lines[0]??'')&&/^(?:项目分组|Project)\s*[:：]/i.test(lines[1]??''))return lines.slice(2).join('\n')
 return text
}


function isProjectEntity(entity,label){
 const name=normalizeSurface(entity),project=normalize(label),positions=[]
 let surface=''


 for(let i=0;i<project.length;i++)if(normalizeSurface(project[i])){positions.push(i);surface+=project[i]}
 if(!name||!surface)return false
 let at=surface.indexOf(name)
 while(at>=0){
  const before=project[positions[at]-1]??'',after=project[positions[at+name.length-1]+1]??''
  if(!(/^[a-z0-9]/.test(name)&&/[a-z0-9]/.test(before))&&!(/[a-z0-9]$/.test(name)&&/[a-z0-9]/.test(after)))return true
  at=surface.indexOf(name,at+1)
 }
 return false
}
const fieldCache=new WeakMap()
function searchFields(item){
 const body=memoryBody(item)
 const historical=(item?.evidence??[]).find(e=>e?.source==='codex-memory-import')
 const label=historical?.sourceProjectLabel??'',description=historical?.sourceProjectDescription??''
 const cueKey=JSON.stringify(item?.cues??[])
 const cached=fieldCache.get(item)
 if(cached&&cached.body===body&&cached.label===label&&cached.description===description&&cached.cueKey===cueKey)return cached.fields
 const anchors=new Set(),weakAnchors=new Set()


 for(const raw of String(description).normalize('NFKC').match(/[A-Za-z0-9][A-Za-z0-9_+#.\/-]*/g)??[]){
  if(!(/[A-Z]/.test(raw)||/[A-Za-z].*[0-9]|[0-9].*[A-Za-z]/.test(raw)||/[-_]/.test(raw)))continue
  const tokens=[...relevanceTokens(raw)]

  const parts=raw.toLowerCase().split(/[_./-]+/).filter(Boolean)
  if(parts.length>1&&parts.every(part=>![...relevanceTokens(part)].some(t=>!t.startsWith('@'))))continue
  for(const token of tokens)if(!token.startsWith('@')&&!token.startsWith('zh:'))weakAnchors.add(token)
 }
 const head=label||(body.trim().split(/\s+/).length>=4?body:'')

 const pathHead=label.match(/^(?:[a-z]:)?[\/\\][^\n]*/i)?.[0]?.trim()
 const pathBase=pathHead?.replace(/[\/\\]+$/,'').split(/[\/\\]/).at(-1)?.split(/\s/)[0]
 if(pathBase)for(const token of relevanceTokens(pathBase))if(!token.startsWith('@')&&!token.startsWith('zh:'))anchors.add(token)
 const compoundHead=label.match(/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+/i)?.[0]
 if(compoundHead)for(const token of relevanceTokens(compoundHead))if(!token.startsWith('@')&&!token.startsWith('zh:'))anchors.add(token)
 const named=head.match(/^(?:[A-Z][A-Za-z0-9_-]*|[a-z]+\d+[a-z0-9-]*)(?:\s+[A-Z][A-Za-z0-9_-]*)*/)?.[0]??''
 for(const token of relevanceTokens(named))if(!token.startsWith('@')&&!token.startsWith('zh:'))(label?anchors:weakAnchors).add(token)
 for(const token of relevanceTokens(label)){if(/^[a-z]+\d+[a-z0-9-]*$/.test(token))anchors.add(token)}
 const bodyTokens=relevanceTokens(body),bodyObjects=new Set(bodyTokens)
 for(const cue of item?.cues??[])for(const token of relevanceTokens(cue))bodyTokens.add(token)
 const descriptionTokens=relevanceTokens(description+' '+label)
 const configurationDecision=bodyObjects.has('@capability')&&bodyObjects.has('@state')&&/\bdecisions?\b|决策/.test(normalize(body))
 const fields={body:bodyTokens,objects:bodyObjects,configurationDecision,description:descriptionTokens,anchors,weakAnchors,projectLabel:label}
 fieldCache.set(item,{body,label,description,cueKey,fields})
 return fields
}

export function relevanceCorpus(items=[],text=null){
 const fields=new Map(),df=new Map()
 for(const item of items){const f=searchFields(item);fields.set(item,f);for(const token of f.body)df.set(token,(df.get(token)??0)+1)}
 return {fields,df,size:items.length,queryText:text,queryTokens:text==null?null:relevanceTokens(text)}
}

export function fieldRelevance({text='',cues=[],entities=[],item={},corpus=null}={}){
 const f=corpus?.fields.get(item)??searchFields(item),q=corpus?.queryText===text&&corpus.queryTokens?new Set(corpus.queryTokens):relevanceTokens(text)

 if(!String(text??'').trim())for(const cue of cues??[])for(const token of relevanceTokens(cue))q.add(token)
 const sharedEntities=(entities??[]).filter(x=>(item.entities??[]).includes(x))


 const projectEntity=entity=>isProjectEntity(entity,f.projectLabel)
 const subjectMatch=sharedEntities.some(entity=>!projectEntity(entity))
 const anchors=new Set(f.anchors)
 for(const entity of item.entities??[])if(projectEntity(entity))for(const token of relevanceTokens(entity))anchors.add(token)
 const anchorHits=[...q].filter(t=>anchors.has(t)||f.weakAnchors.has(t))


 const hasIndependentConcept=[...q].some(t=>!anchors.has(t)&&t.startsWith('@')&&!CONTEXT_CONCEPTS.has(t))
 const queryTopics=[...q].filter(t=>!anchors.has(t)&&!(hasIndependentConcept&&f.weakAnchors.has(t)))
 const unknownLiteral=t=>t.startsWith('zh:')&&!(corpus?corpus.df.has(t):f.body.has(t))
 const hasSubject=queryTopics.some(t=>!CONTEXT_CONCEPTS.has(t)&&!unknownLiteral(t))


 const topics=hasSubject?queryTopics.filter(t=>!CONTEXT_CONCEPTS.has(t)):queryTopics


 const matched=topics.filter(t=>f.body.has(t))
 const substantive=matched.filter(t=>!t.startsWith('zh:'))
 const literal=matched.filter(t=>t.startsWith('zh:'))
 const weight=t=>1+Math.log(1+(corpus?.size??1)/((corpus?.df.get(t)??1)+1))
 const literalTopics=topics.filter(t=>t.startsWith('zh:'))
 const explicitTopics=topics.filter(t=>!t.startsWith('zh:'))
 const literalTotal=literalTopics.reduce((n,t)=>n+weight(t),0)
 const literalOverlap=literal.reduce((n,t)=>n+weight(t),0)
 const literalCoverage=literalTotal?literalOverlap/literalTotal:0


 const literalBudget=literalTopics.length?weight('zh:budget'):0
 const total=explicitTopics.reduce((n,t)=>n+weight(t),0)+literalBudget
 const overlap=substantive.reduce((n,t)=>n+weight(t),0)+literalBudget*literalCoverage
 const coverage=explicitTopics.length?(total?overlap/total:0):literalCoverage
 const bodyMatch=matched
 const precise=bodyMatch.some(t=>!t.startsWith('@')&&!t.startsWith('zh:')&&(!corpus||(corpus.df.get(t)??0)<=Math.max(2,corpus.size*.03))&&(/[0-9_+.#/]/.test(t)||t.length>=7))
 const hasConcreteConcept=topics.some(t=>t.startsWith('@')&&!CONTEXT_CONCEPTS.has(t))
 const topicEnough=substantive.length>0||!hasConcreteConcept&&literal.length>=2
 const identity=anchorHits.length>0||sharedEntities.some(projectEntity)
 const concreteConcept=substantive.some(t=>t.startsWith('@')&&!CONTEXT_CONCEPTS.has(t))


 const partialRoute=identity&&(concreteConcept||precise)
 const identifierRoute=precise&&coverage>=.16&&bodyMatch.some(t=>!t.startsWith('@')&&!t.startsWith('zh:')&&/[0-9_+.#/]/.test(t))
 const rareConceptRoute=coverage>=.16&&substantive.some(t=>t.startsWith('@')&&!CONTEXT_CONCEPTS.has(t)&&(corpus?.df.get(t)??1)<=Math.max(2,(corpus?.size??1)*.03))
 const focus=focusTopics(topics)


 const transferOps=['@cut','@copy','@paste','@move']
 const transferRequested=topics.includes('@filemanager')&&transferOps.some(t=>topics.includes(t))
 const transferSupport=transferOps.filter(t=>f.objects.has(t)).length>=2||f.objects.has('@filemanager')&&transferOps.some(t=>topics.includes(t)&&f.objects.has(t))
 const frameSupport=focus.has('@boundaryframe')&&(f.objects.has('@frame')&&f.objects.has('@mode')||f.configurationDecision)


 const objectSupport=!focus.size||[...focus].some(t=>t==='@filemanager'&&transferRequested?transferSupport:f.objects.has(t))||frameSupport
 const admitted=subjectMatch||identifierRoute||objectSupport&&(topicEnough&&coverage>=.32||partialRoute||rareConceptRoute)


 const relevance=admitted?Math.min(1,Math.max(subjectMatch?.20:0,.08+.82*coverage+.10*(identity?1:0))) : Math.min(.17,.16*coverage)
 return {relevance,anchor:anchorHits.length?1:0,topic:coverage,identifier:precise?1:0}
}
