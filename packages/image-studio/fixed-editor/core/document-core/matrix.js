// 有限可逆仿射矩阵 [a,b,c,d,e,f] 行主序: (x',y') = (a*x + c*y + e, b*x + d*y + f)
import { docError } from './ids.js';

export function createMatrix() { return [1, 0, 0, 1, 0, 0]; }
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
export function isMatrix(v) { return Array.isArray(v) && v.length === 6 && v.every(x => typeof x === 'number' && Number.isFinite(x)); }
export function determinant(m) { return m[0] * m[3] - m[1] * m[2]; }
export function isInvertible(m) { return isMatrix(m) && Math.abs(determinant(m)) > 1e-12; }

export function multiply(m, n) { // m∘n，先应用 n 再应用 m
  const [a, b, c, d, e, f] = m, [a2, b2, c2, d2, e2, f2] = n;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}
export function invert(m) {
  if (!isInvertible(m)) throw docError('VALIDATION_FAILED', '矩阵不可逆，无法求逆');
  const [a, b, c, d, e, f] = m, det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
export function applyToPoint(m, p) { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }
export function fromTRS({ translateX = 0, translateY = 0, scaleX = 1, scaleY = 1, rotation = 0 }) {
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const z = v => (v === 0 ? 0 : v); // 归一 -0，保证矩阵序列化稳定
  return [z(scaleX * cos), z(scaleX * sin), z(-scaleY * sin), z(scaleY * cos), z(translateX), z(translateY)];
}
export function decompose(m) {
  const [a, b] = m;
  const scaleX = Math.hypot(a, b);
  const det = determinant(m);
  const scaleY = scaleX === 0 ? 0 : det / scaleX;
  return { translateX: m[4], translateY: m[5], scaleX, scaleY, rotation: Math.atan2(b, a) };
}
export function toCss(m) { return `matrix(${m.join(', ')})`; }
export function boundsOf(m, w, h) { // 内容在父坐标系中的轴对齐包围盒
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => applyToPoint(m, { x, y }));
  return {
    minX: Math.min(...corners.map(p => p.x)), minY: Math.min(...corners.map(p => p.y)),
    maxX: Math.max(...corners.map(p => p.x)), maxY: Math.max(...corners.map(p => p.y)),
  };
}
// 把变换约束在画布内：内容不超出画布时只钳制平移；超出则等比缩小到恰好放入，再钳制平移。
// 该函数是「图层移动/缩放限制在画布范围内，禁止拖动自动扩大画布」的唯一实现，UI 提交前与
// 服务端 transformLayer 校验时共用，保证双路径一致。
export function constrainMatrix(matrix, assetW, assetH, canvasW, canvasH) {
  if (!isInvertible(matrix)) throw docError('VALIDATION_FAILED', '图层矩阵无效');
  const { rotation, scaleX, scaleY } = decompose(matrix);
  const signY = scaleY < 0 ? -1 : 1;
  const build = (sx, sy, tx, ty) => fromTRS({ translateX: tx, translateY: ty, scaleX: sx, scaleY: sy, rotation });
  let sx = Math.abs(scaleX), sy = Math.abs(scaleY) * signY;
  if (!(sx > 0)) sx = 1e-6;
  if (Math.abs(sy) < 1e-6) sy = 1e-6 * signY;
  let b = boundsOf(build(sx, sy, 0, 0), assetW, assetH);
  const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
  if (bw > canvasW + 1e-9 || bh > canvasH + 1e-9) {
    const ratio = Math.min(canvasW / bw, canvasH / bh);
    sx = Math.max(sx * ratio, 1e-6);
    sy = Math.max(Math.abs(scaleY) * ratio, 1e-6) * signY;
    b = boundsOf(build(sx, sy, 0, 0), assetW, assetH);
  }
  const tx0 = matrix[4], ty0 = matrix[5];
  const dx = b.minX + tx0 < 0 ? -b.minX - tx0 : (b.maxX + tx0 > canvasW ? canvasW - b.maxX - tx0 : 0);
  const dy = b.minY + ty0 < 0 ? -b.minY - ty0 : (b.maxY + ty0 > canvasH ? canvasH - b.maxY - ty0 : 0);
  return build(sx, sy, tx0 + dx, ty0 + dy);
}
