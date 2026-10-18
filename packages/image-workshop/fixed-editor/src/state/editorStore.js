import {generationSnapshots,placeGeneratedResults,regenerateCanvasTask} from './generation-placement.js';
// EditorStore：编辑器唯一状态源（框架无关，React 经 useSyncExternalStore 绑定）。
// 职责：文档状态 + 每画布有界历史 + 选择/视口 + 生成批次 + 保存（expectedRevision 防覆盖）。

import { applyCommand, emptyDocument, makeCommand, envelope } from '../lib/commands.js';
import { History } from '../lib/history.js';
import { validateCanvasDocument } from '../lib/schema.js';
import { clampRectToCanvas } from '../lib/renderPlan.js';
import { ratioValue, fitTargetRect } from '../lib/targetRatio.js';
import { transformBounds } from '../lib/matrix.js';
import { uuid, now } from '../lib/id.js';

const AUTOSAVE_DEALAY = 800;
const COALESCE_MS = 800;
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 16;

function clampZoom(z) {
  if (!Number.isFinite(z) || z <= 0) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

function needsBillingRefresh(task) {
  const provider=String(task?.costProvider||task?.costChannel||'').toLowerCase();
  const billing=task?.billing||{};
  const check=task?.billingCheck||{};
  const rawAmounts=[billing.credits,billing.costUsd].filter(v=>v!=null&&!(typeof v==='string'&&!v.trim()));
  const validValue=v=>(typeof v==='number'||typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v))&&Number.isFinite(Number(v))&&Number(v)>=0;
  const amounts=rawAmounts.map(Number);
  const validAmounts=rawAmounts.length>0&&rawAmounts.every(validValue);
  const hasConfirmedAmount=validAmounts&&(billing.status==='settled'
    || billing.status==='refunded'&&amounts.every(v=>v===0));
  const attempts=Number(check.attempts)||0;
  const retryScheduled=['checking','unavailable'].includes(check.status)
    && attempts<5 && Number.isFinite(check.nextAt);
  return provider==='toapis' && !!task?.remoteId && !hasConfirmedAmount
    && (billing.status==='pending' || check.status==='pending' || retryScheduled);
}

export class EditorStore {
  constructor(adapter) {
    this.adapter = adapter;
    this.doc = emptyDocument();
    this.activeProjectId = null;
    this.activeCanvasId = null;
    /** @type {Map<string, History>} */
    this.histories = new Map();
    this.selection = new Set();
    this.viewport = { zoom: 1, panX: 0, panY: 0 };
    this.stageSize = { width: 0, height: 0 };
    this.saveState = 'idle'; // idle|saving|saved|conflict|error
    this.notice = '';
    this.noticeKind = 'info';
    this.projects = [];
    this.ready = false;
    this.models = [];
    this.modelsLoading = false;
    this.modelsError = '';
    this.modelsLoadEpoch = 0;
    this.modelsChangeListener = null;
    this.savePromise = null;
    this.appliedCandidates = new Set();
    this.applyingCandidates = new Map();
    this.disposed = false;
    // 生成状态
    this.batches = new Map(); // batchId -> {batch, tasks: Map, candidates: [], pollTimer}
    this.activeBatchId = null;
    this.targetAspectRatio = null;
    this.targetRect = null; // 画布坐标落点（新图层放置语义）
    this.pendingCommands = [];
    this.lastServerRevision = 0;
    this.saveTimer = null;
    this.listeners = new Set();
    this.snapshot = this.buildSnapshot();
  }

  // ---- 订阅 ----
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getSnapshot() {
    return this.snapshot;
  }

  buildSnapshot() {
    const canvas = this.activeCanvasId ? this.doc.canvases[this.activeCanvasId] : null;
    const layers = canvas ? canvas.layerIds.map((id) => this.doc.layers[id]).filter(Boolean) : [];
    const assets = canvas ? [...new Set(layers.map((l) => l.assetId))].map((id) => this.doc.assets[id]).filter(Boolean) : [];
    const project = this.activeProjectId ? this.doc.projects[this.activeProjectId] : null;
    const history = this.activeCanvasId ? this.histories.get(this.activeCanvasId) : null;
    const activeBatch = this.activeBatchId ? this.batches.get(this.activeBatchId) : null;
    return {
      ready: this.ready,
      models: this.models, modelsLoading: this.modelsLoading, modelsError: this.modelsError,
      mock: this.adapter.mock === true,
      projects: this.projects,
      project,
      canvas,
      layers,
      assets,
      selection: [...this.selection],
      viewport: { ...this.viewport },
      stageSize: { ...this.stageSize },
      saveState: this.saveState,
      hasPendingChanges: this.pendingCommands.length > 0 || !!this.savePromise,
      notice: this.notice,
      noticeKind: this.noticeKind,
      canUndo: history ? history.canUndo : false,
      canRedo: history ? history.canRedo : false,
      historyStats: history ? history.stats() : { undoCount: 0, redoCount: 0, bytes: 0 },
      targetRect: this.targetRect ? { ...this.targetRect } : null,
      targetAspectRatio: this.targetAspectRatio,
      batchHistory: [...this.batches.values()].filter((r) => r.batch.canvasId === this.activeCanvasId).map((r) => ({ id: r.batch.id, prompt: r.batch.prompt ?? r.batch.effectiveParams?.prompt ?? '', createdAt: r.batch.createdAt })),
      generationBatches: generationSnapshots(this),
      activeBatch: activeBatch
        ? {
            batch: activeBatch.batch,
            tasks: [...activeBatch.tasks.values()].map((t) => ({ ...t })),
            candidates: activeBatch.candidates,
          }
        : null,
    };
  }

