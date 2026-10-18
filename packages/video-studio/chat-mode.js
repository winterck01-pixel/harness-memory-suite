import {videoDefaults,requestMode,modesForSpec} from './model-capabilities.js';
// Old chat preferences stored only referenceMode. Derive, never silently relabel references.
export function chatOptions(spec,prefs={},referenceCount=0){
 const options={...videoDefaults(spec),...prefs,model:spec.id};
 if(!prefs.generationMode){
  const inferred=prefs.referenceMode==='reference'?'reference':requestMode({referenceMode:prefs.referenceMode,referenceIds:Array(referenceCount).fill('reference')});
  const modes=modesForSpec(spec);
  options.generationMode=modes.includes(inferred)?inferred:modes.includes('reference')&&referenceCount>0?'reference':inferred==='text'?modes[0]:inferred;
 }
 return options;
}
export function mentionedReferenceCount(draft){return new Set(String(draft||'').match(/@"[^\"]+"/g)||[]).size;}
