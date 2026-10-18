// Project/Canvas/Layer/Asset 校验（契约 documentSchema 冻结字段）。
import { isMatrix, isInvertible } from './matrix.js';
import { isRefId } from './ids.js';
import { docError } from './ids.js';
import { LIMITS } from './limits.js';

const FORMATS = ['image/png', 'image/jpeg', 'image/webp'];
function finiteNumber(v, label) { if (typeof v !== 'number' || !Number.isFinite(v)) throw docError('VALIDATION_FAILED', label + '必须是有限数'); return v; }
function intInRange(v, min, max, label) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw docError('VALIDATION_FAILED', `${label}必须是 ${min}..${max} 的整数`);
  return v;
}
function nameOf(v, label) {
  if (typeof v !== 'string' || v.length < 1 || v.length > LIMITS.nameMaxChars) throw docError('VALIDATION_FAILED', `${label}需为 1..${LIMITS.nameMaxChars} 个字符`);
  return v;
}

export function validateProject(p) {
  if (!p || typeof p !== 'object') throw docError('VALIDATION_FAILED', '项目无效');
  if (!isRefId(p.id)) throw docError('VALIDATION_FAILED', '项目ID无效');
  nameOf(p.name, '项目名称');
  if (!Array.isArray(p.canvasIds) || p.canvasIds.some(id => !isRefId(id))) throw docError('VALIDATION_FAILED', '项目画布列表无效');
  finiteNumber(p.createdAt, '项目创建时间'); finiteNumber(p.updatedAt, '项目更新时间');
  return p;
}
export function validateCanvas(c) {
  if (!c || typeof c !== 'object') throw docError('VALIDATION_FAILED', '画布无效');
  if (!isRefId(c.id)) throw docError('VALIDATION_FAILED', '画布ID无效');
  if (!isRefId(c.projectId)) throw docError('VALIDATION_FAILED', '画布项目ID无效');
  nameOf(c.name, '画布名称');
  if (c.schemaVersion !== 1) throw docError('VALIDATION_FAILED', `不支持的画布 schema 版本: ${c.schemaVersion}，当前仅支持 1`);
  intInRange(c.revision, 0, Number.MAX_SAFE_INTEGER, '画布 revision');
  intInRange(c.width, 1, LIMITS.maxCanvasWidth, '画布宽度');
  intInRange(c.height, 1, LIMITS.maxCanvasHeight, '画布高度');
  if (c.width * c.height > LIMITS.maxCanvasPixels) throw docError('RESOURCE_EXCEEDED', `画布像素 ${c.width * c.height} 超过上限 ${LIMITS.maxCanvasPixels}`);
  if (c.background !== '#ffffff') throw docError('VALIDATION_FAILED', '画布背景必须为 #ffffff');
  if (!Array.isArray(c.layerIds) || c.layerIds.some(id => !isRefId(id)) || new Set(c.layerIds).size !== c.layerIds.length) throw docError('VALIDATION_FAILED', '画布图层列表无效（底到顶有序，ID 不得重复）');
  finiteNumber(c.createdAt, '画布创建时间'); finiteNumber(c.updatedAt, '画布更新时间');
  return c;
}
export function validateLayer(l) {
  if (!l || typeof l !== 'object') throw docError('VALIDATION_FAILED', '图层无效');
  if (!isRefId(l.id)) throw docError('VALIDATION_FAILED', '图层ID无效');
  if (l.kind !== 'image') throw docError('VALIDATION_FAILED', '图层类型仅支持 image');
  if (!isRefId(l.assetId)) throw docError('VALIDATION_FAILED', '图层素材引用无效');
  nameOf(l.name, '图层名称');
  if (typeof l.visible !== 'boolean') throw docError('VALIDATION_FAILED', '图层可见性无效');
  if (typeof l.locked !== 'boolean') throw docError('VALIDATION_FAILED', '图层锁定无效');
  finiteNumber(l.opacity, '图层透明度');
  if (l.opacity < 0 || l.opacity > 1) throw docError('VALIDATION_FAILED', '图层透明度必须在 0..1');
  if (!isInvertible(l.matrix)) throw docError('VALIDATION_FAILED', '图层矩阵必须有限且可逆');
  return l;
}
export function validateAsset(a) {
  if (!a || typeof a !== 'object') throw docError('VALIDATION_FAILED', '素材无效');
  if (!isRefId(a.id)) throw docError('VALIDATION_FAILED', '素材ID无效');
  if (typeof a.hash !== 'string' || !/^[0-9a-f]{64}$/.test(a.hash)) throw docError('VALIDATION_FAILED', '素材 hash 必须为 sha256 hex');
  intInRange(a.width, 1, 65536, '素材宽度'); intInRange(a.height, 1, 65536, '素材高度');
  if (!FORMATS.includes(a.format)) throw docError('VALIDATION_FAILED', '素材格式仅支持 PNG/JPEG/WebP');
  intInRange(a.byteSize, 1, LIMITS.maxUploadBytes, '素材字节数');
  if (typeof a.previewUrl !== 'string') throw docError('VALIDATION_FAILED', '素材预览URL无效');
  if (typeof a.refCount !== 'number' || !Number.isInteger(a.refCount) || a.refCount < 0) throw docError('VALIDATION_FAILED', '素材引用计数无效');
  return a;
}
