// MOCK 适配器：按契约 projectApi / assetApi / generationAdapter / exportApi 的本地实现。
// 明确标注 mock：所有生成结果/任务/费用均为模拟数据（mock:true），不连接任何真实 API。
// 持久化用 localStorage（浏览器）/ 内存（node 测试）。集成时整体替换为 core generation-adapter。

import { applyCommand, emptyDocument, makeCommand } from '../lib/commands.js';
import { validateCanvasDocument } from '../lib/schema.js';
import { uuid, now } from '../lib/id.js';
import { adapterError } from './adapter.js';
import mockCatalog from './modelCatalog.mock.json' with { type: 'json' };

const STORAGE_KEY = 'dsh-iw-editor-mock-v1';
const LATENCY = { min: 120, max: 320 };

function delay(ms = LATENCY.min + Math.random() * (LATENCY.max - LATENCY.min)) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 跨环境 sha256（hex）：浏览器与 Node>=18 均提供 WebCrypto (crypto.subtle)，不依赖 node:crypto
// 输入可为 string 或 ArrayBuffer/TypedArray；环境缺少 WebCrypto 时明确报错，不伪造哈希
async function sha256Hex(input) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw adapterError('ADAPTER_INTERNAL', '当前环境缺少 WebCrypto (crypto.subtle)，无法计算 sha256', 500);
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  const buf = await subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* 隐私模式等 */ }
  return null;
}

// 生成确定性 mock 预览图（彩色块 + 提示词哈希决定色相），标注 mock
function mockPreviewDataUrl(seed, width, height) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="', width, '" height="', height, '">',
    '<rect width="100%" height="100%" fill="hsl(', hue, ',65%,72%)"/>',
    '<rect width="100%" height="100%" fill="none" stroke="hsl(', hue, ',60%,45%)" stroke-width="8"/>',
    '<text x="50%" y="50%" font-size="', Math.max(12, Math.floor(width / 12)), '" text-anchor="middle" dominant-baseline="middle" fill="hsl(', hue, ',60%,25%)" font-family="sans-serif">MOCK</text>',
    '</svg>',
  ];
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(parts.join(''));
}

function mockCostEstimate(model, quality, n) {
  // mock 费用估算：仅演示费用显示，不是真实价格
  const base = { openai_image: 0.04, gemini_image: 0.03, seedream: 0.02, flux_image: 0.03, qwen_image: 0.02, kling: 0.03, grok_image: 0.03, vidu_image: 0.03, midjourney: 0.05 };
  const unit = base[model.family] ?? 0.03;
  const q = quality && quality !== 'auto' ? 1.5 : 1;
  return Math.round(unit * q * (n || 1) * 100) / 100;
}

