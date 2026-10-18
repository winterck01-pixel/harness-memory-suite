// 语义命令应用（契约 commandSchema 冻结 14 类命令）。纯数据、无供应商依赖。
// 撤销不存完整 ImageData：每条命令记录受影响实体的 before/after 快照，undo=恢复before。
// 撤销/重做都是新 revision（单调递增），一次拖动=一次 transformLayer=一次撤销。
import { docError, newId, isRefId } from './ids.js';
import { validateProject, validateCanvas, validateLayer, validateAsset } from './schema.js';
import { constrainMatrix, fromTRS } from './matrix.js';
import { LIMITS } from './limits.js';

export const COMMAND_TYPES = Object.freeze([
  'addLayer', 'removeLayer', 'reorderLayer', 'renameLayer', 'setLayerVisibility', 'setLayerLocked',
  'setLayerOpacity', 'transformLayer', 'applyGeneratedResult',
  'createProject', 'renameProject', 'createCanvas', 'renameCanvas', 'deleteCanvas',
]);
const CANVAS_SCOPED = new Set(['addLayer', 'removeLayer', 'reorderLayer', 'renameLayer', 'setLayerVisibility', 'setLayerLocked', 'setLayerOpacity', 'transformLayer', 'applyGeneratedResult', 'renameCanvas', 'deleteCanvas']);
export const LOCK_BLOCKED = new Set(['transformLayer', 'removeLayer', 'reorderLayer']); // 锁定禁止：移动/变换、删除、重排（重命名/可见性/透明度不在契约禁止清单）

export function createStore() { return { projects: {}, canvases: {}, layers: {}, assets: {} }; }
export function clone(v) { return JSON.parse(JSON.stringify(v)); }
export function validateEnvelope(env) {
  if (!env || typeof env !== 'object') throw docError('VALIDATION_FAILED', '命令封装无效');
  if (!isRefId(env.id)) throw docError('VALIDATION_FAILED', '命令ID无效');
  if (!COMMAND_TYPES.includes(env.type)) throw docError('VALIDATION_FAILED', `未知命令类型: ${env.type}（禁止静默丢弃）`);
  if (typeof env.canvasId !== 'string') throw docError('VALIDATION_FAILED', '命令画布ID无效');
  if (!Number.isInteger(env.baseRevision) || env.baseRevision < 0) throw docError('VALIDATION_FAILED', '命令 baseRevision 无效');
  if (!env.payload || typeof env.payload !== 'object') throw docError('VALIDATION_FAILED', '命令 payload 无效');
  if (!Number.isFinite(env.createdAt)) throw docError('VALIDATION_FAILED', '命令 createdAt 无效');
  return env;
}

function newResult(store, env) {
  return {
    store: clone(store),
    entry: { commandId: env.id, type: env.type, canvasId: env.canvasId || '', before: {}, after: {} },
    events: [],
    snapBefore(entity, bag) { this.entry.before[bag] = [...(this.entry.before[bag] || []), entity]; },
    snapAfter(entity, bag) { this.store[bag][entity.id] = entity; this.entry.after[bag] = [...(this.entry.after[bag] || []), entity]; },
    recordAfter(entity, bag) { this.entry.after[bag] = [...(this.entry.after[bag] || []), entity]; }, // 只记录快照，不写回 store（删除类命令用）
    dropAfter(id, bag) { delete this.store[bag][id]; },
  };
}

