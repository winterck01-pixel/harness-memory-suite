import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { pruneObject } from './browser-cache-bounds.js'

const APP_ID = 'dsh-launchpad'
const OPEN_KEY = 'dsh-launchpad:opened:v1'
const SELECTED_KEY = 'dsh-launchpad:selected:v1'
const TASK_STATE_KEY = 'dsh-launchpad:task-state:v1'
const TERMINAL_SUCCESS = new Set(['completed', 'succeeded', 'success'])
const ACTIVE = new Set(['queued', 'waiting', 'submitting', 'polling', 'running', 'processing'])

function readJSON(storage, key, fallback) {
  try {
    const value = JSON.parse(storage.getItem(key) || 'null')
    return value ?? fallback
  } catch {
    return fallback
  }
}

function writeJSON(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)) } catch { /* storage can be disabled */ }
}

function createLaunchpad(ctx) {
  const apps = new Map()
  const listeners = new Set()
  const taskSources = new Map()
  const notices = []
  const noticeListeners = new Set()
  let taskSnapshot = { image: [], video: [], sessionNames: {}, updatedAt: 0 }
  const storage = typeof localStorage === 'undefined' ? { getItem: () => null, setItem() {}, removeItem() {} } : localStorage
  const statusLedger = readJSON(storage, TASK_STATE_KEY, {})
  const bootAt = Date.now()
  let opened = new Set(readJSON(storage, OPEN_KEY, []).filter((id) => typeof id === 'string'))
  let selected = storage.getItem(SELECTED_KEY) || ''
  let activePanel = ctx.layout.panelInfo.getSnapshot().activePanelId || ''
  let refreshTimer
  let revision = 0
  let polling = false
  let currentSnapshot = null
  const entryDisposers = new Map()
  const subscriptions = new Set()

  const publish = () => {
    revision++
    currentSnapshot = null
    for (const listener of listeners) listener()
  }
  const snapshot = () => currentSnapshot ??= {
    revision,
    apps: [...apps.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    opened: [...opened],
    selected,
    activePanel,
    tasks: taskSnapshot,
    notices: [...notices],
  }
  const iconFor = (app) => function AppEntryIcon({ size = 18 }) {
    return React.createElement(app.icon, { size })
  }
  const persistOpened = () => writeJSON(localStorage, OPEN_KEY, [...opened])

  function registerApp(descriptor) {
    if (!descriptor || typeof descriptor.id !== 'string' || !descriptor.id || descriptor.id === APP_ID) {
      throw new TypeError('launchpad app requires a stable non-launchpad id')
    }
    if (typeof descriptor.name !== 'string' || !descriptor.name || typeof descriptor.icon !== 'function') {
      throw new TypeError(`launchpad app ${descriptor.id} requires a name and SVG icon component`)
    }
    const app = {
      id: descriptor.id,
      name: descriptor.name,
      description: typeof descriptor.description === 'string' ? descriptor.description : '',
      order: Number.isFinite(descriptor.order) ? descriptor.order : 50,
      icon: descriptor.icon,
      kind: descriptor.kind || 'app',
    }
    apps.set(app.id, app)
    if (opened.has(app.id)) ensureEntry(app)
    publish()
    if (selected === app.id && opened.has(app.id)) selectSafely(app.id)
    return () => {
      if (apps.get(app.id) !== app) return
      apps.delete(app.id)
      entryDisposers.get(app.id)?.()
      entryDisposers.delete(app.id)
      publish()
    }
  }

  function ensureEntry(app) {
    if (entryDisposers.has(app.id)) return
    const unregister = ctx.slots.register(
      { name: 'sidebar.panellist', id: app.id, order: 20 + app.order / 100, label: app.name },
      iconFor(app),
    )
    entryDisposers.set(app.id, unregister)
  }

  function selectSafely(id) {
    try {
      ctx.layout.selectPanel(id)
      selected = id
      activePanel = id
      window.dispatchEvent(new CustomEvent('dsh-app-activated', {detail: {id}}))
      localStorage.setItem(SELECTED_KEY, id)
      publish()
      return true
    } catch (error) {
      console.warn('[dsh-launchpad] app panel is not registered', id, error)
      return false
    }
  }

  function syncSelected(id) {
    activePanel = id || ''
    window.dispatchEvent(new CustomEvent('dsh-app-activated', {detail: {id: activePanel}}))
    if (activePanel !== APP_ID) {
      selected = activePanel
      try {
        if (selected) localStorage.setItem(SELECTED_KEY, selected)
        else localStorage.removeItem(SELECTED_KEY)
      } catch {}
    }
    publish()
  }

  function openApp(id) {
    const app = apps.get(id)
    if (!app) return false
    if (!opened.has(id)) {
      opened.add(id)
      persistOpened()
      ensureEntry(app)
      publish()
    }
    return selectSafely(id)
  }

  function closeApp(id) {
    if (!opened.has(id)) return
    opened.delete(id)
    persistOpened()
    entryDisposers.get(id)?.()
    entryDisposers.delete(id)
    if (activePanel === id) {
      selected = ''
      activePanel = ''
      localStorage.removeItem(SELECTED_KEY)
      try { ctx.layout.selectPanel(null) } catch {}
    }
    publish()
  }

  function registerTaskSource(source) {
    if (!source || !['image', 'video'].includes(source.kind) || typeof source.url !== 'string') {
      throw new TypeError('task source requires image/video kind and same-origin URL')
    }
    const token = Symbol(source.kind)
    taskSources.set(token, source)
    void refreshTasks()
    return () => taskSources.delete(token)
  }

  function notifyTask(task, kind) {
    const id = `${kind}:${task.id}`
    const noticeId = `completion:${id}`
    if (readJSON(localStorage, `${TASK_STATE_KEY}:notified`, []).includes(noticeId)) return
    notices.unshift({ id: noticeId, title: `${kind === 'video' ? '视频' : '图片'}生成完成`, detail: task.prompt || task.model || '' })
    notices.splice(5)
    const seen = readJSON(localStorage, `${TASK_STATE_KEY}:notified`, [])
    writeJSON(localStorage, `${TASK_STATE_KEY}:notified`, [...seen, noticeId].slice(-300))
    publish()
  }

  function dismissNotice(id) {
    const index = notices.findIndex((notice) => notice.id === id)
    if (index >= 0) {
      notices.splice(index, 1)
      publish()
    }
  }

  async function refreshTasks() {
    const sources = [...taskSources.values()]
    if (!sources.length || polling) return
    polling = true
    try {
    const results = await Promise.allSettled(sources.map(async (source) => {
      const response = await fetch(source.url, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new Error(`task query failed (${response.status})`)
      const data = await response.json()
      return { kind: source.kind, tasks: Array.isArray(data.tasks) ? data.tasks : [], sessionNames: data.sessionNames || {} }
    }))
    const next = { image: [], video: [], sessionNames: {}, updatedAt: Date.now() }
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const { kind, tasks, sessionNames } = result.value
      next[kind] = tasks.map((task) => ({ ...task, kind, __source: kind }))
      Object.assign(next.sessionNames, sessionNames)
      for (const task of tasks) {
        if (!task || typeof task.id !== 'string') continue
        const key = `${kind}:${task.id}`
        const previous = statusLedger[key]
        const status = String(task.status || '').toLowerCase()
        if (TERMINAL_SUCCESS.has(status) && previous && ACTIVE.has(previous)) notifyTask(task, kind)
        // Do not notify old records first seen after a browser refresh.
        if (!previous && task.createdAt >= bootAt && TERMINAL_SUCCESS.has(status)) notifyTask(task, kind)
        delete statusLedger[key]
        statusLedger[key] = status
      }
    }
    pruneObject(statusLedger, 1200, (status) => ACTIVE.has(status))
    writeJSON(localStorage, TASK_STATE_KEY, statusLedger)
    for (const result of results) {
      if (result.status === 'rejected') {
        const kind = sources[results.indexOf(result)]?.kind
        if (kind) next[kind] = taskSnapshot[kind]
      }
    }
    if (results.some((result) => result.status === 'rejected')) Object.assign(next.sessionNames, taskSnapshot.sessionNames)
    taskSnapshot = next
    for (const listener of subscriptions) listener()
    publish()
    } finally {
      polling = false
    }
  }

  function registerTaskPolling() {
    refreshTimer = setInterval(() => void refreshTasks(), 10000)
    const refresh = () => void refreshTasks()
    window.addEventListener('dsh-image-assets-changed', refresh)
    window.addEventListener('dsh-video-assets-changed', refresh)
    window.addEventListener('dsh-local-image-jobs', refresh)
    return () => {
      clearInterval(refreshTimer)
      window.removeEventListener('dsh-image-assets-changed', refresh)
      window.removeEventListener('dsh-video-assets-changed', refresh)
      window.removeEventListener('dsh-local-image-jobs', refresh)
    }
  }

  function subscribeTasks(listener) {
    subscriptions.add(listener)
    return () => subscriptions.delete(listener)
  }

  function restore() {
    for (const id of opened) {
      const app = apps.get(id)
      if (app) ensureEntry(app)
    }
    if (selected && opened.has(selected) && apps.has(selected)) selectSafely(selected)
  }

  return {
    registerApp,
    registerTaskSource,
    registerTaskPolling,
    openApp,
    closeApp,
    syncSelected,
    restore,
    getSnapshot: snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getTaskSnapshot() { return taskSnapshot },
    subscribeTasks,
    dismissNotice,
  }
}

function Styles() {
  return <style>{`
.dsh-launchpad{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:24px clamp(16px,4vw,40px);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base,transparent)}
.dsh-launchpad h1{font-size:22px;margin:0}.dsh-launchpad-head{display:flex;align-items:center;gap:10px;margin:0 0 6px}.dsh-launchpad-subtitle{opacity:.66;margin:0 0 22px;font-size:13px}
.dsh-launchpad-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(168px,100%),1fr));gap:12px}
.dsh-launchpad-card{min-width:0;min-height:128px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:inherit;text-align:left;padding:16px;cursor:pointer;display:flex;flex-direction:column;gap:10px;transition:background .15s,border-color .15s}
.dsh-launchpad-card:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}.dsh-launchpad-card:focus-visible,.dsh-launchpad-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsh-launchpad-cardtop{display:flex;align-items:center;gap:10px}.dsh-launchpad-icon{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,currentColor 9%,transparent);flex:none}
.dsh-launchpad-name{font-size:14px;font-weight:600}.dsh-launchpad-desc{font-size:12px;opacity:.68;line-height:1.5}.dsh-launchpad-empty{padding:28px 12px;border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;opacity:.7}
.dsh-launchpad-open{margin-top:28px}.dsh-launchpad-open h2{font-size:14px;margin:0 0 10px}.dsh-launchpad-row{display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-launchpad-rowicon{display:grid;place-items:center;width:30px;height:30px;flex:none}.dsh-launchpad-rowname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.dsh-launchpad-current{font-size:11px;opacity:.6}.dsh-launchpad-close{border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;padding:6px 10px}.dsh-launchpad-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-launchpad-notice{position:fixed;right:20px;bottom:20px;z-index:1200;width:min(380px,calc(100vw - 32px));max-width:calc(100vw - 32px);display:grid;grid-template-columns:minmax(0,1fr);gap:8px}.dsh-launchpad-toast{min-width:0;box-sizing:border-box;display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 28px #0002}.dsh-launchpad-toastmain{flex:1;min-width:0;display:block}.dsh-launchpad-toastmain>strong{display:block}.dsh-launchpad-toastdetail{display:block;max-width:100%;font-size:12px;opacity:.68;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-launchpad-toastclose{flex:none;border:0;background:transparent;color:inherit;cursor:pointer;font-size:18px}
@media(max-width:540px){.dsh-launchpad{padding:16px}.dsh-launchpad-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dsh-launchpad-card{min-height:116px;padding:12px}.dsh-launchpad-cardtop{align-items:flex-start;flex-direction:column;gap:7px}}
@media(prefers-reduced-motion:reduce){.dsh-launchpad-card{transition:none}}
`}</style>
}

function LaunchpadPanel({ service }) {
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
  const appMap = new Map(snapshot.apps.map((app) => [app.id, app]))
  const opened = snapshot.opened.map((id) => appMap.get(id)).filter(Boolean)
  const current = service.getTaskSnapshot()
  return <main className="dsh-launchpad"><Styles />
    <header className="dsh-launchpad-head"><LaunchpadGlyph size={24} /><h1>启动台</h1></header>
    <p className="dsh-launchpad-subtitle">打开常用工具；关闭入口不会取消已提交的生成任务。</p>
    <section aria-label="应用" className="dsh-launchpad-grid">
      {snapshot.apps.length ? snapshot.apps.map((app) => <button key={app.id} className="dsh-launchpad-card" type="button" onClick={() => service.openApp(app.id)}>
        <span className="dsh-launchpad-cardtop"><span className="dsh-launchpad-icon"><app.icon size={23} /></span><span className="dsh-launchpad-name">{app.name}</span></span>
        <span className="dsh-launchpad-desc">{app.description}</span>
      </button>) : <div className="dsh-launchpad-empty">应用插件正在登记…</div>}
    </section>
    <section className="dsh-launchpad-open" aria-label="已打开应用"><h2>侧栏入口</h2>
      {opened.length ? opened.map((app) => <div key={app.id} className="dsh-launchpad-row">
        <span className="dsh-launchpad-rowicon"><app.icon size={19} /></span><span className="dsh-launchpad-rowname">{app.name}</span>
        {snapshot.activePanel === app.id && <span className="dsh-launchpad-current">当前</span>}
        <button className="dsh-launchpad-close" type="button" aria-label={`关闭${app.name}侧栏入口`} onClick={() => service.closeApp(app.id)}>关闭</button>
      </div>) : <p className="dsh-launchpad-empty">打开应用后，其入口会保留在侧栏。</p>}
    </section>
    <span hidden>{current.image.length + current.video.length}</span>
  </main>
}

function LaunchpadGlyph({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
}

function LaunchpadIcon({ size = 20 }) { return <LaunchpadGlyph size={size} /> }

function NoticeOverlay({ service }) {
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
  if (!snapshot.notices.length) return null
  return <><Styles /><aside className="dsh-launchpad-notice" aria-live="polite" aria-label="生成完成提醒">
    {snapshot.notices.map((notice) => <div className="dsh-launchpad-toast" key={notice.id} role="status">
      <span aria-hidden="true">✓</span><span className="dsh-launchpad-toastmain"><strong>{notice.title}</strong>{notice.detail && <span className="dsh-launchpad-toastdetail">{notice.detail}</span>}</span>
      <button className="dsh-launchpad-toastclose" aria-label="关闭提醒" onClick={() => service.dismissNotice(notice.id)}>×</button>
    </div>)}
  </aside></>
}

export const inject = ['slots', 'layout']

export function apply(ctx) {
  const service = createLaunchpad(ctx)
  ctx.effect(() => ctx.provide('dshLaunchpad', service), 'dsh-launchpad: service')
  ctx.effect(() => service.registerTaskPolling(), 'dsh-launchpad: task monitor')
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: APP_ID }, () => <LaunchpadPanel service={service} />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: APP_ID, order: 0, label: '启动台' }, LaunchpadIcon))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-launchpad-notices', order: 90, label: '生成完成提醒' }, () => <NoticeOverlay service={service} />))
  ctx.effect(() => {
    const stop = ctx.layout.panelInfo.subscribe(() => {
      const id = ctx.layout.panelInfo.getSnapshot().activePanelId || ''
      if (id !== APP_ID) service.syncSelected(id)
    })
    const timer = setTimeout(() => service.restore(), 0)
    return () => { stop(); clearTimeout(timer) }
  }, 'dsh-launchpad: restore navigation')
}
