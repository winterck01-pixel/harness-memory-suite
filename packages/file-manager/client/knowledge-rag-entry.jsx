import React, { useEffect, useState } from 'react'
import { Button, SettingsForm, SettingsValueField, SettingsSecretField, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { RagSettingsController, ROLES, ROLE_INFO, reusable, modelsFor, PROTOCOLS, REASONING, sameRoute, credentialsFor } from './knowledge-rag-model.js'
import { KnowledgeRagOperations } from './knowledge-rag-operations.jsx'
import { ragStyles } from './knowledge-rag-style.js'

const labels = { unavailable: '正在读取知识库配置…', readOnly: '设置暂不可写，请先重试读取。', saveFailed: '保存未完成，请检查上方提示。', save: '保存设置', saving: '正在保存…' }

export function KnowledgeRagEntry({ compact = false, onOpenSettings }) {
  const [unavailable,setUnavailable] = useState(false)
  return <div className={`dkr-entry ${compact ? 'dkr-compact' : ''}`}><style>{ragStyles}</style><strong>知识库处理与检索</strong><Button type="button" size="sm" variant="outline" onClick={() => setUnavailable(onOpenSettings?.() !== true)} disabled={!onOpenSettings}>配置处理与检索</Button>{(!onOpenSettings || unavailable) && <span className="dkr-hint" role="status">设置分区暂不可用</span>}</div>
}
function SelectField({id,label,value,disabled,options,onChange,error}) {
  return <div className="dkr-field"><label className="dkr-field-label" htmlFor={id}>{label}</label><select id={id} className="dkr-select" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}>{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>{error && <p id={`${id}-error`} className="dkr-error">{error}</p>}</div>
}
function ValueField({controller,state,role,field,label,hint,numeric=false,disabled=false}) {
  const model = role ? state.draft.models[role] : state.draft
  const baseline = role ? controller.baseline.models[role] : controller.baseline
  const error = state.errors[role ? `${role}.${field}` : field]
  return <SettingsValueField id={`dkr-${role || 'general'}-${field}`} label={label} text={String(model[field])} hint={hint} numeric={numeric} disabled={disabled || state.saving || state.phase !== 'ready'} overridden={model[field] !== baseline[field]} overriddenLabel="未保存" resetLabel="撤销修改" invalid={!!error} invalidLabel={error || ''} onEdit={value => controller.edit(role,field,value)} onReset={() => controller.reset(role,field)}/>
}
function InstructionField({role,field,label,hint,controller,state}) {
  const model=state.draft.models[role],baseline=controller.baseline.models[role],id=`dkr-${role}-${field}`,error=state.errors[`${role}.${field}`]
  return <div className="dkr-field"><div className="dkr-card-head"><label className="dkr-field-label" htmlFor={id}>{label}</label>{model[field]!==baseline[field]&&<Button type="button" size="sm" disabled={state.saving} onClick={()=>controller.reset(role,field)}>撤销修改</Button>}</div><textarea id={id} className="dkr-instructions" rows={4} value={model[field]} disabled={state.saving||state.phase!=='ready'} aria-invalid={!!error} aria-describedby={`${id}-hint`} onChange={event=>controller.edit(role,field,event.target.value)}/><p id={`${id}-hint`} className={error?'dkr-error':'dkr-hint'}>{error||hint}</p></div>
}
function ImageVectorFields({role,model,controller,state}) {
  const disabled=state.saving||state.phase!=='ready'
  return <><div className="dkr-toggle"><span>启用直接图片向量能力</span><Switch checked={model.imageEnabled} label="启用直接图片向量能力" disabled={disabled} onChange={value=>controller.edit(role,'imageEnabled',value)}/></div><p className="dkr-hint">此开关只保存能力配置。索引或查询仍需另选资料、页码与本次外发授权，不会自动上传图片。</p><details className="dkr-details"><summary>图片向量任务指令</summary><InstructionField controller={controller} state={state} role={role} field="imageDocumentInstructions" label="图片索引向量指令" hint="非空，最多 4000 字符。"/><InstructionField controller={controller} state={state} role={role} field="imageQueryInstructions" label="图片查询向量指令" hint="以图检索时使用；非空，最多 4000 字符。"/><InstructionField controller={controller} state={state} role={role} field="multimodalQueryInstructions" label="文字检索图片时的向量指令" hint="文字查找文本或图片候选时使用；不是图片与文字的联合向量。非空，最多 4000 字符。"/></details></>
}
function CredentialField({role,field,controller,state}) {
  const model=state.draft.models[role],baseline=controller.baseline.models[role],labels={apiKey:'API 凭据',accessKey:'Access Key',secretKey:'Secret Key'}
  const clear={apiKey:'clearCredential',accessKey:'clearAccessKey',secretKey:'clearSecretKey'}[field],configured=sameRoute(model,baseline)&&model[{apiKey:'credentialSet',accessKey:'accessKeySet',secretKey:'secretKeySet'}[field]]
  const disabled=state.saving||state.phase!=='ready',error=state.errors[`${role}.${field}`]
  return <><SettingsSecretField id={`dkr-${role}-${field}`} label={labels[field]} hint="留空保留当前路由已存凭据；保存后不会回显。" text={model[field]} configured={configured} stateLabel={model[clear]?'保存时清除':configured?'已保存':'未设置'} disabled={disabled||model[clear]} onEdit={value=>controller.edit(role,field,value)}/>{error&&<p className="dkr-error" role="alert">{error}</p>}<div className="dkr-toggle"><span>保存时清除已存 {labels[field]}</span><Switch checked={model[clear]} label={`清除${ROLE_INFO[role].title}已存${labels[field]}`} disabled={disabled} onChange={value=>controller.edit(role,clear,value)}/></div></>
}
function RoleCard({role,controller,state}) {
  const model=state.draft.models[role],reuse=model.source==='harness',dedicated=model.protocol==='volc-visual-ocr',info=ROLE_INFO[role],disabled=state.saving||state.phase!=='ready'
  const providers=state.catalog.providers
  const providerOptions=[{value:'',label:'选择 Harness 服务商'},...providers.map(provider=>({value:provider.id,label:provider.name,disabled:provider.unavailable}))]
  if(model.provider&&!providers.some(provider=>provider.id===model.provider))providerOptions.push({value:model.provider,label:`${model.provider}（当前不可用）`,disabled:true})
  const models=modelsFor(state.catalog,model.provider,role),modelOptions=[{value:'',label:'选择模型'},...models.map(value=>({value:value.id,label:value.name===value.id?value.id:`${value.name} · ${value.id}`}))]
  if(model.model&&!models.some(value=>value.id===model.model))modelOptions.push({value:model.model,label:`${model.model}（当前不可用）`,disabled:true})
  const presets=state.providerCatalog.presets.filter(preset=>preset.roles.includes(role))
  const presetOptions=[{value:'custom',label:'自定义接口'},...presets.map(preset=>({value:preset.id,label:preset.label}))]
  const protocolOptions=PROTOCOLS[role].map(protocol=>({value:protocol,label:role==='ocr'?(protocol==='volc-visual-ocr'?'专用 OCR · volc-visual-ocr':'视觉识字 · openai-chat'):protocol}))
  if(!PROTOCOLS[role].includes(model.protocol))protocolOptions.push({value:model.protocol,label:'当前协议不受支持',disabled:true})
  const descriptor=state.providerCatalog.protocols.find(protocol=>protocol.id===model.protocol&&protocol.roles.includes(role))
  const routeChanged=!sameRoute(model,controller.baseline.models[role])
  const supportsInstruction=descriptor?descriptor.instructionModels.includes(model.model):model.model==='doubao-seed-rerank'
  const reasoningOptions=REASONING.map(value=>({value,label:value||'使用模型默认设置'}))
  if(!REASONING.includes(model.reasoningEffort))reasoningOptions.push({value:model.reasoningEffort,label:'当前推理强度不受支持',disabled:true})
  const modelPresets=[...new Map(presets.filter(preset=>preset.config.protocol===model.protocol).map(preset=>[preset.config.model,preset])).values()]
  return <section className="dkr-card" aria-labelledby={`dkr-${role}-title`}><div className="dkr-card-head"><h3 id={`dkr-${role}-title`}>{info.title}</h3><Switch checked={model.enabled} onChange={value=>controller.edit(role,'enabled',value)} label={`启用${info.title}`} disabled={disabled}/></div><p className="dkr-hint">{dedicated?'专用文字识别服务；仅展示服务商实际返回的文字与可用版面定位，不调用视觉聊天或 MediaKit。':info.hint}</p>
    {reusable(role)&&<SelectField id={`dkr-${role}-source`} label="配置来源" value={model.source} disabled={disabled} options={[{value:'independent',label:'独立接口与凭据'},{value:'harness',label:'复用已配置的 Harness 服务',disabled:dedicated}]} onChange={value=>controller.edit(role,'source',value)}/>}
    {reuse?<><div className="dkr-grid"><SelectField id={`dkr-${role}-provider`} label="Harness 服务商" value={model.provider} disabled={disabled} options={providerOptions} error={state.errors[`${role}.provider`]} onChange={value=>controller.edit(role,'provider',value)}/><SelectField id={`dkr-${role}-model`} label="模型" value={model.model} disabled={disabled||!model.provider} options={modelOptions} error={state.errors[`${role}.model`]} onChange={value=>controller.edit(role,'model',value)}/></div><p className="dkr-hint">使用宿主已保存的地址与凭据；此角色的独立凭据不会用于 Harness 请求。</p>{state.catalog.unavailable&&<p className="dkr-error">Harness 模型列表暂不可用，请重试读取设置。</p>}{state.errors[`${role}.protocol`]&&<p className="dkr-error" role="alert">{state.errors[`${role}.protocol`]}</p>}</>:<>
      <div className="dkr-grid"><SelectField id={`dkr-${role}-preset`} label="接口预设" value={model.preset} disabled={disabled} options={presetOptions} onChange={value=>controller.preset(role,value)}/><SelectField id={`dkr-${role}-protocol`} label="接口协议" value={model.protocol} disabled={disabled} options={protocolOptions} error={state.errors[`${role}.protocol`]} onChange={value=>controller.edit(role,'protocol',value)}/></div>
      <p className="dkr-hint">预设只修改此角色的草稿，不会自动启用或保存。切换接口后请确认凭据适用。{descriptor?.path&&`请求接口：${descriptor.path}。`}</p>
      <div className="dkr-grid"><ValueField controller={controller} state={state} role={role} field="provider" label="服务商名称" hint="自定义标识；请求使用下方地址与协议。"/><ValueField controller={controller} state={state} role={role} field="model" label={dedicated?'OCR 接口操作名':model.protocol==='vikingdb-rerank'?'重排模型 ID':'模型 ID / 部署接入点 ID'} hint={dedicated?'此协议使用操作名 OCRNormal。':reusable(role)?'可输入模型 ID 或 ep 部署接入点 ID。':undefined}/></div>
      {modelPresets.length>0&&<div className="dkr-model-shortcuts" aria-label={`${info.title}模型快捷选择`}>{modelPresets.map(preset=><Button type="button" key={preset.id} size="sm" variant="outline" disabled={disabled} onClick={()=>{controller.edit(role,'model',preset.config.model);if(reusable(role)&&preset.config.reasoningEffort!==undefined)controller.edit(role,'reasoningEffort',preset.config.reasoningEffort)}}>{preset.config.model}</Button>)}</div>}
      <ValueField controller={controller} state={state} role={role} field="endpoint" label={dedicated||model.protocol==='vikingdb-rerank'?'服务 origin':'API 基础地址'} hint={model.protocol==='dashscope-rerank'?'填写 https://实际业务空间ID.cn-beijing.maas.aliyuncs.com（地域须与 Key 匹配），不含 /api/v1；使用百炼 API Key。Qwen3-VL 支持文字或图片候选；图片需本次单独授权，最多 3 张候选页。超预算回退原检索，不静默截断。':dedicated||model.protocol==='vikingdb-rerank'?'仅 HTTPS origin，不要附加请求路径。':model.protocol==='ark-multimodal'?'请求使用 /embeddings/multimodal，不使用普通 /embeddings。':role==='rerank'?'Cohere v2 基础地址应以 /v2 结尾。':'请输入服务商 API 基础地址。'}/>
      {reusable(role)&&!dedicated&&<SelectField id={`dkr-${role}-reasoningEffort`} label="推理强度" value={model.reasoningEffort} disabled={disabled} options={reasoningOptions} error={state.errors[`${role}.reasoningEffort`]} onChange={value=>controller.edit(role,'reasoningEffort',value)}/>}
      {model.protocol==='ark-multimodal'&&<><SelectField id={`dkr-${role}-dimensions`} label="向量维度" value={model.dimensions} disabled={disabled} options={[{value:'1024',label:'1024'},{value:'2048',label:'2048'},...(!['1024','2048'].includes(model.dimensions)?[{value:model.dimensions,label:'当前维度不受支持',disabled:true}]:[])]} error={state.errors[`${role}.dimensions`]} onChange={value=>controller.edit(role,'dimensions',value)}/><InstructionField controller={controller} state={state} role={role} field="queryInstructions" label="查询向量指令" hint="非空，最多 4000 字符。"/><InstructionField controller={controller} state={state} role={role} field="documentInstructions" label="文档向量指令" hint="非空，最多 4000 字符。"/><p className="dkr-hint">仅使用单一稠密向量；多向量与稀疏向量固定关闭。</p></>}
      {model.protocol==='ark-multimodal'&&<ImageVectorFields role={role} model={model} controller={controller} state={state}/>}
      {dedicated&&<><ValueField controller={controller} state={state} role={role} field="region" label="Region" hint="此 OCR 服务要求 cn-north-1。"/><p className="dkr-hint">PDF 按所选页渲染后识别。格式、页数与编码后请求大小由核心验证；不能仅凭源图大小判定专用 OCR 可用。</p></>}
      {model.protocol==='vikingdb-rerank'&&<><ValueField controller={controller} state={state} role={role} field="region" label="Region" hint="例如 cn-beijing。"/>{supportsInstruction?<InstructionField controller={controller} state={state} role={role} field="instruction" label="重排指令" hint="最多 1024 字符。"/>:<><p className="dkr-hint">此模型不支持重排指令。</p>{model.instruction&&<Button type="button" size="sm" variant="outline" disabled={disabled} onClick={()=>controller.edit(role,'instruction','')}>清除不支持的重排指令</Button>}</>}<p className="dkr-hint">此协议使用独立 Access Key / Secret Key，由知识库核心签名；不使用 Ark API 凭据。</p></>}
      {routeChanged&&<p className="dkr-hint" role="status">路由切换不会继承旧凭据，请为当前接口配置适用的凭据。</p>}
      {credentialsFor(model).map(field=><CredentialField key={field} field={field} role={role} controller={controller} state={state}/>)}
    </>}
  </section>
}

export function KnowledgeRagSettingsSection() {
  const [controller] = useState(() => new RagSettingsController())
  const [state,setState] = useState(() => controller.snapshot())
  useEffect(() => {controller.activate();const unsubscribe = controller.subscribe(setState);controller.load();return () => {unsubscribe();controller.dispose()}},[controller])
  return <section className="dkr-section"><style>{ragStyles}</style><h2 className="dkr-title">知识库处理与检索</h2><p className="dkr-intro">为文档处理与检索分别选择服务商和模型。配置只在保存时写入；离开此页会丢弃未保存修改。</p>
    {state.error && <div className="dkr-feedback" role="alert"><p className="dkr-error">{state.error}</p><Button size="sm" variant="outline" disabled={state.saving} onClick={controller.load}>重试读取</Button></div>}
    {state.saved && <p className="dkr-saved" role="status">设置已保存并读回确认。模型或分块变更后需要重建索引。</p>}
    <SettingsForm labels={{...labels,unavailable:state.phase === 'error' ? '知识库配置暂不可用。' : labels.unavailable}} state={state.shell} onSave={controller.save} onDiscard={controller.discard}>
      {state.draft && <><div className="dkr-toggle"><span>启用已配置的远程处理与检索能力</span><Switch checked={state.draft.enabled} label="启用已配置的远程处理与检索能力" disabled={state.saving || state.phase !== 'ready'} onChange={value => controller.edit(null,'enabled',value)}/></div><p className="dkr-hint">此开关控制文本、OCR、视觉、向量与重排的远程处理。本地解析与关键词检索可独立使用。保存设置不会发起服务商请求；每次远程操作仍需明确授权资料范围。关闭后停止后续发送并丢弃旧结果，已发送的请求无法撤回。</p><div className="dkr-rows">{ROLES.map(role => <RoleCard key={role} role={role} controller={controller} state={state}/>)}</div><details className="dkr-details"><summary>分块设置</summary><div className="dkr-grid"><ValueField controller={controller} state={state} field="chunkSize" label="分块字符数" hint="200–4000 字符。" numeric/><ValueField controller={controller} state={state} field="overlap" label="重叠字符数" hint="非负，且小于分块字符数的一半。" numeric/></div></details><div className="dkr-actions"><Button type="button" variant="outline" size="sm" disabled={state.saving || !state.shell.dirty} onClick={controller.discard}>取消修改</Button></div></>}
    </SettingsForm>
    {state.phase === 'ready' && <KnowledgeRagOperations settingsBusy={state.saving||state.shell.dirty} settingsVersion={controller.epoch}/>}
  </section>
}
