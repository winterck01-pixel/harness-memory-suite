// 语义命令 reducer（契约 commandSchema）。
// 撤销/重做以语义命令存储，不存完整 ImageData；一次拖动 = 一次撤销；撤销也是新 revision。
// 文档状态为规范化结构：{ projects, canvases, layers, assets }（均为 id -> entity 映射）。

import { uuid, now } from './id.js';
import { validateCommandEnvelope, validateCanvas, validateLayer, ContractError } from './schema.js';
import { sanitize } from './matrix.js';

// 仅供本地历史使用的内部反向命令类型（不属于契约 commandTypes，也绝不提交到 /canvases/:id API）
const INTERNAL_TYPES = new Set(['deleteProject']);

export function emptyDocument() {
  return { projects: {}, canvases: {}, layers: {}, assets: {} };
}

function clone(state) {
  return {
    projects: { ...state.projects },
    canvases: { ...state.canvases },
    layers: { ...state.layers },
    assets: { ...state.assets },
  };
}

function touchCanvas(canvas) {
  return { ...canvas, revision: canvas.revision + 1, updatedAt: now() };
}

function touchProject(project) {
  return { ...project, updatedAt: now() };
}

function requireLayer(state, layerId) {
  const layer = state.layers[layerId];
  if (!layer) throw new ContractError('LAYER_NOT_FOUND', `图层不存在: ${layerId}`);
  return layer;
}

function requireCanvas(state, canvasId) {
  const canvas = state.canvases[canvasId];
  if (!canvas) throw new ContractError('CANVAS_NOT_FOUND', `画布不存在: ${canvasId}`);
  return canvas;
}

function moveLayer(canvas, layerId, toIndex) {
  const from = canvas.layerIds.indexOf(layerId);
  if (from < 0) throw new ContractError('LAYER_NOT_FOUND', `画布中不存在图层 ${layerId}`);
  const next = [...canvas.layerIds];
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, layerId);
  return next;
}

/**
 * 应用一条命令。返回 { state, inverse }。
 * inverse 是可用于撤销的反向命令信封（内部 deleteProject 除外，仅本地历史使用）。
 * baseRevision 不匹配抛 REVISION_CONFLICT（调用方转换为 409，不覆盖）。
 */
