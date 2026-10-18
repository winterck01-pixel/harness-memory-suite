// 项目管理首页：项目卡（封面/名称/画布数/最近编辑）+ 创建/打开/重命名
import React, { useState } from 'react';
import { useStore, useEditorState } from '../state/storeContext.jsx';
import { ProjectIcon, PlusIcon } from './icons.jsx';

const RATIO_PRESETS = [
  { label: '16:9 横屏', w: 1280, h: 720 },
  { label: '9:16 竖屏', w: 720, h: 1280 },
  { label: '1:1 方形', w: 1080, h: 1080 },
  { label: '4:3', w: 1024, h: 768 },
  { label: '3:4', w: 768, h: 1024 },
  { label: '3:2', w: 1200, h: 800 },
  { label: '2:3', w: 800, h: 1200 },
  { label: '21:9 宽屏', w: 1680, h: 720 },
];

function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ProjectHome() {
  const store = useStore();
  const state = useEditorState();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('未命名项目');
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState('');

  function applyPreset(preset) {
    setWidth(preset.w);
    setHeight(preset.h);
  }

  async function submitCreate(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('请输入项目名称');
    if (!(width >= 1 && width <= 4096) || !(height >= 1 && height <= 4096)) {
      return setError('宽高必须是 1..4096 像素');
    }
    if (width * height > 8388608) return setError('像素总数超过上限 8388608（8MP）');
    try {
      await store.createProject({ name: name.trim(), width, height });
      setCreating(false);
    } catch (e2) {
      setError(e2?.message || String(e2));
    }
  }

  async function submitRename(projectId) {
    const value = renameValue.trim();
    setRenamingId(null);
    if (!value) return;
    try {
      await store.renameProject(projectId, value);
    } catch (e2) {
      store.setNotice(`重命名失败：${e2?.message || e2}`, 'error');
    }
  }

  return (
    <main className="iw-project-home" data-testid="project-home">
      <header className="iw-home-header">
        <h1><ProjectIcon size={22} /> 图片工坊 · 项目</h1>
        <button type="button" className="iw-primary" data-testid="create-project" onClick={() => setCreating(true)}>
          <PlusIcon size={16} /> 新建项目
        </button>
      </header>

      {creating && (
        <form className="iw-create-form" onSubmit={submitCreate} data-testid="create-project-form">
          <h2>新建项目</h2>
          <label>
            名称
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus aria-label="项目名称" />
          </label>
          <fieldset>
            <legend>比例预设</legend>
            <div className="iw-preset-row">
              {RATIO_PRESETS.map((p) => (
                <button type="button" key={p.label}
                  className={`iw-preset${width === p.w && height === p.h ? ' is-active' : ''}`}
                  onClick={() => applyPreset(p)}>
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="iw-size-row">
            <label>宽（像素）<input type="number" min={1} max={4096} value={width}
              onChange={(e) => setWidth(Number(e.target.value))} aria-label="画布宽" /></label>
            <label>高（像素）<input type="number" min={1} max={4096} value={height}
              onChange={(e) => setHeight(Number(e.target.value))} aria-label="画布高" /></label>
          </div>
          <p className="iw-hint">像素决定输出大小；视图缩放不改变像素。默认白色背景。</p>
          {error && <p role="alert" className="iw-error">{error}</p>}
          <div className="iw-form-actions">
            <button type="submit" className="iw-primary">创建并打开</button>
            <button type="button" onClick={() => setCreating(false)}>取消</button>
          </div>
        </form>
      )}

      <section className="iw-project-grid" data-testid="project-grid">
        {state.projects.map((p) => (
          <article key={p.id} className={`iw-project-card${state.project?.id === p.id ? ' is-active' : ''}`} data-testid="project-card">
            <button type="button" className="iw-project-cover" onClick={() => store.openProject(p.id)} aria-label={`打开项目 ${p.name}`}>
              {p.coverUrl
                ? <img src={p.coverUrl} alt="" />
                : <span className="iw-project-cover-empty"><ProjectIcon size={28} /></span>}
            </button>
            <div className="iw-project-meta">
              {renamingId === p.id ? (
                <input className="iw-rename-input" value={renameValue} autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => submitRename(p.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitRename(p.id); if (e.key === 'Escape') setRenamingId(null); }}
                  aria-label="项目新名称" />
              ) : (
                <strong onDoubleClick={() => { setRenamingId(p.id); setRenameValue(p.name); }} title="双击重命名">{p.name}</strong>
              )}
              <small>{p.canvasCount} 张画布 · 最近编辑 {formatTime(p.updatedAt)}</small>
            </div>
            <div className="iw-project-actions">
              <button type="button" onClick={() => store.openProject(p.id)}>打开</button>
              <button type="button" onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}>重命名</button>
            </div>
          </article>
        ))}
        {!state.projects.length && <p className="iw-empty">还没有项目，点击「新建项目」开始。</p>}
      </section>
      {state.mock && <p className="iw-mock-badge">MOCK 适配器：项目数据为本地模拟，生成结果均为模拟数据</p>}
    </main>
  );
}
