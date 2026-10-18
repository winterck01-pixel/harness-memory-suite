import {useEffect,useMemo,useState,useCallback} from 'react';
import {resolveReferences} from '../components/PromptReferences.jsx';

export function useGenerationReferences(layers,canvasId){
  const [prompt,setPrompt]=useState(''),[mentions,setMentions]=useState([]),[manualIds,setManualIds]=useState([]);
  const [active,setActive]=useState(false),[draftIds,setDraftIds]=useState([]);
  const resolved=useMemo(()=>resolveReferences(prompt,mentions,manualIds,layers),[prompt,mentions,manualIds,layers]);
  useEffect(()=>{setPrompt('');setMentions([]);setManualIds([]);setActive(false);setDraftIds([]);},[canvasId]);
  useEffect(()=>{
    const add=e=>{if(layers.some(l=>l.id===e.detail))setManualIds(ids=>[...new Set([...ids,e.detail])]);};
    window.addEventListener('iw-add-reference',add);return()=>window.removeEventListener('iw-add-reference',add);
  },[layers]);
  function replaceIds(ids){
    const valid=[...new Set(ids)].filter(id=>layers.some(l=>l.id===id));
    const removed=new Set(mentions.filter(m=>!valid.includes(m.layerId)).map(m=>m.token));
    setPrompt(text=>text.replace(/@参考\d+(?!\d)/g,token=>removed.has(token)?'':token));
    setMentions(rows=>rows.filter(m=>!removed.has(m.token)));setManualIds(valid);
  }
  const cancel=useCallback(()=>{setActive(false);setDraftIds([]);},[]);
  const validDraft=draftIds.filter(id=>layers.some(l=>l.id===id));
  return {prompt,setPrompt,mentions,setMentions,manualIds,setManualIds,resolved,replaceIds,
    active,draftIds:validDraft,
    start:()=>{setDraftIds(resolved.ids);setActive(true);},
    cancel,
    confirm:()=>{replaceIds(validDraft);setActive(false);setDraftIds([]);},
    toggle:id=>{if(layers.some(l=>l.id===id))setDraftIds(ids=>ids.includes(id)?ids.filter(i=>i!==id):[...ids,id]);},
  };
}
