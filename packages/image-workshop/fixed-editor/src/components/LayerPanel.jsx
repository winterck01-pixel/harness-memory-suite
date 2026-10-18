// 图层栏：稳定层序（顶到底显示）、选择/多选、重命名、排序、可见/隐藏、锁定/解锁、删除、透明度
import React, { useEffect, useRef, useState } from 'react';
import { useLayerReorder } from '../hooks/useLayerReorder.js';
import { useStore, useEditorState } from '../state/storeContext.jsx';
import { EyeIcon, EyeOffIcon, LockIcon, UnlockIcon, TrashIcon, UpIcon, DownIcon, DownloadIcon, ExportIcon, ReferenceIcon } from './icons.jsx';

export function LayerPanel({ onContextMenu, referencePick }) {
  const store = useStore();
  const state = useEditorState();
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const reorder = useLayerReorder(store,state.canvas?.id);

  if (!state.canvas) return null;
  // layerIds 底到顶；面板顶到底显示 = 逆序
  const ordered = [...state.layers].reverse();

  function commitRename(layerId) {
    setEditingId(null);
    const value = editValue.trim();
    if (!value || value === state.layers.find((l) => l.id === layerId)?.name) return;
    store.execute({
      type: 'renameLayer', canvasId: state.canvas.id, baseRevision: 0,
      payload: { layerId, name: value.slice(0, 120) },
    });
  }

  function move(layerId, dir) {
    const canvas = store.doc.canvases[state.canvas.id];
    const from = canvas.layerIds.indexOf(layerId);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= canvas.layerIds.length) return;
    store.execute({
      type: 'reorderLayer', canvasId: canvas.id, baseRevision: 0,
      payload: { layerId, toIndex: to },
    });
  }

  function remove(layer) {
    store.execute({
      type: 'removeLayer', canvasId: state.canvas.id, baseRevision: 0,
      payload: { layerId: layer.id },
    });
    store.setNotice(`已删除图层「${layer.name}」（仅移除文档引用，原文件保留）`, 'success');
  }

  return (
    <section className="iw-layers" aria-label="图层" data-testid="layer-panel">
      <header className="iw-layers-header">
        <strong title="拖动手柄调整覆盖顺序；上方图层覆盖下方图层。锁定层不能拖动。">图层 <small className="iw-layer-drag-hint">拖动排序</small></strong>
        <span>{referencePick?.active ? `参考已选 ${referencePick.draftIds.length} 张` : `${state.layers.length}/64`}</span>
      </header>
      <ul ref={reorder.listRef} className={`iw-layer-list${reorder.dragging ? ' is-reordering' : ''}`} data-drop-end={reorder.dragging && reorder.dropBefore === null ? 'true' : undefined}>
        {ordered.map((layer) => {
          const asset = state.assets.find((a) => a.id === layer.assetId);
          const selected = referencePick?.active ? referencePick.draftIds.includes(layer.id) : state.selection.includes(layer.id);
          const canvas = store.doc.canvases[state.canvas.id];
          const index = canvas.layerIds.indexOf(layer.id);
          return (
            <li key={layer.id}
              className={`iw-layer-item${selected ? ' is-selected' : ''}${layer.locked ? ' is-locked' : ''}${!layer.visible ? ' is-hidden' : ''}${reorder.dragging === layer.id ? ' is-dragging' : ''}${reorder.dropBefore === layer.id ? ' is-drop-before' : ''}${referencePick?.active && referencePick.draftIds.includes(layer.id)?' is-reference-selected':''}`}
              data-layer-id={layer.id}
              data-testid={`layer-item-${layer.id}`}
              onClick={(e) => {
                if (e.target.closest('button,input,textarea,.iw-layer-rename')) return;
                if(referencePick?.active){referencePick.toggle(layer.id);return;}
                if (e.shiftKey || e.metaKey || e.ctrlKey) store.toggleSelect(layer.id);
                else store.select(layer.id);
              }}
              onContextMenu={(e) => {if(referencePick?.active){e.preventDefault();return;}onContextMenu?.(e,layer);}}
              onDoubleClick={() => { if(referencePick?.active)return;setEditingId(layer.id); setEditValue(layer.name); }}>
              {referencePick?.active&&<input type="checkbox" aria-label={`选为参考 ${layer.name} 图层${index+1}`} checked={referencePick.draftIds.includes(layer.id)} onChange={()=>referencePick.toggle(layer.id)}/>}
              <button type="button" className="iw-layer-eye" aria-label={layer.visible ? `隐藏 ${layer.name}` : `显示 ${layer.name}`}
                title={layer.visible ? '隐藏' : '显示'}
                onClick={() => store.execute({ type: 'setLayerVisibility', canvasId: canvas.id, baseRevision: 0, payload: { layerId: layer.id, visible: !layer.visible } })}>
                {layer.visible ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
              </button>
              <button type="button" className="iw-layer-grip" aria-label={`拖动排序 ${layer.name}`} title="拖动调整层级；Alt+↑/↓ 移动一层" {...reorder.handleProps(layer)} disabled={layer.locked||referencePick?.active}>⠿</button>
              <span className="iw-layer-thumb" aria-hidden="true">
                {asset ? <img src={asset.previewUrl} alt="" /> : <span className="iw-layer-thumb-empty" />}
              </span>
              <div className="iw-layer-body">
                {editingId === layer.id ? (
                  <input className="iw-layer-rename" value={editValue} autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitRename(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(layer.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="图层名称" />
                ) : (
                  <span className="iw-layer-name" title="双击重命名">{layer.name}</span>
                )}
                <div className="iw-layer-opacity">
                  <label>
                    <span className="iw-sr-only">透明度</span>
                    <input type="range" min={0} max={1} step={0.01} value={layer.opacity}
                      aria-label={`${layer.name} 透明度`}
                      onChange={(e) => store.execute({
                        type: 'setLayerOpacity', canvasId: canvas.id, baseRevision: 0,
                        payload: { layerId: layer.id, opacity: Number(e.target.value) },
                      }, { coalesceKey: `opacity:${layer.id}` })} />
                  </label>
                  <span>{Math.round(layer.opacity * 100)}%</span>
                </div>
              </div>
              <div className="iw-layer-actions">
                <button type="button" aria-label={`锁定 ${layer.name}`} title={layer.locked ? '解锁' : '锁定'}
                  onClick={() => store.execute({ type: 'setLayerLocked', canvasId: canvas.id, baseRevision: 0, payload: { layerId: layer.id, locked: !layer.locked } })}>
                  {layer.locked ? <LockIcon size={15} /> : <UnlockIcon size={15} />}
                </button>
                <button type="button" aria-label={`上移 ${layer.name}`} title="上移一层" disabled={referencePick?.active || layer.locked || index >= canvas.layerIds.length - 1}
                  onClick={() => move(layer.id, 1)}>
                  <UpIcon size={15} />
                </button>
                <button type="button" aria-label={`下移 ${layer.name}`} title="下移一层" disabled={referencePick?.active || layer.locked || index <= 0}
                  onClick={() => move(layer.id, -1)}>
                  <DownIcon size={15} />
                </button>
                <button type="button" aria-label={`删除 ${layer.name}`} title="删除图层（保留原文件）" disabled={referencePick?.active || layer.locked}
                  onClick={() => remove(layer)}>
                  <TrashIcon size={15} />
                </button>
              </div>
            </li>
          );
        })}
        {!ordered.length && <li className="iw-layer-empty">画布还没有图层，导入图片或从候选中应用。</li>}
      </ul>
    </section>
  );
}

// 图层右键菜单：导出此图层（内容/画布边界）、作为生成参考、下载原素材
export function LayerContextMenu({ x, y, layer, onClose }) {
  const store = useStore();
  const state = useEditorState();
  const ref = useRef(null);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close, { once: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', close);
    };
  }, [onClose]);

  if (!layer) return null;
  const asset = state.assets.find((a) => a.id === layer.assetId);

  const items = [
    { label: '导出此图层（内容边界）…', icon: <ExportIcon size={15} />, run: () => store.exportLayer(layer.id, 'content') },
    { label: '导出此图层（画布尺寸）…', icon: <ExportIcon size={15} />, run: () => store.exportLayer(layer.id, 'canvas') },
    { label: '作为生成参考', icon: <ReferenceIcon size={15} />, run: () => { window.dispatchEvent(new CustomEvent('iw-add-reference', { detail: layer.id })); store.setNotice(`已把「${layer.name}」加入参考`, 'success'); } },
    ...(asset?.originalUrl ? [{ label: '下载原素材', icon: <DownloadIcon size={15} />, run: () => {
      const a = document.createElement('a');
      a.href = asset.originalUrl;
      const extension = ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif',png:'png',jpeg:'jpg',jpg:'jpg',webp:'webp',gif:'gif'})[asset.format] || 'bin';
      a.download = asset.originalName || `${layer.name}-original.${extension}`;
      a.click();
    } }] : []),
  ];

  return (
    <div className="iw-context-menu" style={{ left: x, top: y }} role="menu" data-testid="layer-context-menu" ref={ref}>
      {items.map((item) => (
        <button key={item.label} type="button" role="menuitem" onClick={() => { item.run(); onClose(); }}>
          {item.icon}<span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
