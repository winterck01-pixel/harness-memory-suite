import {MODEL_CATALOG as VIDEO_CATALOG} from 'dsh-video-studio/model-registry.js';
import {MODEL_CATALOG as IMAGE_CATALOG} from 'dsh-image-studio/model-registry.js';
import {defaultProfile} from 'dsh-image-studio/model-registry.js';
// Display only: selection and submission retain the logical model ID.
export function imageModelName(id,profiles={}){if(id?.startsWith('mcp:cn:'))return IMAGE_CATALOG.find(s=>s.id===id)?.displayName||id;if(profiles[id]?.modelName)return profiles[id].modelName;try{return defaultProfile(id)?.modelName||id}catch{return id}}
// Historical provenance must come from the task, never today's configuration.
export function taskModelName(task){if(task?.costProvider==='kling')return '可灵 MCP · '+(task.providerModel||task.model);const name=task?.providerModel||task?.model||'—';return task?.model==='toapis:viduq4-preview'?'ToAPIs · '+name:task?.model==='viduq4-preview'?'Vidu 官方 · '+name:name}

export function videoModelName(id,profiles={}){if(id?.startsWith('mcp:cn:'))return VIDEO_CATALOG.find(s=>s.id===id)?.displayName||id;const name=profiles[id]?.modelName|| (id==='toapis:viduq4-preview'?'viduq4-preview':id);return id==='viduq4-preview'?'Vidu 官方 · '+name:id==='toapis:viduq4-preview'?'ToAPIs · '+name:name}
