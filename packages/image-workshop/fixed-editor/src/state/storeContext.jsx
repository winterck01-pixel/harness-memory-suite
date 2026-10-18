import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { EditorStore } from './editorStore.js';

const StoreContext = createContext(null);

export function EditorProvider({ store, children }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('EditorProvider 缺失');
  return store;
}

export function useEditorState() {
  const store = useStore();
  return useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store));
}
