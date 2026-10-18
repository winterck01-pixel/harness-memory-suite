// 契约冻结的资源与历史限额（源自 contract.json resourcePolicy/historyLimits）。
export const LIMITS = Object.freeze({
  maxCanvasPixels: 8388608,   // W*H 上限 8MP
  maxCanvasWidth: 4096,
  maxCanvasHeight: 4096,
  maxLayersPerCanvas: 64,
  maxUploadBytes: 20971520,   // 20MB
  previewCacheMaxBytes: 268435456, // 256MB
  maxUndoCount: 100,
  maxUndoBytes: 67108864,     // 64MB
  nameMaxChars: 120,
});
