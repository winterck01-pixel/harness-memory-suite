// 应用外壳：DSH 导航 + 窄文档标签 + 左工具栏 + 画布舞台 + 图层面板 + 右侧生成面板 + 缩放控制
import React, { useEffect, useState, useCallback } from 'react';
import { useGenerationReferences } from './hooks/useGenerationReferences.js';
import { useStore, useEditorState } from './state/storeContext.jsx';
import { ProjectHome } from './components/ProjectHome.jsx';
import { CanvasTabs } from './components/CanvasTabs.jsx';
import { Toolbar } from './components/Toolbar.jsx';
import { CanvasStage } from './components/CanvasStage.jsx';
import { LayerPanel, LayerContextMenu } from './components/LayerPanel.jsx';
import { RightPanel } from './components/RightPanel.jsx';
import { GenerationPanel } from './components/GenerationPanel.jsx';
import { ZoomControls } from './components/ZoomControls.jsx';
import { UndoIcon, RedoIcon, ExportIcon } from './components/icons.jsx';

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function App({ GenerationPanelComponent = GenerationPanel }) {
  const store = useStore();
  const state = useEditorState();
  const [targetRectMode, setTargetRectMode] = useState(false);
  const [menu, setMenu] = useState(null);
  const referenceDraft = useGenerationReferences(state.layers,state.canvas?.id);
  const references = {...referenceDraft,start:()=>{setTargetRectMode(false);setMenu(null);window.dispatchEvent(new CustomEvent('iw-tool-change',{detail:'select'}));referenceDraft.start();}};
  const changeTargetMode=useCallback(active=>{if(active)referenceDraft.cancel();setTargetRectMode(active);},[referenceDraft.cancel]);

  // 全局快捷键（不抢输入框）
  useEffect(() => {
    const onKey = (e) => {
      if(e.defaultPrevented)return;
      if(referenceDraft.active){
        if(e.key==='Escape'){e.preventDefault();referenceDraft.cancel();return;}
        if(e.key==='Enter'&&!isTypingTarget(e.target)){e.preventDefault();referenceDraft.confirm();return;}
        if(!isTypingTarget(e.target)&&(e.key==='Delete'||e.key==='Backspace'||((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())))){e.preventDefault();return;}
      }
      if (isTypingTarget(e.target)) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); store.save(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!state.selection.length) return;
        e.preventDefault();
        for (const layer of store.selectedLayers()) {
          if (layer.locked) continue; // 锁定层禁止删除
          store.execute({ type: 'removeLayer', canvasId: state.canvas.id, baseRevision: 0, payload: { layerId: layer.id } });
        }
        return;
      }
      if (['v','h'].includes(e.key.toLowerCase()))referenceDraft.cancel();
      if (e.key.toLowerCase() === 'v') window.dispatchEvent(new CustomEvent('iw-tool-change', { detail: 'select' }));
      if (e.key.toLowerCase() === 'h') window.dispatchEvent(new CustomEvent('iw-tool-change', { detail: 'hand' }));
      if (e.key.toLowerCase() === 'f') store.fitToWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, state.selection, state.canvas, referenceDraft]);

  const inEditor = Boolean(state.canvas);

  return (
    <div className="iw-app" data-testid="app">
      <header className="iw-topbar">
        <div className="iw-brand">
          <strong>图片工坊</strong>
          <small>固定画布编辑器</small>
        </div>
        {state.project && <span className="iw-project-name" data-testid="active-project">{state.project.name}</span>}
        <div className="iw-topbar-actions">
          {inEditor && (
            <>
              <button type="button" aria-label="撤销" title="撤销 (Ctrl+Z)" disabled={!state.canUndo}
                data-testid="undo" onClick={() => store.undo()}>
                <UndoIcon size={17} />
              </button>
              <button type="button" aria-label="重做" title="重做 (Ctrl+Shift+Z)" disabled={!state.canRedo}
                data-testid="redo" onClick={() => store.redo()}>
                <RedoIcon size={17} />
              </button>
              <button type="button" data-testid="export-composite" onClick={() => store.exportComposite()} title="导出当前可见图层的合成图">
                <ExportIcon size={15} /> 导出可见合成
              </button>
              <button type="button" onClick={() => store.closeProject()} title="返回项目列表"
                data-testid="back-to-projects">项目</button>
            </>
          )}
        </div>
      </header>

      {inEditor && <CanvasTabs />}

      <div className="iw-body">
        {inEditor ? (
          <>
            <Toolbar referencePick={references} />
            <CanvasStage referencePick={references} targetRectMode={targetRectMode} onTargetRectDone={() => setTargetRectMode(false)} />
            <div className="iw-center-bottom">
              <ZoomControls />
            </div>
            <RightPanel>
            <LayerPanel referencePick={references} onContextMenu={(e, layer) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, layer }); }} />

              <GenerationPanelComponent store={store} state={state} targetRectMode={targetRectMode} setTargetRectMode={changeTargetMode} referenceDraft={references} />
            </RightPanel>
          </>
        ) : (
          <ProjectHome />
        )}
      </div>

      {menu && (
        <LayerContextMenu x={menu.x} y={menu.y} layer={menu.layer} onClose={() => setMenu(null)} />
      )}

      {state.notice && (
        <p role="status" className={`iw-notice is-${state.noticeKind}`} data-testid="notice">{state.notice}</p>
      )}
    </div>
  );
}
