// asset-repository：不可变原图 + hash/尺寸/格式/字节数 + 分级预览 + 引用计数与显式回收。
// 删除图层/画布/项目仅移除文档引用，不永久删除原文件；refCount 归零后由显式 reclaim 处理。
import { createHash, randomUUID } from 'node:crypto';
import { docError } from '../document-core/ids.js';
import { validateAsset } from '../document-core/schema.js';
import { LIMITS } from '../document-core/limits.js';
import { probeImage, detectImageType } from './probe.js';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function createAssetRepository({ storage, policy, baseUrl = '/api/image-studio', now = () => Date.now() }) {
  const indexFile = 'assets/index.json';
  let index = null; // hash -> 资产元数据
  const load = async () => { if (!index) index = (await storage.read(indexFile)) || {}; return index; };
  const persist = async () => { await storage.write(indexFile, index); };
  const assetPath = (hash, format) => `assets/${hash.slice(0, 2)}/${hash}.${EXT[format]}`;
  const admit = bytes => {
    if (!Buffer.isBuffer(bytes)) throw docError('VALIDATION_FAILED', '素材必须为图片字节');
    policy?.checkUploadBytes?.(bytes.length);
    const limit = policy?.limits?.maxUploadBytes ?? policy?.maxUploadBytes ?? LIMITS.maxUploadBytes;
    if (bytes.length > limit) throw docError('RESOURCE_EXCEEDED', `上传大小 ${bytes.length} 超过上限 ${limit}`);
  };

  return {
    async register({ bytes, name }) {
      admit(bytes);
      const type = detectImageType(bytes);
      if (!type) throw docError('VALIDATION_FAILED', '不支持的图片格式（仅 PNG/JPEG/WebP）');
      const { width, height } = probeImage(bytes);
      if (width < 1 || height < 1) throw docError('VALIDATION_FAILED', '图片尺寸无效');
      policy?.admitDecode?.(width, height);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const idx = await load();
      const existing = idx[hash];
      if (existing) {
        // 不可变原图：已存在则校验落盘内容未被破坏，并提升引用计数
        const onDisk = await storage.readRaw(assetPath(hash, existing.format));
        if (!onDisk || createHash('sha256').update(onDisk).digest('hex') !== hash) throw docError('ASSET_NOT_FOUND', '原图文件缺失或已被破坏，拒绝复用');
        existing.refCount += 1;
        await persist();
        return this.get(existing.id);
      }
      const id = randomUUID();
      const asset = validateAsset({
        id, hash, width, height, format: type, byteSize: bytes.length,
        previewUrl: `${baseUrl}/image?id=${id}`, refCount: 1,
      });
      await storage.writeRaw(assetPath(hash, type), bytes);
      idx[hash] = { ...asset, name: typeof name === 'string' && name ? name.slice(0, LIMITS.nameMaxChars) : '素材', createdAt: now() };
      await persist();
      return { ...asset };
    },
    async get(id) {
      const idx = await load();
      const row = Object.values(idx).find(a => a.id === id);
      if (!row) return null;
      const { name, createdAt, ...meta } = row;
      return { ...meta, name };
    },
    async getByHash(hash) {
      const idx = await load();
      const row = idx[hash];
      if (!row) return null;
      const { name, createdAt, ...meta } = row;
      return { ...meta, name };
    },
    async list() {
      const idx = await load();
      return Object.values(idx).map(({ name, createdAt, ...meta }) => meta);
    },
    async retain(id) {
      const idx = await load();
      const row = Object.values(idx).find(a => a.id === id);
      if (!row) throw docError('ASSET_NOT_FOUND', '素材不存在');
      row.refCount += 1; await persist(); return row.refCount;
    },
    async release(id) {
      const idx = await load();
      const row = Object.values(idx).find(a => a.id === id);
      if (!row) return 0;
      row.refCount = Math.max(0, row.refCount - 1); await persist(); return row.refCount;
    },
    async reclaim(id) { // 显式回收：仅 refCount===0 时删除原文件与索引
      const idx = await load();
      const row = Object.values(idx).find(a => a.id === id);
      if (!row) return { ok: true, reclaimed: false };
      if (row.refCount > 0) throw docError('VALIDATION_FAILED', `素材仍被 ${row.refCount} 处引用，不能回收`);
      await storage.remove(assetPath(row.hash, row.format));
      delete idx[row.hash];
      await persist();
      return { ok: true, reclaimed: true, hash: row.hash };
    },
    async readOriginal(id) {
      const idx = await load();
      const row = Object.values(idx).find(a => a.id === id);
      if (!row) throw docError('ASSET_NOT_FOUND', '素材不存在');
      const bytes = await storage.readRaw(assetPath(row.hash, row.format));
      if (!bytes) throw docError('ASSET_NOT_FOUND', '原图文件缺失');
      return bytes;
    },
    previewTier(asset, maxPixels) {
      if (!asset || asset.width * asset.height <= maxPixels) return { tier: 'original', url: asset?.previewUrl };
      return { tier: String(maxPixels), url: `${asset.previewUrl}&tier=${maxPixels}` };
    },
  };
}
