import {compileShotMentions,remapShotMentions,shotRefs} from './shot-mentions.js';
import {validateParameters,validateReferences,modeCapability,durationIsAutomatic,videoDefaults,modelSpec} from 'dsh-video-studio/model-registry.js';
import {modeNames,modesFor,modeOf,modeProblem,refsForMode} from './generation-modes.js';
import {mkdir,readFile,writeFile,rename,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export class FilmError extends Error {constructor(message,status=400){super(message);this.status=status}}
export class Store {
 constructor(dir){this.dir=dir;this.tail=Promise.resolve();this.data={schema:1,projects:[],tasks:[]}}
 async open(){await mkdir(this.dir,{recursive:true,mode:0o700});try{this.data=JSON.parse(await readFile(join(this.dir,'projects.json'),'utf8'));if(this.data.schema!==1||!Array.isArray(this.data.projects)||!Array.isArray(this.data.tasks))throw Error('项目数据版本无效')}catch(e){if(e.code!=='ENOENT')throw e}return this}
 read(){return structuredClone(this.data)}
 async history(projectId,revision,direction){return this.tx(s=>{const p=projectOf(s,projectId,revision),h=s.history?.[projectId];if(!h?.[direction]?.length)throw new FilmError('没有可撤销或重做的操作');if(s.tasks.some(t=>t.projectId===projectId&&active(t)))throw new FilmError('存在未结束任务，暂不可撤销或重做');const target=h[direction].pop();for(const shot of target.shots){const current=p.shots.find(x=>x.id===shot.id);if(current)shot.candidates=[...new Map([...shot.candidates,...current.candidates].map(c=>[c.id,c])).values()];}h[direction==='undo'?'redo':'undo'].push(structuredClone(p));target.revision=p.revision+1;s.projects[s.projects.indexOf(p)]=target;return target;})}
 tx(fn,{history=false}={}){const p=this.tail.then(async()=>{const draft=structuredClone(this.data);const result=await fn(draft);if(history){draft.history??={};for(const before of this.data.projects){const after=draft.projects.find(p=>p.id===before.id);if(after&&JSON.stringify(before)!==JSON.stringify(after)){const h=draft.history[before.id]??={undo:[],redo:[]};h.undo.push(structuredClone(before));h.undo=h.undo.slice(-20);h.redo=[];while(h.undo.length>1&&JSON.stringify(h).length>8*1024*1024)h.undo.shift();}}}if(JSON.stringify(draft)===JSON.stringify(this.data))return structuredClone(result);const dest=join(this.dir,'projects.json'),tmp=dest+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(draft),{mode:0o600});try{await copyFile(dest,dest+'.bak')}catch(e){if(e.code!=='ENOENT')throw e}await rename(tmp,dest);this.data=draft;return structuredClone(result)});this.tail=p.catch(()=>{});return p}
}
export const uid=()=>randomUUID();
export function projectOf(s,id,rev){const p=s.projects.find(x=>x.id===id);if(!p)throw new FilmError('项目不存在',404);if(rev!==undefined&&p.revision!==rev)throw new FilmError('项目已在另一窗口修改，请刷新后重试',409);return p}
export function shotOf(p,id){const x=p.shots.find(x=>x.id===id);if(!x)throw new FilmError('片段不存在',404);return x}
export function text(v,max=32000){if(typeof v!=='string'||v.length>max)throw new FilmError('文字长度或格式无效');return v}
export function seconds(v){if(!Number.isFinite(v)||v<0.1||v>300)throw new FilmError('片段时长须为 0.1–300 秒');return v}
export function references(v){if(!Array.isArray(v)||v.length>50)throw new FilmError('最多50个参考素材');const seen=new Set();return v.map(r=>{if(!r||typeof r.id!=='string'||seen.has(r.id)||!['person','scene','reference','first','last'].includes(r.role))throw new FilmError('参考图角色或重复引用无效');seen.add(r.id);return {id:r.id,role:r.role}})}
export function effectiveRefs(p,shot){const map=new Map((p.sharedRefs||[]).map(x=>[x.id,x]));for(const r of shot.refs)map.set(r.id,r);return [...map.values()]}
export const active=t=>['queued','waiting','dispatching','submitting','polling','uncertain','timed_out'].includes(t.status);
export function validateShot(p,shot,catalog,assets){
 const model=catalog.find(m=>m.id===shot.model);if(!model)throw new FilmError('模型未启用，请在视频模型设置中配置');
 const mode=modeOf(shot),refs=effectiveRefs(p,shot),rows=refs.map(r=>assets.find(a=>a.id===r.id)),problem=modeProblem(mode,model,rows,shot);if(problem)throw new FilmError(problem);
 const automatic=durationIsAutomatic(model,mode,rows)||shot.generationDuration===-1;
 if(!automatic&&!shot.selected&&shot.duration>shot.generationDuration)throw new FilmError('生成时长短于槽位使用时长，请先调整');
 const cap=modeCapability(model,mode),ordered=refsForMode(refs,mode),request={draft:shot.draft===true,model:shot.model,prompt:compileShotMentions(shot.prompt||'',refs,assets),duration:durationIsAutomatic(model,mode,rows)?undefined:shot.generationDuration,aspectRatio:cap?.ratioPolicy==='omit'?null:cap?.ratioPolicy==='input'?'adaptive':shot.aspectRatio,resolution:shot.draft?'480p':shot.resolution||model.defaults?.resolution||'',generationMode:mode,referenceMode:['text','first','frames'].includes(mode)?'frames':'reference',referenceIds:ordered.map(r=>r.id),referenceRoles:ordered,n:1,extra:shot.extra||{}};
 try{validateParameters(request,rows.length);validateReferences(request,rows);}catch(e){throw new FilmError(e.message);}
 if(!request.prompt.trim()&&!(model.promptOptionalWithMedia&&(rows.length||request.extra.metadata?.media?.length)))throw new FilmError('请填写提示词');return request;
}
const generationSeconds=v=>v===-1?-1:seconds(v);

