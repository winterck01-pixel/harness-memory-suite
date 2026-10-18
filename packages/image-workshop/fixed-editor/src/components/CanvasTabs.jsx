// Photoshop 式窄文档标签（顶部约 30–32px）：切换/关闭/新建
import React, { useState } from 'react';
import { useStore, useEditorState } from '../state/storeContext.jsx';
import { PlusIcon, CloseIcon } from './icons.jsx';

export function CanvasTabs() {
  const store = useStore();
  const state = useEditorState();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('新画布');
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [error, setError] = useState('');
  const project = state.project;
  if (!project) return null;
  const canvases = project.canvasIds.map((id) => store.doc.canvases[id]).filter(Boolean);

  return (
    <>
    <div className="iw-tabs" role="tablist" aria-label="画布标签" data-testid="canvas-tabs">
      {canvases.map((canvas) => {
        const active = canvas.id === state.canvas?.id;
        return (
          <div key={canvas.id} className={`iw-tab${active ? ' is-active' : ''}`} role="tab" aria-selected={active}>
            <button type="button" className="iw-tab-label" onClick={() => store.switchCanvas(canvas.id)}>
              <span className="iw-tab-name" title={canvas.name}>{canvas.name}</span>
              <span className="iw-tab-size">{canvas.width}×{canvas.height}</span>
            </button>
            <button type="button" className="iw-tab-close" aria-label={`关闭画布 ${canvas.name}`}
              onClick={() => store.deleteCanvas(canvas.id)}>
              <CloseIcon size={12} />
            </button>
          </div>
        );
      })}
      <button type="button" className="iw-tab iw-tab-new" data-testid="new-canvas"
        onClick={() => {
          setName(`画布 ${canvases.length + 1}`);
          setWidth(state.canvas?.width || 1280);
          setHeight(state.canvas?.height || 720);
          setError(''); setCreating(true);
        }}>
        <PlusIcon size={14} />
      </button>
    </div>
    {creating && <div className="iw-canvas-dialog" role="dialog" aria-modal="true" aria-label="新建画布">
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 8388608) {
          setError('请输入名称及有效整数像素，单边最大4096，总像素最大8388608'); return;
        }
        try { await store.createCanvas({ name: name.trim(), width, height }); setCreating(false); }
        catch (err) { setError(err.message || String(err)); }
      }}>
        <h3>新建画布</h3>
        <label>名称 <input aria-label="画布名称" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus /></label>
        <label>比例 <select aria-label="画布比例" defaultValue="custom" onChange={(e) => {
          if (e.target.value !== 'custom') { const [w,h] = e.target.value.split('x').map(Number); setWidth(w); setHeight(h); }
        }}><option value="custom">自定义</option><option value="1280x720">16:9</option><option value="720x1280">9:16</option><option value="1080x1080">1:1</option><option value="1024x768">4:3</option></select></label>
        <label>宽 <input aria-label="画布宽度" type="number" min="1" max="4096" value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label>
        <label>高 <input aria-label="画布高度" type="number" min="1" max="4096" value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">创建画布</button><button type="button" onClick={() => setCreating(false)}>取消</button>
      </form>
    </div>}
    </>
  );
}
