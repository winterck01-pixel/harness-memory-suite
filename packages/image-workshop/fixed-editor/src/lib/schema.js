// 契约 schema 校验（contract.json documentSchema / commandSchema / renderPlan）。
// UI 在提交命令、渲染、交接前用同一组校验，保证与 core 对同一份 schema 的理解一致。

import { isInvertible, isMatrix } from './matrix.js';

export class ContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ContractError(code, message);
}

function isString(v, min, max) {
  return typeof v === 'string' && v.length >= min && v.length <= max;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateMatrix(m, where = 'matrix') {
  if (!isMatrix(m)) fail('VALIDATION_FAILED', `${where} 必须是 6 个有限数字`);
  if (!isInvertible(m)) fail('VALIDATION_FAILED', `${where} 必须可逆（det != 0）`);
  return m;
}

export function validateProject(p) {
  if (!p || typeof p !== 'object') fail('VALIDATION_FAILED', 'Project 缺失');
  if (!UUID_V4.test(p.id || '')) fail('VALIDATION_FAILED', 'Project.id 必须是 uuid v4');
  if (!isString(p.name, 1, 120)) fail('VALIDATION_FAILED', 'Project.name 长度 1..120');
  if (!Array.isArray(p.canvasIds)) fail('VALIDATION_FAILED', 'Project.canvasIds 必须为数组');
  if (!Number.isFinite(p.createdAt) || !Number.isFinite(p.updatedAt)) fail('VALIDATION_FAILED', 'Project 时间戳必须为 epoch ms');
  return p;
}

export function validateCanvas(c) {
  if (!c || typeof c !== 'object') fail('VALIDATION_FAILED', 'Canvas 缺失');
  if (!UUID_V4.test(c.id || '')) fail('VALIDATION_FAILED', 'Canvas.id 必须是 uuid v4');
  if (!isString(c.projectId, 1, 200)) fail('VALIDATION_FAILED', 'Canvas.projectId 缺失');
  if (!isString(c.name, 1, 120)) fail('VALIDATION_FAILED', 'Canvas.name 长度 1..120');
  if (c.schemaVersion !== 1) fail('VALIDATION_FAILED', 'Canvas.schemaVersion 必须为 1');
  if (!Number.isInteger(c.revision) || c.revision < 0) fail('VALIDATION_FAILED', 'Canvas.revision 必须为非负整数');
  if (!Number.isInteger(c.width) || c.width < 1 || c.width > 4096) fail('VALIDATION_FAILED', 'Canvas.width 必须为 1..4096 整数');
  if (!Number.isInteger(c.height) || c.height < 1 || c.height > 4096) fail('VALIDATION_FAILED', 'Canvas.height 必须为 1..4096 整数');
  if (c.width * c.height > 8388608) fail('RESOURCE_EXCEEDED', 'Canvas 像素总数超过契约上限 8388608');
  if (c.background !== '#ffffff') fail('VALIDATION_FAILED', 'Canvas.background 固定 #ffffff');
  if (!Array.isArray(c.layerIds) || c.layerIds.length > 64) fail('VALIDATION_FAILED', 'Canvas.layerIds 必须为数组且不超过 64 层');
  for (const id of c.layerIds) if (!UUID_V4.test(id)) fail('VALIDATION_FAILED', 'Canvas.layerIds 元素必须是 uuid v4');
  return c;
}

export function validateLayer(l) {
  if (!l || typeof l !== 'object') fail('VALIDATION_FAILED', 'Layer 缺失');
  if (!UUID_V4.test(l.id || '')) fail('VALIDATION_FAILED', 'Layer.id 必须是 uuid v4');
  if (l.kind !== 'image') fail('VALIDATION_FAILED', "Layer.kind 固定 'image'");
  if (!isString(l.assetId, 1, 200)) fail('VALIDATION_FAILED', 'Layer.assetId 缺失');
  if (!isString(l.name, 1, 120)) fail('VALIDATION_FAILED', 'Layer.name 长度 1..120');
  if (typeof l.visible !== 'boolean') fail('VALIDATION_FAILED', 'Layer.visible 必须为布尔');
  if (typeof l.locked !== 'boolean') fail('VALIDATION_FAILED', 'Layer.locked 必须为布尔');
  if (typeof l.opacity !== 'number' || !(l.opacity >= 0 && l.opacity <= 1)) fail('VALIDATION_FAILED', 'Layer.opacity 必须为 0..1');
  validateMatrix(l.matrix, 'Layer.matrix');
  return l;
}

export function validateAsset(a) {
  if (!a || typeof a !== 'object') fail('VALIDATION_FAILED', 'Asset 缺失');
  if (!UUID_V4.test(a.id || '')) fail('VALIDATION_FAILED', 'Asset.id 必须是 uuid v4');
  if (!/^[0-9a-f]{64}$/.test(a.hash || '')) fail('VALIDATION_FAILED', 'Asset.hash 必须为 sha256 hex');
  if (!Number.isInteger(a.width) || a.width < 1) fail('VALIDATION_FAILED', 'Asset.width 必须为正整数');
  if (!Number.isInteger(a.height) || a.height < 1) fail('VALIDATION_FAILED', 'Asset.height 必须为正整数');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(a.format)) fail('VALIDATION_FAILED', 'Asset.format 仅支持 png/jpeg/webp');
  if (!Number.isInteger(a.byteSize) || a.byteSize < 0) fail('VALIDATION_FAILED', 'Asset.byteSize 必须为非负整数');
  if (!isString(a.previewUrl, 1, 2048)) fail('VALIDATION_FAILED', 'Asset.previewUrl 缺失');
  if (!Number.isInteger(a.refCount) || a.refCount < 0) fail('VALIDATION_FAILED', 'Asset.refCount 必须为非负整数');
  return a;
}

