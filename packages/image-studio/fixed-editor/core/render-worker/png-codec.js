/**
 * png-codec.js — 零依赖纯 JavaScript PNG 编解码（RGBA 8-bit / colorType 6 / 无隔行）。
 * 仅依赖 node:zlib 与 node:buffer，供图像合成 worker 做像素级精确测试使用。
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { createResourcePolicy } from '../resource-policy/policy.js';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BPP = 4; // RGBA：每像素 4 字节

/* ---------------- CRC32（标准 CRC-32，多项式 0xEDB88320） ---------------- */

let crcTable = null;
function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** 标准 CRC-32，返回无符号 32 位整数。 */
export function crc32(buf) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------------- 编码 ---------------- */

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuf.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return chunk;
}

/**
 * 将直通（非预乘）RGBA 像素编码为 PNG Buffer。
 * @param {number} width 宽（>=1）
 * @param {number} height 高（>=1）
 * @param {Uint8Array|Buffer} rgba 长度 width*height*4，行优先、自上而下
 * @returns {Buffer} 8-bit RGBA、无隔行、每行 filter 0 (None) 的 PNG
 */
export function encodePng(width, height, rgba) {
  if (!Number.isInteger(width) || width < 1) throw new Error('PNG 宽度无效');
  if (!Number.isInteger(height) || height < 1) throw new Error('PNG 高度无效');
  const expected = width * height * BPP;
  if (!rgba || rgba.length !== expected) {
    throw new Error(`PNG 像素数据长度无效: 期望 ${expected} 字节`);
  }
  const src = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  const stride = width * BPP;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const dst = y * (1 + stride);
    raw[dst] = 0; // filter type 0 (None)
    src.copy(raw, dst + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none
  return Buffer.concat([
    SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(raw)),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 解码 ---------------- */

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * 解码 PNG Buffer 为直通 RGBA 像素，支持全部五种过滤器（None/Sub/Up/Average/Paeth）。
 * @param {Buffer|Uint8Array} buffer
 * @returns {{ width: number, height: number, rgba: Buffer }}
 */
export function decodePng(buffer, { policy = createResourcePolicy() } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('PNG 签名无效');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filterMethod = 0;
  let interlace = 0;
  let seenIHDR = false;
  const idats = [];

  let offset = 8;
  while (offset < buf.length) {
    if (offset + 8 > buf.length) throw new Error('PNG 分块头截断');
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) throw new Error(`PNG 分块长度无效: ${type}`);
    const storedCrc = buf.readUInt32BE(dataEnd);
    if (storedCrc !== crc32(buf.subarray(offset + 4, dataEnd))) {
      throw new Error(`PNG 分块 CRC 校验失败: ${type}`);
    }
    if (type === 'IHDR') {
      if (seenIHDR) throw new Error('PNG 包含多个 IHDR 分块');
      if (length !== 13) throw new Error('PNG IHDR 长度无效');
      seenIHDR = true;
      const d = buf.subarray(dataStart, dataEnd);
      width = d.readUInt32BE(0);
      height = d.readUInt32BE(4);
      bitDepth = d[8];
      colorType = d[9];
      compression = d[10];
      filterMethod = d[11];
      interlace = d[12];
    } else if (type === 'IDAT') {
      idats.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!seenIHDR) throw new Error('PNG 缺少 IHDR 分块');
  if (width < 1 || height < 1) throw new Error('PNG 尺寸无效: 宽高必须为正整数');
  if (bitDepth !== 8) throw new Error('PNG 位深不支持');
  if (colorType !== 6) throw new Error('PNG 颜色类型不支持: 只支持 RGBA(6)');
  if (compression !== 0) throw new Error('PNG 压缩方法不支持');
  if (filterMethod !== 0) throw new Error('PNG 过滤器方法不支持');
  if (interlace !== 0) throw new Error('PNG 隔行扫描不支持');
  if (idats.length === 0) throw new Error('PNG 缺少 IDAT 分块');

  policy.admitDecode(width, height);
  const stride = width * BPP;
  const rowSize = 1 + stride;
  const inflated = inflateSync(Buffer.concat(idats), { maxOutputLength: height * rowSize });
  if (inflated.length !== height * rowSize) throw new Error('PNG 像素数据长度不符');

  // 原地逆滤波：逐行处理，仅依赖本行已还原的字节与上一行（已还原）
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    const filter = inflated[rowStart];
    if (filter === 0) continue;
    const prev = y > 0 ? rowStart - rowSize : -1; // 上一行起点
    for (let i = 0; i < stride; i++) {
      const p = rowStart + 1 + i;
      const x = inflated[p];
      const left = i >= BPP ? inflated[p - BPP] : 0;
      const above = prev >= 0 ? inflated[prev + 1 + i] : 0;
      let value;
      switch (filter) {
        case 1:
          value = x + left;
          break;
        case 2:
          value = x + above;
          break;
        case 3:
          value = x + ((left + above) >> 1);
          break;
        case 4: {
          const upperLeft = prev >= 0 && i >= BPP ? inflated[prev + 1 + i - BPP] : 0;
          value = x + paeth(left, above, upperLeft);
          break;
        }
        default:
          throw new Error(`PNG 过滤器类型不支持: ${filter}`);
      }
      inflated[p] = value & 0xff;
    }
  }

  const rgba = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    inflated.copy(rgba, y * stride, y * rowSize + 1, y * rowSize + 1 + stride);
  }
  return { width, height, rgba };
}
