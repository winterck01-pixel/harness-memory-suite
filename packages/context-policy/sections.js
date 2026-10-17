


const SECTION_TOOLS = {
 'tool:goal':['create_goal','get_goal','update_goal'],
 'tool:jobs':['job_output','job_list','job_kill'],
 'team:policy':['spawn_teammate','send_message','team_task_create','team_task_get','team_task_list','team_task_update'],
 'codex-mac-delegation':['subagent_codex'],
};
const AUDITED_TOOL_SECTIONS = new Set(['read','write','edit','glob','grep','bash','pwsh','web_search','web_fetch','ralph','workflow']);
export function selectSections(s,sections,originalTools,selectedTools){
 if(!Array.isArray(sections))return sections;
 const original=new Set(originalTools.map(t=>t.name));
 const selected=new Set(selectedTools.map(t=>t.name));
 return sections.filter(section=>{
  if(s.blocked&&['tools:sdk','tools:ptc-only','capability:workflow'].includes(section.name))return false;
  if(section.name?.startsWith('mcp:'))return [...selected].some(n=>n.startsWith('mcp__'+section.name.slice(4)+'__'));
  if(section.name==='mcp-resource-servers')return ['list_mcp_resources','list_mcp_resource_templates','read_mcp_resource'].some(n=>selected.has(n));
  let required=Object.hasOwn(SECTION_TOOLS,section.name)?SECTION_TOOLS[section.name]:null;
  if(!required&&section.name?.startsWith('tool:')){
   const name=section.name.slice(5);
   if(AUDITED_TOOL_SECTIONS.has(name)||original.has(name))required=[name];
  }
  return !required||required.some(name=>selected.has(name));
 });
}
