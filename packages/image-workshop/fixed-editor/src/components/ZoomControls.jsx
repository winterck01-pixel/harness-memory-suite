// 左下缩放控制：比例显示 + 滑块 + 适应窗口 + 100%（缩放只改变视图，不改变像素）
import React from 'react';
import { useStore, useEditorState } from '../state/storeContext.jsx';
import { FitIcon } from './icons.jsx';

export function ZoomControls() {
  const store = useStore();
  const state = useEditorState();
  if (!state.canvas) return null;
  const percent = Math.round(state.viewport.zoom * 100);
  // 滑块用对数刻度（2%..1600%）
  const toSlider = (z) => Math.log2(z / 0.02);
  const fromSlider = (v) => 0.02 * 2 ** Number(v);

  return (
    <div className="iw-zoom" data-testid="zoom-controls">
      <button type="button" aria-label="缩小" onClick={() => store.zoomBy(1 / 1.2)}>−</button>
      <input type="range" min={0} max={toSlider(16)} step={0.02} value={toSlider(state.viewport.zoom)}
        aria-label="缩放滑块" onChange={(e) => store.setZoom(fromSlider(e.target.value))} />
      <button type="button" aria-label="放大" onClick={() => store.zoomBy(1.2)}>＋</button>
      <span className="iw-zoom-value" data-testid="zoom-value">{percent}%</span>
      <button type="button" className="iw-zoom-fit" onClick={() => store.fitToWindow()} aria-label="适应窗口">
        <FitIcon size={15} /> 适应窗口
      </button>
      <button type="button" onClick={() => store.setZoom(1)} aria-label="实际像素 100%">100%</button>
    </div>
  );
}
