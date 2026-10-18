// 图片格式识别与尺寸探测（纯 JS，无 sharp 依赖；生产解码由 render-worker 负责）。
import { docError } from '../document-core/ids.js';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function detectImageType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
export function probeImage(bytes) {
  const format = detectImageType(bytes);
  if (!format) throw docError('VALIDATION_FAILED', '不支持的图片格式（仅 PNG/JPEG/WebP）');
  if (format === 'image/png') {
    if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw docError('VALIDATION_FAILED', 'PNG 缺少 IHDR');
    return { format, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (format === 'image/jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (i + 4 > bytes.length) break;
      const len = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format, height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    throw docError('VALIDATION_FAILED', 'JPEG 中未找到尺寸帧');
  }
  // WebP
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { format, width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
  if (chunk === 'VP8 ') {
    if (bytes.length < 30) throw docError('VALIDATION_FAILED', 'VP8 数据过短');
    return { format, width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes.length < 25) throw docError('VALIDATION_FAILED', 'VP8L 数据过短');
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { format, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw docError('VALIDATION_FAILED', 'WebP 分块类型不支持');
}
