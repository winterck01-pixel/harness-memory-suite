// render-worker：原尺寸快照导出/生成合成。纯函数合成核心 + 受限队列 + 独立子进程。
import { invert, applyToPoint, multiply, fromTRS } from '../document-core/matrix.js';
import { rgbaBytesFor } from '../resource-policy/policy.js';

export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) throw new Error('背景色必须为 #rrggbb');
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 统一层序/变换/alpha/背景/可见性。隐藏层排除，锁定层包含，背景为 canvas.background。
export function compositeRenderPlan(plan, assetPixels) {
  const W = plan.width, H = plan.height;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 1 || H < 1) throw new Error('渲染计划尺寸无效');
  const out = new Uint8ClampedArray(W * H * 4);
  const [br, bg, bb] = plan.background ? hexToRgb(plan.background) : [255, 255, 255];
  const bgAlpha = plan.backgroundAlpha === undefined ? 255 : plan.backgroundAlpha; // 合成导出=255 不透明；单层导出=0 透明
  if (bgAlpha > 0) for (let i = 0; i < W * H; i++) { out[i * 4] = br; out[i * 4 + 1] = bg; out[i * 4 + 2] = bb; out[i * 4 + 3] = bgAlpha; }
  for (const item of plan.items) {
    if (!item.visible) continue; // 隐藏层不在预览与可见合成中出现
    const src = assetPixels[item.assetId];
    if (!src) throw new Error(`素材像素缺失: ${item.assetId}`);
    blendLayer(out, W, H, src, item.matrix, item.opacity === undefined ? 1 : item.opacity);
  }
  return out;
}

// 直通（非预乘）alpha 合成：out = src*a + dst*(1-a)；采样用视口/图层逆矩阵最近邻。
function blendLayer(out, W, H, src, matrix, opacity) {
  const inv = invert(matrix);
  const sw = src.width, sh = src.height, sd = src.data;
  const op = Math.max(0, Math.min(1, opacity));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = applyToPoint(inv, { x: x + 0.5, y: y + 0.5 });
      const sx = Math.floor(p.x), sy = Math.floor(p.y);
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      const si = (sy * sw + sx) * 4;
      const sa = sd[si + 3];
      if (sa === 0) continue;
      const a = (sa / 255) * op;
      const di = (y * W + x) * 4;
      const da = out[di + 3] / 255;
      const oa = a + da * (1 - a);
      if (oa <= 0) continue;
      const k = da * (1 - a) / oa;
      out[di] = sd[si] * a / oa + out[di] * k;
      out[di + 1] = sd[si + 1] * a / oa + out[di + 1] * k;
      out[di + 2] = sd[si + 2] * a / oa + out[di + 2] * k;
      out[di + 3] = oa * 255;
    }
  }
}

// 由文档 store 构建统一渲染计划（预览/导出/生成参考共同解释）。
export function buildRenderPlan(store, canvasId) {
  const canvas = store.canvases[canvasId];
  if (!canvas) throw new Error('画布不存在');
  const items = canvas.layerIds.map(id => store.layers[id]).filter(Boolean).map(l => ({
    layerId: l.id, assetId: l.assetId, visible: l.visible, locked: l.locked, opacity: l.opacity, matrix: l.matrix,
  }));
  return { canvasId, width: canvas.width, height: canvas.height, background: canvas.background, items };
}

// 单层导出：content=内容边界（变换后包围盒与画布交集），canvas=完整画布尺寸；均为透明背景。
// 返回 { data, width, height }，调用方负责编码。
export function renderLayer(plan, item, assetPixels, bounds = 'content') {
  if (!['content', 'canvas'].includes(bounds)) throw new Error('图层导出边界无效');
  const src = assetPixels[item.assetId];
  if (!src) throw new Error(`素材像素缺失: ${item.assetId}`);
  let w, h, matrix;
  if (bounds === 'canvas') {
    w = plan.width; h = plan.height; matrix = item.matrix;
  } else {
    const corners = [[0, 0], [src.width, 0], [0, src.height], [src.width, src.height]].map(([x, y]) => applyToPoint(item.matrix, { x, y }));
    const minX = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x))));
    const minY = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y))));
    const maxX = Math.min(plan.width, Math.ceil(Math.max(...corners.map(p => p.x))));
    const maxY = Math.min(plan.height, Math.ceil(Math.max(...corners.map(p => p.y))));
    w = Math.max(1, maxX - minX); h = Math.max(1, maxY - minY);
    matrix = multiply(fromTRS({ translateX: -minX, translateY: -minY }), item.matrix);
  }
  const data = compositeRenderPlan({ ...plan, width: w, height: h, backgroundAlpha: 0, items: [{ ...item, matrix, visible: true }] }, assetPixels);
  return { data, width: w, height: h };
}

export function compositeBytesEstimate(w, h) { return rgbaBytesFor(w, h); }
