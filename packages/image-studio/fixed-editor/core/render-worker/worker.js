// 独立子进程 worker：完整解码/合成在子进程完成，OOM/超时退出不影响主服务。
// 协议：父进程 send({jobId, type, plan, assets:[{assetId, path, width, height}], outputPath})
//       子进程 reply({jobId, ok, outputPath, width, height}) 或 {jobId, ok:false, error}
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResourcePolicy } from '../resource-policy/policy.js';
import { probeImage } from '../asset-repository/probe.js';
import { multiply, fromTRS } from '../document-core/matrix.js';
import { compositeRenderPlan, renderLayer } from './composite.js';
import { decodePng, encodePng } from './png-codec.js';

async function loadAsset(io, decode, a, policy) {
  if (a.rgba) {
    policy.admitDecode(a.width, a.height);
    const data = Buffer.from(a.rgba);
    if (data.length !== a.width * a.height * 4) throw new Error('素材像素长度无效');
    return { width: a.width, height: a.height, data };
  }
  const bytes = await io.readFile(a.path);
  policy.checkUploadBytes(bytes.length);
  const actual = probeImage(bytes);
  policy.admitDecode(actual.width, actual.height);
  if (actual.width !== a.width || actual.height !== a.height) throw new Error('素材尺寸与冻结元数据不符');
  const decoded = await decode(bytes);
  if (decoded.width !== actual.width || decoded.height !== actual.height) throw new Error('解码尺寸与素材元数据不符');
  return { width: decoded.width, height: decoded.height, data: decoded.rgba || decoded.data };
}

export function createWorker({ io = { readFile, writeFile, rename, mkdir, unlink }, decode = decodePng, encode = encodePng, policy = createResourcePolicy() } = {}) {
  return async function handleJob(job) {
    const { type, plan, assets = [], outputPath } = job;
    if (!plan || !Array.isArray(plan.items)) throw new Error('渲染计划无效');
    policy.checkLayerCount(plan.items.length);
    policy.checkCanvasSize(plan.width, plan.height);
    const wanted = new Set((type === 'export-layer' ? plan.items.filter(i => i.layerId === job.layerId) : plan.items.filter(i => i.visible)).map(i => i.assetId));
    const selected = [...wanted].map(id => { const a = assets.find(a => a.assetId === id); if (!a) throw new Error(`素材缺失: ${id}`); return a; });
    policy.admitExport(plan.width, plan.height, selected);
    const pixels = {};
    for (const a of selected) pixels[a.assetId] = await loadAsset(io, decode, a, policy);
    let result;
    if (type === 'export-composite' || type === 'preview') {
      const width = type === 'preview' ? job.width : plan.width;
      const height = type === 'preview' ? job.height : plan.height;
      policy.checkCanvasSize(width, height);
      policy.admitExport(width, height, selected);
      const scale = fromTRS({ scaleX: width / plan.width, scaleY: height / plan.height });
      const items = type === 'preview' ? plan.items.map(i => ({ ...i, matrix: multiply(scale, i.matrix) })) : plan.items;
      result = { data: compositeRenderPlan({ ...plan, width, height, items }, pixels), width, height };
    } else if (type === 'export-layer') {
      const item = plan.items.find(i => i.layerId === job.layerId);
      if (!item) throw new Error(`图层不在渲染计划中: ${job.layerId}`);
      result = renderLayer(plan, item, pixels, job.bounds || 'content');
    } else throw new Error(`未知任务类型: ${type}`);
    const png = await encode(result.width, result.height, result.data);
    await io.mkdir(dirname(outputPath), { recursive: true });
    const tmp = `${outputPath}.${process.pid}.tmp`;
    try {
      await io.writeFile(tmp, png);
      await io.rename(tmp, outputPath);
    } finally {
      try { await io.unlink?.(tmp); } catch {}
    }
    return { ok: true, outputPath, width: result.width, height: result.height, bytes: png.length, resourceUsage: { rssBytes: process.memoryUsage().rss, maxRssBytes: process.resourceUsage().maxRSS * 1024 } };
  };
}

export function startWorkerProcess({ send = m => process.send?.(m), handleJob = createWorker() } = {}) {
  let busy = false;
  process.on('message', async job => {
    if (busy) { send({ jobId: job.jobId, ok: false, error: '渲染 worker 忙碌，请经受限队列提交' }); return; }
    busy = true;
    try { send({ jobId: job.jobId, ...(await handleJob(job)) }); }
    catch (error) { send({ jobId: job.jobId, ok: false, error: error?.message || String(error) }); }
    finally { busy = false; }
  });
  process.on('disconnect', () => process.exit(0));
}
// 直接执行本文件时作为子进程启动
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startWorkerProcess();