function newShot(body){const defaults=videoDefaults(modelSpec(body.model));return {id:uid(),name:text(body.name||'新片段',100),...defaults,duration:seconds(body.duration),generationDuration:generationSeconds(body.generationDuration),model:text(body.model,100),prompt:'',refs:[],selected:null,candidates:[],dependency:null,muted:false,trimIn:0};}
export async function mutate(store,body,capabilities={}){if(['undo','redo'].includes(body.op))return store.history(body.projectId,body.revision,body.op);return store.tx(s=>{
 if(['createProject','createProjectWithShot'].includes(body.op)){const first=body.op==='createProjectWithShot'?newShot(body):null;const p={id:uid(),name:text((first?body.projectName:body.name)||'未命名影片',120),revision:0,shots:first?[first]:[],sharedRefs:[],createdAt:Date.now()};s.projects.push(p);return p}
 const p=projectOf(s,body.projectId,body.revision);
 if(body.op==='renameProject')p.name=text(body.name,120);
 else if(body.op==='duplicateShot'){
  if(p.shots.length>=200)throw new FilmError('每个项目最多200个片段');
  const source=shotOf(p,body.shotId),copy={...structuredClone(source),id:uid(),name:(source.name+' 副本').slice(0,100),selected:null,candidates:[],trimIn:0};
  p.shots.splice(p.shots.indexOf(source)+1,0,copy);
 }
 else if(body.op==='restoreShot'){
  const entry=p.deletedShots?.at(-1);if(!entry)throw new FilmError('没有可撤销的删除');if(p.shots.length>=200)throw new FilmError('每个项目最多200个片段');
  const i=Math.min(entry.index,p.shots.length);if(entry.shot.dependency&&!p.shots.slice(0,i).some(x=>x.id===entry.shot.dependency))throw new FilmError('原前置片段已移除或顺序变化，请先恢复前置片段');
  p.shots.splice(i,0,entry.shot);p.deletedShots.pop();
 }
 else if(body.op==='batchSettings'){
  if(!Array.isArray(body.shotIds)||!body.shotIds.length||body.shotIds.length>30||new Set(body.shotIds).size!==body.shotIds.length)throw new FilmError('每批选择1–30个片段');
  const v=body.patch||{},allowed=['model','generationDuration','aspectRatio','resolution'];if(!Object.keys(v).length||Object.keys(v).some(k=>!allowed.includes(k)))throw new FilmError('批量参数无效');
  for(const id of body.shotIds){const shot=shotOf(p,id);for(const key of Object.keys(v))shot[key]=key==='generationDuration'?generationSeconds(v[key]):text(v[key],120);
   try{validateShot(p,{...shot,prompt:shot.prompt||'草稿'},capabilities.models||[],capabilities.assets||[])}catch(e){throw new FilmError(shot.name+'：'+e.message)}
  }
 }
 else if(body.op==='batchRefs'){if(!Array.isArray(body.shotIds)||!body.shotIds.length||new Set(body.shotIds).size!==body.shotIds.length)throw new FilmError('请选择片段');const refs=references(body.refs);for(const id of body.shotIds){const shot=shotOf(p,id),priorMode=modeOf(shot);shot.refs=references([...new Map([...shot.refs,...refs].map(r=>[r.id,r])).values()]);if(capabilities.models){const model=capabilities.models.find(m=>m.id===shot.model);if(!model)throw new FilmError('模型未启用');const mode=priorMode==='text'?(modesFor(model).includes('reference')?'reference':shot.refs.length>1?'frames':'first'):priorMode;shot.generationMode=mode;shot.refs=refsForMode(shot.refs,mode);const problem=modeProblem(mode,model,effectiveRefs(p,shot).map(r=>capabilities.assets.find(a=>a.id===r.id)),shot);if(problem)throw new FilmError(shot.name+'：'+problem);}}}
 else if(body.op==='sharedRefs'){const before=p.shots.map(shot=>shotRefs(p,shot));p.sharedRefs=references(body.refs);p.shots.forEach((shot,i)=>{shot.prompt=remapShotMentions(shot.prompt||'',before[i],shotRefs(p,shot),capabilities.assets||[])});}
 else if(body.op==='addShot'){if(p.shots.length>=200)throw new FilmError('每个项目最多200个片段');p.shots.push(newShot(body))}
 else if(body.op==='editShot'){
  const x=shotOf(p,body.shotId),v=body.patch||{};
  for(const k of ['name','prompt','model','aspectRatio','resolution'])if(k in v)x[k]=text(v[k],k==='prompt'?32000:120);
  for(const k of ['duration','generationDuration'])if(k in v)x[k]=k==='generationDuration'?generationSeconds(v[k]):seconds(v[k]);
  if('extra'in v){if(!v.extra||typeof v.extra!=='object'||Array.isArray(v.extra)||JSON.stringify(v.extra).length>12000)throw new FilmError('高级视频参数无效');x.extra=structuredClone(v.extra);}
  if('trimIn'in v){if(!Number.isFinite(v.trimIn)||v.trimIn<0||v.trimIn>300)throw new FilmError('裁剪起点无效');x.trimIn=v.trimIn}
  if('generationMode'in v){if(!Object.hasOwn(modeNames,v.generationMode))throw new FilmError('生成模式无效');x.generationMode=v.generationMode}
  if('draft'in v){if(typeof v.draft!=='boolean')throw new FilmError('样片参数无效');x.draft=v.draft}if('muted'in v)x.muted=v.muted===true;
  if('refs'in v){const before=shotRefs(p,x);x.refs=references(v.refs);if(!('prompt'in v))x.prompt=remapShotMentions(x.prompt||'',before,shotRefs(p,x),capabilities.assets||[]);}
  if('dependency'in v){const ix=p.shots.indexOf(x);if(v.dependency&&!p.shots.slice(0,ix).some(q=>q.id===v.dependency))throw new FilmError('只能等待前面的片段');x.dependency=v.dependency||null}
  const selected=x.candidates.find(c=>c.id===x.selected);if(selected&&x.trimIn+x.duration>selected.duration+0.05)throw new FilmError('选片长度不足，请缩短槽位或调整裁剪起点');
 }
 else if(body.op==='reorder'){if(!Array.isArray(body.ids)||new Set(body.ids).size!==p.shots.length||body.ids.length!==p.shots.length||body.ids.some(id=>!p.shots.some(x=>x.id===id)))throw new FilmError('排序数据无效');p.shots=body.ids.map(id=>shotOf(p,id));for(let i=0;i<p.shots.length;i++)if(p.shots[i].dependency&&!p.shots.slice(0,i).some(x=>x.id===p.shots[i].dependency))throw new FilmError('排序会破坏前置依赖，请先取消依赖')}
 else if(body.op==='adopt'){const x=shotOf(p,body.shotId),c=x.candidates.find(c=>c.id===body.candidateId);if(!c)throw new FilmError('候选不存在');const trim=body.fullLength?0:body.trimIn??0;if(body.fullLength)x.duration=c.duration;if(!Number.isFinite(trim)||trim<0||trim+x.duration>c.duration+0.05)throw new FilmError('候选长度不足以填满槽位，请先调整使用时长');x.selected=c.id;x.trimIn=trim}
 else if(body.op==='deleteShot'){if(s.tasks.some(t=>t.projectId===p.id&&t.shotId===body.shotId&&active(t)))throw new FilmError('有未结束任务，不能删除片段');if(p.shots.some(x=>x.dependency===body.shotId))throw new FilmError('有其他片段依赖此片段');const shot=shotOf(p,body.shotId);p.deletedShots??=[];p.deletedShots.push({shot:structuredClone(shot),index:p.shots.indexOf(shot),deletedAt:Date.now()});p.deletedShots=p.deletedShots.slice(-20);p.shots=p.shots.filter(x=>x.id!==body.shotId)}
 else throw new FilmError('未知操作');
 p.revision++;return p;
},{history:true})}