function applyCanvasCommand(store, env) {
  const canvasId = env.canvasId;
  const canvas = store.canvases[canvasId];
  if (!canvas) throw docError('CANVAS_NOT_FOUND', '画布不存在');
  if (env.baseRevision !== canvas.revision) throw docError('REVISION_CONFLICT', `baseRevision ${env.baseRevision} 与当前 revision ${canvas.revision} 不一致`);
  const p = env.payload;
  const next = newResult(store, env);
  next.snapBefore(canvas, 'canvases');
  const bumped = { ...clone(canvas), revision: canvas.revision + 1, updatedAt: Date.now() };
  const layerOf = id => { const l = store.layers[id]; if (!l) throw docError('LAYER_NOT_FOUND', '图层不存在'); return l; };
  const canvasOwns = id => bumped.layerIds.includes(id);

  switch (env.type) {
    case 'addLayer': {
      const layer = validateLayer({ ...p.layer, id: isRefId(p.layer?.id) ? p.layer.id : newId() });
      if (bumped.layerIds.length >= LIMITS.maxLayersPerCanvas) throw docError('RESOURCE_EXCEEDED', `图层数超过上限 ${LIMITS.maxLayersPerCanvas}`);
      if (store.layers[layer.id]) throw docError('VALIDATION_FAILED', '图层 ID 已存在');
      const asset = store.assets[layer.assetId];
      if (!asset) throw docError('ASSET_NOT_FOUND', '图层引用的素材不存在');
      const finalLayer = { ...layer, matrix: constrainMatrix(layer.matrix, asset.width, asset.height, canvas.width, canvas.height) };
      const index = p.index === undefined ? bumped.layerIds.length : p.index;
      if (!Number.isInteger(index) || index < 0 || index > bumped.layerIds.length) throw docError('VALIDATION_FAILED', '图层插入位置无效');
      bumped.layerIds = [...bumped.layerIds];
      bumped.layerIds.splice(index, 0, finalLayer.id);
      next.store.canvases[canvasId] = bumped;
      next.snapAfter(bumped, 'canvases');
      next.snapAfter(finalLayer, 'layers');
      next.events.push({ type: 'layerAdded', canvasId, layerId: finalLayer.id, assetId: finalLayer.assetId });
      return next;
    }
    case 'removeLayer': {
      const layer = layerOf(p.layerId);
      if (layer.locked) throw docError('VALIDATION_FAILED', '锁定图层不能删除');
      if (!canvasOwns(p.layerId)) throw docError('LAYER_NOT_FOUND', '图层不属于该画布');
      next.snapBefore(layer, 'layers');
      bumped.layerIds = bumped.layerIds.filter(id => id !== p.layerId);
      next.store.canvases[canvasId] = bumped;
      next.dropAfter(p.layerId, 'layers');
      next.snapAfter(bumped, 'canvases');
      next.events.push({ type: 'layerRemoved', canvasId, layerId: p.layerId, assetId: layer.assetId });
      return next;
    }
    case 'reorderLayer': {
      const layer = layerOf(p.layerId);
      if (layer.locked) throw docError('VALIDATION_FAILED', '锁定图层不能重排');
      const from = bumped.layerIds.indexOf(p.layerId);
      if (from < 0) throw docError('LAYER_NOT_FOUND', '图层不属于该画布');
      const to = Number.isInteger(p.toIndex) ? Math.max(0, Math.min(p.toIndex, bumped.layerIds.length - 1)) : from;
      const ids = [...bumped.layerIds];
      ids.splice(from, 1); ids.splice(to, 0, p.layerId);
      bumped.layerIds = ids;
      next.store.canvases[canvasId] = bumped;
      next.snapAfter(bumped, 'canvases');
      next.events.push({ type: 'layersReordered', canvasId, layerId: p.layerId, toIndex: to });
      return next;
    }
    case 'renameLayer': {
      const layer = layerOf(p.layerId);
      if (!canvasOwns(p.layerId)) throw docError('LAYER_NOT_FOUND', '图层不属于该画布');
      if (typeof p.name !== 'string' || p.name.length < 1 || p.name.length > LIMITS.nameMaxChars) throw docError('VALIDATION_FAILED', `图层名称需为 1..${LIMITS.nameMaxChars} 个字符`);
      next.snapBefore(layer, 'layers');
      const updated = { ...clone(layer), name: p.name };
      next.store.layers[p.layerId] = updated;
      next.store.canvases[canvasId] = bumped;
      next.snapAfter(updated, 'layers');
      next.snapAfter(bumped, 'canvases');
      next.events.push({ type: 'layerRenamed', canvasId, layerId: p.layerId });
      return next;
    }
    case 'setLayerVisibility': {
      const layer = layerOf(p.layerId);
      if (!canvasOwns(p.layerId)) throw docError('LAYER_NOT_FOUND', '图层不属于该画布');
      if (typeof p.visible !== 'boolean') throw docError('VALIDATION_FAILED', '可见性必须为布尔值');
      next.snapBefore(layer, 'layers');
      const updated = { ...clone(layer), visible: p.visible };
      next.store.layers[p.layerId] = updated;
      next.store.canvases[canvasId] = bumped;
      next.snapAfter(updated, 'layers'); next.snapAfter(bumped, 'canvases');
      next.events.push({ type: 'layerVisibilityChanged', canvasId, layerId: p.layerId, visible: p.visible });
      return next;
    }
    case 'setLayerLocked': {
      const layer = layerOf(p.layerId);
      if (!canvasOwns(p.layerId)) throw docError('LAYER_NOT_FOUND', '图层不属于该画布');
      if (typeof p.locked !== 'boolean') throw docError('VALIDATION_FAILED', '锁定必须为布尔值');
      next.snapBefore(layer, 'layers');
      const updated = { ...clone(layer), locked: p.locked };
      next.store.layers[p.layerId] = updated;
      next.store.canvases[canvasId] = bumped;
      next.snapAfter(updated, 'layers'); next.snapAfter(bumped, 'canvases');
      next.events.push({ type: 'layerLockedChanged', canvasId, layerId: p.layerId, locked: p.locked });
      return next;
    }
    case 'setLayerOpacity': {
      const layer = layerOf(p.layerId);
      if (!canvasOwns(p.layerId)) throw docError('LAYER_NOT_FOUND', '图层不属于该画布');
      if (typeof p.opacity !== 'number' || !Number.isFinite(p.opacity) || p.opacity < 0 || p.opacity > 1) throw docError('VALIDATION_FAILED', '透明度必须在 0..1');
      next.snapBefore(layer, 'layers');
      const updated = { ...clone(layer), opacity: p.opacity };
      next.store.layers[p.layerId] = updated;
      next.store.canvases[canvasId] = bumped;
      next.snapAfter(updated, 'layers'); next.snapAfter(bumped, 'canvases');
      next.events.push({ type: 'layerOpacityChanged', canvasId, layerId: p.layerId, opacity: p.opacity });
      return next;
    }
    case 'transformLayer': {
      const layer = layerOf(p.layerId);
      if (layer.locked) throw docError('VALIDATION_FAILED', '锁定图层不能移动/变换');
      if (!canvasOwns(p.layerId)) throw docError('LAYER_NOT_FOUND', '图层不属于该画布');
      const asset = store.assets[layer.assetId];
      if (!asset) throw docError('ASSET_NOT_FOUND', '图层引用的素材不存在');
      next.snapBefore(layer, 'layers');
      const updated = { ...clone(layer), matrix: constrainMatrix(p.matrix, asset.width, asset.height, canvas.width, canvas.height) };
      next.store.layers[p.layerId] = updated;
      next.store.canvases[canvasId] = bumped;
      next.snapAfter(updated, 'layers'); next.snapAfter(bumped, 'canvases');
      next.events.push({ type: 'layerTransformed', canvasId, layerId: p.layerId });
      return next;
    }
    case 'applyGeneratedResult': {
      const candidateId = p.candidateId;
      const receipt = candidateId && Object.hasOwn(store.generationReceipts || {}, candidateId) ? store.generationReceipts[candidateId] : null;
      if (receipt) {
        if (receipt.canvasId !== canvasId || receipt.assetId !== p.asset?.id || receipt.assetHash !== p.asset?.hash) throw docError('VALIDATION_FAILED', '生成候选收据与请求不符');
        const repeated = newResult(store, env);
        repeated.events.push({ type: 'layerAdded', canvasId, layerId: receipt.layerId, assetId: receipt.assetId, fromGeneration: true, alreadyApplied: true });
        return repeated;
      }
      if (candidateId !== undefined && !isRefId(candidateId)) throw docError('VALIDATION_FAILED', '候选ID无效');
      if (bumped.layerIds.length >= LIMITS.maxLayersPerCanvas) throw docError('RESOURCE_EXCEEDED', `图层数超过上限 ${LIMITS.maxLayersPerCanvas}`);
      const asset = validateAsset(p.asset);
      const rect = p.targetRect;
      if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !(rect.width > 0) || !(rect.height > 0)) throw docError('VALIDATION_FAILED', '生成结果落点无效');
      const raw = fromTRS({ translateX: rect.x, translateY: rect.y, scaleX: rect.width / asset.width, scaleY: rect.height / asset.height });
      const layer = validateLayer({
        id: isRefId(p.layerId) ? p.layerId : newId(), kind: 'image', assetId: asset.id,
        name: typeof p.name === 'string' && p.name ? p.name.slice(0, LIMITS.nameMaxChars) : '生成结果',
        visible: true, locked: false, opacity: 1,
        matrix: constrainMatrix(raw, asset.width, asset.height, canvas.width, canvas.height),
      });
      if (store.layers[layer.id]) throw docError('VALIDATION_FAILED', '生成图层ID已存在');
      if (candidateId) {
        next.store.generationReceipts ||= {};
        next.store.generationReceipts[candidateId] = { candidateId, canvasId, layerId: layer.id, assetId: asset.id, assetHash: asset.hash, commandId: env.id, appliedAt: env.createdAt };
      }
      if (!store.assets[asset.id]) { next.store.assets[asset.id] = clone(asset); next.snapAfter(clone(asset), 'assets'); }
      bumped.layerIds = [...bumped.layerIds, layer.id];
      next.store.canvases[canvasId] = bumped;
      next.snapAfter(bumped, 'canvases');
      next.snapAfter(layer, 'layers');
      next.events.push({ type: 'layerAdded', canvasId, layerId: layer.id, assetId: asset.id, fromGeneration: true });
      return next;
    }
    case 'renameCanvas': {
      if (typeof p.name !== 'string' || p.name.length < 1 || p.name.length > LIMITS.nameMaxChars) throw docError('VALIDATION_FAILED', `画布名称需为 1..${LIMITS.nameMaxChars} 个字符`);
      bumped.name = p.name;
      next.store.canvases[canvasId] = bumped;
      next.snapAfter(bumped, 'canvases');
      next.events.push({ type: 'canvasRenamed', canvasId });
      return next;
    }
    case 'deleteCanvas': {
      for (const id of bumped.layerIds) {
        const l = store.layers[id];
        if (l) { next.snapBefore(l, 'layers'); next.dropAfter(id, 'layers'); next.events.push({ type: 'layerRemoved', canvasId, layerId: id, assetId: l.assetId }); }
      }
      next.dropAfter(canvasId, 'canvases');
      // 删除类命令：after 不记录被删实体，redo 时按 before-only 规则重新删除
      for (const project of Object.values(store.projects)) {
        if (project.canvasIds.includes(canvasId)) {
          const updated = { ...clone(project), canvasIds: project.canvasIds.filter(id => id !== canvasId), updatedAt: Date.now() };
          next.snapBefore(project, 'projects');
          next.store.projects[project.id] = updated;
          next.snapAfter(updated, 'projects');
        }
      }
      next.events.push({ type: 'canvasDeleted', canvasId, projectId: canvas.projectId });
      return next;
    }
    default:
      throw docError('VALIDATION_FAILED', `画布级命令未实现: ${env.type}`);
  }
}

