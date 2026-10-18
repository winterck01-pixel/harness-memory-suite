import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorStore} from '../fixed-editor/src/state/editorStore.js';

function browserEvents(){
  const listeners=new Map();
  return {
    addEventListener(type,fn){const set=listeners.get(type)||new Set();set.add(fn);listeners.set(type,set);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
    dispatchEvent(event){for(const fn of [...(listeners.get(event.type)||[])])fn(event);return true;},
    listenerCount(type){return listeners.get(type)?.size||0;},
  };
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};

test('same mounted editor reloads model catalog after shared MCP selection changes and ignores stale reads',async()=>{
  const oldWindow=globalThis.window,window=browserEvents();globalThis.window=window;
  const stale=deferred();let reads=0;
  const adapter={
    getModels:async()=>{reads++;if(reads===1)return{models:Array.from({length:17},(_,i)=>({id:`legacy-${i}`}))};if(reads===2)return stale.promise;return{models:Array.from({length:19},(_,i)=>({id:i===18?'mcp:workrally:image:second':'legacy-'+i}))};},
    listProjects:async()=>({projects:[]}),
  };
  const store=new EditorStore(adapter);
  try{
    await store.init();
    assert.equal(store.getSnapshot().models.length,17);
    window.dispatchEvent(new Event('dsh-image-models-changed'));
    await tick();
    assert.equal(reads,2);
    window.dispatchEvent(new Event('dsh-image-models-changed'));
    await tick();
    assert.equal(store.getSnapshot().models.length,19);
    assert.equal(store.getSnapshot().models.at(-1).id,'mcp:workrally:image:second');
    stale.resolve({models:[{id:'stale-result'}]});
    await tick();
    assert.equal(store.getSnapshot().models.length,19);
    assert.equal(store.getSnapshot().models.at(-1).id,'mcp:workrally:image:second');
    assert.equal(window.listenerCount('dsh-image-models-changed'),1);
  }finally{
    store.dispose();
    assert.equal(window.listenerCount('dsh-image-models-changed'),0);
    if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
  }
});
