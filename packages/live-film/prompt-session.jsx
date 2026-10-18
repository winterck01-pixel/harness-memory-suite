import {useSyncExternalStore} from 'react';
let current;
const listeners=new Set();
let release;
const notify=()=>{for(const listener of listeners)listener()};
const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};
const snapshot=()=>current?.getSnapshot()?.key||'';
export function bindPromptSession(ctx){
 const attach=service=>{release?.();current=service?.adapter?.current;release=current?.subscribe(notify);notify();return()=>{release?.();release=undefined;current=undefined;notify()}};
 const service=ctx.uiSession;
 if(service){const dispose=attach(service);ctx.effect?.(()=>dispose)}
 else ctx.inject?.(['uiSession'],scope=>scope.effect(()=>attach(scope.uiSession)));
}
export function usePromptSession(){return useSyncExternalStore(subscribe,snapshot,()=> '');}
