// 左工具栏：精简 SVG 轮廓图标 + tooltip + 快捷键（无不可用假按钮）
import React, { useRef, useEffect } from 'react';
import { useStore, useEditorState } from '../state/storeContext.jsx';
import { SelectIcon, HandIcon, UploadIcon, FitIcon, ReferenceIcon } from './icons.jsx';

export function Toolbar({referencePick}) {
  const store = useStore();
  const state = useEditorState();
  const fileRef = useRef(null);
  const [tool, setTool] = React.useState('select');
  useEffect(()=>{const changed=e=>setTool(e.detail);window.addEventListener('iw-tool-change',changed);return()=>window.removeEventListener('iw-tool-change',changed);},[]);
  function chooseTool(id){referencePick?.cancel();window.dispatchEvent(new CustomEvent('iw-tool-change',{detail:id}));}

  if (!state.canvas) return null;

  const tools = [
    { id: 'select', label: '选择/移动 (V)', icon: <SelectIcon /> },
    { id: 'hand', label: '平移视图 (H)', icon: <HandIcon /> },
  ];

  return (
    <div className="iw-toolbar" role="toolbar" aria-label="工具栏" data-testid="toolbar">
      {tools.map((t) => (
        <button key={t.id} type="button" title={t.label} aria-label={t.label}
          className={`iw-tool-btn${tool === t.id && !referencePick?.active ? ' is-active' : ''}`}
          aria-pressed={tool === t.id && !referencePick?.active}
          onClick={() => chooseTool(t.id)}>
          {t.icon}
        </button>
      ))}
      <button type="button" className={`iw-tool-btn${referencePick?.active?' is-active':''}`} aria-label="选图作参考" title="进入参考选图模式：可连续点击多张图片，不移动图层" aria-pressed={!!referencePick?.active} onClick={()=>referencePick?.active?referencePick.cancel():referencePick?.start()}><ReferenceIcon /></button>
      <span className="iw-tool-sep" />
      <button type="button" title="适应窗口 (F)" aria-label="适应窗口" className="iw-tool-btn"
        onClick={() => store.fitToWindow()}>
        <FitIcon />
      </button>
      <button type="button" title="导入图片为新图层" aria-label="导入图片为新图层" className="iw-tool-btn"
        onClick={() => fileRef.current?.click()}>
        <UploadIcon />
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
        aria-label="导入图片文件"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            await store.importImage(file);
          } catch (err) {
            store.setNotice(`导入失败：${err?.message || err}`, 'error');
          }
        }} />
      {/* 当前工具通过自定义事件通知画布 */}

    </div>
  );
}
