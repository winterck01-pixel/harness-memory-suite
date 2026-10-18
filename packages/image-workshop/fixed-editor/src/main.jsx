// 生产入口：导出 mount()，由 DSH 插件槽位调用（集成胶水由 lead 编写）。
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { EditorProvider } from './state/storeContext.jsx';
import { EditorStore } from './state/editorStore.js';
import { createMockAdapter } from './adapters/mockAdapter.js';
import { assertAdapter } from './adapters/adapter.js';
import css from './styles.css';

let styleInjected = false;
function injectStyles() {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

export function mount(target, { adapter, GenerationPanelComponent } = {}) {
  injectStyles();
  const resolved = assertAdapter(adapter);
  const store = new EditorStore(resolved);
  store.init();
  const root = createRoot(target);
  root.render(
    <EditorProvider store={store}>
      <App GenerationPanelComponent={GenerationPanelComponent} />
    </EditorProvider>,
  );
  return { store, root, async unmount() { if (await store.save() === false) return false; store.dispose(); root.unmount(); return true; } };
}

// DSH 插件槽位约定（与 image-workshop index.js 一致的最小面）
export const inject = ['uiSession', 'slots'];
export function apply(ctx) {
  injectStyles();
  return ctx.slots.register({ name: 'main', key: 'image-workshop-editor' }, function ImageWorkshopEditor(props) {
    return <EditorBound {...props} />;
  });
}

function EditorBound({ adapter, GenerationPanelComponent }) {
  const [store] = React.useState(() => new EditorStore(assertAdapter(adapter)));
  React.useEffect(() => { store.init(); return () => store.dispose(); }, [store]);
  return (
    <EditorProvider store={store}>
      <App GenerationPanelComponent={GenerationPanelComponent} />
    </EditorProvider>
  );
}

export { App, EditorStore, EditorProvider, createMockAdapter };
