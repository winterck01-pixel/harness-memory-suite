import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {RagSettingsController,ROLES,sameRoute,writeSettings} from '../client/knowledge-rag-model.js'


const providerCatalog=JSON.parse(await readFile(new URL('./fixtures/provider-catalog.json',import.meta.url),'utf8'))
const response=(data,status=200)=>Response.json(data,{status})
const fixture=()=>({providerCatalog:structuredClone(providerCatalog),settings:{enabled:false,chunkSize:1200,overlap:160,models:Object.fromEntries(ROLES.map(role=>[role,{enabled:false,source:'independent',provider:`legacy-${role}`,protocol:role==='embedding'?'openai-embeddings':role==='rerank'?'cohere-v2':'openai-chat',endpoint:`https://${role}.example/v1`,model:`old-${role}`,credentialSet:true,accessKeySet:false,secretKeySet:false}]))},modelCatalog:{providers:[]}})
const preset=(id)=>providerCatalog.presets.find(value=>value.id===id)

function server(initial=fixture()) {
  let current=structuredClone(initial),reads=0
  const calls=[]
  const controller=new RagSettingsController(async(url,options)=>{
    calls.push({url,options});if(options.method==='GET'){reads++;return response(current)}
    const settings=JSON.parse(options.body).settings
    current={...current,settings:{...settings,models:Object.fromEntries(ROLES.map(role=>{const value=settings.models[role];return [role,{...value,credentialSet:!!value.apiKey||initial.settings.models[role].credentialSet,accessKeySet:!!value.accessKey,secretKeySet:!!value.secretKey}]}))}}
    return response(current.settings)
  })
  return {controller,calls,get reads(){return reads},get current(){return current}}
}

test('Ark server settings roundtrip keeps protocol, dimensions and instructions without changing other roles',async()=>{
  const initial=fixture();initial.settings.models.embedding={...preset('volcengine-ark-embedding').config,enabled:true,credentialSet:true,dimensions:2048,queryInstructions:'custom query',documentInstructions:'custom document'}
  const h=server(initial);await h.controller.load();h.controller.edit(null,'chunkSize','1300');await h.controller.save()
  const payload=JSON.parse(h.calls.find(call=>call.options.method==='POST').options.body).settings
  assert.equal(payload.models.embedding.protocol,'ark-multimodal');assert.equal(payload.models.embedding.dimensions,2048)
  assert.equal(payload.models.embedding.queryInstructions,'custom query');assert.equal(payload.models.embedding.documentInstructions,'custom document')
  for(const role of ['text','ocr','vision','rerank'])assert.equal(payload.models[role].model,`old-${role}`)
  assert.equal(Object.hasOwn(payload.models.embedding,'apiKey'),false);assert.equal(h.controller.snapshot().shell.dirty,false)
})

test('unknown server protocol survives projection and blocks POST instead of falling back',async()=>{
  const initial=fixture();initial.settings.models.embedding.protocol='unsupported-protocol'
  const h=server(initial);await h.controller.load();h.controller.edit(null,'chunkSize','1300');await h.controller.save()
  assert.equal(h.controller.snapshot().draft.models.embedding.protocol,'unsupported-protocol')
  assert.equal(h.controller.snapshot().shell.invalid,true);assert.equal(h.calls.filter(call=>call.options.method==='POST').length,0)
  assert.equal(h.controller.snapshot().errors['embedding.protocol'],'当前接口协议不受支持，请选择此角色支持的协议后保存。')
})

test('server preset changes only its role, preserves enabled state, discards typed secrets and never writes',async()=>{
  const h=server();await h.controller.load();h.controller.edit('embedding','enabled',true);h.controller.edit('embedding','apiKey','draft-api')
  const others=structuredClone(h.controller.snapshot().draft.models)
  h.controller.preset('embedding','volcengine-ark-embedding')
  const model=h.controller.snapshot().draft.models.embedding
  assert.equal(model.enabled,true);assert.equal(model.dimensions,'1024');assert.equal(model.apiKey,'');assert.equal(model.clearCredential,false)
  assert.equal(model.queryInstructions,preset('volcengine-ark-embedding').config.queryInstructions)
  assert.equal(h.calls.length,1,'selecting a preset only changes a local draft')
  for(const role of ['text','ocr','vision','rerank'])assert.deepEqual(h.controller.snapshot().draft.models[role],others[role])
  assert.equal(sameRoute(model,h.controller.baseline.models.embedding),false)
})

test('custom preset selection is UI-only, and cancel restores the inferred server preset without a POST',async()=>{
  const initial=fixture();initial.settings.models.text={...preset('volcengine-ark-pro').config,enabled:false,credentialSet:true}
  const h=server(initial);await h.controller.load();assert.equal(h.controller.snapshot().draft.models.text.preset,'volcengine-ark-pro')
  h.controller.preset('text','custom');assert.equal(h.controller.snapshot().shell.dirty,false);await h.controller.save()
  assert.equal(h.calls.length,1);h.controller.discard();assert.equal(h.controller.snapshot().draft.models.text.preset,'volcengine-ark-pro')
})

