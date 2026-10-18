// resource-policy：上传/解码/缩略/导出/生成入库共用准入预算；准入检查在分配前进行。
import { LIMITS } from '../document-core/limits.js';
import { docError } from '../document-core/ids.js';

export function rgbaBytesFor(w, h) {
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 || !Number.isSafeInteger(w * h * 4)) throw docError('VALIDATION_FAILED', '图片尺寸无效');
  return w * h * 4;
}

export function createResourcePolicy(overrides = {}) {
  const limits = { ...LIMITS, ...overrides };
  const budget = overrides.memoryBudgetBytes ?? 512 * 1024 * 1024;
  const codecProfile = overrides.codecProfile ?? 'js-png';
  if (!['js-png', 'sharp-0.34.5'].includes(codecProfile)) throw docError('VALIDATION_FAILED', '渲染编码器预算配置无效');
  if (!Number.isSafeInteger(budget) || budget < 1) throw docError('VALIDATION_FAILED', '内存预算无效');
  return {
    limits,
    memoryBudgetBytes: budget,
    codecProfile,
    checkCanvasSize(w, h) {
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw docError('VALIDATION_FAILED', '画布尺寸无效');
      if (w > limits.maxCanvasWidth || h > limits.maxCanvasHeight) throw docError('RESOURCE_EXCEEDED', `画布边长超过 ${limits.maxCanvasWidth}x${limits.maxCanvasHeight}`);
      if (w * h > limits.maxCanvasPixels) throw docError('RESOURCE_EXCEEDED', `画布像素 ${w * h} 超过上限 ${limits.maxCanvasPixels}`);
      return true;
    },
    checkLayerCount(n) {
      if (!Number.isInteger(n) || n < 0) throw docError('VALIDATION_FAILED', '图层数无效');
      if (n > limits.maxLayersPerCanvas) throw docError('RESOURCE_EXCEEDED', `图层数 ${n} 超过上限 ${limits.maxLayersPerCanvas}`);
      return true;
    },
    checkUploadBytes(n) {
      if (!Number.isInteger(n) || n < 0) throw docError('VALIDATION_FAILED', '字节数无效');
      if (n > limits.maxUploadBytes) throw docError('RESOURCE_EXCEEDED', `上传 ${n} 字节超过上限 ${limits.maxUploadBytes}`);
      return true;
    },
    // 保守工作缓冲预算：PNG inflate/解码副本、输出/编码/deflate/拼接；另需外部OS约束native内存。
    estimateExportPeakBytes(w, h, assetPixels = []) {
      const raw = assetPixels.map(a => rgbaBytesFor(a.width, a.height));
      const out = rgbaBytesFor(w, h);
      const maxResample = raw.length ? Math.max(...raw) : 0;
      if (codecProfile === 'sharp-0.34.5') {
        // Sharp returns one RGBA buffer per source; all sources remain live through encoding.
        // 3*out: output RGBA + encoded PNG + tmpfs output. 2*largest: native codec headroom.
        // Fixed 160MiB reserve includes Node/runtime, compressed input, 64MiB preview cache,
        // and native scratch. OS cgroup/FSIZE/time limits remain the final hard boundary.
        return Math.ceil(160 * 1024 * 1024 + 3 * out + raw.reduce((s, v) => s + v, 0) + 2 * maxResample);
      }
      return Math.ceil(8 * out + 5 * raw.reduce((s, v) => s + v, 0) + 2 * maxResample);
    },
    admitExport(w, h, assetPixels = []) {
      this.checkCanvasSize(w, h);
      const peak = this.estimateExportPeakBytes(w, h, assetPixels);
      if (peak > budget) throw docError('RESOURCE_EXCEEDED', `导出预估峰值 ${peak} 字节超过内存预算 ${budget}，任务被拒绝（分配前检查）`);
      return { admitted: true, estimatedPeakBytes: peak };
    },
    admitDecode(width, height) {
      const bytes = rgbaBytesFor(width, height);
      if (bytes > budget) throw docError('RESOURCE_EXCEEDED', `解码 ${width}x${height} 需要 ${bytes} 字节，超过内存预算 ${budget}`);
      return { admitted: true, bytes };
    },
  };
}

// 按字节计费的 LRU：键 = assetHash + 目标分辨率；回收不得删除项目/历史/候选/执行中快照引用的原图。
export function createByteLruCache({ maxBytes = LIMITS.previewCacheMaxBytes } = {}) {
  const map = new Map(); // key -> { bytes, value }
  let current = 0;
  const evict = () => { while (current > maxBytes && map.size) { const oldest = map.keys().next().value; const e = map.get(oldest); current -= e.bytes; map.delete(oldest); } };
  return {
    get maxBytes() { return maxBytes; },
    get currentBytes() { return current; },
    get size() { return map.size; },
    has: key => map.has(key),
    get(key) { const e = map.get(key); if (!e) return undefined; map.delete(key); map.set(key, e); return e.value; },
    set(key, value, bytes) {
      if (!Number.isInteger(bytes) || bytes < 0) throw docError('VALIDATION_FAILED', '缓存字节数无效');
      const old = map.get(key);
      if (old) { current -= old.bytes; map.delete(key); }
      map.set(key, { value, bytes }); current += bytes; evict();
      return true;
    },
    delete(key) { const e = map.get(key); if (!e) return false; current -= e.bytes; map.delete(key); return true; },
    clear() { map.clear(); current = 0; },
    keys() { return [...map.keys()]; },
  };
}
