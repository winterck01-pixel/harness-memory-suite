// 仿射矩阵工具（契约 documentSchema.Matrix）：
// number[6] 行主序 [a,b,c,d,e,f]，映射 (x',y') = (a*x + c*y + e, b*x + d*y + f)
// 约束：det = a*d - b*c != 0（可逆）；所有元素有限；首期仅平移+缩放+旋转（UI 保证）。

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export function isMatrix(m) {
  return Array.isArray(m) && m.length === 6 && m.every((v) => typeof v === 'number' && Number.isFinite(v));
}

export function isInvertible(m) {
  if (!isMatrix(m)) return false;
  const [a, b, c, d] = m;
  return a * d - b * c !== 0;
}

export function determinant(m) {
  const [a, b, c, d] = m;
  return a * d - b * c;
}

export function identity() {
  return [...IDENTITY];
}

export function multiply(m, n) {
  // 矩阵乘积 m·n（列向量约定）：先应用 n，再应用 m。
  // 即 apply(apply(p, n), m) === apply(p, multiply(m, n))
  const [a1, b1, c1, d1, e1, f1] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyToPoint(m, x, y) {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0 || !Number.isFinite(det)) return null;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const ie = -(ia * e + ic * f);
  const if_ = -(ib * e + id * f);
  const inv = [ia, ib, ic, id, ie, if_];
  return isMatrix(inv) ? inv : null;
}

export function fromTranslation(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

export function fromScale(sx, sy = sx) {
  return [sx, 0, 0, sy, 0, 0];
}

export function fromRotation(radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

export function composeTranslation(m, tx, ty) {
  return multiply(m, fromTranslation(tx, ty));
}

export function composeScale(m, sx, sy = sx) {
  return multiply(m, fromScale(sx, sy));
}

export function composeRotation(m, radians) {
  return multiply(m, fromRotation(radians));
}

// 变换后的轴对齐包围盒（画布坐标）
export function transformBounds(m, width, height) {
  const corners = [
    applyToPoint(m, 0, 0),
    applyToPoint(m, width, 0),
    applyToPoint(m, width, height),
    applyToPoint(m, 0, height),
  ];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// 将矩阵约束为「有限且可逆」，非法时返回 null（调用方拒绝该变换）
export function sanitize(m) {
  if (!isInvertible(m)) return null;
  return [...m];
}