test('provider catalog and settings strip all three credential literals before exposure or preset application',async()=>{
  const initial=fixture(),secrets={apiKey:'leaked-api-key',accessKey:'leaked-access-key',secretKey:'leaked-secret-key'}
  for(const value of Object.values(initial.settings.models))Object.assign(value,secrets)
  Object.assign(initial.providerCatalog.presets[0],secrets);Object.assign(initial.providerCatalog.presets[0].config,secrets,{unexpected:{...secrets}})
  const h=server(initial);await h.controller.load();h.controller.preset('embedding','volcengine-ark-embedding')
  assert.doesNotMatch(JSON.stringify(h.controller.snapshot()),/leaked-api-key|leaked-access-key|leaked-secret-key|unexpected/)
  const payload=writeSettings(h.controller.snapshot().draft);assert.equal(Object.hasOwn(payload.models.embedding,'apiKey'),false)
})

for(const [field,value]of [['dimensions','1536'],['queryInstructions',' '],['documentInstructions','x'.repeat(4001)]])test(`invalid Ark ${field} prevents settings POST`,async()=>{
  const h=server();await h.controller.load();h.controller.preset('embedding','volcengine-ark-embedding');h.controller.edit('embedding',field,value);await h.controller.save()
  assert.equal(h.controller.snapshot().shell.invalid,true);assert.equal(h.calls.filter(call=>call.options.method==='POST').length,0)
})

test('legacy protocols never acquire Ark or Viking fields when another role is saved',async()=>{
  const h=server();await h.controller.load();h.controller.edit('text','model','ep-custom');await h.controller.save()
  const payload=JSON.parse(h.calls.find(call=>call.options.method==='POST').options.body).settings
  for(const role of ROLES)for(const field of ['dimensions','queryInstructions','documentInstructions','region','instruction','accessKey','secretKey','preset'])assert.equal(Object.hasOwn(payload.models[role],field),false,`${role}.${field}`)
  assert.equal(payload.models.text.reasoningEffort,'')
})

test('chat presets use actual server reasoning values, while model and ep IDs remain editable',async()=>{
  const h=server();await h.controller.load();h.controller.preset('text','volcengine-ark-lite');h.controller.preset('vision','volcengine-ark-turbo');h.controller.preset('ocr','volcengine-ark-pro')
  h.controller.edit('text','model','ep-my-deployment');await h.controller.save()
  const payload=JSON.parse(h.calls.find(call=>call.options.method==='POST').options.body).settings
  assert.equal(payload.models.text.reasoningEffort,'');assert.equal(payload.models.text.model,'ep-my-deployment')
  assert.equal(payload.models.vision.reasoningEffort,'minimal');assert.equal(payload.models.ocr.reasoningEffort,'minimal')
  assert.equal(payload.models.embedding.provider,'legacy-embedding')
})

test('Viking AK and SK remain separate from API key, keep stored credentials and explicitly clear independently',async()=>{
  const initial=fixture();initial.settings.models.rerank={...preset('volcengine-vikingdb-doubao-seed-rerank').config,enabled:false,instruction:'',accessKeySet:true,secretKeySet:true,credentialSet:false}
  const h=server(initial);await h.controller.load();h.controller.edit('rerank','instruction','prefer exact answers');await h.controller.save()
  let payload=JSON.parse(h.calls.find(call=>call.options.method==='POST').options.body).settings.models.rerank
  assert.equal(Object.hasOwn(payload,'apiKey'),false);assert.equal(Object.hasOwn(payload,'accessKey'),false);assert.equal(Object.hasOwn(payload,'secretKey'),false)
  assert.equal(payload.region,'cn-beijing');assert.equal(payload.instruction,'prefer exact answers')
  h.controller.edit('rerank','accessKey','new-ak');h.controller.edit('rerank','clearSecretKey',true);await h.controller.save()
  payload=JSON.parse(h.calls.filter(call=>call.options.method==='POST').at(-1).options.body).settings.models.rerank
  assert.equal(payload.accessKey,'new-ak');assert.equal(payload.secretKey,'');assert.equal(Object.hasOwn(payload,'apiKey'),false)
  assert.equal(h.controller.snapshot().draft.models.rerank.accessKey,'');assert.equal(h.controller.snapshot().draft.models.rerank.secretKey,'')
})

