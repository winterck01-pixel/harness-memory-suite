// 稳定 ID：uuid v4（契约要求所有实体 ID 为 uuid v4，且 Layer.id 不等于数组下标）

export function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // 兜底：不依赖 crypto 的环境（老 node / 部分测试环境）
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function now() {
  return Date.now();
}