export function createMockAdapter({ latency = true, persist = true, taskDuration } = {}) {
  const store = storage();
  let doc = emptyDocument();
  let loaded = false;

  // generation 状态
  /** @type {Map<string, GenerationTask & {timer?:any}>} */
  const tasks = new Map();
  /** @type {Map<string, {batch:GenerationBatch, candidates:Candidate[], timers:any[]}>} */
  const batches = new Map();

  function load() {
    if (loaded) return;
    loaded = true;
    if (!persist || !store) return;
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (raw) doc = JSON.parse(raw);
      const generation = JSON.parse(store.getItem(STORAGE_KEY + '-generation') || '{}');
      for (const [id, record] of generation.batches || []) batches.set(id, { ...record, timers: [] });
      for (const [id, task] of generation.tasks || []) tasks.set(id, { ...task, ...(['queued','submitting','polling'].includes(task.status) ? {status:'failed',error:'本地模拟任务因页面重载中断'} : {}) });
    } catch { /* 损坏的本地数据从头开始 */ }
  }

  function save() {
    if (!persist || !store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(doc));
      store.setItem(STORAGE_KEY + '-generation', JSON.stringify({ batches: [...batches].map(([id,r]) => [id,{batch:r.batch,candidates:r.candidates}]), tasks: [...tasks].map(([id,{timer,...task}]) => [id,task]) }));
    } catch { /* 超额忽略 */ }
  }

  async function wait() {
    if (latency) await delay();
  }

  function listLayers(canvasId) {
    const canvas = doc.canvases[canvasId];
    if (!canvas) return [];
    return canvas.layerIds.map((id) => doc.layers[id]).filter(Boolean);
  }

  function listAssets(canvasId) {
    const used = new Set(listLayers(canvasId).map((l) => l.assetId));
    return [...used].map((id) => doc.assets[id]).filter(Boolean);
  }

  function requireCanvas(canvasId) {
    const canvas = doc.canvases[canvasId];
    if (!canvas) throw adapterError('CANVAS_NOT_FOUND', '画布不存在', 404);
    return canvas;
  }

  function seedDemoContent() {
    if (Object.keys(doc.projects).length > 0) return;
    // 一个演示项目（mock 数据，首次打开时创建，用户可删除）
    const projectId = uuid();
    const canvasId = uuid();
    const assetA = uuid();
    const assetB = uuid();
    const t = now();
    doc = {
      projects: {
        [projectId]: { id: projectId, name: '示例项目', canvasIds: [canvasId], createdAt: t, updatedAt: t },
      },
      canvases: {
        [canvasId]: {
          id: canvasId, projectId, name: '画布 1', schemaVersion: 1, revision: 0,
          width: 1280, height: 720, background: '#ffffff', layerIds: [assetA, assetB], createdAt: t, updatedAt: t,
        },
      },
      layers: {
        [assetA]: {
          id: assetA, kind: 'image', assetId: assetA, name: '背景层', visible: true, locked: false,
          opacity: 1, matrix: [1, 0, 0, 1, 0, 0],
        },
        [assetB]: {
          id: assetB, kind: 'image', assetId: assetB, name: '角色层', visible: true, locked: false,
          opacity: 1, matrix: [1, 0, 0, 1, 240, 120],
        },
      },
      assets: {
        [assetA]: {
          id: assetA, hash: '0'.repeat(64), width: 1280, height: 720, format: 'image/png',
          byteSize: 0, previewUrl: mockPreviewDataUrl('bg-' + projectId, 1280, 720), refCount: 1, mock: true,
        },
        [assetB]: {
          id: assetB, hash: '1'.repeat(64), width: 640, height: 480, format: 'image/png',
          byteSize: 0, previewUrl: mockPreviewDataUrl('char-' + projectId, 640, 480), refCount: 1, mock: true,
        },
      },
    };
    save();
  }

  return {
    mock: true,
    async costPreview() { return {estimate:{status:'unavailable',reason:'本地 mock，不提供真实费用'}}; },
    async getModels() { return { models: mockCatalog.models, mock: true }; },

    async listProjects() {
      load(); seedDemoContent(); await wait();
      const projects = Object.values(doc.projects).map((p) => ({
        id: p.id,
        name: p.name,
        canvasCount: p.canvasIds.length,
        canvasIds: [...p.canvasIds],
        coverUrl: (() => {
          const first = doc.canvases[p.canvasIds[0]];
          if (!first) return '';
          const layer = doc.layers[first.layerIds[first.layerIds.length - 1]];
          const asset = layer && doc.assets[layer.assetId];
          return asset ? asset.previewUrl : '';
        })(),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      return { projects };
    },

    async createProject({ name, width, height }) {
      load(); await wait();
      const projectId = uuid();
      const canvasId = uuid();
      const t = now();
      const { state } = applyCommand(doc, makeCommand('createProject', canvasId, 0, {
        project: { id: projectId, name, canvasIds: [canvasId], createdAt: t, updatedAt: t },
        canvas: {
          id: canvasId, projectId, name: '画布 1', schemaVersion: 1, revision: 0,
          width, height, background: '#ffffff', layerIds: [], createdAt: t, updatedAt: t,
        },
      }));
      doc = state; save();
      return { project: doc.projects[projectId], canvas: doc.canvases[canvasId] };
    },

    async renameProject(projectId, name) {
      load(); await wait();
      const project = doc.projects[projectId];
      if (!project) throw adapterError('PROJECT_NOT_FOUND', '项目不存在', 404);
      const canvasId = project.canvasIds[0] || '';
      const { state } = applyCommand(doc, makeCommand('renameProject', canvasId, 0, { projectId, name }));
      doc = state; save();
      return { project: doc.projects[projectId] };
    },

    async openProject(projectId) {
      load(); seedDemoContent(); await wait();
      const project = doc.projects[projectId];
      if (!project) throw adapterError('PROJECT_NOT_FOUND', '项目不存在', 404);
      const canvasId = project.canvasIds[0];
      const canvas = doc.canvases[canvasId];
      if (!canvas) throw adapterError('CANVAS_NOT_FOUND', '项目没有画布', 404);
      return { project, canvas };
    },

    async listCanvases(projectId) {
      load(); await wait();
      const project = doc.projects[projectId];
      if (!project) throw adapterError('PROJECT_NOT_FOUND', '项目不存在', 404);
      return {
        canvases: project.canvasIds.map((id) => {
          const c = doc.canvases[id];
          return c ? { id: c.id, name: c.name, width: c.width, height: c.height, revision: c.revision, updatedAt: c.updatedAt } : null;
        }).filter(Boolean),
      };
    },

    async createCanvas(projectId, { name, width, height }) {
      load(); await wait();
      const project = doc.projects[projectId];
      if (!project) throw adapterError('PROJECT_NOT_FOUND', '项目不存在', 404);
      const canvasId = uuid();
      const t = now();
      const { state } = applyCommand(doc, makeCommand('createCanvas', canvasId, 0, {
        canvas: {
          id: canvasId, projectId, name, schemaVersion: 1, revision: 0,
          width, height, background: '#ffffff', layerIds: [], createdAt: t, updatedAt: t,
        },
      }));
      doc = state; save();
      return { canvas: doc.canvases[canvasId] };
    },

    async getCanvas(canvasId) {
      load(); await wait();
      const canvas = requireCanvas(canvasId);
      const layers = listLayers(canvasId);
      const assets = listAssets(canvasId);
      validateCanvasDocument({ canvas, layers, assets });
      return { canvas, layers, assets };
    },

    async putCanvas(canvasId, { expectedRevision, commands }) {
      load(); await wait();
      const canvas = requireCanvas(canvasId);
      if (canvas.revision !== expectedRevision) {
        throw adapterError('REVISION_CONFLICT', `revision 冲突：期望 ${expectedRevision}，当前 ${canvas.revision}`, 409);
      }
      let state = doc;
      for (const cmd of commands) {
        const applied = applyCommand(state, cmd);
        state = applied.state;
      }
      doc = state; save();
      return { canvas: doc.canvases[canvasId], newRevision: doc.canvases[canvasId].revision };
    },

    async renameCanvas(canvasId, name) {
      load(); await wait();
      const canvas = requireCanvas(canvasId);
      const { state } = applyCommand(doc, makeCommand('renameCanvas', canvasId, canvas.revision, { name }));
      doc = state; save();
      return { canvas: doc.canvases[canvasId] };
    },

    async deleteCanvas(canvasId) {
      load(); await wait();
      const canvas = requireCanvas(canvasId);
      const { state } = applyCommand(doc, makeCommand('deleteCanvas', canvasId, canvas.revision, { canvasId }));
      doc = state; save();
      return { ok: true };
    },

    async uploadImage(file) {
      load(); await wait();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw adapterError('VALIDATION_FAILED', '仅支持 PNG/JPEG/WebP', 400);
      }
      if (file.size > 20971520) throw adapterError('RESOURCE_EXCEEDED', '图片超过 20MB 上限', 413);
      const bytes = new Uint8Array(await fileToArrayBuffer(file));
      const hash = await sha256Hex(bytes.buffer);
      const size = await imageSize(bytes, file.type);
      const id = uuid();
      const previewUrl = await readAsDataUrl(file);
      doc = {
        ...doc,
        assets: {
          ...doc.assets,
          [id]: { id, hash, width: size.width, height: size.height, format: file.type, byteSize: file.size, previewUrl, refCount: 0, mock: false },
        },
      };
      save();
      return doc.assets[id];
    },

    async exportLayer({ layerId, bounds }) {
      load(); await wait();
      const layer = Object.values(doc.layers).find((l) => l.id === layerId);
      if (!layer) throw adapterError('LAYER_NOT_FOUND', '图层不存在', 404);
      const asset = doc.assets[layer.assetId];
      return mockCanvasExport(asset, layer, bounds);
    },

    async exportComposite(canvasId) {
      load(); await wait();
      const canvas = requireCanvas(canvasId);
      const layers = listLayers(canvasId).filter((l) => l.visible); // 排除隐藏层，包含锁定层
      const assets = layers.map((l) => doc.assets[l.assetId]).filter(Boolean);
      return mockCanvasExport(assets, layers, 'canvas', canvas);
    },

    // ---- 生成（mock）----

    async submitGeneration(batch) {
      load(); await wait();
      const batchId = uuid();
      const canvas = requireCanvas(batch.canvasId);
      const created = [];
      for (const modelId of batch.models) {
        const spec = mockCatalog.models.find((m) => m.id === modelId);
        if (!spec) {
          created.push({ taskId: '', model: modelId, status: 'failed', error: '模型不存在（mock 目录）', mock: true, createdAt: now() });
          continue;
        }
        const refCount = (batch.referenceLayerIds || []).length;
        if (refCount > 0 && !spec.supportsReference) {
          // 不支持参考的模型：清楚状态，不悄悄丢弃输入
          created.push({
            taskId: '', model: modelId, status: 'failed', mock: true, createdAt: now(),
            error: `该模型不支持参考图（最多 ${spec.maxRefs ?? 0} 张），已保留你的参考选择未提交`,
            code: 'REFERENCE_UNSUPPORTED',
          });
          continue;
        }
        if (spec.minRefs > 0 && refCount < spec.minRefs) {
          created.push({
            taskId: '', model: modelId, status: 'failed', mock: true, createdAt: now(),
            error: `该模型至少需要 ${spec.minRefs} 张参考图`,
            code: 'REFERENCE_REQUIRED',
          });
          continue;
        }
        const ratio = batch.params?.[modelId]?.aspectRatio || 'auto';
        if (ratio !== 'auto' && !spec.ratios.includes(ratio)) {
          created.push({ taskId: '', model: modelId, status: 'failed', mock: true, createdAt: now(), error: '该模型不支持此比例', code: 'VALIDATION_FAILED' });
          continue;
        }
        const taskId = uuid();
        const n = batch.params?.[modelId]?.n || 1;
        const task = {
          taskId, batchId, model: modelId, mock: true,
          status: 'queued', createdAt: now(),
          costEstimate: mockCostEstimate(spec, batch.params?.[modelId]?.quality, n),
          effectiveParams: {
            model: modelId, prompt: batch.prompt, aspectRatio: ratio,
            quality: batch.params?.[modelId]?.quality || 'auto',
            resolution: batch.params?.[modelId]?.resolution || '',
            n, referenceLayerIds: [...(batch.referenceLayerIds || [])],
            referenceInputMode: batch.referenceInputMode || 'separate',
            targetRect: batch.targetRect ? { ...batch.targetRect } : null,
          },
          sourceRevision: canvas.revision,
          candidates: [],
        };
        tasks.set(taskId, task);
        created.push(task);
        scheduleMockTask(taskId, { ...batch, id: batchId });
      }
      const record = {
        batch: {
          id: batchId, canvasId: batch.canvasId, sourceRevision: canvas.revision,
          referenceSnapshot: [...(batch.referenceLayerIds || [])],
          targetRect: batch.targetRect ? { ...batch.targetRect } : null,
          prompt: batch.prompt, models: [...batch.models], mock: true, createdAt: now(),
        },
        candidates: [],
        timers: [],
      };
      batches.set(batchId, record);
      save();
      return { tasks: created.map((t) => ({ ...t })) };
    },

    async getTask(taskId) {
      load(); await wait(60);
      const task = tasks.get(taskId);
      if (!task) throw adapterError('TASK_NOT_FOUND', '任务不存在', 404);
      return { ...task, candidates: task.candidates.map((id) => doc.assets[id]).filter(Boolean) };
    },

    async cancelTask(taskId) {
      const task = tasks.get(taskId);
      if (!task) throw adapterError('TASK_NOT_FOUND', '任务不存在', 404);
      if (task.timer) clearTimeout(task.timer);
      if (['queued', 'submitting', 'polling'].includes(task.status)) task.status = 'cancelled';
      return { ok: true };
    },

    async listBatches(canvasId) {
      load();
      return { batches: [...batches.values()].filter((r) => r.batch.canvasId === canvasId).map((r) => ({ ...r.batch, candidates: r.candidates.map((id) => doc.assets[id]).filter(Boolean), tasks: [...tasks.values()].filter((t) => t.batchId === r.batch.id).map(({timer,...t}) => t) })) };
    },

    async getBatch(batchId) {
      load();
      const record = batches.get(batchId);
      if (!record) throw adapterError('TASK_NOT_FOUND', '批次不存在', 404);
      return {
        ...record.batch,
        candidates: record.candidates.map((id) => doc.assets[id]).filter(Boolean),
        tasks: [...tasks.values()].filter((t) => t.batchId === batchId).map((t) => ({ ...t })),
      };
    },

    // 候选应用为新图层（固定落点 targetRect，落点语义=新图层放置，不是修改原像素）
    async applyCandidate(batchId, candidateAssetId, targetRect) {
      load(); await wait();
      const record = batches.get(batchId);
      if (!record) throw adapterError('TASK_NOT_FOUND', '批次不存在', 404);
      const asset = doc.assets[candidateAssetId];
      if (!asset) throw adapterError('ASSET_NOT_FOUND', '候选素材不存在', 404);
      const canvasId = record.batch.canvasId;
      const canvas = requireCanvas(canvasId);
      let rect = targetRect || record.batch.targetRect;
      if (!rect) {
        // 未选落点时应用在画布中心（contain 拟合，保持素材比例）
        const scale = Math.min(canvas.width / asset.width, canvas.height / asset.height, 1);
        const w = asset.width * scale;
        const h = asset.height * scale;
        rect = { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, width: w, height: h };
      }
      // 等比铺满落点（contain）：保持素材比例，落在已固定 rect 内
      const scale = Math.min(rect.width / asset.width, rect.height / asset.height);
      const w = asset.width * scale;
      const h = asset.height * scale;
      const matrix = [scale, 0, 0, scale, rect.x + (rect.width - w) / 2, rect.y + (rect.height - h) / 2];
      const layerId = uuid();
      const layer = {
        id: layerId, kind: 'image', assetId: asset.id, name: `生成图层 ${now().toString(36).slice(-4)}`,
        visible: true, locked: false, opacity: 1, matrix,
      };
      const { state } = applyCommand(doc, makeCommand('applyGeneratedResult', canvasId, canvas.revision, {
        layer, batchId, candidateId: candidateAssetId,
      }));
      doc = {
        ...state,
        assets: { ...state.assets, [asset.id]: { ...asset, refCount: (asset.refCount || 0) + 1 } },
      };
      save();
      return { canvas: doc.canvases[canvasId], layer: doc.layers[layerId], newRevision: doc.canvases[canvasId].revision };
    },

    // 测试/调试辅助
    _reset() {
      doc = emptyDocument();
      save();
    },
    _seedDemoContent: seedDemoContent,
  };

  function scheduleMockTask(taskId, batch) {
    const task = tasks.get(taskId);
    if (!task) return;
    const params = batch.params?.[task.model] || {};
    const seedKey = `${task.model}|${batch.prompt}|${params.aspectRatio || 'auto'}|${taskId}`;
    const total = taskDuration ?? (900 + Math.random() * 900);
    // 阶段时刻按总时长等比缩放（60/240 对应默认 900ms 基准），固定时长时也保持完整生命周期
    const steps = [
      { at: Math.max(1, Math.round(total * (60 / 900))), status: 'submitting' },
      { at: Math.max(2, Math.round(total * (240 / 900))), status: 'polling' },
      { at: Math.max(3, Math.round(total)), status: 'completed' },
    ];
    for (const step of steps) {
      const timer = setTimeout(() => {
        if (task.status === 'cancelled' || task.status === 'failed') return;
        task.status = step.status;
        if (step.status === 'completed') {
          const n = params.n || 1;
          const record = batches.get(batch.id);
          void (async () => {
            for (let i = 0; i < n; i++) {
              const assetId = uuid();
              const asset = {
                id: assetId,
                hash: await sha256Hex(seedKey + '#' + i),
                width: 768, height: 768,
                format: 'image/png', byteSize: 0,
                previewUrl: mockPreviewDataUrl(seedKey + '#' + i, 768, 768),
                refCount: 0, mock: true,
              };
              doc = { ...doc, assets: { ...doc.assets, [assetId]: asset } };
              task.candidates.push(assetId);
              if (record) record.candidates.push(assetId);
            }
            save();
          })();
        }
      }, step.at);
      task.timer = timer;
    }
  }
}

// ---- 浏览器侧 mock 导出（真实 canvas 合成；node 环境明确报错，不伪造）----

async function mockCanvasExport(assetOrAssets, layerOrLayers, bounds, canvasDoc) {
  const isSingle = !Array.isArray(assetOrAssets);
  const assets = isSingle ? [assetOrAssets] : assetOrAssets;
  const layers = isSingle ? [layerOrLayers] : layerOrLayers;
  const canvas = canvasDoc || (isSingle ? { width: assets[0].width, height: assets[0].height, background: '#ffffff' } : null);
  if (typeof document === 'undefined' || !document.createElement) {
    throw adapterError('EXPORT_UNSUPPORTED', 'mock 导出需要在浏览器环境执行（集成后由 render-worker 原尺寸导出）', 501);
  }
  const outW = bounds === 'canvas' && canvas ? canvas.width : assets[0].width;
  const outH = bounds === 'canvas' && canvas ? canvas.height : assets[0].height;
  const el = document.createElement('canvas');
  el.width = outW;
  el.height = outH;
  const ctx = el.getContext('2d');
  if (!ctx) throw adapterError('EXPORT_UNSUPPORTED', 'canvas 2d 不可用', 501);
  if (bounds === 'canvas') {
    ctx.fillStyle = canvas.background || '#ffffff'; // 白底
    ctx.fillRect(0, 0, outW, outH);
  }
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const asset = assets[i];
    if (!layer.visible) continue; // 隐藏层排除（锁定层包含）
    const img = await loadImage(asset.previewUrl);
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    const [a, b, c, d, e, f] = layer.matrix;
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0, asset.width, asset.height);
    ctx.restore();
  }
  return await new Promise((resolve, reject) => {
    el.toBlob((blob) => (blob ? resolve(blob) : reject(adapterError('EXPORT_FAILED', 'canvas 编码失败', 500))), 'image/png');
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(adapterError('ASSET_NOT_FOUND', '预览图加载失败', 404));
    img.src = src;
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(adapterError('UPLOAD_FAILED', '文件读取失败', 400));
      reader.readAsDataURL(file);
      return;
    }
    // node 测试环境兜底
    file.arrayBuffer().then((buf) => {
      const b64 = Buffer.from(buf).toString('base64');
      resolve(`data:${file.type};base64,${b64}`);
    }).catch(() => reject(adapterError('UPLOAD_FAILED', '文件读取失败', 400)));
  });
}

// 兼容取文件字节：浏览器 File 有 arrayBuffer；jsdom File 没有，走 FileReader.readAsArrayBuffer
function fileToArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(adapterError('ADAPTER_INTERNAL', '当前环境无法读取文件字节', 500));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(adapterError('UPLOAD_FAILED', '文件读取失败', 400));
    reader.readAsArrayBuffer(file);
  });
}

async function imageSize(bytes, type) {
  if (type === 'image/png') {
    // PNG IHDR: 宽高在偏移 16..24
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (typeof document !== 'undefined' && document.createElement) {
    try {
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      return { width: img.naturalWidth, height: img.naturalHeight };
    } catch { /* 落到底部默认 */ }
  }
  return { width: 1024, height: 1024 };
}
