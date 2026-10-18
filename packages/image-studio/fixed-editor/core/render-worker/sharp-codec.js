// 宿主必须提供锁定sharp；只在隔离worker加载native解码器。
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
export function createSharpCodec({ modulePath = process.env.DSH_SHARP_MODULE || 'sharp', policy } = {}) {
  const sharp = require(modulePath);
  const version = require(modulePath === 'sharp' ? 'sharp/package.json' : join(modulePath, 'package.json')).version;
  if (version !== '0.34.5') throw new Error(`sharp版本不匹配：要求0.34.5，实际${version}`);
  sharp.cache(false); sharp.concurrency(1);
  const limitInputPixels = Math.floor((policy?.memoryBudgetBytes || 512 * 1024 * 1024) / 28);
  return {
    version,
    async decode(bytes) {
      const { data, info } = await sharp(bytes, { limitInputPixels, sequentialRead: true, animated: false, failOn: 'warning' }).toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error('解码器未输出RGBA');
      policy?.admitDecode(info.width, info.height);
      return { width: info.width, height: info.height, rgba: data };
    },
    async encode(width, height, data) {
      policy?.checkCanvasSize(width, height);
      return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 }, limitInputPixels }).png().toBuffer();
    },
  };
}
