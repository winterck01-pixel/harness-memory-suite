import test from 'node:test'
import assert from 'node:assert/strict'
import { RagSettingsController, ROLES } from '../client/knowledge-rag-model.js'
import { RagOperationsController } from '../client/knowledge-rag-operations-model.js'
const response = (data,status=200) => Response.json(data,{status})
const document = () => ({settings:{enabled:false,chunkSize:1200,overlap:160,models:Object.fromEntries(ROLES.map(role=>[role,{enabled:false,source:'independent',provider:role,endpoint:`https://${role}.example/v1`,model:role,credentialSet:true,apiKey:'must-never-seed'}]))},modelCatalog:{providers:[{id:'harness-provider',name:'Configured',models:[{id:'text-model',inputModalities:['text']},{id:'vision-model',inputModalities:['text','image']}]}]},status:[],capabilities:{TEXT:true}})
const deferred=()=>{let resolve;const promise=new Promise(value=>resolve=value);return {promise,resolve}}

test('save sends five independent roles, omits blank credentials, clears explicitly, then reads back without secrets',async()=>{
  const calls=[],model=new RagSettingsController(async(url,options)=>{calls.push({url,options});return response(document())})
  await model.load();assert.doesNotMatch(JSON.stringify(model.snapshot()),/must-never-seed/)
  model.edit('embedding','apiKey','embedding-only-secret');model.edit('rerank','clearCredential',true);model.edit('text','provider','separate-text-provider')
  await model.save()
  assert.deepEqual(calls.map(call=>call.options.method),['GET','POST','GET'])
  assert.equal(calls[1].url,'/api/knowledge-rag/action')
  const payload=JSON.parse(calls[1].options.body).settings
  assert.equal(payload.models.embedding.apiKey,'embedding-only-secret');assert.equal(payload.models.rerank.apiKey,'')
  for(const role of ['text','ocr','vision'])assert.equal(Object.hasOwn(payload.models[role],'apiKey'),false)
  assert.equal(payload.models.text.provider,'separate-text-provider')
  assert.equal(model.snapshot().saved,true);assert.equal(model.snapshot().shell.dirty,false)
  assert.doesNotMatch(JSON.stringify(model.snapshot()),/embedding-only-secret|must-never-seed/)
})

test('invalid draft blocks all network writes and cancel drops secret drafts without writes',async()=>{
  let writes=0;const model=new RagSettingsController(async(_url,options)=>{if(options.method==='POST')writes++;return response(document())})
  await model.load();model.edit('embedding','apiKey','API_KEY=example');model.edit(null,'overlap','700')
  assert.equal(model.snapshot().shell.invalid,true);await model.save();assert.equal(writes,0)
  model.discard();assert.equal(model.snapshot().draft.models.embedding.apiKey,'');assert.equal(model.snapshot().shell.dirty,false)
  model.edit('vision','apiKey','valid-draft');model.dispose();assert.equal(model.snapshot().draft,null);assert.equal(writes,0)
})

test('Harness choices bind provider and modality per role, and do not send independent draft credentials',async()=>{
  let payload;const model=new RagSettingsController(async(_url,options)=>{if(options.method==='POST')payload=JSON.parse(options.body).settings;return response(document())})
  await model.load();model.edit('vision','apiKey','unused-independent-secret');model.edit('vision','source','harness');model.edit('vision','enabled',true);model.edit('vision','provider','harness-provider');model.edit('vision','model','text-model')
  assert.equal(model.snapshot().shell.invalid,true)
  model.edit('vision','model','vision-model');await model.save()
  assert.equal(payload.models.vision.source,'harness');assert.equal(payload.models.vision.provider,'harness-provider');assert.equal(payload.models.vision.model,'vision-model');assert.equal(Object.hasOwn(payload.models.vision,'apiKey'),false)
  assert.equal(payload.models.embedding.source,'independent')
})

test('accepted save with failed read-back erases typed secrets and retry performs only GET',async()=>{
  let reads=0,posts=0;const model=new RagSettingsController(async(_url,options)=>{if(options.method==='POST'){posts++;return response(document().settings)}if(++reads===2)throw new Error('network with echoed secret');return response(document())})
  await model.load();model.edit('ocr','apiKey','private-ocr-secret');await model.save()
  assert.equal(model.snapshot().draft,null);assert.equal(model.snapshot().phase,'error');assert.doesNotMatch(model.snapshot().error,/echoed secret|private-ocr-secret/)
  await model.save();assert.equal(posts,1);await model.load();assert.equal(posts,1);assert.equal(reads,3)
})

test('late GET JSON, previous refresh, and disposed save cannot repopulate drafts',async()=>{
  const late=deferred();let reads=0;const model=new RagSettingsController(async()=>++reads===1?{ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:()=>late.promise}:response(document()))
  const first=model.load();await Promise.resolve();await model.load();model.edit('embedding','model','new-draft');late.resolve(document());await first
  assert.equal(model.snapshot().draft.models.embedding.model,'new-draft')
  const gate=deferred(),saving=new RagSettingsController(async(_url,options)=>options.method==='POST'?gate.promise:response(document()))
  await saving.load();saving.edit('text','apiKey','never-survive-unmount');const pending=saving.save();saving.dispose();gate.resolve(response(document()));await pending
  assert.equal(saving.snapshot().draft,null)
})