function applyProjectCommand(store, env) {
  const p = env.payload;
  const next = newResult(store, env);
  switch (env.type) {
    case 'createProject': {
      const w = p.width, h = p.height;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || w > LIMITS.maxCanvasWidth || h < 1 || h > LIMITS.maxCanvasHeight || w * h > LIMITS.maxCanvasPixels) throw docError('RESOURCE_EXCEEDED', `项目画布尺寸 ${w}x${h} 超出契约上限`);
      if (typeof p.name !== 'string' || p.name.length < 1 || p.name.length > LIMITS.nameMaxChars) throw docError('VALIDATION_FAILED', `项目名称需为 1..${LIMITS.nameMaxChars} 个字符`);
      const now = Date.now();
      const canvasId = isRefId(p.canvasId) ? p.canvasId : newId();
      const project = validateProject({ id: isRefId(p.projectId) ? p.projectId : newId(), name: p.name, canvasIds: [canvasId], createdAt: now, updatedAt: now });
      const canvas = validateCanvas({ id: canvasId, projectId: project.id, name: typeof p.canvasName === 'string' && p.canvasName ? p.canvasName.slice(0, LIMITS.nameMaxChars) : '画布 1', schemaVersion: 1, revision: 0, width: w, height: h, background: '#ffffff', layerIds: [], createdAt: now, updatedAt: now });
      next.snapAfter(project, 'projects');
      next.snapAfter(canvas, 'canvases');
      next.events.push({ type: 'projectCreated', projectId: project.id, canvasId });
      return next;
    }
    case 'renameProject': {
      const project = store.projects[p.projectId];
      if (!project) throw docError('PROJECT_NOT_FOUND', '项目不存在');
      if (typeof p.name !== 'string' || p.name.length < 1 || p.name.length > LIMITS.nameMaxChars) throw docError('VALIDATION_FAILED', `项目名称需为 1..${LIMITS.nameMaxChars} 个字符`);
      next.snapBefore(project, 'projects');
      const updated = { ...clone(project), name: p.name, updatedAt: Date.now() };
      next.store.projects[project.id] = updated;
      next.snapAfter(updated, 'projects');
      next.events.push({ type: 'projectRenamed', projectId: project.id });
      return next;
    }
    case 'createCanvas': {
      const project = store.projects[p.projectId];
      if (!project) throw docError('PROJECT_NOT_FOUND', '项目不存在');
      const w = p.width, h = p.height;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || w > LIMITS.maxCanvasWidth || h < 1 || h > LIMITS.maxCanvasHeight || w * h > LIMITS.maxCanvasPixels) throw docError('RESOURCE_EXCEEDED', `画布尺寸 ${w}x${h} 超出契约上限`);
      const now = Date.now();
      const canvas = validateCanvas({ id: isRefId(p.canvasId) ? p.canvasId : newId(), projectId: project.id, name: typeof p.name === 'string' && p.name ? p.name.slice(0, LIMITS.nameMaxChars) : `画布 ${project.canvasIds.length + 1}`, schemaVersion: 1, revision: 0, width: w, height: h, background: '#ffffff', layerIds: [], createdAt: now, updatedAt: now });
      next.snapBefore(project, 'projects');
      const updatedProject = { ...clone(project), canvasIds: [...project.canvasIds, canvas.id], updatedAt: now };
      next.store.projects[project.id] = updatedProject;
      next.snapAfter(updatedProject, 'projects');
      next.snapAfter(canvas, 'canvases');
      next.events.push({ type: 'canvasCreated', projectId: project.id, canvasId: canvas.id });
      return next;
    }
    default:
      throw docError('VALIDATION_FAILED', `项目级命令未实现: ${env.type}`);
  }
}

export function applyCommand(store, env) {
  validateEnvelope(env);
  return CANVAS_SCOPED.has(env.type) ? applyCanvasCommand(store, env) : applyProjectCommand(store, env);
}
