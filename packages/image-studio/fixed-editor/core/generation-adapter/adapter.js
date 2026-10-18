// generation-adapter：接入原模型能力/费用/任务/候选，不复制模型参数定义。
// 模型能力来源经注入（集成层接 image-studio/model-registry|model-selection|image-parameters），
// 本模块只做：批次冻结（revision+参考快照+目标落点+有效参数）、多模型抽卡、候选、幂等应用。
import { docError, newId } from '../document-core/ids.js';

export function createGenerationAdapter({ engine, config, assets, modelRuntime, batchStore, canvasExists, readTaskResult, layerAsset, now = () => Date.now() }) {
  // engine: 现有 createEngine 实例 {submit, list, recover, retryDownload, dismiss}
  // modelRuntime: {resolveSelectedModel, ratiosFor, sizeForRatio, validateParameters, modelSpec}
  // batchStore: {load()->Batch[], save(Batch[])->Promise}
  // canvasExists: async (canvasId) => bool
  // readTaskResult: async (taskId, resultIndex) => {bytes, type, name}
  // layerAsset: async (layerId) => Asset|null（文档层查询，由集成层经 project-repository 提供）
  const load = async () => (await batchStore.load()) || [];
  const saveAll = async batches => batchStore.save(batches);
  const findBatch = async id => (await load()).find(b => b.id === id) || null;

  const api = {
    async resolveDraft(draft = {}) {
      const current = await config();
      const model = modelRuntime.resolveSelectedModel(current, draft.model);
      const ratios = modelRuntime.ratiosFor(model);
      const aspectRatio = draft.aspectRatio && ratios.includes(draft.aspectRatio) ? draft.aspectRatio : (draft.aspectRatio === undefined ? 'auto' : null);
      if (aspectRatio === null) throw docError('VALIDATION_FAILED', '图片比例不支持');
      const size = draft.aspectRatio && draft.aspectRatio !== 'auto' ? modelRuntime.sizeForRatio(model, draft.aspectRatio, draft.resolution || '') : (draft.size || 'auto');
      return { model, prompt: String(draft.prompt ?? ''), aspectRatio, resolution: draft.resolution || '', size, quality: draft.quality || 'auto', n: Math.min(Math.max(1, draft.n || 1), 15), ...(draft.sourceTaskId !== undefined ? {sourceTaskId:draft.sourceTaskId} : {}), ...(draft.maskReferenceId !== undefined ? {maskReferenceId:draft.maskReferenceId} : {}), extra: draft.extra || {} };
    },
    // 模型能力探测：不悄悄丢弃输入。referenceCount>0 时不支持参考的模型给出清楚状态。
    describeCapabilities(model, { referenceCount = 0 } = {}) {
      try {
        modelRuntime.validateParameters({ model, prompt: 'x' }, referenceCount);
        return { model, supportsReference: true, status: 'ok', note: referenceCount > 0 ? `支持 ${referenceCount} 张参考图` : '' };
      } catch (error) {
        return { model, supportsReference: false, status: 'unsupported', note: error.message || '该模型不支持参考图' };
      }
    },
    async createBatch({ canvasId, sourceRevision, referenceLayerIds = [], targetRect, request }) {
      if (!canvasId) throw docError('VALIDATION_FAILED', '批次缺少 canvasId');
      if (!Number.isInteger(sourceRevision) || sourceRevision < 0) throw docError('VALIDATION_FAILED', '批次 revision 无效');
      if (!targetRect || !Number.isFinite(targetRect.width) || !Number.isFinite(targetRect.height) || !Number.isFinite(targetRect.x) || !Number.isFinite(targetRect.y) || !(targetRect.width > 0) || !(targetRect.height > 0)) throw docError('VALIDATION_FAILED', '目标落点无效');
      const draft = await this.resolveDraft(request);
      const referenceSnapshot = [];
      for (const layerId of referenceLayerIds) {
        const asset = layerAsset ? await layerAsset(layerId, canvasId) : null;
        if (!asset) throw docError('ASSET_NOT_FOUND', `参考图层不存在: ${layerId}`);
        if (asset) referenceSnapshot.push({ layerId, assetId: asset.id, hash: asset.hash, width: asset.width, height: asset.height, ...(asset.matrix ? { matrix: [...asset.matrix], opacity: asset.opacity ?? 1, visible: asset.visible ?? true } : {}) });
      }
      const batch = {
        id: newId(), canvasId, sourceRevision,
        referenceSnapshot, targetRect: { ...targetRect },
        effectiveParams: structuredClone(draft), // 冻结时点的模型有效参数（透传原 generation 引擎语义）
        models: [], taskIds: [], candidates: [], modelStatus: {},
        state: 'draft', createdAt: now(), appliedCandidateId: null,
      };
      const batches = await load();
      batches.push(batch);
      await saveAll(batches);
      return batch;
    },
    async submitBatch(batchId, { models, requestsByModel = {}, execution, origin } = {}) {
      const batch = await findBatch(batchId);
      if (!batch) throw docError('VALIDATION_FAILED', '生成批次不存在');
      if (batch.state !== 'draft') throw docError('VALIDATION_FAILED', '批次已提交，不能重复提交');
      const current = await config();
      const targets = models && models.length ? models : current.enabledModels;
      const submitted = [];
      const persistBatch = async () => saveAll((await load()).map(b => b.id === batch.id ? batch : b));
      batch.models = [...new Set(targets)];
      batch.requestsByModel = structuredClone(requestsByModel); // Freeze even failed model requests for exact explicit replay.
      batch.modelStatus = Object.fromEntries(batch.models.map(model => [model, { status: 'not_submitted', requestId: newId() }]));
      batch.state = 'submitting';
      await persistBatch(); // 不确定的进程中断不得自动重提已发生的付费请求。
      for (const model of [...new Set(targets)]) {
        const cap = this.describeCapabilities(model, { referenceCount: batch.referenceSnapshot.length });
        if (!cap.supportsReference) { batch.modelStatus[model] = cap; await persistBatch(); continue; }
        const requestId = batch.modelStatus[model].requestId;
        let engineAttempted = false;
        try {
          const params = await this.resolveDraft({ ...structuredClone(batch.effectiveParams), ...structuredClone(requestsByModel[model] || {}), model });
          const draft = { ...params, requestId, referenceIds: batch.referenceSnapshot.map(r => r.assetId) };
          modelRuntime.validateParameters(draft, batch.referenceSnapshot.length);
          batch.modelStatus[model] = { ...cap, status: 'submitting', requestId, effectiveParams: params };
          await persistBatch();
          engineAttempted = true;
          const task = await engine.submit(draft, execution, origin);
          if (!task?.id) throw new Error('生成引擎未返回 taskId');
          batch.modelStatus[model] = { ...cap, requestId, taskId: task.id, status: 'submitted', effectiveParams: params };
          batch.taskIds.push(task.id);
          submitted.push({ model, taskId: task.id });
        } catch (error) {
          batch.modelStatus[model] = { ...batch.modelStatus[model], ...cap, status: engineAttempted ? 'uncertain' : 'failed', requestId, note: error.message || String(error) };
        }
        await persistBatch();
      }
      batch.state = Object.values(batch.modelStatus).some(s => s.status === 'uncertain') ? 'uncertain' : (submitted.length ? 'submitted' : 'failed');
      batch.submittedAt = now();
      await persistBatch();
      if (!submitted.length) throw docError('VALIDATION_FAILED', '没有可提交的模型：' + Object.values(batch.modelStatus).map(s => s.note).join('；'));
      return { batch, submitted };
    },
    async recoverSubmittingBatches() {
      const batches = await load();
      let tasks;
      try { tasks = await engine.list(); } catch { tasks = []; }
      if (!Array.isArray(tasks)) tasks = [];
      for (const batch of batches.filter(b => b.state === 'submitting')) {
        let uncertain = false;
        batch.modelStatus ||= {};
        batch.taskIds ||= [];
        for (const model of batch.models || Object.keys(batch.modelStatus || {})) {
          const status = batch.modelStatus[model] || { requestId: `${batch.id}:${model}` };
          if (status.taskId) continue;
          if (['unsupported', 'failed'].includes(status.status)) continue;
          const requestId = status.requestId || `${batch.id}:${model}`;
          const matched = tasks.filter(t => t.requestId === requestId || t.id === requestId);
          if (matched.length === 1) {
            const task = matched[0];
            batch.modelStatus[model] = { ...status, requestId, taskId: task.id, status: 'submitted', recoveredAt: now() };
            if (!batch.taskIds.includes(task.id)) batch.taskIds.push(task.id);
          } else {
            uncertain = true;
            batch.modelStatus[model] = { ...status, requestId, status: 'uncertain', note: '中断后无法唯一确认引擎任务；禁止自动重提' };
          }
        }
        batch.state = uncertain ? 'uncertain' : (batch.taskIds.length ? 'submitted' : 'failed');
        batch.recoveredAt = now();
      }
      await saveAll(batches);
      return batches.filter(b => b.recoveredAt !== undefined);
    },
    async syncCandidates(batchId) { // 从引擎任务同步候选（结果先入候选，不自动加层）
      const batch = await findBatch(batchId);
      if (!batch) throw docError('VALIDATION_FAILED', '生成批次不存在');
      const tasks = await engine.list();
      for (const taskId of batch.taskIds) {
        const task = tasks.find(t => t.id === taskId);
        if (!task) continue;
        const model = Object.entries(batch.modelStatus).find(([, status]) => status.taskId === taskId)?.[0] || task.model;
        if (['completed', 'failed', 'timed_out', 'uncertain'].includes(task.status)) {
          const existing = batch.candidates.find(c => c.taskId === taskId);
          const images = (task.results || []).map((r, i) => ({ resultIndex: i, sourceKey: r.sourceKey, name: r.name, type: r.type }));
          if (existing) Object.assign(existing, { status: task.status, images });
          else batch.candidates.push({ candidateId: newId(), taskId, model, status: task.status, images, createdAt: now(), appliedAt: null, appliedLayerId: null });
        }
      }
      const batches = (await load()).map(b => (b.id === batch.id ? batch : b));
      await saveAll(batches);
      return batch.candidates;
    },
    // 应用候选 = 一条可撤销命令（applyGeneratedResult），放到批次冻结时的固定落点。
    async buildApplyCommand(batchId, candidateId, { layerName, resultIndex = 0, layout } = {}) {
      const batch = await findBatch(batchId);
      if (!batch) throw docError('VALIDATION_FAILED', '生成批次不存在');
      const candidate = batch.candidates.find(c => c.candidateId === candidateId);
      if (!candidate) throw docError('VALIDATION_FAILED', '候选不存在');
      if (candidate.status !== 'completed' || !candidate.images.length) throw docError('VALIDATION_FAILED', '候选尚未完成，不能应用');
      if (!Number.isInteger(resultIndex) || resultIndex < 0) throw docError('VALIDATION_FAILED', '候选结果索引无效');
      const legacyIndex=candidate.applyResultIndex ?? 0;
      const applicationId = candidate.applyEnvelopes?.[resultIndex]?.payload.candidateId || (candidate.applyEnvelope && legacyIndex===resultIndex ? candidate.applyEnvelope.payload.candidateId : resultIndex===0 && (!candidate.applyEnvelope || legacyIndex===0) ? candidateId : `${candidateId}:result:${resultIndex}`);
      const legacy = candidate.applyResultIndex === resultIndex || (resultIndex === 0 && candidate.applyResultIndex === undefined);
      const applied = candidate.applications?.[resultIndex] || (legacy && candidate.appliedLayerId ? {layerId:candidate.appliedLayerId} : null);
      if (applied) return { alreadyApplied:true,layerId:applied.layerId,applicationId };
      if (canvasExists && !(await canvasExists(batch.canvasId))) throw docError('CANVAS_NOT_FOUND', '目标画布已不存在，结果不会落错文档');
      const prepared = candidate.applyEnvelopes?.[resultIndex] || (legacy ? candidate.applyEnvelope : null);
      if (prepared) return { envelope:structuredClone(prepared),asset:structuredClone(prepared.payload.asset),candidate,batch,applicationId };
      const image = candidate.images.find(i => i.resultIndex === resultIndex);
      if (!image) throw docError('VALIDATION_FAILED', '候选结果索引无效');
      const { bytes, type, name } = await readTaskResult(candidate.taskId, image.resultIndex);
      const asset = await assets.register({ bytes, name: layerName || name || '生成结果' });
      let targetRect={...batch.targetRect};
      if(layout==='grid'){
        const task=engine.list().find(t=>t.id===candidate.taskId);
        const images=(task?.results||[]).filter(r=>r.resultRole!=='grid');
        const image=task?.results?.[resultIndex];
        if(candidate.model!=='midjourney'||images.length!==4||new Set(images.map(r=>r.providerIndex)).size!==4||!images.every(r=>Number.isInteger(r.providerIndex)&&r.providerIndex>=1&&r.providerIndex<=4)||image?.resultRole==='grid')throw docError('VALIDATION_FAILED','仅支持四张有原始序号的 Midjourney 图片按网格加入');
        const slot=image.providerIndex-1,w=targetRect.width/2,h=targetRect.height/2;
        targetRect={x:targetRect.x+(slot%2)*w,y:targetRect.y+Math.floor(slot/2)*h,width:w,height:h};
      }
      const envelope = {
        id: newId(), type: 'applyGeneratedResult', canvasId: batch.canvasId, baseRevision: -1, // 由提交方按当前 revision 填充
        payload: { candidateId:applicationId, layerId:resultIndex === 0 ? candidateId : newId(), asset, targetRect, name: layerName || name || '生成结果' }, createdAt: now(),
      };
      candidate.applyEnvelopes ||= {};
      candidate.applyEnvelopes[resultIndex] = structuredClone(envelope);
      await saveAll((await load()).map(b => b.id === batch.id ? batch : b));
      return { envelope, asset, candidate, batch };
    },
    async markApplied(batchId, candidateId, layerId, resultIndex = 0) {
      const batches = await load();
      const batch = batches.find(b => b.id === batchId);
      if (!batch) return null;
      const candidate = batch.candidates.find(c => c.candidateId === candidateId);
      if (!candidate) throw docError('VALIDATION_FAILED', '候选不存在');
      candidate.applications ||= {};
      const existing=candidate.applications[resultIndex];
      if(existing&&existing.layerId!==layerId)throw docError('VALIDATION_FAILED','此结果已应用到其他图层');
      candidate.applications[resultIndex]={layerId,appliedAt:now()};
      // Keep legacy fields readable for existing documents; per-result receipts own idempotency.
      if(resultIndex===0){candidate.appliedAt=now();candidate.appliedLayerId=layerId;}
      batch.appliedCandidateId = candidateId;
      await saveAll(batches);
      return batch;
    },
    async listBatches({ canvasId } = {}) {
      const batches = await load();
      return canvasId ? batches.filter(b => b.canvasId === canvasId) : batches;
    },
    async getBatch(batchId) { return findBatch(batchId); },
  };
  // 单一writer中的batch read-modify-save串行化，避免不同批次保存覆盖或重复准备候选。
  let mutations = Promise.resolve();
  for (const name of ['createBatch', 'submitBatch', 'syncCandidates', 'buildApplyCommand', 'markApplied', 'recoverSubmittingBatches']) {
    const run = api[name];
    api[name] = (...args) => {
      const next = mutations.then(() => run.apply(api, args));
      mutations = next.catch(() => {});
      return next;
    };
  }
  return api;
}
