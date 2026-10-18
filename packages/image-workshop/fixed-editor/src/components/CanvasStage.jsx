import {CanvasGeneration} from './CanvasGeneration.jsx';
// 有限白底画布舞台：空间选择/多选/拖动/缩放（边界内）、框选、落点框选、视口缩放/平移。
// 像素坐标系：画布元素按 zoom 缩放显示，图层矩阵始终为画布坐标（缩放只改变视图）。
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, useEditorState } from '../state/storeContext.jsx';
import { buildRenderPlan } from '../lib/renderPlan.js';
import { hitTest, screenToCanvas } from '../lib/hitTest.js';
import { transformBounds, multiply } from '../lib/matrix.js';

import { constrainedTargetRect } from '../lib/targetRatio.js';

import { SCALE_HANDLES, layerBounds, scaleSelection } from '../lib/freeTransform.js';
const HANDLE_LABELS = {nw:'左上角',n:'上边',ne:'右上角',e:'右边',se:'右下角',s:'下边',sw:'左下角',w:'左边'};

function normalizeRect(a, b) {
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    width: Math.abs(a[0] - b[0]),
    height: Math.abs(a[1] - b[1]),
  };
}

function clampDelta(delta, bounds, canvas) {
  // 平移后图层包围盒必须留在画布内；图层大于画布时保持中心在画布内
  let lo_x = -bounds.x;
  let hi_x = canvas.width - (bounds.x + bounds.width);
  let lo_y = -bounds.y;
  let hi_y = canvas.height - (bounds.y + bounds.height);
  const mid = (lo, hi) => (lo + hi) / 2;
  let dx = Math.min(Math.max(delta[0], lo_x), hi_x);
  let dy = Math.min(Math.max(delta[1], lo_y), hi_y);
  if (lo_x > hi_x) dx = mid(lo_x, hi_x);
  if (lo_y > hi_y) dy = mid(lo_y, hi_y);
  return [dx, dy];
}

