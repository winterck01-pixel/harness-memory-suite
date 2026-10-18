// 渲染计划（契约 renderPlan）：统一层序/变换/裁切/alpha/背景/可见性，
// 供预览/导出/生成参考共同解释。预览/导出/生成参考都必须由本函数派生，不允许各写一套。

import { transformBounds } from './matrix.js';

export function buildRenderPlan(canvas, layers, assets) {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const items = [];
  for (const layerId of canvas.layerIds) {
    const layer = byId.get(layerId);
    if (!layer) continue; // 未知 schema 引用不静默丢弃：由上層校验报错，这里跳过仅保护渲染
    const asset = assets.find((a) => a.id === layer.assetId) || null;
    items.push({
      layerId: layer.id,
      assetId: layer.assetId,
      visible: layer.visible === true,
      locked: layer.locked === true,
      opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
      matrix: [...layer.matrix],
      // 渲染辅助信息（不属于契约 RenderItem 必需字段，预览/导出共用）
      assetWidth: asset ? asset.width : 0,
      assetHeight: asset ? asset.height : 0,
      previewUrl: asset ? asset.previewUrl : '',
    });
  }
  return {
    canvasId: canvas.id,
    width: canvas.width,
    height: canvas.height,
    background: canvas.background || '#ffffff',
    items, // 底到顶有序
  };
}

// 可见合成用的条目（预览/导出/composite 共同语义）：排除隐藏层，包含锁定层
export function visibleItems(renderPlan) {
  return renderPlan.items.filter((item) => item.visible);
}

// 图层在画布坐标中的包围盒
export function layerBoundsInCanvas(layer, asset) {
  return transformBounds(layer.matrix, asset.width, asset.height);
}

// 把矩形约束在画布范围内（返回不越界的矩形；若完全在画布外返回 null）
export function clampRectToCanvas(rect, canvas) {
  const x1 = Math.max(0, Math.min(rect.x, canvas.width));
  const y1 = Math.max(0, Math.min(rect.y, canvas.height));
  const x2 = Math.max(0, Math.min(rect.x + rect.width, canvas.width));
  const y2 = Math.max(0, Math.min(rect.y + rect.height, canvas.height));
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
