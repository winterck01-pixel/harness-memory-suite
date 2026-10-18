// project-repository：项目/画布元数据、expectedRevision 原子保存、冲突处理。
// 契约 projectApi 的完整服务端实现；每项目一个 JSON 文件，保存 = tmp+rename 原子替换。
import { docError } from '../document-core/ids.js';
import { applyCommand, createStore, clone, validateEnvelope } from '../document-core/commands.js';
import { History } from '../document-core/history.js';
import { migrateDocument } from '../document-core/migration.js';

export function createProjectRepository({ storage, assets, now = () => Date.now() }) {
  // assets: { get(id)->Asset|null, list()->Asset[] } 由 asset-repository 提供（素材元数据唯一所有者）
  const projectFile = id => `projects/${id}.json`;
  const metaFile = id => `projects/${id}.meta.json`;
  const chains = new Map(); // 每项目串行化，进程内防竞态
  const serialize = (key, job) => { const prev = chains.get(key) || Promise.resolve(); const next = prev.then(job, job); chains.set(key, next.catch(() => {})); return next; };

  const loadProjectStore = async projectId => {
    const raw = await storage.read(projectFile(projectId));
    if (!raw) return null;
    const { doc } = migrateDocument(raw);
    const store = createStore();
    store.histories = raw.histories || {};
    store.generationReceipts = raw.generationReceipts || {};
    store.projects[doc.project.id] = doc.project;
    for (const canvas of Object.values(doc.canvases || {})) store.canvases[canvas.id] = canvas;
    for (const layer of Object.values(doc.layers || {})) store.layers[layer.id] = layer;
    for (const asset of (await assets?.list?.()) || []) store.assets[asset.id] = clone(asset);
    return store;
  };
  const saveProjectStore = async (projectId, store) => {
    await storage.write(projectFile(projectId), {
      schemaVersion: 1,
      project: store.projects[projectId],
      canvases: store.canvases,
      layers: store.layers,
      histories: store.histories || {},
      generationReceipts: store.generationReceipts || {},
    });
  };
  const findProjectOfCanvas = async canvasId => {
    for (const name of await storage.listNames('projects')) {
      if (!name.endsWith('.json') || name.endsWith('.meta.json')) continue;
      const raw = await storage.read(`projects/${name}`);
      if (raw?.canvases?.[canvasId]) return raw.project?.id;
    }
    return null;
  };

  const historyFor = (store, canvasId) => {
    const history = new History(store);
    const saved = store.histories?.[canvasId];
    if (saved) { history.undoStack = saved.undoStack || []; history.redoStack = saved.redoStack || []; history.bytes = saved.bytes || 0; }
    return history;
  };
  const saveHistory = (store, canvasId, history) => {
    store.histories ||= {};
    store.histories[canvasId] = { undoStack: history.undoStack, redoStack: history.redoStack, bytes: history.bytes };
  };
  const moveHistory = async (canvasId, expectedRevision, direction) => {
    const projectId = await findProjectOfCanvas(canvasId);
    if (!projectId) throw docError('CANVAS_NOT_FOUND', '画布不存在');
    return serialize(projectId, async () => {
      const store = await loadProjectStore(projectId);
      const canvas = store?.canvases[canvasId];
      if (!canvas) throw docError('CANVAS_NOT_FOUND', '画布不存在');
      if (canvas.revision !== expectedRevision) { const e = docError('REVISION_CONFLICT', '撤销/重做 revision 冲突'); e.currentRevision = canvas.revision; throw e; }
      const history = historyFor(store, canvasId);
      if (!history[direction]()) throw docError('VALIDATION_FAILED', direction === 'undo' ? '没有可撤销操作' : '没有可重做操作');
      saveHistory(history.store, canvasId, history);
      await saveProjectStore(projectId, history.store);
      return { canvas: history.store.canvases[canvasId], newRevision: history.store.canvases[canvasId].revision, events: [] };
    });
  };

  return {
    storage,
    async getGenerationReceipt(canvasId, candidateId) {
      const projectId = await findProjectOfCanvas(canvasId);
      if (!projectId) throw docError('CANVAS_NOT_FOUND', '画布不存在');
      const store = await loadProjectStore(projectId);
      const receipt = Object.hasOwn(store.generationReceipts, candidateId) ? store.generationReceipts[candidateId] : null;
      return receipt?.canvasId === canvasId ? clone(receipt) : null;
    },
    async undoCanvas(canvasId, { expectedRevision }) { return moveHistory(canvasId, expectedRevision, 'undo'); },
    async redoCanvas(canvasId, { expectedRevision }) { return moveHistory(canvasId, expectedRevision, 'redo'); },
    async listProjects() {
      const names = await storage.listNames('projects');
      const out = [];
      for (const name of names) {
        if (!name.endsWith('.json') || name.endsWith('.meta.json')) continue;
        const raw = await storage.read(`projects/${name}`);
        if (!raw?.project) continue;
        const canvases = Object.values(raw.canvases || {});
        let cover = null;
        const first = canvases.find(c => c.id === raw.project.canvasIds[0]) || canvases[0];
        if (first) for (const layerId of [...first.layerIds].reverse()) {
          const layer = (raw.layers || {})[layerId];
          if (layer?.visible) { const asset = await assets?.get(layer.assetId); if (asset?.previewUrl) { cover = asset.previewUrl; break; } }
        }
        out.push({ id: raw.project.id, name: raw.project.name, canvasCount: raw.project.canvasIds.length, updatedAt: raw.project.updatedAt, cover });
      }
      out.sort((a, b) => b.updatedAt - a.updatedAt);
      return out;
    },
    async createProject({ name, width, height }) {
      return serialize('create', async () => {
        const store = createStore();
        const r = applyCommand(store, { id: crypto.randomUUID(), type: 'createProject', canvasId: '', baseRevision: 0, payload: { name, width, height }, createdAt: now() });
        const project = r.store.projects[Object.keys(r.store.projects)[0]];
        await saveProjectStore(project.id, r.store);
        const canvas = r.store.canvases[project.canvasIds[0]];
        return { project, canvas };
      });
    },
    async renameProject(projectId, { name, expectedUpdatedAt }) {
      return serialize(projectId, async () => {
        const store = await loadProjectStore(projectId);
        if (!store) throw docError('PROJECT_NOT_FOUND', '项目不存在');
        if(expectedUpdatedAt!==undefined&&store.projects[projectId].updatedAt!==expectedUpdatedAt)throw docError('REVISION_CONFLICT','项目已变化');
        const r = applyCommand(store, { id: crypto.randomUUID(), type: 'renameProject', canvasId: '', baseRevision: 0, payload: { projectId, name }, createdAt: now() });
        await saveProjectStore(projectId, r.store);
        return { project: r.store.projects[projectId] };
      });
    },
    async openProject(projectId) {
      const store = await loadProjectStore(projectId);
      if (!store) throw docError('PROJECT_NOT_FOUND', '项目不存在');
      const project = store.projects[projectId];
      const meta = (await storage.read(metaFile(projectId))) || {};
      const canvasId = project.canvasIds.includes(meta.lastOpenCanvasId) ? meta.lastOpenCanvasId : project.canvasIds[0];
      const canvases = project.canvasIds.map(id => store.canvases[id]).filter(Boolean).map(c => ({ id: c.id, name: c.name, width: c.width, height: c.height, revision: c.revision, updatedAt: c.updatedAt }));
      return { project, canvasId, canvases };
    },
    async setLastOpenCanvas(projectId, canvasId) {
      const store = await loadProjectStore(projectId);
      if (!store?.projects[projectId]?.canvasIds.includes(canvasId)) throw docError('CANVAS_NOT_FOUND', '画布不属于该项目');
      await storage.write(metaFile(projectId), { lastOpenCanvasId: canvasId, updatedAt: now() });
      return { ok: true };
    },
    async listCanvases(projectId) {
      const store = await loadProjectStore(projectId);
      if (!store) throw docError('PROJECT_NOT_FOUND', '项目不存在');
      return store.projects[projectId].canvasIds.map(id => store.canvases[id]).filter(Boolean).map(c => ({ id: c.id, name: c.name, width: c.width, height: c.height, revision: c.revision }));
    },
    async createCanvas(projectId, { name, width, height }) {
      return serialize(projectId, async () => {
        const store = await loadProjectStore(projectId);
        if (!store) throw docError('PROJECT_NOT_FOUND', '项目不存在');
        const r = applyCommand(store, { id: crypto.randomUUID(), type: 'createCanvas', canvasId: '', baseRevision: 0, payload: { projectId, name, width, height }, createdAt: now() });
        await saveProjectStore(projectId, r.store);
        const canvasId = r.events.find(e => e.type === 'canvasCreated').canvasId;
        return { canvas: r.store.canvases[canvasId] };
      });
    },
    async getCanvas(canvasId) {
      const projectId = await findProjectOfCanvas(canvasId);
      if (!projectId) throw docError('CANVAS_NOT_FOUND', '画布不存在');
      const store = await loadProjectStore(projectId);
      const canvas = store?.canvases[canvasId];
      if (!canvas) throw docError('CANVAS_NOT_FOUND', '画布不存在');
      const layers = canvas.layerIds.map(id => store.layers[id]).filter(Boolean);
      const assets = [...new Set(layers.map(l => l.assetId))].map(id => store.assets[id]).filter(Boolean);
      return { canvas, layers, assets };
    },
    async submitCommands(canvasId, { expectedRevision, commands }) {
      const projectId = await findProjectOfCanvas(canvasId);
      if (!projectId) throw docError('CANVAS_NOT_FOUND', '画布不存在');
      return serialize(projectId, async () => {
        const store = await loadProjectStore(projectId);
        const canvas = store?.canvases[canvasId];
        if (!canvas) throw docError('CANVAS_NOT_FOUND', '画布不存在');
        if (!Array.isArray(commands) || commands.length === 0) throw docError('VALIDATION_FAILED', 'commands 不能为空');
        if (canvas.revision !== expectedRevision) {
          const e = docError('REVISION_CONFLICT', `expectedRevision ${expectedRevision} 与当前 revision ${canvas.revision} 不一致，未覆盖`);
          e.currentRevision = canvas.revision;
          throw e;
        }
        let current = store;
        const history = historyFor(store, canvasId);
        const events = [];
        for (const env of commands) {
          validateEnvelope(env);
          if (env.canvasId !== canvasId || ['createProject', 'renameProject', 'createCanvas', 'deleteCanvas'].includes(env.type)) throw docError('VALIDATION_FAILED', '命令不属于提交的画布或应使用项目接口');
          const r = applyCommand(current, env);
          current = r.store;
          if (!r.events.some(e => e.alreadyApplied)) history.record(r.entry);
          events.push(...r.events);
        }
        saveHistory(current, canvasId, history);
        await saveProjectStore(projectId, current);
        return { canvas: current.canvases[canvasId], newRevision: current.canvases[canvasId].revision, events };
      });
    },
    async renameCanvas(canvasId, { name, expectedRevision }) {
      const projectId = await findProjectOfCanvas(canvasId);
      if (!projectId) throw docError('CANVAS_NOT_FOUND', '画布不存在');
      return serialize(projectId, async () => {
        const store = await loadProjectStore(projectId);
        const canvas = store?.canvases[canvasId];
        if (!canvas) throw docError('CANVAS_NOT_FOUND', '画布不存在');
        if(expectedRevision!==undefined&&canvas.revision!==expectedRevision){const e=docError('REVISION_CONFLICT','画布已变化');e.currentRevision=canvas.revision;throw e;}
        const r = applyCommand(store, { id: crypto.randomUUID(), type: 'renameCanvas', canvasId, baseRevision: canvas.revision, payload: { name }, createdAt: now() });
        const history=historyFor(store,canvasId);history.record(r.entry);saveHistory(r.store,canvasId,history);
        await saveProjectStore(projectId, r.store);
        return { canvas: r.store.canvases[canvasId] };
      });
    },
    async deleteCanvas(canvasId, {expectedRevision}={}) {
      const projectId = await findProjectOfCanvas(canvasId);
      if (!projectId) throw docError('CANVAS_NOT_FOUND', '画布不存在');
      return serialize(projectId, async () => {
        const store = await loadProjectStore(projectId);
        const canvas = store?.canvases[canvasId];
        if (!canvas) throw docError('CANVAS_NOT_FOUND', '画布不存在');
        if(expectedRevision!==undefined&&canvas.revision!==expectedRevision){const e=docError('REVISION_CONFLICT','画布已变化');e.currentRevision=canvas.revision;throw e;}
        const r = applyCommand(store, { id: crypto.randomUUID(), type: 'deleteCanvas', canvasId, baseRevision: canvas.revision, payload: {}, createdAt: now() });
        await saveProjectStore(projectId, r.store);
        // 原图保守保留：项目/历史/候选引用尚未统一收集，不据删除画布降低回收保护。
        return { ok: true };
      });
    },
  };
}
