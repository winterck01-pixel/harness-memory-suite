import {KlingReferenceControls} from '../../../../video-studio/kling-reference-controls.jsx';
// Native model selection, reference bindings and batch generation share the live editor adapter.
import React, { useEffect, useMemo, useState } from 'react';
import { useStore, useEditorState } from '../state/storeContext.jsx';
import { commonModelRatios, chooseTargetRatio } from '../lib/targetRatio.js';
import { ReferenceControls } from './ReferenceControls.jsx';
import { ModelMenu } from './ModelMenu.jsx';
import { PromptReferences } from './PromptReferences.jsx';
import { GenerationCandidates } from './GenerationCandidates.jsx';
import { MidjourneyControls } from '../../../../live-film/midjourney-controls.jsx';
import { TaskBilling } from '../../../../live-film/cost-ui.jsx';
import { CardIcon, TargetIcon, ReferenceIcon, CloseIcon } from './icons.jsx';


function effectiveModelParams(MODELS, selectedModels, params, targetRatio = null) {
  const effectiveParams = {};
  for (const id of selectedModels) {
      const model = MODELS.find((m) => m.id === id);
      const values = params[id] || {};
      const extraDefaults = Object.fromEntries(Object.entries(model?.parameterSchema?.properties || {}).filter(([,f]) => f.default !== undefined).map(([key,f]) => [key,f.default]));
      effectiveParams[id] = { aspectRatio: model?.ratios?.[0] || 'auto', ...(model?.sizes?.length ? {resolution:model.sizes[0]} : {}), ...(model?.quality?.length ? {quality:model.quality[0]} : {}), ...values, ...(targetRatio ? {aspectRatio:targetRatio} : {}), extra: {...extraDefaults,...values.extra} };
    }
  return effectiveParams;
}

function costLabel(item) {
  const finite=(n)=>typeof n === 'number' && Number.isFinite(n);
  const range=(lo,hi)=>finite(lo) ? (finite(hi) && hi !== lo ? `${lo}–${hi}` : String(lo)) : null;
  const credits=range(item.creditsMin,item.creditsMax);
  const usd=range(item.costUsdMin,item.costUsdMax);
  const parts=[];
  if(credits !== null) parts.push(`${credits} 积分`);
  if(usd !== null) parts.push(`USD ${usd}`);
  if(!parts.length && finite(item.amount)) parts.push(`${item.amount} ${item.currency || ''}`);
  return parts.length ? parts.join(' · ') : '费用未知';
}

const COST_LABELS={public_reference:'公开参考价',estimated:'账户估算',unknown:'费用未知',unavailable:'暂不可用'};
const TASK_LABELS = {
  queued: '等待提交', submitting: '正在提交', polling: '生成中',
  completed: '已完成', failed: '失败', cancelled: '已取消',
};

