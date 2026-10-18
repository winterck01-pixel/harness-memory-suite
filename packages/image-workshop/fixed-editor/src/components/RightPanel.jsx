// 右侧 Photoshop 式面板：拖动调宽 + 键盘调整 + 宽度持久化
import React, { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'dsh-iw-right-panel-width';
const MIN = 260;
const MAX = 680;
const DEFAULT = 340;
const HEIGHT_KEY = 'dsh-iw-layer-panel-height';
const clampHeight = n => Math.max(28, Math.min(76, n));
function loadHeight(){try{const value=Number(localStorage.getItem(HEIGHT_KEY));if(Number.isFinite(value)&&value>=28&&value<=76)return value;}catch{}return 52;}

function loadWidth() {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw ? Number(raw) : DEFAULT;
    if (Number.isFinite(n) && n >= MIN && n <= MAX) return n;
  } catch { /* ignore */ }
  return DEFAULT;
}

export function RightPanel({ children }) {
  const [width, setWidth] = useState(loadWidth);
  const dragRef = useRef(null);
  const bodyRef = useRef(null), heightDrag = useRef(null);
  const [height,setHeight] = useState(loadHeight);
  const parts = React.Children.toArray(children);
  useEffect(()=>{try{localStorage.setItem(HEIGHT_KEY,String(height));}catch{}},[height]);
  function heightDown(e){e.preventDefault();heightDrag.current={initial:height,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}
  function heightMove(e){const d=heightDrag.current,box=bodyRef.current?.getBoundingClientRect();if(d&&box?.height)setHeight(clampHeight(d.initial+(e.clientY-d.y)/box.height*100));}
  function heightUp(){heightDrag.current=null;}
  function heightKey(e){if(['ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();setHeight(h=>e.key==='Home'?52:clampHeight(h+(e.key==='ArrowDown'?4:-4)));}}

  useEffect(() => {
    try { localStorage.setItem(KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

  const onHandleDown = useCallback((e) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [width]);

  const onHandleMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    // 向左拖 = 变宽
    const next = Math.min(MAX, Math.max(MIN, d.startWidth + (d.startX - e.clientX)));
    setWidth(next);
  }, []);

  const onHandleUp = useCallback(() => { dragRef.current = null; }, []);

  const onHandleKey = useCallback((e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth((w) => Math.min(MAX, w + 16)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setWidth((w) => Math.max(MIN, w - 16)); }
    if (e.key === 'Home') { e.preventDefault(); setWidth(DEFAULT); }
  }, []);

  return (
    <aside className="iw-right-panel" style={{ width }} data-testid="right-panel" aria-label="生成面板">
      <div className="iw-right-resize" role="separator" aria-orientation="vertical" tabIndex={0}
        aria-label="调整面板宽度（左右方向键）" title="拖动调整宽度；聚焦后可用左右方向键"
        data-testid="right-panel-resize"
        onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
        onKeyDown={onHandleKey} />
      <div ref={bodyRef} className="iw-right-body" style={{'--iw-layers-height':height+'%'}}>
        {parts[0]}
        <div className="iw-layer-resize" role="separator" tabIndex={0} aria-orientation="horizontal" aria-label="调整图层区高度（上下方向键）" aria-valuemin={28} aria-valuemax={76} aria-valuenow={Math.round(height)} title="拖动调整图层区高度；上下方向键调整，Home 恢复默认"
          onPointerDown={heightDown} onPointerMove={heightMove} onPointerUp={heightUp} onPointerCancel={heightUp} onLostPointerCapture={heightUp} onKeyDown={heightKey}><span /></div>
        {parts.slice(1)}
      </div>
    </aside>
  );
}
