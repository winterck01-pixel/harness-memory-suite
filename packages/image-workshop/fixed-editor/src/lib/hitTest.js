// 命中测试（契约 renderPlan.hitTesting）：
// screenPoint -> (viewportInverse) -> canvasPoint -> (layerMatrixInverse) -> assetPoint
// 首期 O(N) 逆层序遍历：画布边界检查 -> 隐藏/锁定过滤 -> 包围盒粗测 -> 局部矩形精测。

import { applyToPoint, invert, transformBounds } from './matrix.js';

// 视口：zoom 为视图缩放（不改变像素），pan 为屏幕偏移（CSS 像素）
export function screenToCanvas(screenPoint, viewport) {
  const { zoom = 1, panX = 0, panY = 0 } = viewport || {};
  if (!(zoom > 0) || !Number.isFinite(zoom)) return null;
  return [(screenPoint[0] - panX) / zoom, (screenPoint[1] - panY) / zoom];
}

export function canvasToScreen(canvasPoint, viewport) {
  const { zoom = 1, panX = 0, panY = 0 } = viewport || {};
  return [canvasPoint[0] * zoom + panX, canvasPoint[1] * zoom + panY];
}

export function pointInCanvas(canvasPoint, canvas) {
  return (
    canvasPoint[0] >= 0 &&
    canvasPoint[1] >= 0 &&
    canvasPoint[0] <= canvas.width &&
    canvasPoint[1] <= canvas.height
  );
}

// 画布坐标点是否落在图层内（未考虑可见/锁定；调用方负责过滤）
export function hitTestLayer(canvasPoint, layer, asset) {
  if (!layer || !asset) return null;
  const bounds = transformBounds(layer.matrix, asset.width, asset.height);
  // 包围盒粗测
  if (
    canvasPoint[0] < bounds.x ||
    canvasPoint[1] < bounds.y ||
    canvasPoint[0] > bounds.x + bounds.width ||
    canvasPoint[1] > bounds.y + bounds.height
  ) {
    return null;
  }
  // 逆矩阵精测：画布点 -> 素材局部坐标
  const inv = invert(layer.matrix);
  if (!inv) return null;
  const [lx, ly] = applyToPoint(inv, canvasPoint[0], canvasPoint[1]);
  if (lx < 0 || ly < 0 || lx > asset.width || ly > asset.height) return null;
  return { layerId: layer.id, assetPoint: [lx, ly] };
}

// 逆层序（顶到底）遍历。默认跳过隐藏层；skipLocked=true 时跳过锁定层（画布编辑选择语义）。
export function hitTest(canvasPoint, canvas, layers, assets, { skipLocked = true } = {}) {
  if (!pointInCanvas(canvasPoint, canvas)) return null; // 画布边界检查：有限画布，画布外不命中
  const ordered = [...layers].sort((a, b) => canvas.layerIds.indexOf(b.id) - canvas.layerIds.indexOf(a.id));
  for (const layer of ordered) {
    if (!layer.visible) continue; // 隐藏层不参与画布命中
    if (skipLocked && layer.locked) continue; // 锁定层不可从画布选中编辑，仅可从列选/导出
    const asset = assets.find((a) => a.id === layer.assetId);
    const hit = hitTestLayer(canvasPoint, layer, asset);
    if (hit) return hit;
  }
  return null;
}
