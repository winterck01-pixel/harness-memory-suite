import {memoryOptOut} from './memory-policy.js';
export const GROUPS=['knowledge','reader','image','video','report','developer','web','agents','memory','workflow','other'];
export const BASE=new Set(['search_capabilities','activate_tool_group','release_capabilities','ask_user_question','skill','exit_plan_mode','mnemo_recall','mnemo_experience','search_experience','read_knowledge_fragment','structured_output']);
const names={knowledge:/^(?:.*_knowledge(?:_.*)?|knowledge_history|index_knowledge|import_knowledge_path|search_experience|read_knowledge_fragment)$/,reader:/^reader_/,image:/^(?:generate_image|image_generation_status|list_image_models|list_generated_images|list_reference_images|import_reference_image|send_generated_media|read_image|media_show)$/,video:/^(?:generate_video|video_generation_status|list_video_models|list_generated_videos|list_video_reference_images|import_video_reference_image|send_generated_video|media_show)$/,report:/^(?:report_studio|present)$/,developer:/^(?:bash|read|write|edit|glob|grep|job_kill|job_list|job_output|todo_write)$/,web:/^(?:web_search|web_fetch)$/,agents:/^(?:.*agent.*|spawn_teammate|team_task_.*|send_message)$/,memory:/^(?:mnemo_|daily_news_(?:remember|memory_status))/,workflow:/^(?:workflow|create_goal|get_goal|update_goal)$/};
export function createState(){return {turn:null,hasUser:false,text:'',blocked:false,memoryBlocked:false,knowledgeBlocked:false,groups:new Set(),enabled:new Set(),allowed:new Set(BASE),catalog:new Map(),skills:new Set(),phase:1,summary:''};}
export function claim(s,{turn,message,sessionId}){
 if(message?.source?.kind!=='user'&&message?.source?.kind!=='schedule')return;
 if(s.turn!==turn)Object.assign(s,createState(),{turn});
 s.hasUser=true;s.text+='\n'+(message.content??[]).filter(x=>x.type==='text').map(x=>x.text??'').join('\n');
 s.blocked ||= /(?:不要|禁止|不允许|不用|不使用|关闭|禁用)(?:调用|使用|加载)?(?:任何|所有|全部)?工具|\b(?:no tools|do not (?:use|call|load) (?:any )?tools)\b/i.test(s.text);
 s.memoryBlocked ||= memoryOptOut(s.text);
 s.knowledgeBlocked ||= /(?:不要|禁止|不允许|不用|不使用|关闭|禁用|不查|不读|不检索)(?:读取|读|使用|查询|查|调用|检索)?(?:任何|所有|全部)?(?:知识库|资料库)|\b(?:do not|don't|never) (?:read|use|search|query) (?:the )?(?:knowledge base|knowledge tools)\b/i.test(s.text);
}
export function groupsFor(name){const a=Object.entries(names).filter(([,r])=>r.test(name)).map(([g])=>g);return a.length?a:['other'];}
export function permitted(s,name){return !s.blocked&&!(s.memoryBlocked&&names.memory.test(name))&&!(s.knowledgeBlocked&&names.knowledge.test(name));}
export function select(s,tools){const chosen=tools.filter(t=>permitted(s,t.name)&&(BASE.has(t.name)||s.enabled.has(t.name)));s.allowed=new Set(chosen.map(t=>t.name));return chosen;}
export function activate(s,group,tools=[],reason=''){
 if(s.blocked)throw Error('CAPABILITY_USER_DISABLED: 用户本轮关闭工具。');
 if(group&&!GROUPS.includes(group))throw Error('CAPABILITY_UNKNOWN_GROUP: 无full兜底，请search_capabilities。');
 if(!group&&!tools.length)throw Error('CAPABILITY_SELECTION_REQUIRED');
 const requested=tools.length?tools:[...s.catalog.keys()].filter(n=>groupsFor(n).includes(group));
 if(!requested.length)throw Error('CAPABILITY_NOT_AVAILABLE: 当前作用域没有匹配工具；扩大搜索或检查连接/安装状态。');
 if(requested.length>(s.maxTools??24)||new Set([...s.enabled,...requested]).size>(s.maxTools??24))throw Error('CAPABILITY_BUDGET: 每阶段最多24个扩展工具；使用具体tools选择或先release_capabilities。');
 if(s.enabled.size&&requested.some(n=>!s.enabled.has(n))&&!reason.trim())throw Error('CAPABILITY_REASON_REQUIRED: 扩展能力须说明下一步缺少什么。');
 for(const n of requested){if(!s.catalog.has(n)||!permitted(s,n))throw Error('CAPABILITY_UNAVAILABLE_OR_DISABLED: '+n);}
 for(const n of requested)s.enabled.add(n);if(group)s.groups.add(group);
 return {enabled:requested,availableOnNextStep:true,phase:s.phase};
}
export function denial(s,name){if(!s)return; if(!permitted(s,name))return 'CAPABILITY_USER_DISABLED: 本轮用户关闭了此能力。';if(name==='run_code')return;if(!BASE.has(name)&&!s.enabled.has(name))return 'CAPABILITY_NOT_LOADED: 先search_capabilities，再activate_tool_group；仅下个执行步骤可用。';}
export function release(s,summary=''){s.enabled.clear();s.groups.clear();s.skills.clear();s.loadedSkills?.clear();s.pendingSkills?.clear();s.phase++;s.summary=summary.slice(0,2000);return {released:true,phase:s.phase,history:'已加载内容仍在真实历史中，由宿主压缩；保留结论、来源、版本与证据。'};}
