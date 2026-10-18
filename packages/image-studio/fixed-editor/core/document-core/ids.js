// 稳定ID与错误工厂。document-core 不依赖 React/HTTP/Canvas/供应商。
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  CANVAS_NOT_FOUND: 'CANVAS_NOT_FOUND',
  LAYER_NOT_FOUND: 'LAYER_NOT_FOUND',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  RESOURCE_EXCEEDED: 'RESOURCE_EXCEEDED',
};
const STATUS = {
  VALIDATION_FAILED: 400,
  PROJECT_NOT_FOUND: 404,
  CANVAS_NOT_FOUND: 404,
  LAYER_NOT_FOUND: 404,
  ASSET_NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  RESOURCE_EXCEEDED: 413,
};
export function docError(code, message) {
  const e = new Error(message);
  e.code = code;
  e.status = STATUS[code] || 400;
  return e;
}
export function statusForCode(code) { return STATUS[code] || 400; }

let idGenerator = null;
export function newId() {
  if (idGenerator) return idGenerator();
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  throw docError('VALIDATION_FAILED', '当前环境缺少 crypto.randomUUID，无法生成稳定ID');
}
export function setIdGenerator(fn) { idGenerator = fn; } // 仅测试注入
export function isUuidV4(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
export function isRefId(v) { return typeof v === 'string' && v.length > 0 && v.length <= 64; }
