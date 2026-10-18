// Whitelisted UI operations only. Each success waits for the committed component state.
export async function confirmUiState(check,alive=()=>true){for(let i=0;i<100;i++){if(!alive())return 'failed';if(check())return 'applied';await new Promise(resolve=>setTimeout(resolve,10));}return 'failed';}
export function createLegacyAgentUi({snapshot,alive,workspace,actions}){
 return async event=>{
  const {command,value}=event,state=snapshot();if(!alive()||!state)return 'failed';
  if(command==='workspace')return workspace(value);
  if(state.active===false)return 'unsupported';
  const hasAsset=id=>state.images.find(a=>a.id===id),hasTask=id=>state.tasks.find(t=>t.id===id&&!t.hiddenAt&&!t.isTrashed);
  if(['compose_task','use_reference'].includes(command)&&(state.dirty||state.busy))return 'blocked_dirty';
  let check;
  if(command==='search'){if(typeof value!=='string')return 'failed';actions.search(value);check=()=>snapshot().search===value;}
  else if(command==='show_panel'){if(!['library','history'].includes(value))return 'unsupported';actions.tab(value);check=()=>snapshot().tab===value;}
  else if(command==='select_asset'){const asset=hasAsset(value);if(!asset)return 'failed';actions.chooseImage(asset);actions.preview(false);check=()=>snapshot().selectedId===value&&!snapshot().selectedTaskId&&!snapshot().modal&&!snapshot().detailTaskId;}
  else if(command==='select_task'){const task=hasTask(value);if(!task)return 'failed';actions.chooseTask(task);actions.openTask(task);check=()=>snapshot().selectedTaskId===value&&snapshot().detailTaskId===value;}
  else if(command==='preview'){if(!['open','close'].includes(value))return 'unsupported';if(value==='open'&&!hasAsset(state.selectedId))return 'failed';actions.preview(value==='open');check=()=>snapshot().modal===(value==='open')&&(value!=='close'||!snapshot().detailTaskId);}
  else if(command==='zoom'||command==='fit'){if(!hasAsset(state.selectedId))return 'failed';if(command==='zoom'&&![1,2].includes(value))return 'unsupported';const zoom=command==='zoom'&&value===2;actions.preview(false);actions.zoom(zoom);check=()=>snapshot().zoom===zoom&&!snapshot().modal&&!snapshot().detailTaskId;}
  else if(command==='compose_task'||command==='use_reference'){
   if(!state.initialized||state.configStale)return 'failed';const task=command==='compose_task'?hasTask(value):hasAsset(value)?{referenceIds:[value]}:null;if(!task)return 'failed';
   actions.compose(task);actions.preview(false);check=()=>{const next=snapshot();return !next.modal&&!next.detailTaskId&&next.formKey===state.formKey+1&&next.formDraft&&next.formDraft.prompt===(task.prompt||'')&&JSON.stringify(next.formDraft.referenceIds||[])===JSON.stringify(task.referenceIds||[])&&(command==='compose_task'?next.seed.id===task.id:next.seed.referenceIds?.length===1&&next.seed.referenceIds[0]===value);};
  }else return 'unsupported';
  return confirmUiState(check,alive);
 };
}
export function createWorkspaceAgentUi({snapshot,dirty,change}){
 return async value=>{if(!['editor','legacy'].includes(value))return 'unsupported';if(dirty())return 'blocked_dirty';change(value);return confirmUiState(()=>{const state=snapshot();return state.mode===value&&state.ready;},()=>snapshot().mounted);};
}