export function applyCommand(state, command) {
  validateCommandEnvelope(command, { allowInternal: INTERNAL_TYPES.has(command.type) });
  const { type, canvasId, baseRevision, payload } = command;
  const next = clone(state);
  let inverse;

  const checkRevision = () => {
    const canvas = requireCanvas(next, canvasId);
    if (canvas.revision !== baseRevision) {
      throw new ContractError('REVISION_CONFLICT', `revision 冲突: 期望 ${baseRevision}，当前 ${canvas.revision}`);
    }
    return canvas;
  };

  switch (type) {
    case 'addLayer':
    case 'applyGeneratedResult': {
      const canvas = checkRevision();
      const layer = payload.layer;
      validateLayer(layer);
      if (next.layers[layer.id]) throw new ContractError('VALIDATION_FAILED', `图层 id 重复: ${layer.id}`);
      if (!next.assets[layer.assetId]) throw new ContractError('ASSET_NOT_FOUND', `素材不存在: ${layer.assetId}`);
      const index = typeof payload.index === 'number' ? payload.index : canvas.layerIds.length;
      const layerIds = [...canvas.layerIds];
      layerIds.splice(Math.max(0, Math.min(index, layerIds.length)), 0, layer.id);
      next.layers = { ...next.layers, [layer.id]: layer };
      next.canvases = { ...next.canvases, [canvasId]: touchCanvas({ ...canvas, layerIds }) };
      inverse = envelope({ type: 'removeLayer', canvasId, baseRevision: next.canvases[canvasId].revision, payload: { layerId: layer.id, index } });
      break;
    }
    case 'removeLayer': {
      const canvas = checkRevision();
      const index = canvas.layerIds.indexOf(payload.layerId);
      if (index < 0) throw new ContractError('LAYER_NOT_FOUND', `画布中不存在图层 ${payload.layerId}`);
      const layer = requireLayer(next, payload.layerId);
      const layerIds = canvas.layerIds.filter((id) => id !== payload.layerId);
      const layers = { ...next.layers };
      delete layers[layer.id];
      next.layers = layers;
      next.canvases = { ...next.canvases, [canvasId]: touchCanvas({ ...canvas, layerIds }) };
      inverse = envelope({ type: 'addLayer', canvasId, baseRevision: next.canvases[canvasId].revision, payload: { layer, index } });
      break;
    }
    case 'reorderLayer': {
      const canvas = checkRevision();
      const from = canvas.layerIds.indexOf(payload.layerId);
      if (from < 0) throw new ContractError('LAYER_NOT_FOUND', `画布中不存在图层 ${payload.layerId}`);
      const layerIds = moveLayer(canvas, payload.layerId, payload.toIndex);
      next.canvases = { ...next.canvases, [canvasId]: touchCanvas({ ...canvas, layerIds }) };
      inverse = envelope({ type: 'reorderLayer', canvasId, baseRevision: next.canvases[canvasId].revision, payload: { layerId: payload.layerId, toIndex: from } });
      break;
    }
    case 'renameLayer': {
      const canvas = checkRevision();
      const layer = requireLayer(next, payload.layerId);
      next.layers = { ...next.layers, [layer.id]: { ...layer, name: payload.name } };
      next.canvases = { ...next.canvases, [canvasId]: touchCanvas(canvas) };
      inverse = envelope({ type: 'renameLayer', canvasId, baseRevision: next.canvases[canvasId].revision, payload: { layerId: layer.id, name: layer.name } });
      break;
    }
    case 'setLayerVisibility': {
      const canvas = checkRevision();
      const layer = requireLayer(next, payload.layerId);
      if (layer.locked && payload.visible === false) {
        // 锁定仅禁止编辑类操作；可见性属于输出语义，锁定层允许切换可见性（列表操作）
      }
      next.layers = { ...next.layers, [layer.id]: { ...layer, visible: payload.visible } };
      next.canvases = { ...next.canvases, [canvasId]: touchCanvas(canvas) };
      inverse = envelope({ type: 'setLayerVisibility', canvasId, baseRevision: next.canvases[canvasId].revision, payload: { layerId: layer.id, visible: layer.visible } });
      break;
    }
    case 'setLayerLocked': {
      const canvas = checkRevision();
      const layer = requireLayer(next, payload.layerId);
      next.layers = { ...next.layers, [layer.id]: { ...layer, locked: payload.locked } };
      next.canvases = { ...next.canvases, [canvasId]: touchCanvas(canvas) };
      inverse = envelope({ type: 'setLayerLocked', canvasId, baseRevision: next.canvases[canvasId].revision, payload: { layerId: layer.id, locked: layer.locked } });
      break;
    }
    case 'setLayerOpacity': {
      const canvas = checkRevision();
      const layer = requireLayer(next, payload.layerId);
      next.layers = { ...next.layers, [layer.id]: { ...layer, opacity: payload.opacity } };
      next.canvases = { ...next.canvases, [canvasId]: touchCanvas(canvas) };
      inverse = envelope({ type: 'setLayerOpacity', canvasId, baseRevision: next.canvases[canvasId].revision, payload: { layerId: layer.id, opacity: layer.opacity } });
      break;
    }
    case 'transformLayer': {
      const canvas = checkRevision();
      const layer = requireLayer(next, payload.layerId);
      const matrix = sanitize(payload.matrix);
      if (!matrix) throw new ContractError('VALIDATION_FAILED', '变换矩阵必须有限且可逆');
      next.layers = { ...next.layers, [layer.id]: { ...layer, matrix } };
      next.canvases = { ...next.canvases, [canvasId]: touchCanvas(canvas) };
      inverse = envelope({ type: 'transformLayer', canvasId, baseRevision: next.canvases[canvasId].revision, payload: { layerId: layer.id, matrix: layer.matrix } });
      break;
    }
    case 'createCanvas': {
      const canvas = payload.canvas;
      validateCanvas(canvas);
      if (next.canvases[canvas.id]) throw new ContractError('VALIDATION_FAILED', `画布 id 重复: ${canvas.id}`);
      const project = next.projects[canvas.projectId];
      if (!project) throw new ContractError('PROJECT_NOT_FOUND', `项目不存在: ${canvas.projectId}`);
      next.canvases = { ...next.canvases, [canvas.id]: canvas };
      next.projects = { ...next.projects, [project.id]: touchProject({ ...project, canvasIds: [...project.canvasIds, canvas.id] }) };
      inverse = envelope({ type: 'deleteCanvas', canvasId: canvas.id, baseRevision: 0, payload: { canvasId: canvas.id } });
      break;
    }
    case 'renameCanvas': {
      const canvas = checkRevision();
      next.canvases = { ...next.canvases, [canvasId]: touchCanvas({ ...canvas, name: payload.name }) };
      inverse = envelope({ type: 'renameCanvas', canvasId, baseRevision: next.canvases[canvasId].revision, payload: { name: canvas.name } });
      break;
    }
    case 'deleteCanvas': {
      const canvas = requireCanvas(next, canvasId);
      const project = next.projects[canvas.projectId];
      const canvases = { ...next.canvases };
      delete canvases[canvasId];
      const layers = { ...next.layers };
      for (const id of canvas.layerIds) delete layers[id];
      next.canvases = canvases;
      next.layers = layers;
      if (project) {
        next.projects = {
          ...next.projects,
          [project.id]: touchProject({ ...project, canvasIds: project.canvasIds.filter((id) => id !== canvasId) }),
        };
      }
      inverse = envelope({ type: 'createCanvas', canvasId, baseRevision: 0, payload: { canvas } });
      break;
    }
    case 'createProject': {
      const { project, canvas } = payload;
      validateCanvas(canvas);
      if (next.projects[project.id]) throw new ContractError('VALIDATION_FAILED', `项目 id 重复: ${project.id}`);
      next.projects = { ...next.projects, [project.id]: project };
      next.canvases = { ...next.canvases, [canvas.id]: canvas };
      inverse = envelope({ type: 'deleteProject', canvasId: canvas.id, baseRevision: 0, payload: { projectId: project.id } }, { internal: true });
      break;
    }
    case 'renameProject': {
      const project = next.projects[payload.projectId];
      if (!project) throw new ContractError('PROJECT_NOT_FOUND', `项目不存在: ${payload.projectId}`);
      next.projects = { ...next.projects, [project.id]: touchProject({ ...project, name: payload.name }) };
      inverse = envelope({ type: 'renameProject', canvasId, baseRevision: 0, payload: { projectId: project.id, name: project.name } });
      break;
    }
    case 'deleteProject': {
      // 内部反向命令（仅本地历史）：删除项目及其全部画布/图层引用
      const project = next.projects[payload.projectId];
      if (!project) throw new ContractError('PROJECT_NOT_FOUND', `项目不存在: ${payload.projectId}`);
      const canvases = { ...next.canvases };
      const layers = { ...next.layers };
      for (const cid of project.canvasIds) {
        const c = canvases[cid];
        if (c) for (const lid of c.layerIds) delete layers[lid];
        delete canvases[cid];
      }
      next.canvases = canvases;
      next.layers = layers;
      next.projects = { ...next.projects };
      delete next.projects[project.id];
      inverse = null; // 顶层操作的再反向由 createProject 重建（历史只保留一级反向）
      break;
    }
    default:
      throw new ContractError('VALIDATION_FAILED', `未实现的命令类型 ${type}`);
  }

  return { state: next, inverse };
}

export function envelope(cmd, { internal = false } = {}) {
  return {
    id: uuid(),
    type: cmd.type,
    canvasId: cmd.canvasId,
    baseRevision: cmd.baseRevision,
    payload: cmd.payload,
    createdAt: now(),
    ...(internal ? { internal: true } : {}),
  };
}

export function makeCommand(type, canvasId, baseRevision, payload) {
  return envelope({ type, canvasId, baseRevision, payload });
}