for(const status of [401,403,404])test(`HTTP ${status} revokes visible settings and discards credential drafts`,async()=>{
  const model=new RagSettingsController(async(_url,options)=>options.method==='POST'?response({error:'ECHO_secret_value'},status):response(document()))
  await model.load();model.edit('text','apiKey','secret-value');await model.save()
  assert.equal(model.snapshot().draft,null);assert.equal(model.snapshot().shell.available,false);assert.doesNotMatch(model.snapshot().error,/ECHO|secret/)
})

test('only safe server validation codes are displayed; failed saves keep drafts for correction',async()=>{
  const model=new RagSettingsController(async(_url,options)=>options.method==='POST'?response({error:'credential-is-secret'},400):response(document()))
  await model.load();model.edit('text','model','new-model');await model.save();assert.equal(model.snapshot().draft.models.text.model,'new-model');assert.doesNotMatch(model.snapshot().error,/credential-is-secret/)
})

test('local index/search remain local by default; remote actions carry exact consent and scope preserves revision',async()=>{
  const calls=[],fixture={...document(),status:[{id:'entry',title:'Entry',revision:'rev-1',projectId:'',shared:false}]}
  const operations=new RagOperationsController(async(_url,options)=>{if(options.method==='GET')return response(fixture);const body=JSON.parse(options.body);calls.push(body);return response(body.action==='search'?{results:[],mode:'keyword',warnings:[]}:{chunks:1,semantic:false})})
  await operations.load();await operations.index('entry');await operations.search('dragon');await operations.index('entry',true);await operations.search('dragon',true);await operations.scope(operations.snapshot().records[0],'/project',false)
  assert.deepEqual(calls.slice(0,4).map(body=>[body.action,body.allowRemote,body.consent]),[['index',false,'selected-document'],['search',false,'query-and-candidates'],['index',true,'selected-document'],['search',true,'query-and-candidates']])
  assert.deepEqual(calls[4],{action:'scope',id:'entry',updatedAt:'rev-1',projectId:'/project',shared:false})
})

test('operations disposed during response parsing cannot expose late private results',async()=>{
  const gate=deferred(),operations=new RagOperationsController(async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:()=>gate.promise}))
  const pending=operations.search('dragon');await Promise.resolve();operations.dispose();gate.resolve({results:[{id:'private',summary:'private-content'}]});await pending
  assert.equal(operations.snapshot().results.length,0)
})

test('React effect reactivation still fences all responses from its previous lifetime',async()=>{
  const old=deferred();let reads=0
  const model=new RagSettingsController(async()=>++reads===1?old.promise:response(document()))
  const pending=model.load();model.dispose();model.activate();await model.load();model.edit('text','model','reactivated-draft');old.resolve(response(document()));await pending
  assert.equal(model.snapshot().draft.models.text.model,'reactivated-draft')
})

test('effect reactivation after an in-flight mutation releases both controller busy guards',async()=>{
  const post=deferred(),model=new RagSettingsController(async(_url,options)=>options.method==='POST'?post.promise:response(document()))
  await model.load();model.edit('text','model','changed');const saving=model.save();model.dispose();model.activate();await model.load();post.resolve(response(document()));await saving
  assert.equal(model.snapshot().phase,'ready');assert.equal(model.snapshot().saving,false)
  const late=deferred();let reads=0;const operations=new RagOperationsController(async()=>++reads===1?late.promise:response(document()))
  const loading=operations.load();operations.dispose();operations.activate();await operations.load();late.resolve(response(document()));await loading
  assert.equal(operations.snapshot().busy,false);assert.equal(operations.snapshot().loading,false);assert.equal(reads,2)
})

test('accepted settings cannot roll back through cancel until a canonical GET succeeds',async()=>{
  let canonical=document(), reads=0
  canonical.settings.models.text.model='old-text'
  const posted=[]
  const model=new RagSettingsController(async(_url,options)=>{
    if(options.method==='POST') {
      const settings=JSON.parse(options.body).settings
      posted.push(settings)
      canonical={...canonical,settings}
      return response(settings)
    }
    if(++reads===2)throw new Error('readback unavailable')
    return response(canonical)
  })
  await model.load();model.edit('text','model','new-text');model.edit('text','apiKey','new-text-secret');await model.save()
  assert.equal(posted.length,1);assert.equal(canonical.settings.models.text.model,'new-text')
  assert.equal(model.baseline,null);assert.equal(model.snapshot().draft,null)
  model.discard();model.edit('ocr','model','other-role');await model.save()
  assert.equal(posted.length,1,'cancel/edit must not submit the obsolete full models document')
  assert.equal(model.snapshot().phase,'error');assert.equal(model.snapshot().shell.available,false)
  assert.doesNotMatch(JSON.stringify(model.snapshot()),/new-text-secret/)
  await model.load()
  assert.equal(model.snapshot().phase,'ready');assert.equal(model.snapshot().draft.models.text.model,'new-text')
  model.edit('ocr','model','other-role');await model.save()
  assert.equal(posted.length,2);assert.equal(posted[1].models.text.model,'new-text')
  assert.equal(posted[1].models.ocr.model,'other-role');assert.equal(Object.hasOwn(posted[1].models.text,'apiKey'),false)
})

for(const [code,message] of [['REVISION_CHANGED','条目已修改'],['AMBIGUOUS_SCOPE','不能同时设置']])test(`scope failure ${code} receives actionable native copy`,async()=>{
  const operations=new RagOperationsController(async()=>response({error:code},400))
  await operations.scope({id:'entry',revision:'outdated'},'/project',true)
  assert.ok(operations.snapshot().error.includes(message))
})