export function CanvasStage({ targetRectMode, onTargetRectDone, referencePick }) {
  const store = useStore();
  const state = useEditorState();
  const containerRef = useRef(null);
  const [tool, setTool] = useState('select');
  const [drag, setDragState] = useState(null);
  const [keepAspect, setKeepAspect] = useState(true);
  const [hoverId, setHoverId] = useState(null);
  const dragRef = useRef(null);
  const setDrag = (next) => { dragRef.current = next; setDragState(next); };
  useEffect(() => {
    const cancel = (e) => {
      if (e.key === 'Escape' && dragRef.current) { setDrag(null); e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  useEffect(() => { setDrag(null); }, [state.canvas?.id, referencePick?.active, targetRectMode]);

  useEffect(() => {
    const onTool = (e) => setTool(e.detail);
    window.addEventListener('iw-tool-change', onTool);
    return () => window.removeEventListener('iw-tool-change', onTool);
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      store.setStageSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    store.setStageSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [store]);

  const canvas = state.canvas;
  const { zoom, panX, panY } = state.viewport;

  const toCanvasPoint = useCallback((clientX, clientY) => {
    const el = containerRef.current;
    if (!el) return [0, 0];
    const rect = el.getBoundingClientRect();
    return screenToCanvas([clientX - rect.left, clientY - rect.top], state.viewport);
  }, [state.viewport]);

  const plan = canvas ? buildRenderPlan(canvas, state.layers, state.assets) : null;
  const selectedLayers = state.layers.filter(l => state.selection.includes(l.id));
  const editableLayers = selectedLayers.filter(l => l.visible && !l.locked);
  const editableBounds = layerBounds(editableLayers, state.assets);
  const previewTransform = drag?.mode === 'scale' ? scaleSelection(drag.bbox, drag.handle, drag.start, drag.current, canvas, drag.keepAspect !== drag.shiftKey)
    : drag?.mode === 'move' && drag.current && drag.bbox ? (() => {
      const [dx, dy] = clampDelta([drag.current[0] - drag.start[0], drag.current[1] - drag.start[1]], drag.bbox, canvas);
      return {matrix:[1,0,0,1,dx,dy]};
    })() : null;
  const displayMatrix = layer => previewTransform && drag.origins.has(layer.layerId || layer.id) && !layer.locked && layer.visible
    ? multiply(previewTransform.matrix, drag.origins.get(layer.layerId || layer.id)) : layer.matrix;
  const displayLayers = state.layers.map(l => ({...l, matrix:displayMatrix(l)}));
  const visible = plan ? plan.items.filter(i => i.visible).map(i => ({...i, matrix:displayMatrix(i)})) : [];

  function onPointerDown(e) {
    if (!canvas || e.button !== 0) return;
    const point = toCanvasPoint(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if(referencePick?.active){
      const hit=hitTest(point,canvas,state.layers,state.assets,{skipLocked:false});
      if(hit)referencePick.toggle(hit.layerId);
      return;
    }
    if (targetRectMode) {
      if (!state.targetAspectRatio || point[0] < 0 || point[1] < 0 || point[0] > canvas.width || point[1] > canvas.height) return;
      setDrag({ mode: 'targetRect', ratio: state.targetAspectRatio, start: point, current: point });
      return;
    }
    if (tool === 'hand') {
      setDrag({ mode: 'pan', startClient: [e.clientX, e.clientY], startPan: [panX, panY] });
      return;
    }
    const hit = hitTest(point, canvas, state.layers, state.assets);
    if (hit) {
      if (e.shiftKey) store.toggleSelect(hit.layerId);
      else if (!state.selection.includes(hit.layerId)) store.select(hit.layerId);
      const selected = e.shiftKey ? [...store.selection] : (state.selection.includes(hit.layerId) ? state.selection : [hit.layerId]);
      const origins = new Map();
      for (const id of selected) {
        const layer = state.layers.find((l) => l.id === id);
        if (layer && layer.visible && !layer.locked) origins.set(id, layer.matrix);
      }
      const movable = store.selectedLayers().filter(l => l.visible && !l.locked);
      if (origins.size) setDrag({ mode: 'move', start: point, current: point, origins, bbox:layerBounds(movable,state.assets) });
    } else {
      setDrag({ mode: 'marquee', start: point, current: point, additive: e.shiftKey });
    }
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (referencePick?.active || !d || !canvas) return;
    if (d.mode === 'pan') {
      const dx = e.clientX - d.startClient[0];
      const dy = e.clientY - d.startClient[1];
      store.setViewportPan(d.startPan[0] + dx, d.startPan[1] + dy);
      return;
    }
    const point = toCanvasPoint(e.clientX, e.clientY);
    if (d.mode === 'move' || d.mode === 'scale') {
      setDrag({ ...d, current: point, shiftKey:e.shiftKey });
    } else {
      setDrag({ ...d, current: point, shiftKey:e.shiftKey });
    }
  }

  function onPointerUp(e) {
    const d = dragRef.current;
    setDrag(null);
    if (referencePick?.active || !d || !canvas) return;
    const end = toCanvasPoint(e.clientX, e.clientY);

    if (d.mode === 'targetRect') {
      const rect = constrainedTargetRect(d.start, end, canvas, state.targetAspectRatio);
      if (targetRectMode && rect && rect.width >= 4 && rect.height >= 4) {
        store.setTargetRect(rect);
        onTargetRectDone?.();
      }
      return;
    }
    if (d.mode === 'marquee') {
      const rect = normalizeRect(d.start, end);
      if (rect.width < 2 && rect.height < 2) {
        if (!d.additive) store.clearSelection();
        return;
      }
      const hits = state.layers.filter((layer) => {
        const asset = state.assets.find((a) => a.id === layer.assetId);
        if (!asset || !layer.visible) return false;
        const b = transformBounds(layer.matrix, asset.width, asset.height);
        return b.x < rect.x + rect.width && b.x + b.width > rect.x &&
               b.y < rect.y + rect.height && b.y + b.height > rect.y;
      }).map((l) => l.id);
      store.selectMany(hits);
      return;
    }
    if (d.mode === 'move' || d.mode === 'scale') {
      let matrix;
      if (d.mode === 'move') {
        const [dx, dy] = clampDelta([end[0] - d.start[0], end[1] - d.start[1]], d.bbox, canvas);
        matrix = [1,0,0,1,dx,dy];
      } else {
        matrix = scaleSelection(d.bbox, d.handle, d.start, end, canvas, d.keepAspect !== e.shiftKey)?.matrix;
      }
      if (!matrix) return;
      const commands = [];
      for (const [layerId, origin] of d.origins) {
        const current = store.selectedLayers().find(l => l.id === layerId);
        if (!current || current.locked || !current.visible) continue;
        const next = multiply(matrix, origin);
        if (next.every((v, i) => Math.abs(v - origin[i]) < 1e-8)) continue;
        commands.push({type:'transformLayer',canvasId:canvas.id,baseRevision:0,payload:{layerId,matrix:next}});
      }
      if (commands.length) store.executeGroup(commands); // One completed gesture = one undo step.
    }
  }

  function onWheel(e) {
    if (!canvas || dragRef.current) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const el = containerRef.current;
      const rect = el.getBoundingClientRect();
      store.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, [e.clientX - rect.left, e.clientY - rect.top]);
    } else {
      store.setViewportPan(panX - e.deltaX, panY - e.deltaY);
    }
  }

  function startScale(e, handle) {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0 || referencePick?.active || targetRectMode || !editableBounds) return;
    containerRef.current?.setPointerCapture?.(e.pointerId);
    const origins = new Map(editableLayers.map(l => [l.id, [...l.matrix]]));
    const point = toCanvasPoint(e.clientX, e.clientY);
    setDrag({mode:'scale',handle,bbox:editableBounds,origins,start:point,current:point,keepAspect,shiftKey:e.shiftKey});
  }

  if (!canvas || !plan) return <div className="iw-stage" ref={containerRef} />;

  const selBbox = layerBounds(displayLayers.filter(l => state.selection.includes(l.id) && l.visible && !l.locked),state.assets);
  const dragRect = drag && (drag.mode === 'marquee' || drag.mode === 'targetRect')
    ? (drag.mode === 'targetRect' ? constrainedTargetRect(drag.start, drag.current, canvas, state.targetAspectRatio) : normalizeRect(drag.start, drag.current)) : null;

  return (
    <div className="iw-stage" ref={containerRef} data-testid="canvas-stage"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}
      onWheel={onWheel} style={{ cursor: referencePick?.active ? 'copy' : targetRectMode ? 'crosshair' : tool === 'hand' ? 'grab' : 'default' }}>
      <div className="iw-canvas" data-testid="canvas-element"
        style={{
          width: canvas.width * zoom, height: canvas.height * zoom,
          left: panX, top: panY, background: canvas.background,
        }}>
        <div className="iw-canvas-inner" style={{ width: canvas.width, height: canvas.height, transform: `scale(${zoom})` }}>
          {visible.map((item) => {
            const selected = state.selection.includes(item.layerId);
            const asset = state.assets.find((a) => a.id === item.assetId);
            const b = transformBounds(item.matrix, item.assetWidth, item.assetHeight);
            return (
              <img key={item.layerId} src={item.previewUrl} alt="" draggable={false}
                data-testid={`layer-img-${item.layerId}`}
                className={`iw-layer-img${selected ? ' is-selected' : ''}${hoverId === item.layerId ? ' is-hover' : ''}`}
                style={{
                  position: 'absolute', left: 0, top: 0,
                  width: item.assetWidth, height: item.assetHeight,
                  transform: `matrix(${item.matrix.join(',')})`,
                  opacity: item.opacity,
                  pointerEvents: 'none',
                }} />
            );
          })}
          <CanvasGeneration store={store} state={state} layers={displayLayers} disabled={targetRectMode||referencePick?.active} />
          {/* 每图层选中轮廓 */}
          {displayLayers.filter((l) => l.visible && !referencePick?.active && state.selection.includes(l.id)).map((layer) => {
            const asset = state.assets.find((a) => a.id === layer.assetId);
            if (!asset) return null;
            const b = transformBounds(layer.matrix, asset.width, asset.height);
            return <div key={layer.id} className="iw-layer-outline" data-testid={`layer-outline-${layer.id}`}
              style={{ left: b.x, top: b.y, width: b.width, height: b.height, borderWidth:1/zoom }} />;
          })}
          {referencePick?.active && displayLayers.filter(l=>l.visible&&referencePick.draftIds.includes(l.id)).map(layer=>{
            const asset=state.assets.find(a=>a.id===layer.assetId);if(!asset)return null;
            const b=transformBounds(layer.matrix,asset.width,asset.height);
            return <div key={'ref-'+layer.id} className="iw-reference-outline" data-testid={`reference-outline-${layer.id}`} style={{left:b.x,top:b.y,width:b.width,height:b.height,borderWidth:2/zoom}}><span style={{fontSize:12/zoom,padding:`${3/zoom}px ${6/zoom}px`}}>参考 {referencePick.draftIds.indexOf(layer.id)+1}</span></div>;
          })}
          {/* 选择包围盒 + 缩放手柄 */}
          {selBbox && !targetRectMode && !referencePick?.active && (
            <div className="iw-selection-bbox" data-testid="selection-bbox"
              style={{ left: selBbox.x, top: selBbox.y, width: selBbox.width, height: selBbox.height, borderWidth:1/zoom, '--iw-handle-size':`${10/zoom}px`, '--iw-handle-border':`${1/zoom}px` }}>
              {SCALE_HANDLES.map((h) => (
                <span key={h} role="button" aria-label={`缩放${HANDLE_LABELS[h]}`} title={`拖动${HANDLE_LABELS[h]}缩放；Shift 切换比例`} className={`iw-handle iw-handle-${h}`} data-testid={`handle-${h}`}
                  onPointerDown={(e) => startScale(e, h)} />
              ))}
            </div>
          )}
          {/* 已固定落点（新图层放置语义） */}
          {state.targetRect && (
            <div className="iw-target-rect" data-testid="target-rect" aria-label={`生成区域 ${state.targetAspectRatio}`} data-ratio={state.targetAspectRatio}
              style={{ left: state.targetRect.x, top: state.targetRect.y, width: state.targetRect.width, height: state.targetRect.height }} />
          )}
          {/* 拖拽中的框选/落点矩形 */}
          {dragRect && (
            <div className={`iw-drag-rect${drag?.mode === 'targetRect' ? ' is-target' : ''}`} data-testid="drag-rect"
              style={{ left: dragRect.x, top: dragRect.y, width: dragRect.width, height: dragRect.height }} />
          )}
        </div>
      </div>
      {selBbox && !targetRectMode && !referencePick?.active && <div className="iw-transform-controls" onPointerDown={e => e.stopPropagation()}>
        <strong>自由缩放</strong>
        <label><input type="checkbox" aria-label="缩放保持比例" checked={keepAspect} onChange={e => setKeepAspect(e.target.checked)} disabled={!!drag} /> 保持比例</label>
        <span>{Math.round(selBbox.width)} × {Math.round(selBbox.height)} px</span>
        <small>拖动手柄 · Shift 切换比例 · Esc 取消</small>
      </div>}
      {referencePick?.active&&<div className="iw-reference-pickbar" role="region" aria-label="画布参考选图" onPointerDown={e=>e.stopPropagation()}>
        <strong>选图作参考 · 已选 {referencePick.draftIds.length} 张</strong><small>点击图片增减选择 · 此模式不会移动图层</small>
        <div><button type="button" onClick={referencePick.cancel}>取消</button><button type="button" className="iw-primary" onClick={referencePick.confirm}>完成选图</button></div>
      </div>}
      <div className="iw-stage-info">
        <strong>{canvas.name}</strong>
        <span>{canvas.width}×{canvas.height}px · revision {canvas.revision}</span>
        <span className={`iw-save-state is-${state.saveState}`}>
          {state.saveState === 'saved' ? '已保存' : state.saveState === 'saving' ? '保存中…' :
           state.saveState === 'conflict' ? '保存冲突' : state.saveState === 'error' ? '保存失败' : state.hasPendingChanges ? '有未保存修改' : '已保存'}
        </span>
        {state.saveState==='conflict'&&<><button onClick={()=>store.downloadConflictDraft()}>下载本地修改</button><button onClick={()=>store.reloadAfterConflict().catch(e=>store.setNotice(e.message,'error'))}>保留备份并载入服务器版本</button></>}
        {state.mock && <span className="iw-mock-tag">MOCK</span>}
      </div>
    </div>
  );
}