  emit() {
    this.snapshot = this.buildSnapshot();
    for (const fn of this.listeners) fn();
  }

  setNotice(message, kind = 'info') {
    this.notice = message;
    this.noticeKind = kind;
    this.emit();
  }

  // ---- 启动 ----
  async init() {
    if (!this.modelsChangeListener && globalThis.window?.addEventListener) {
      this.modelsChangeListener = () => { void this.refreshModels(); };
      globalThis.window.addEventListener('dsh-image-models-changed', this.modelsChangeListener);
    }
    await this.refreshModels();
    try { await this.refreshProjects(); }
    catch (e) { this.setNotice(`项目加载失败：${e.message || e}`, 'error'); }
    this.stopAgentChanges=this.adapter.subscribeChanges?.((event,clientId)=>this.onAgentChange(event,clientId),{role:'image-editor',active:()=>this.uiActive!==false,workspace:()=>this.uiActive===false?'legacy':'editor'});
    this.ready = true;
    this.emit();
  }

  async refreshModels() {
    const epoch = ++this.modelsLoadEpoch;
    if (this.disposed) return;
    this.modelsLoading = true;
    this.modelsError = '';
    this.emit();
    try {
      const result = await this.adapter.getModels?.();
      if (this.disposed || epoch !== this.modelsLoadEpoch) return;
      this.models = Array.isArray(result?.models) ? result.models : [];
    } catch (e) {
      if (this.disposed || epoch !== this.modelsLoadEpoch) return;
      this.modelsError = `读取模型能力失败：${e.message || e}`;
    } finally {
      if (!this.disposed && epoch === this.modelsLoadEpoch) {
        this.modelsLoading = false;
        this.emit();
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.modelsLoadEpoch++;
    if (this.modelsChangeListener) globalThis.window?.removeEventListener?.('dsh-image-models-changed', this.modelsChangeListener);
    this.modelsChangeListener = null;
    this.stopAgentChanges?.();
    clearTimeout(this.saveTimer);
    for (const record of this.batches.values()) clearTimeout(record.pollTimer);
    this.listeners.clear();
  }

  async onAgentChange(event,clientId) {
    if(this.disposed)return;
    if(event.kind==='ui-command'&&event.clientId===clientId){
      let status='applied';const v=event.value;
      try{
        if(this.pendingCommands.length||this.savePromise){status='blocked_dirty';}
        else if(event.command==='workspace'&&this.uiWorkspaceHandler)status=await this.uiWorkspaceHandler(v);
        else if(this.uiActive===false)status='unsupported';
        else if(event.command==='open_project')await this.openProject(v);
        else if(event.command==='open_canvas')await this.switchCanvas(v);
        else if(event.command==='select_layers'){if(!Array.isArray(v)||v.some(id=>!this.doc.layers[id]))throw Error('图层不存在');this.selectMany(v);}
        else if(event.command==='zoom'){if(!Number.isFinite(v)||v<=0)throw Error('缩放无效');this.setZoom(v);}
        else if(event.command==='pan'){if(!v||!Number.isFinite(v.x)||!Number.isFinite(v.y))throw Error('视口无效');this.setViewportPan(v.x,v.y);}
        else if(event.command==='fit')this.fitToWindow();
        else status='unsupported';
      }catch{status='failed';}
      await this.adapter.acknowledgeUi?.({clientId,operationId:event.operationId,capability:event.capability,status});return;
    }
    if(!['invalidate','connected'].includes(event.kind)||event.source==='ui')return;
    if(this.pendingCommands.length||this.savePromise){clearTimeout(this.saveTimer);this.externalConflict=true;this.backupConflictDraft();this.saveState='conflict';this.setNotice('Agent已更新服务器画布，本地未保存修改已保留；请先处理冲突','error');return;}
    try{await this.refreshProjects();if(this.activeCanvasId&&(!event.canvasId||event.canvasId===this.activeCanvasId)){const id=this.activeCanvasId;await this.loadCanvasFull(id);this.histories.set(id,new History());this.setNotice('已同步Agent修改；旧本地撤销记录已清理，可使用服务器历史撤销');}}catch(e){this.setNotice(e.message,'error');}
  }

  backupConflictDraft(){
    this.conflictDraft={schema:1,canvasId:this.activeCanvasId,baseRevision:this.lastServerRevision,commands:structuredClone(this.pendingCommands),document:structuredClone(this.doc),savedAt:Date.now()};
    try{globalThis.localStorage?.setItem('dsh-iw-conflict:'+this.activeCanvasId,JSON.stringify(this.conflictDraft));}catch{}
  }
  downloadConflictDraft(){this.backupConflictDraft();downloadBlob(new Blob([JSON.stringify(this.conflictDraft,null,2)],{type:'application/json'}),'canvas-local-draft.json');}
  async reloadAfterConflict(){
    this.backupConflictDraft();clearTimeout(this.saveTimer);this.pendingCommands=[];this.externalConflict=false;
    if(this.activeCanvasId){await this.loadCanvasFull(this.activeCanvasId);this.histories.set(this.activeCanvasId,new History());}
    this.setNotice('已载入服务器版本；本地修改备份保留在此浏览器','info');
  }

  async refreshProjects() {
    const { projects } = await this.adapter.listProjects();
    this.projects = projects;
    for(const project of projects)if(this.doc.projects[project.id])this.doc.projects[project.id]={...this.doc.projects[project.id],name:project.name,updatedAt:project.updatedAt};
    this.emit();
  }

  // 返回项目列表（不删除任何数据）
  async closeProject() {
    if (this.pendingCommands.length || this.savePromise) {
      if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      if (await this.save() === false) return false;
    }
    this.activeProjectId = null;
    this.activeCanvasId = null;
    this.selection.clear();
    this.targetAspectRatio = null;
    this.targetRect = null;
    this.activeBatchId = null;
    await this.refreshProjects();
  }

  // ---- 项目 ----
  async createProject({ name, width, height }) {
    const { project, canvas } = await this.adapter.createProject({ name, width, height });
    this.doc = applyCommand(this.doc, makeCommand('createProject', canvas.id, 0, { project, canvas })).state;
    this.projects = [
      { id: project.id, name: project.name, canvasCount: 1, canvasIds: [canvas.id], coverUrl: '', createdAt: project.createdAt, updatedAt: project.updatedAt },
      ...this.projects,
    ];
    this.activeProjectId = project.id;
    this.lastServerRevision = canvas.revision;
    this.activateCanvas(canvas.id);
    this.setNotice(`已创建项目「${name}」`, 'success');
    return { project, canvas };
  }

  async renameProject(projectId, name) {
    const { project } = await this.adapter.renameProject(projectId, name);
    this.doc = { ...this.doc, projects: { ...this.doc.projects, [projectId]: { ...this.doc.projects[projectId], ...project } } };
    this.projects = this.projects.map((p) => (p.id === projectId ? { ...p, name, updatedAt: project.updatedAt } : p));
    this.setNotice('项目已重命名', 'success');
    this.emit();
  }

  async openProject(projectId) {
    if ((this.pendingCommands.length || this.savePromise) && await this.save() === false) return false;
    const { project, canvas } = await this.adapter.openProject(projectId);
    // 幂等合并：本地没有则创建，已有则更新（closeProject 后再打开同一项目）
    if (this.doc.projects[projectId]) {
      this.doc = {
        ...this.doc,
        projects: { ...this.doc.projects, [projectId]: { ...project, canvasIds: [...project.canvasIds] } },
        canvases: { ...this.doc.canvases, [canvas.id]: canvas },
      };
    } else {
      this.doc = applyCommand(this.doc, makeCommand('createProject', canvas.id, 0, {
        project: { ...project, canvasIds: [...project.canvasIds] },
        canvas,
      })).state;
    }
    const { canvases } = await this.adapter.listCanvases(projectId);
    for (const item of canvases) this.doc.canvases[item.id] = { ...this.doc.canvases[item.id], ...item };
    // 载入项目全部画布的骨架（图层按需加载）
    this.activeProjectId = project.id;
    this.activateCanvas(canvas.id);
    await this.loadCanvasFull(canvas.id);
    this.setNotice(`已打开项目「${project.name}」`, 'success');
  }

  // ---- 画布 ----
  async createCanvas({ name, width, height }) {
    if (!this.activeProjectId) throw new Error('没有打开的项目');
    if (this.pendingCommands.length || this.savePromise) {
      if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      if (await this.save() === false) return false;
    }
    const { canvas } = await this.adapter.createCanvas(this.activeProjectId, { name, width, height });
    // applyCommand 的 createCanvas 分支已把 canvas.id 加入 project.canvasIds，勿重复追加（否则标签列表 key 重复）
    this.doc = applyCommand(this.doc, makeCommand('createCanvas', canvas.id, 0, { canvas })).state;
    this.activateCanvas(canvas.id);
    await this.loadCanvasFull(canvas.id);
    this.setNotice(`已创建画布「${name}」`, 'success');
  }

  async renameCanvas(canvasId, name) {
    if (await this.save() === false) return false;
    const { canvas } = await this.adapter.renameCanvas(canvasId, name);
    this.doc = { ...this.doc, canvases: { ...this.doc.canvases, [canvasId]: canvas } };
    if (this.activeCanvasId === canvasId) this.lastServerRevision = canvas.revision;
    this.emit();
  }

  async deleteCanvas(canvasId) {
    const canvas = this.doc.canvases[canvasId];
    if (!canvas) return;
    const projectId = canvas.projectId;
    if (this.activeCanvasId === canvasId && this.pendingCommands.length) {
      if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      if (await this.save() === false) return false;
    }
    await this.adapter.deleteCanvas(canvasId);
    this.doc = applyCommand(this.doc, makeCommand('deleteCanvas', canvasId, canvas.revision, { canvasId })).state;
    this.histories.delete(canvasId);
    if (this.activeCanvasId === canvasId) {
      const project = this.doc.projects[projectId];
      const nextId = project?.canvasIds[0] || null;
      if (nextId) {
        this.activateCanvas(nextId);
        await this.loadCanvasFull(nextId);
      } else {
        this.activeCanvasId = null;
        this.activeProjectId = null;
        this.selection.clear();
        await this.refreshProjects();
      }
    }
    this.setNotice('画布已关闭（仅移除文档引用，原图保留）', 'success');
    this.emit();
  }

  async loadCanvasFull(canvasId, { canReplace = () => true } = {}) {
    const { canvas, layers, assets } = await this.adapter.getCanvas(canvasId);
    if (this.activeCanvasId !== canvasId || this.disposed || !canReplace()) return false;
    const nextLayers = { ...this.doc.layers };
    for (const l of layers) nextLayers[l.id] = l;
    const nextAssets = { ...this.doc.assets };
    for (const a of assets) nextAssets[a.id] = a;
    this.doc = {
      ...this.doc,
      canvases: { ...this.doc.canvases, [canvasId]: canvas },
      layers: nextLayers,
      assets: nextAssets,
    };
    this.lastServerRevision = canvas.revision;
    if (!this.histories.has(canvasId)) this.histories.set(canvasId, new History());
    this.selection.clear();
    this.saveState = 'idle';
    this.emit();
    try {
      const { batches } = await this.adapter.listBatches(canvasId);
      if (this.activeCanvasId !== canvasId || this.disposed) return;
      for (const item of batches) {
        const batch = item.batch || item;
        if (batch.canvasId !== canvasId) continue;
        const prior = this.batches.get(batch.id);
        if (prior) clearTimeout(prior.pollTimer);
        this.batches.set(batch.id, { batch, tasks: new Map((item.tasks || []).map((t) => [t.taskId || t.model, t])), candidates: item.candidates || [], pollTimer: null, billingRefreshRounds: prior?.billingRefreshRounds || 0 });
        for (const asset of item.candidates || []) this.doc.assets[asset.id] = asset;
        this.pollBatch(batch.id);
      }
      this.activeBatchId = [...this.batches.entries()].reverse().find(([,r]) => r.batch.canvasId === canvasId)?.[0] || null;
      this.emit();
    } catch (e) { this.setNotice(`生成记录恢复失败：${e.message || e}`, 'error'); }
    return true;
  }

  activateCanvas(canvasId) {
    this.activeCanvasId = canvasId;
    this.activeProjectId = this.doc.canvases[canvasId]?.projectId || this.activeProjectId;
    this.selection.clear();
    this.targetAspectRatio = null;
    this.targetRect = null;
    this.activeBatchId = [...this.batches.entries()].reverse().find(([, r]) => r.batch.canvasId === canvasId)?.[0] || null;
    this.viewport = { zoom: 1, panX: 0, panY: 0 };
    if (this.stageSize.width > 0 && this.stageSize.height > 0) this.fitToWindow();
    this.emit();
  }

  // 切换画布前先冲刷未保存修改（不丢失编辑）
  async switchCanvas(canvasId) {
    if (this.activeCanvasId && this.activeCanvasId !== canvasId && (this.pendingCommands.length || this.savePromise)) {
      if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      if (await this.save() === false) return false;
    }
    this.activateCanvas(canvasId);
    await this.loadCanvasFull(canvasId);
  }

  // ---- 选择 ----
  select(layerId, { additive = false } = {}) {
    if (!additive) this.selection.clear();
    if (layerId) this.selection.add(layerId);
    this.emit();
  }

  toggleSelect(layerId) {
    if (this.selection.has(layerId)) this.selection.delete(layerId);
    else this.selection.add(layerId);
    this.emit();
  }

  selectMany(layerIds) {
    this.selection = new Set(layerIds);
    this.emit();
  }

  clearSelection() {
    this.selection.clear();
    this.emit();
  }

  // ---- 命令执行（本地立即生效 + 有界自动保存）----
  execute(command, { coalesceKey = null } = {}) {
    const canvasId = command.canvasId || this.activeCanvasId;
    const canvas = this.doc.canvases[canvasId];
    if (!canvas) throw new Error('画布未激活');
    const full = envelope({ ...command, canvasId, baseRevision: canvas.revision });
    const { state, inverse } = applyCommand(this.doc, full);
    this.doc = state;
    const history = this.histories.get(canvasId) || new History();
    if (!this.histories.has(canvasId)) this.histories.set(canvasId, history);
    history.record([full], [inverse], coalesceKey ? { key: coalesceKey, within: COALESCE_MS } : null);
    this.pendingCommands.push(full);
    this.saveState = 'idle';
    this.emit();
    this.scheduleSave();
    return inverse;
  }

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), AUTOSAVE_DEALAY);
  }

  // 一次用户操作 = 多条语义命令（如多图层拖动/缩放）= 一条历史entry = 一次撤销
  executeGroup(commands, { coalesceKey = null } = {}) {
    const canvasId = this.activeCanvasId;
    let state = this.doc;
    const forwards = [];
    const inverses = [];
    for (const command of commands) {
      const canvas = state.canvases[canvasId];
      if (!canvas) throw new Error('画布未激活');
      const full = envelope({ ...command, canvasId, baseRevision: canvas.revision });
      const applied = applyCommand(state, full);
      state = applied.state;
      forwards.push(full);
      inverses.push(applied.inverse);
    }
    this.doc = state;
    let history = this.histories.get(canvasId);
    if (!history) {
      history = new History();
      this.histories.set(canvasId, history);
    }
    history.record(forwards, inverses, coalesceKey ? { key: coalesceKey, within: COALESCE_MS } : null);
    this.pendingCommands.push(...forwards);
    this.saveState = 'idle';
    this.emit();
    this.scheduleSave();
    return inverses;
  }

  async save() {
    if(this.externalConflict){this.saveState='conflict';this.emit();return false;}
    if (this.savePromise) {
      const ok = await this.savePromise;
      if (!ok) return false;
      return this.pendingCommands.length ? this.save() : true;
    }
    if (!this.activeCanvasId || this.pendingCommands.length === 0) return true;
    const canvasId = this.activeCanvasId;
    const commands = this.pendingCommands.splice(0);
    const revision = this.lastServerRevision;
    this.saveState = 'saving';
    this.emit();
    this.savePromise = (async () => {
      try {
        const result = await this.adapter.putCanvas(canvasId, { expectedRevision: revision, commands });
        this.lastServerRevision = result.newRevision;
        this.saveState = 'saved';
        this.emit();
        return true;
      } catch (e) {
        if (e?.status === 409) {
          this.pendingCommands.unshift(...commands);
          this.externalConflict=true;this.backupConflictDraft();clearTimeout(this.saveTimer);
          this.saveState = 'conflict';
          this.setNotice('保存冲突：另一窗口已修改同一画布，已停止覆盖并保留本地修改', 'error');
        } else {
          this.pendingCommands.unshift(...commands);
          this.saveState = 'error';
          this.setNotice(`保存失败，修改已保留，可重试：${e?.message || e}`, 'error');
        }
        return false;
      }
    })();
    const ok = await this.savePromise;
    this.savePromise = null;
    if (ok && this.pendingCommands.length) return this.save();
    return ok;
  }

  // ---- 撤销/重做（撤销也是新 revision）----
  undo() {
    const canvasId = this.activeCanvasId;
    const history = this.histories.get(canvasId);
    if (!history || !history.canUndo) return;
    const entry = history.popUndo();
    for (let i = entry.inverses.length - 1; i >= 0; i--) {
      const inverse = entry.inverses[i];
      const canvas = this.doc.canvases[canvasId];
      const full = { ...inverse, canvasId, baseRevision: canvas.revision };
      const { state, inverse: reinverse } = applyCommand(this.doc, full);
      this.doc = state;
      this.pendingCommands.push(full);
      // 保留原始 forward 供 redo 重放；只更新 inverse 供再次 undo
      entry.inverses[i] = reinverse;
    }
    history.pushRedo(entry);
    this.emit();
    this.scheduleSave();
  }

  redo() {
    const canvasId = this.activeCanvasId;
    const history = this.histories.get(canvasId);
    if (!history || !history.canRedo) return;
    const entry = history.popRedo();
    for (let i = 0; i < entry.forwards.length; i++) {
      const forward = entry.forwards[i];
      const canvas = this.doc.canvases[canvasId];
      const full = { ...forward, canvasId, baseRevision: canvas.revision };
      const { state, inverse } = applyCommand(this.doc, full);
      this.doc = state;
      this.pendingCommands.push(full);
      entry.inverses[i] = inverse;
    }
    history.undoStack.push(entry);
    history.bytes += entry.bytes;
    history.evict();
    this.emit();
    this.scheduleSave();
  }

  // ---- 视口 ----
  setZoom(zoom, center) {
    const next = clampZoom(zoom);
    if (center && this.stageSize.width) {
      const { zoom: z0, panX, panY } = this.viewport;
      const [cx, cy] = center;
      this.viewport = {
        zoom: next,
        panX: cx - ((cx - panX) / z0) * next,
        panY: cy - ((cy - panY) / z0) * next,
      };
    } else {
      this.viewport = { ...this.viewport, zoom: next };
    }
    this.emit();
  }

  zoomBy(factor, center) {
    this.setZoom(this.viewport.zoom * factor, center);
  }

  setViewportPan(panX, panY) {
    if (!Number.isFinite(panX) || !Number.isFinite(panY)) return;
    this.viewport = { ...this.viewport, panX, panY };
    this.emit();
  }

  setStageSize(size) {
    const initial = !this.stageSize.width || !this.stageSize.height;
    this.stageSize = size;
    if (initial && size.width > 0 && size.height > 0) this.fitToWindow();
    this.emit();
  }

  fitToWindow() {
    const canvas = this.doc.canvases[this.activeCanvasId];
    if (!canvas || !this.stageSize.width || !this.stageSize.height) return;
    const pad = 48;
    const zoom = clampZoom(
      Math.min((this.stageSize.width - pad) / canvas.width, (this.stageSize.height - pad) / canvas.height),
    );
    const panX = (this.stageSize.width - canvas.width * zoom) / 2;
    const panY = (this.stageSize.height - canvas.height * zoom) / 2;
    this.viewport = { zoom, panX, panY };
    this.emit();
  }

  // ---- 生成 ----
  setTargetAspectRatio(ratio) {
    const next = ratioValue(ratio) ? ratio : null;
    if (next === this.targetAspectRatio) return;
    this.targetAspectRatio = next;
    const canvas = this.doc.canvases[this.activeCanvasId];
    if (this.targetRect) this.targetRect = next ? fitTargetRect(this.targetRect, canvas, next) : null;
    this.emit();
  }

  setTargetRect(rect) {
    const canvas = this.doc.canvases[this.activeCanvasId];
    if (!canvas) return;
    this.targetRect = rect ? (this.targetAspectRatio ? fitTargetRect(rect, canvas, this.targetAspectRatio) : clampRectToCanvas(rect, canvas)) : null;
    this.emit();
  }

  async submitGeneration({ prompt, models, params, referenceLayerIds, referenceInputMode, referenceMentions = [] }) {
    const canvasId = this.activeCanvasId;
    const canvas = this.doc.canvases[canvasId];
    if (!canvas) throw new Error('画布未激活');
    if (!prompt.trim() && !models.every(id => id === 'midjourney' && ['blend','describe'].includes(params[id]?.extra?.action))) {
      this.setNotice('请输入提示词', 'error');
      return null;
    }
    if (!models.length) {
      this.setNotice('请至少选择一个模型', 'error');
      return null;
    }
    if (await this.save() === false) return null;
    const fixedTarget = this.targetRect ? { ...this.targetRect } : null;
    if (fixedTarget) {
      const expected = ratioValue(this.targetAspectRatio);
      const valid = expected && Math.abs(fixedTarget.width / fixedTarget.height - expected) < 1e-6 && models.every(id => {
        const model = this.models.find(m => m.id === id);
        return (model?.ratios || []).includes(this.targetAspectRatio) && params[id]?.aspectRatio === this.targetAspectRatio;
      });
      if (!valid) { this.setNotice('框选比例与模型参数不一致，请重新选择支持的比例', 'error'); return null; }
    }
    const sourceRevision = canvas.revision;
    const optimisticId=uuid(),request={canvasId,prompt:prompt.trim(),models:structuredClone(models),params:structuredClone(params),referenceLayerIds:[...referenceLayerIds],referenceInputMode,referenceMentions:structuredClone(referenceMentions),targetRect:fixedTarget,sourceRevision};
    const optimistic={batch:{...request,id:optimisticId,local:true,createdAt:now(),targetRect:fixedTarget||{x:0,y:0,width:canvas.width,height:canvas.height}},tasks:new Map(models.map(model=>[model,{model,status:'submitting'}])),candidates:[],pollTimer:null};
    this.batches.set(optimisticId,optimistic);this.emit();
    let tasks,response;
    try { response = await this.adapter.submitGeneration({
      canvasId,
      prompt: prompt.trim(),
      models,
      params,
      referenceLayerIds,
      referenceInputMode,
      referenceMentions,
      targetRect: fixedTarget,
      sourceRevision,
    });tasks=response.tasks;this.batches.delete(optimisticId); } catch (e) {
      for(const task of optimistic.tasks.values()){task.status=e.status>=400&&e.status<500?'failed':'uncertain';task.error=e.message;}
      if(e.batchId&&this.adapter.getBatch)try{const fresh=await this.adapter.getBatch(e.batchId);this.batches.delete(optimisticId);this.batches.set(fresh.id,{batch:fresh,tasks:new Map(fresh.tasks.map(t=>[t.taskId||t.model,t])),candidates:fresh.candidates||[],pollTimer:null});if(this.activeCanvasId===fresh.canvasId)this.activeBatchId=fresh.id;this.pollBatch(fresh.id);}catch{}
      this.setNotice(`提交失败或结果未知：${e.message || e}`, 'error'); return null;
    }
    const batchId = tasks[0]?.batchId || null;
    const record = {
      batch: {
        id: batchId, canvasId, prompt: prompt.trim(), models: [...models], mock: this.adapter.mock === true,
        referenceLayerIds: [...referenceLayerIds], referenceInputMode,
        targetRect: fixedTarget,
        sourceRevision, createdAt: now(),params:structuredClone(params),referenceMentions:structuredClone(referenceMentions),autoPlace:true,...response.batch,
      },
      tasks: new Map(tasks.map((t) => [t.taskId || `${t.model}#${Math.random()}`, t])),
      candidates: [],
      pollTimer: null,
      billingRefreshRounds: 0,
    };
    this.batches.set(batchId, record);
    if (this.activeCanvasId === canvasId) this.activeBatchId = batchId;
    this.emit();
    this.pollBatch(batchId);
    this.setNotice(`已提交 ${models.length} 个模型任务${this.adapter.mock ? '（mock）' : ''}`, 'success');
    return batchId;
  }

  regenerateTask(batchId,model){return regenerateCanvasTask(this,batchId,model);}

  selectBatch(batchId) {
    if (this.batches.get(batchId)?.batch.canvasId !== this.activeCanvasId) return;
    this.activeBatchId = batchId;
    this.emit();
  }

  pollBatch(batchId) {
    const record = this.batches.get(batchId);
    if (this.disposed || !record || record.pollTimer) return;
    const tick = async () => {
      if (this.disposed) return;
      let active = false;
      for (const task of record.tasks.values()) {
        if (this.disposed) return;
        if (!task.taskId) continue;
        if (['queued', 'submitting', 'polling'].includes(task.status)) {
          active = true;
          try {
            const fresh = await this.adapter.getTask(task.taskId);
            if (this.disposed) return;
            record.tasks.set(task.taskId, fresh);
            for (const asset of fresh.candidates || []) {
              if (!record.candidates.some((c) => c.id === asset.id)) record.candidates.push(asset);
              this.doc = { ...this.doc, assets: { ...this.doc.assets, [asset.id]: asset } };
            }
          } catch { /* 轮询失败保持原状态 */ }
        }
      }
      if (this.disposed) return;
      if (!active && this.adapter.getBatch) {
        try {
          const fresh=await this.adapter.getBatch(batchId);
          record.batch={...record.batch,...(fresh.batch||fresh)};
          if (this.disposed) return;
          for(const task of fresh.tasks||[])record.tasks.set(task.taskId||task.model,task);
          for(const asset of fresh.candidates||[]){
            if(!record.candidates.some(c=>c.id===asset.id))record.candidates.push(asset);
            this.doc={...this.doc,assets:{...this.doc.assets,[asset.id]:asset}};
          }
        } catch(e) { if (!this.disposed) this.setNotice('结果同步失败，请重新打开项目获取候选：'+e.message,'error'); }
      }
      if (this.disposed) return;
      this.emit();
      await placeGeneratedResults(this,record);
      if(this.batches.get(batchId)!==record)return;
      if (active) {
        record.billingRefreshRounds=0;
        record.pollTimer=setTimeout(tick,800);
      } else {
        const awaitingBilling=[...record.tasks.values()].some(needsBillingRefresh);
        if(awaitingBilling&&record.billingRefreshRounds<12){
          record.billingRefreshRounds++;
          record.pollTimer=setTimeout(tick,30000);
        } else {
          if(!awaitingBilling)record.billingRefreshRounds=0;
          record.pollTimer=null;
        }
      }
    };
    record.pollTimer = setTimeout(tick, 500);
  }

  async applyCandidate(batchId, candidateAssetId, options = {}) {
    const key = `${batchId}:${candidateAssetId}`;
    if (this.appliedCandidates.has(key)) return;
    if (this.applyingCandidates.has(key)) return this.applyingCandidates.get(key);
    const promise = this.applyCandidateOnce(batchId, candidateAssetId, options).then((result) => {
      if (result !== false) this.appliedCandidates.add(key);
      return result;
    }).catch((e) => { this.setNotice(`应用候选失败：${e.message || e}`, 'error'); return false; }).finally(() => this.applyingCandidates.delete(key));
    this.applyingCandidates.set(key, promise);
    return promise;
  }

  async applyCandidateOnce(batchId, candidateAssetId, options = {}) {
    const record = this.batches.get(batchId);
    if (!record || record.batch.canvasId !== this.activeCanvasId) {
      this.setNotice('请切回生成任务所属画布后应用候选', 'error');
      return false;
    }
    if (await this.save() === false) return false;
    const sourceCanvasId = record.batch.canvasId;
    if (this.disposed || this.activeCanvasId !== sourceCanvasId || this.pendingCommands.length || this.savePromise || this.externalConflict) return false;
    const sourceDocument = this.doc;
    const expectedRevision = this.lastServerRevision;
    const sourceCanvasRevision = this.doc.canvases[sourceCanvasId]?.revision;
    const canReplace = () => this.doc.canvases[sourceCanvasId]?.revision === sourceCanvasRevision && this.doc === sourceDocument && !this.pendingCommands.length && !this.savePromise && !this.externalConflict && this.lastServerRevision === expectedRevision;
    const preserveConflict = () => {
      clearTimeout(this.saveTimer);
      this.externalConflict = true;
      this.backupConflictDraft();
      this.saveState = 'conflict';
      this.setNotice('服务器画布已变化，本地修改已保留；请先处理冲突', 'error');
    };
    let result;
    try {
      result = await this.adapter.applyCandidate(batchId, candidateAssetId, { ...options, expectedRevision });
    } catch (e) {
      if (e.status === 409 && this.activeCanvasId === sourceCanvasId && !this.disposed) preserveConflict();
      throw e;
    }
    if (result.removed || !result.layer) {
      this.setNotice('该候选已应用过且图层已移除', 'info');
      return;
    }
    const canvasId = result.canvas.id;
    if (canvasId !== this.activeCanvasId || this.disposed) return result;
    // A successful server write is terminal even when a concurrent local edit prevents reloading.
    // Preserve the exact draft and block autosave instead of retrying or resurrecting a removed result.
    if (!canReplace()) { preserveConflict(); return result; }
    const loaded = await this.loadCanvasFull(canvasId, { canReplace });
    if (canvasId !== this.activeCanvasId || this.disposed) return result;
    if (!loaded || this.pendingCommands.length || this.savePromise || this.externalConflict || this.lastServerRevision !== result.canvas.revision) {
      preserveConflict();
      return result;
    }
    if(result.alreadyApplied){this.setNotice('该候选已在画布中，保留原位置','info');return result;}
    const canvas = this.doc.canvases[canvasId];
    let history = this.histories.get(canvasId);
    if (!history) {
      history = new History();
      this.histories.set(canvasId, history);
    }
    if (canvas.layerIds.includes(result.layer.id)) {
      // 服务端已应用：记录 forward（redo 重放）/ inverse（undo 撤销）而不再本地执行
      const forward = envelope({
        type: 'applyGeneratedResult', canvasId, baseRevision: Math.max(0, canvas.revision - 1),
        payload: { layer: result.layer, batchId, candidateId: candidateAssetId },
      });
      const inverse = envelope({
        type: 'removeLayer', canvasId, baseRevision: canvas.revision,
        payload: { layerId: result.layer.id },
      });
      history.record([forward], [inverse]);
    } else {
      // 服务端未应用（保守路径）：本地应用同一条命令
      const forward = envelope({
        type: 'applyGeneratedResult', canvasId, baseRevision: canvas.revision,
        payload: { layer: result.layer, batchId, candidateId: candidateAssetId },
      });
      const { state, inverse } = applyCommand(this.doc, forward);
      this.doc = state;
      history.record([forward], [inverse]);
    }
    this.lastServerRevision = this.doc.canvases[canvasId].revision;
    this.selection = new Set([result.layer.id]);
    this.emit();
    this.setNotice('候选已应用为新图层（固定落点，可撤销）', 'success');
    return result;
  }

  async cancelTask(taskId) {
    try { await this.adapter.cancelTask(taskId); }
    catch (e) { this.setNotice(`取消任务失败：${e.message || e}`, 'error'); return false; }
    for (const record of this.batches.values()) {
      const task = record.tasks.get(taskId);
      if (task) task.status = 'cancelled';
    }
    this.emit();
  }

  // ---- 导入素材 ----
  async importImage(file, options = {}) {
    const canvasId = this.activeCanvasId;
    const canvas = this.doc.canvases[canvasId];
    if (!canvas) throw new Error('画布未激活');
    if(options.canvasId && options.canvasId!==canvasId)throw new Error('目标画布已切换');
    const asset = await this.adapter.uploadImage(file);
    if (this.activeCanvasId !== canvasId) {
      this.setNotice('导入期间已切换画布，请在目标画布重新导入', 'error');
      return;
    }
    this.doc = { ...this.doc, assets: { ...this.doc.assets, [asset.id]: asset } };
    // 等比contain放入画布中心
    const target=options.targetRect||{x:0,y:0,width:canvas.width,height:canvas.height};
    const scale = Math.min(target.width / asset.width, target.height / asset.height, 1);
    const w = asset.width * scale;
    const h = asset.height * scale;
    const layer = {
      id: uuid(), kind: 'image', assetId: asset.id, name: file.name || '导入图片',
      visible: true, locked: false, opacity: 1,
      matrix: options.targetRect ? [target.width/asset.width,0,0,target.height/asset.height,target.x,target.y] : [scale, 0, 0, scale, target.x + (target.width - w) / 2, target.y + (target.height - h) / 2],
    };
    this.execute(makeCommand('addLayer', canvasId, canvas.revision, { layer }));
    this.select(layer.id);
    this.setNotice('图片已导入为新图层', 'success');
  }

  // ---- 导出 ----
  async exportLayer(layerId, bounds) {
    if (await this.save() === false) return false;
    const blob = await this.adapter.exportLayer({ layerId, bounds });
    downloadBlob(blob, `layer-${layerId}.png`);
    this.setNotice(bounds === 'canvas' ? '已按画布尺寸导出图层' : '已按内容边界导出图层（透明 PNG）', 'success');
  }

  async exportComposite() {
    if (await this.save() === false) return false;
    const canvasId = this.activeCanvasId;
    const blob = await this.adapter.exportComposite(canvasId);
    downloadBlob(blob, `composite-${canvasId}.png`);
    this.setNotice('已导出可见图层合成图（画布尺寸/白底）', 'success');
  }

  // ---- 工具 ----
  selectedLayers() {
    const canvas = this.doc.canvases[this.activeCanvasId];
    if (!canvas) return [];
    return canvas.layerIds.map((id) => this.doc.layers[id]).filter((l) => l && this.selection.has(l.id));
  }

  selectionBounds() {
    const layers = this.selectedLayers();
    if (!layers.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const layer of layers) {
      const asset = this.doc.assets[layer.assetId];
      if (!asset) continue;
      const b = transformBounds(layer.matrix, asset.width, asset.height);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  validateActiveCanvas() {
    const canvas = this.doc.canvases[this.activeCanvasId];
    if (!canvas) return false;
    const layers = canvas.layerIds.map((id) => this.doc.layers[id]).filter(Boolean);
    const assets = [...new Set(layers.map((l) => l.assetId))].map((id) => this.doc.assets[id]).filter(Boolean);
    return validateCanvasDocument({ canvas, layers, assets });
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