const COMMAND_TYPES = new Set([
  'addLayer', 'removeLayer', 'reorderLayer', 'renameLayer', 'setLayerVisibility',
  'setLayerLocked', 'setLayerOpacity', 'transformLayer', 'applyGeneratedResult',
  'createProject', 'renameProject', 'createCanvas', 'renameCanvas', 'deleteCanvas',
]);

// 仅本地历史使用的内部反向命令（绝不提交到 /canvases/:id API）
const INTERNAL_COMMAND_TYPES = new Set(['deleteProject']);

export function validateCommandEnvelope(cmd, { allowInternal = false } = {}) {
  if (!cmd || typeof cmd !== 'object') fail('VALIDATION_FAILED', '命令缺失');
  if (!isString(cmd.id, 1, 200)) fail('VALIDATION_FAILED', '命令 id 缺失');
  const allowed = allowInternal ? new Set([...COMMAND_TYPES, ...INTERNAL_COMMAND_TYPES]) : COMMAND_TYPES;
  if (!allowed.has(cmd.type)) fail('VALIDATION_FAILED', `未知命令类型 ${cmd.type}`);
  if (!isString(cmd.canvasId, 1, 200)) fail('VALIDATION_FAILED', '命令 canvasId 缺失');
  if (!Number.isInteger(cmd.baseRevision) || cmd.baseRevision < 0) fail('VALIDATION_FAILED', '命令 baseRevision 必须为非负整数');
  if (!cmd.payload || typeof cmd.payload !== 'object' || Array.isArray(cmd.payload)) fail('VALIDATION_FAILED', '命令 payload 必须为对象');
  if (!Number.isFinite(cmd.createdAt)) fail('VALIDATION_FAILED', '命令 createdAt 必须为 epoch ms');
  return cmd;
}

export function validateRenderPlan(plan) {
  if (!plan || typeof plan !== 'object') fail('VALIDATION_FAILED', 'RenderPlan 缺失');
  if (!isString(plan.canvasId, 1, 200)) fail('VALIDATION_FAILED', 'RenderPlan.canvasId 缺失');
  if (!Number.isInteger(plan.width) || !Number.isInteger(plan.height)) fail('VALIDATION_FAILED', 'RenderPlan 宽高必须为整数');
  if (plan.background !== '#ffffff') fail('VALIDATION_FAILED', 'RenderPlan.background 固定 #ffffff');
  if (!Array.isArray(plan.items)) fail('VALIDATION_FAILED', 'RenderPlan.items 必须为数组');
  for (const item of plan.items) {
    if (!isString(item.layerId, 1, 200)) fail('VALIDATION_FAILED', 'RenderItem.layerId 缺失');
    if (!isString(item.assetId, 1, 200)) fail('VALIDATION_FAILED', 'RenderItem.assetId 缺失');
    if (typeof item.visible !== 'boolean' || typeof item.locked !== 'boolean') fail('VALIDATION_FAILED', 'RenderItem visible/locked 必须为布尔');
    if (typeof item.opacity !== 'number' || !(item.opacity >= 0 && item.opacity <= 1)) fail('VALIDATION_FAILED', 'RenderItem.opacity 必须为 0..1');
    validateMatrix(item.matrix, 'RenderItem.matrix');
  }
  return plan;
}

// 整文档校验（打开画布/保存前）
export function validateCanvasDocument({ canvas, layers, assets }) {
  validateCanvas(canvas);
  const byId = new Map();
  for (const l of layers) {
    validateLayer(l);
    byId.set(l.id, l);
  }
  for (const a of assets) validateAsset(a);
  const assetIds = new Set(assets.map((a) => a.id));
  const seen = new Set();
  for (const id of canvas.layerIds) {
    if (seen.has(id)) fail('VALIDATION_FAILED', 'layerIds 存在重复');
    seen.add(id);
    const layer = byId.get(id);
    if (!layer) fail('LAYER_NOT_FOUND', `layerIds 引用不存在的图层 ${id}`);
    if (!assetIds.has(layer.assetId)) fail('ASSET_NOT_FOUND', `图层 ${id} 引用不存在的素材 ${layer.assetId}`);
  }
  return true;
}