export function GenerationPanel({ targetRectMode, setTargetRectMode, referenceDraft }) {
  const store = useStore();
  const state = useEditorState();
  const MODELS = state.models || [];
  const {prompt,setPrompt,mentions,setMentions,manualIds:referenceLayerIds,setManualIds:setReferenceLayerIds,resolved:referenceInput}=referenceDraft;
  const promptApi=React.useRef(null);
  const [selectedModels, setSelectedModels] = useState([]);
  const [params, setParams] = useState({}); // modelId -> {aspectRatio, resolution, quality, n}
  const [referenceInputMode, setReferenceInputMode] = useState('separate'); // separate | composite
  const submittedRefs = referenceInput.ids;
  const submittedMode = referenceInput.mentions.length ? 'separate' : referenceInputMode;
  const [jsonDrafts, setJsonDrafts] = useState({});
  const [schemaErrors, setSchemaErrors] = useState({});
  const [cost, setCost] = useState(null);
  const [costLoading, setCostLoading] = useState(false);
  const targetRatios = useMemo(() => commonModelRatios(MODELS, selectedModels), [MODELS, selectedModels]);
  const targetRatio = chooseTargetRatio(targetRatios, state.targetAspectRatio || params[selectedModels[0]]?.aspectRatio, state.canvas);
  useEffect(() => {
    if (!targetRatio && state.targetRect) store.setNotice('所选模型没有共同支持的固定比例，已清除框选区域', 'info');
    store.setTargetAspectRatio(targetRatio);
    if (!targetRatio) setTargetRectMode(false);
  }, [store, targetRatio, state.canvas?.id, setTargetRectMode]);

  useEffect(() => {
    setCost(null);
    if (!selectedModels.length || !state.canvas || referenceInput.error) { setCostLoading(false); return; }
    let cancelled=false;
    setCostLoading(true);
    const timer=setTimeout(async () => {
      try {
        const result=await store.adapter.costPreview({canvasId:state.canvas.id,prompt,models:selectedModels,params:effectiveModelParams(MODELS,selectedModels,params,state.targetRect ? targetRatio : null),referenceLayerIds:submittedRefs,referenceInputMode:submittedMode,referenceMentions:referenceInput.mentions,targetRect:state.targetRect});
        if(!cancelled) setCost(result);
      } catch(e) {if(!cancelled) setCost({estimate:{status:'unavailable',reason:e.message || String(e)}});}
      finally {if(!cancelled) setCostLoading(false);}
    },300);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[store,state.canvas?.id,prompt,selectedModels,params,submittedRefs.join('|'),submittedMode,JSON.stringify(referenceInput.mentions),state.targetRect?.x,state.targetRect?.y,state.targetRect?.width,state.targetRect?.height,targetRatio]);

  function toggleModel(id) {
    setSelectedModels((cur) => {
      if (cur.includes(id)) {
        const next = { ...params };
        delete next[id];
        setParams(next);
        return cur.filter((m) => m !== id);
      }
      return [...cur, id];
    });
  }

  function setParam(modelId, key, value) {
    if (key === 'aspectRatio' && targetRatios.includes(value)) store.setTargetAspectRatio(value);
    setParams((cur) => ({ ...cur, [modelId]: { ...cur[modelId], [key]: value } }));
  }

  function setExtraParam(modelId, key, value) {
    setParams((cur) => ({ ...cur, [modelId]: { ...cur[modelId], extra: { ...cur[modelId]?.extra, [key]: value } } }));
  }

  async function submit() {
    if(referenceDraft.active){store.setNotice('请先完成或取消参考选图','info');return;}
    if (selectedModels.some((id) => Object.keys(schemaErrors).some((key) => key.startsWith(id + ':')))) {
      store.setNotice('请修正模型参数 JSON 后提交', 'error'); return;
    }
    if (referenceInput.error) { store.setNotice(referenceInput.error, 'error'); return; }
    const effectiveParams = effectiveModelParams(MODELS,selectedModels,params,state.targetRect ? targetRatio : null);
    for (const id of selectedModels) {
      const schema = MODELS.find((m) => m.id === id)?.parameterSchema?.properties || {};
      for (const [key,field] of Object.entries(schema)) {
        const value=effectiveParams[id].extra[key];
        if(value === undefined) continue;
        if ((['number','integer'].includes(field.type) && (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value)) || (field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)))) {
          store.setNotice(`${id} 参数 ${field.title || key} 超出有效范围`, 'error'); return;
        }
      }
    }
    const batchId = await store.submitGeneration({
      prompt, models: selectedModels, params: effectiveParams, referenceLayerIds: submittedRefs, referenceInputMode: submittedMode, referenceMentions: referenceInput.mentions,
    });
    if (batchId) setPrompt('');
  }

  const batch = state.activeBatch;
  const activeTasks = batch ? batch.tasks : [];
  const pending = activeTasks.some((t) => ['queued', 'submitting', 'polling'].includes(t.status));

  if (!state.canvas) return null;

  return (
    <div className="iw-gen" data-testid="generation-panel">
      <header className="iw-gen-header">
        <strong><CardIcon size={16} /> 局部生成 · 抽卡</strong>
        {state.mock && <span className="iw-mock-tag">MOCK</span>}
      </header>

      <section className="iw-gen-section iw-generation-composer" aria-label="生成提示词工具栏">
        <ReferenceControls references={referenceDraft} layers={state.layers} assets={state.assets} onMention={id=>promptApi.current?.insertLayer(id)} />
        <PromptReferences apiRef={promptApi} value={prompt} onChange={setPrompt} mentions={mentions} onMentions={setMentions} layers={state.layers} assets={state.assets} compact />
        <div className="iw-prompt-toolbar">
          <ModelMenu models={MODELS} selected={selectedModels} onToggle={toggleModel} />
          <select aria-label="参考图输入方式" value={submittedMode} onChange={e=>setReferenceInputMode(e.target.value)}>
            <option value="separate">分别输入</option><option value="composite" disabled={!!referenceInput.mentions.length}>合成输入</option>
          </select>
        </div>
        <p className="iw-ref-summary" data-testid="ref-summary">待提交：{submittedRefs.length} 个图层 · {submittedMode === 'composite'?'合成输入':'分别输入'}</p>
        {referenceInput.error && <small role="alert">{referenceInput.error}</small>}
      </section>

      <section className="iw-gen-section">
        {selectedModels.length > 0 && <small>生成分辨率由模型支持的档位决定；画布中的展示大小使用框选区域的像素尺寸。</small>}
        {selectedModels.length > 0 && <h3>模型参数</h3>}
        {state.modelsLoading && <p role="status">正在读取模型能力…</p>}
        {state.modelsError && <p role="alert">{state.modelsError}</p>}
        {!state.modelsLoading && !MODELS.length && <p role="status">模型目录未连接或暂无可用模型，请连接原图片工坊生成服务。</p>}
        <div className="iw-selected-parameters">
          {MODELS.filter(m => selectedModels.includes(m.id)).map((m) => {
            const checked = selectedModels.includes(m.id);
            const p = params[m.id] || {};
            return (
              <details key={m.id} open className="iw-model-settings">
                <summary>{m.name || m.id} <span>参数</span></summary>
                {checked && (
                  <div className="iw-model-params">
                    <label>比例
                      <select value={state.targetRect ? targetRatio : (p.aspectRatio || m.ratios?.[0] || 'auto')} onChange={(e) => setParam(m.id, 'aspectRatio', e.target.value)}
                        aria-label={`${m.id} 比例`}>
                        {(state.targetRect ? targetRatios : (m.ratios || [])).map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                    {m.sizes?.length > 0 && (
                      <label>生成分辨率
                        <select value={p.resolution || m.sizes[0]} onChange={(e) => setParam(m.id, 'resolution', e.target.value)}
                          aria-label={`${m.id} 清晰度`}>
                          {m.sizes.map((s) => <option key={s} value={s}>{m.workrally?.resolutionOptions?.find(o=>String(o.value)===String(s))?.label || s}</option>)}
                        </select>
                      </label>
                    )}
                    {m.quality && (
                      <label>质量
                        <select value={p.quality || 'auto'} onChange={(e) => setParam(m.id, 'quality', e.target.value)}
                          aria-label={`${m.id} 质量`}>
                          {m.quality.map((q) => <option key={q} value={q}>{q}</option>)}
                        </select>
                      </label>
                    )}
                    {m.n && m.n.length > 1 && (
                      <label>数量
                        <select value={p.n || 1} onChange={(e) => setParam(m.id, 'n', Number(e.target.value))}
                          aria-label={`${m.id} 数量`}>
                          {m.n.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                    )}
                    {m.id === 'midjourney' && <div className="iw-mj-settings"><MidjourneyControls value={{...Object.fromEntries(Object.entries(m.parameterSchema?.properties||{}).filter(([,f])=>f.default!==undefined).map(([k,f])=>[k,f.default])),...p.extra}} onChange={extra => setParam(m.id, 'extra', extra)} /></div>}
                    {m.adapter==='klingMcp'&&m.mcp&&<KlingReferenceControls spec={m} extra={p.extra||{}} set={(key,value)=>{const next={...p.extra};if(value==='')delete next[key];else next[key]=value;setParam(m.id,'extra',next)}} busy={pending} style={{fontSize:12}}/>}
                    {Object.entries(m.id === 'midjourney' ? {} : m.parameterSchema?.properties || {}).filter(([key]) => !['aspectRatio','resolution','quality','n'].includes(key)&&!(m.adapter==='klingMcp'&&key==='elements')).map(([key, field]) => {
                      const value = p.extra?.[key] ?? field.default ?? (field.type === 'boolean' ? false : '');
                      const draftKey = `${m.id}:${key}`;
                      return <label key={key}>{field.title || key}
                        {field.enum ? <select aria-label={`${m.id} ${key}`} value={value} onChange={(e) => setExtraParam(m.id,key,field.enum.find((v) => String(v) === e.target.value))}>{field.enum.map((v) => <option key={String(v)} value={v}>{String(v)}</option>)}</select>
                        : field.type === 'boolean' ? <input aria-label={`${m.id} ${key}`} type="checkbox" checked={!!value} onChange={(e) => setExtraParam(m.id,key,e.target.checked)} />
                        : ['string','number','integer'].includes(field.type) ? <input aria-label={`${m.id} ${key}`} type={field.type === 'string' ? 'text' : 'number'} min={field.minimum} max={field.maximum} step={field.type === 'integer' ? 1 : 'any'} value={value} onChange={(e) => setExtraParam(m.id,key,field.type === 'string' ? e.target.value : Number(e.target.value))} />
                        : ['object','array'].includes(field.type) ? <textarea aria-label={`${m.id} ${key}`} value={jsonDrafts[draftKey] ?? JSON.stringify(value || (field.type === 'array' ? [] : {}),null,2)} onChange={(e) => {
                          const text=e.target.value; setJsonDrafts((cur)=>({...cur,[draftKey]:text}));
                          try {
                            const parsed=JSON.parse(text);
                            if (field.type === 'array' ? !Array.isArray(parsed) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('类型不符');
                            setExtraParam(m.id,key,parsed);
                            setSchemaErrors((cur)=>{const next={...cur};delete next[draftKey];return next;});
                          } catch { setSchemaErrors((cur)=>({...cur,[draftKey]:'请输入有效的 '+field.type+' JSON'})); }
                        }} />
                        : <span>此参数请使用原生成面板设置</span>}
                        {schemaErrors[draftKey] && <small role="alert">{schemaErrors[draftKey]}</small>}
                        {field.description && <small>{field.description}</small>}
                      </label>;
                    })}
                    {!m.supportsReference && (
                      <p className="iw-model-note">该模型不支持参考图：如选择参考图层，提交时会明确失败而不会悄悄丢弃。</p>
                    )}
                    {m.minRefs > 0 && (
                      <p className="iw-model-note">该模型至少需要 {m.minRefs} 张参考图。</p>
                    )}
                  </div>
                )}
              </details>
            );
          })}
        </div>
      </section>

      <section className="iw-gen-section">
        <h3>目标落点</h3>
        <label className="iw-target-ratio">框选比例
          <select aria-label="框选比例" value={targetRatio || ''} disabled={!targetRatios.length}
            onChange={(e) => store.setTargetAspectRatio(e.target.value)}>
            {!targetRatios.length && <option value="">暂无可用比例</option>}
            {targetRatios.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <p className="iw-hint">{!selectedModels.length ? '先选择生成模型，再按模型支持的比例框选。' : !targetRatios.length ? '所选模型没有共同支持的固定比例，请调整模型选择。' : selectedModels.length > 1 ? '仅显示所选模型共同支持的比例；框选后所有模型使用同一比例。' : '选框锁定所选比例，并同步到生成参数。'}</p>
        <button type="button" className={`iw-target-btn${targetRectMode ? ' is-active' : ''}`}
          data-testid="pick-target" aria-label="框选落点" disabled={!targetRatio}
          onClick={() => setTargetRectMode(!targetRectMode)}>
          <TargetIcon size={15} /> {targetRectMode ? `正在框选 ${targetRatio} · 点击取消` : `框选落点${targetRatio ? ' · ' + targetRatio : ''}`}
        </button>
        {state.targetRect ? (
          <p className="iw-target-info" data-testid="target-info">
            {targetRatio} · 落点 {Math.round(state.targetRect.x)},{Math.round(state.targetRect.y)} · {Math.round(state.targetRect.width)}×{Math.round(state.targetRect.height)}
            <button type="button" aria-label="清除落点" onClick={() => store.setTargetRect(null)}><CloseIcon size={12} /></button>
          </p>
        ) : (
          <p className="iw-hint">落点语义 = 新图层放置区域（不是修改该区域原像素）。未选落点时应用在画布中心。</p>
        )}
      </section>

      <section className="iw-gen-section" aria-label="费用预览">
        <h3>费用预览</h3>
        {costLoading ? <p role="status">正在查询费用…</p> : !cost ? <p>费用未知，选择模型后查询。</p> : (cost.estimates || [cost.estimate || cost]).map((item,index) => <p key={item.model || index}>
          {item.model ? `${item.model}：` : ''}{costLabel(item)}
          {item.status && ` · ${COST_LABELS[item.status] || item.status}`}{item.reason && ` · ${item.reason}`}
          {item.account?.identity && <small> · 账户 {item.account.identity}</small>}
        </p>)}
      </section>
      <section className="iw-gen-section">
        <button type="button" className="iw-primary iw-submit" disabled={pending || targetRectMode || referenceDraft.active || state.modelsLoading || !MODELS.length}
          data-testid="gen-submit" onClick={submit}>
          <ReferenceIcon size={15} /> {pending ? '任务进行中…' : `提交生成（${selectedModels.length} 个模型）`}
        </button>
      </section>

      {state.batchHistory?.length > 0 && <section className="iw-gen-section">
        <label>本画布生成记录 <select aria-label="生成记录" value={batch?.batch.id || ''} onChange={(e) => store.selectBatch(e.target.value)}>
          {state.batchHistory.map((item) => <option key={item.id} value={item.id}>{String(item.prompt || '未命名生成任务').slice(0, 36)}</option>)}
        </select></label>
      </section>}
      {batch && (
        <section className="iw-gen-section" data-testid="batch-panel">
          <h3>任务与候选</h3>
          <ul className="iw-task-list">
            {activeTasks.map((t) => (
              <li key={t.taskId || t.model} className={`iw-task is-${t.status}`} data-testid={`task-${t.model}`}>
                <div className="iw-task-head">
                  <strong>{t.model}</strong>
                  <span>{TASK_LABELS[t.status] || t.status}</span>
                  {typeof t.costEstimate === 'number' && <span className="iw-task-cost">约 ¥{t.costEstimate.toFixed(2)}{state.mock ? '（mock 估算）' : '（预估）'}</span>}
                  {!state.mock && <TaskBilling task={{...t,id:t.taskId}} kind="image" />}
                </div>
                {t.acceptedInput && <p>实际提交输入：{t.acceptedInput.referenceCount} 张参考图 · {t.acceptedInput.referenceInputMode === 'composite' ? '合成输入' : '分别输入'}</p>}
                {t.error && <p className="iw-task-error" role="alert">{t.error}</p>}
                {t.cancelSupported !== false && ['queued', 'submitting', 'polling'].includes(t.status) && (
                  <button type="button" onClick={() => store.cancelTask(t.taskId)}>取消</button>
                )}
              </li>
            ))}
          </ul>
          <GenerationCandidates batch={batch} />
        </section>
      )}
    </div>
  );
}
