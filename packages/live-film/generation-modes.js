import {VIDEO_MODE_NAMES,modesForSpec,referenceKindsFor,referenceProblem,modeLabelFor} from 'dsh-video-studio/model-capabilities.js';
export const modeNames=VIDEO_MODE_NAMES;
export const modeLabel=(mode,model)=>modeLabelFor(model,mode);
export function modesFor(model){return modesForSpec(model);}
export function modeOf(shot){if(shot?.generationMode)return shot.generationMode;const refs=shot?.refs||[];return refs.some(r=>r.role==='last')?'frames':refs.some(r=>r.role==='first')?'first':refs.length?'reference':'text';}
export function kindsFor(mode,model){return referenceKindsFor(model,mode);}
export function modeProblem(mode,model,refs,request={}){if(!Array.isArray(refs)){if(!modesFor(model).includes(mode))return '当前模型不支持此模式，请重新选择';const cap=model.modeCapabilities[mode];if(refs<(cap.minReferences||0))return '请补全此模式的参考素材';return '';}return referenceProblem(model,mode,refs,request);}
export function refsForMode(refs,mode){return refs.map((r,i)=>({...r,role:mode==='first'?'first':mode==='frames'?(i?'last':'first'):'reference'}));}