test('route edits drop all typed credentials and configured flags only apply to an exact baseline route',async()=>{
  const h=server();await h.controller.load();h.controller.edit('text','apiKey','draft-api');h.controller.edit('text','provider','new-provider')
  assert.equal(h.controller.snapshot().draft.models.text.apiKey,'');assert.equal(sameRoute(h.controller.snapshot().draft.models.text,h.controller.baseline.models.text),false)
  h.controller.edit('text','provider','legacy-text');assert.equal(sameRoute(h.controller.snapshot().draft.models.text,h.controller.baseline.models.text),true)
  h.controller.preset('rerank','volcengine-vikingdb-doubao-seed-rerank');h.controller.edit('rerank','accessKey','draft-ak');h.controller.edit('rerank','secretKey','draft-sk');h.controller.edit('rerank','endpoint','https://new-viking.example')
  assert.equal(h.controller.snapshot().draft.models.rerank.accessKey,'');assert.equal(h.controller.snapshot().draft.models.rerank.secretKey,'')
  const payload=writeSettings(h.controller.snapshot().draft).models.rerank
  assert.equal(Object.hasOwn(payload,'apiKey'),false);assert.equal(Object.hasOwn(payload,'accessKey'),false);assert.equal(Object.hasOwn(payload,'secretKey'),false)
})

test('Viking model changes and preset changes clear instructions unsupported by base model',async()=>{
  const h=server();await h.controller.load();h.controller.preset('rerank','volcengine-vikingdb-doubao-seed-rerank');h.controller.edit('rerank','instruction','seed-only instruction')
  h.controller.edit('rerank','model','base-multilingual-rerank');assert.equal(h.controller.snapshot().draft.models.rerank.instruction,'');assert.equal(h.controller.snapshot().shell.invalid,false)
  h.controller.preset('rerank','volcengine-vikingdb-doubao-seed-rerank');h.controller.edit('rerank','instruction','seed-only instruction')
  h.controller.preset('rerank','volcengine-vikingdb-base-multilingual-rerank');assert.equal(h.controller.snapshot().draft.models.rerank.instruction,'');await h.controller.save()
  const payload=JSON.parse(h.calls.find(call=>call.options.method==='POST').options.body).settings.models.rerank
  assert.equal(payload.model,'base-multilingual-rerank');assert.equal(payload.instruction,'')
})

test('accepted Viking save with failed GET clears every secret and cancel cannot resubmit an obsolete route',async()=>{
  let reads=0,posts=0
  const h=new RagSettingsController(async(_url,options)=>{if(options.method==='POST'){posts++;return response({})}if(++reads===2)throw new Error('offline');return response(fixture())})
  await h.load();h.preset('rerank','volcengine-vikingdb-doubao-seed-rerank');h.edit('rerank','accessKey','private-ak');h.edit('rerank','secretKey','private-sk');await h.save();h.discard();h.edit('rerank','model','base-multilingual-rerank');await h.save()
  assert.equal(posts,1);assert.equal(h.snapshot().draft,null);assert.equal(h.baseline,null);assert.doesNotMatch(JSON.stringify(h.snapshot()),/private-ak|private-sk/)
})

test('candidate presets and serialized changes are accepted by the actual frozen core',async()=>{
  const {validateSettings,publicSettings}=await import(process.env.RAG_CORE_PROVIDERS || '../../knowledge-vault/lib/providers.js')
  let accepted=validateSettings({})
  const calls=[]
  const h=new RagSettingsController(async(_url,options)=>{
    if(options.method==='GET')return response({settings:publicSettings(accepted),providerCatalog,modelCatalog:{providers:[]}})
    const body=JSON.parse(options.body);calls.push(body)
    accepted=validateSettings(body.settings,accepted)
    return response(publicSettings(accepted))
  })
  await h.load()
  h.preset('embedding','volcengine-ark-embedding');h.preset('text','volcengine-ark-lite');h.preset('vision','volcengine-ark-pro');h.preset('ocr','volcengine-ark-turbo');h.preset('rerank','volcengine-vikingdb-doubao-seed-rerank')
  h.edit('embedding','apiKey','fixture-api');h.edit('rerank','accessKey','fixture-ak');h.edit('rerank','secretKey','fixture-sk');await h.save()
  assert.equal(calls.length,1);assert.equal(h.snapshot().saved,true);assert.equal(h.snapshot().shell.dirty,false)
  assert.equal(accepted.models.embedding.dimensions,1024);assert.equal(accepted.models.vision.reasoningEffort,'minimal');assert.equal(accepted.models.text.reasoningEffort,'')
  assert.equal(accepted.models.rerank.accessKey,'fixture-ak');assert.equal(accepted.models.rerank.secretKey,'fixture-sk');assert.equal(accepted.models.rerank.apiKey,'')
  assert.doesNotMatch(JSON.stringify(h.snapshot()),/fixture-api|fixture-ak|fixture-sk/)

  h.edit('rerank','region','cn-shanghai');h.edit('rerank','instruction','seed-only');await h.save()
  assert.equal(accepted.models.rerank.accessKey,'fixture-ak');assert.equal(accepted.models.rerank.secretKey,'fixture-sk')
  h.edit('rerank','model','base-multilingual-rerank');await h.save();assert.equal(accepted.models.rerank.instruction,'')
  h.edit('rerank','endpoint','https://new-viking.example');await h.save()
  assert.equal(accepted.models.rerank.accessKey,'');assert.equal(accepted.models.rerank.secretKey,'')
})
