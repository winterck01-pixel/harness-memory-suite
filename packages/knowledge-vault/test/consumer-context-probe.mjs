

import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
const root=process.env.KNOWLEDGE_CONSUMER_ROOT;if(!root)throw Error('KNOWLEDGE_CONSUMER_ROOT required')
const [{apply:fileman},{apply:reader}]=await Promise.all([import(pathToFileURL(join(root,'consumer-fileman/index.js'))),import(pathToFileURL(join(root,'consumer-reader/index.js')))])
const services=new Map(),tools=new Map(),tables=new Map(),effects=[];
let filemanHandler;const readerRoutes=[];
services.set('sessions',new Map([['a',{header:{cwd:'/projects/a'}}],['b',{header:{cwd:'/projects/b'}}]]));
services.set('connection',{requestRejection:({headers})=>headers.authorization==='test-only'?undefined:401,fetch:{register(route){readerRoutes.push(route);return()=>{}}}});
services.set('webServer',{register(route){filemanHandler=route.handler;return()=>{}}});
services.set('tools',{resultValidationVersion:1,register(tool){tools.set(tool.name,tool);return()=>{}}});
const ctx={get:k=>services.get(k),provide:(k,v)=>services.set(k,v),tools:services.get('tools'),connection:services.get('connection'),logger:{info(){},warn(){}},effect:fn=>{const stop=fn();if(typeof stop==='function')effects.push(stop);return stop},inject:(deps,fn)=>fn({...ctx,connection:services.get('connection')}),storageDomain:{async open(spec){for(const [name,s]of Object.entries(spec.tables)){const map=new Map();tables.set(name,{get:id=>map.get(id),entries:()=>map.entries(),put:async(id,value)=>map.set(id,s.valueSchema.parse(value))})}return{table:name=>tables.get(name),close(){}}}}};
const sandbox=await mkdtemp(join(tmpdir(),'kv-consumers-'));
try{
 await apply(ctx,{enabled:true});const saved=await tools.get('save_knowledge').execute({title:'private',content:'consumer private secret'},{agent:{id:'a'}});
 const vault=services.get('knowledgeVault');assert.throws(()=>vault.list(),/TRUSTED_CONTEXT_REQUIRED/);
 const stop=fileman(ctx,{root:sandbox,writable:true,trash:false});effects.push(stop);
 const send=async(path,headers)=>{const req=Readable.from([]);req.url='/dsh-fileman/'+path;req.method='GET';req.headers=headers;let body='';const res={writeHead(status){this.statusCode=status},setHeader(){},end(value){body+=value||''}};await filemanHandler(req,res);return{status:res.statusCode,body}};
 const ok=await send('knowledge/list',{authorization:'test-only',host:'fixture','sec-fetch-site':'same-origin'});assert.equal(ok.status,200,ok.body);assert.match(ok.body,/private/);
 const denied=await send('knowledge/list',{host:'fixture','sec-fetch-site':'same-origin'});assert.equal(denied.status,401);assert.doesNotMatch(denied.body,/consumer private secret/);
 const origin=await send('knowledge/list',{authorization:'test-only',host:'fixture',origin:'https://evil.test'});assert.notEqual(origin.status,200);assert.doesNotMatch(origin.body,/consumer private secret/);
 assert.throws(()=>vault.get(saved.id),/TRUSTED_CONTEXT_REQUIRED/);
 await reader(ctx,{storageDir:join(sandbox,'reader'),sourceRoots:[sandbox]});
 const books=readerRoutes.find(route=>route.path==='/api/reader/books');assert.ok(books,'real reader books route registered');
 assert.equal((await books.fetch(new Request('https://fixture/api/reader/books',{headers:{authorization:'test-only','sec-fetch-site':'same-origin'}}))).status,200);
 assert.equal((await books.fetch(new Request('https://fixture/api/reader/books'))).status,403);
 const creator=tools.get('reader_create_book'),creationExec={agent:{id:'a'},token:Symbol('reader-create')};
 const created=await creator.execute({requestId:'probe-linked-book',document:{title:'Linked fixture',kind:'novel',chapters:[{id:'one',title:'One',source:{knowledgeId:saved.id}}]}},creationExec);
 assert.equal(creator.validateResult(creationExec,{isError:false,value:created}),true,'real reader proof validation restores execution scope');
 const getBook=tools.get('reader_get_book');const readExec={agent:{id:'a'},token:Symbol('reader-get')};
 const book=await getBook.execute({bookId:created.bookId},readExec);assert.equal(getBook.validateResult(readExec,{isError:false,value:book}),true);
 await assert.rejects(getBook.execute({bookId:created.bookId},{agent:{id:'b'}}),error=>error.status===403&&error.code==='SOURCE_REVOKED');
 const rag=services.get('knowledgeRag');const a=rag.contextForExecution({agent:{id:'a'}}),b=rag.contextForExecution({agent:{id:'b'}});
 const scopedA=vault.forContext(a),scopedB=vault.forContext(b);assert.equal(scopedA.get(saved.id).id,saved.id);assert.throws(()=>scopedB.get(saved.id),/知识条目不存在/);
 const found=await rag.search({query:'consumer',allowRemote:false},a);assert.match(JSON.stringify(found),/consumer private secret/);rag.assertSearchResult(found);
 assert.equal((await rag.search({query:'consumer',allowRemote:false},b)).results.length,0);
 console.log('REAL_CONSUMER_CONTEXT_ACCEPTANCE_OK: fileman authenticated/unauthenticated/cross-origin; reader authenticated/unauthenticated; public scoped service A/B and direct rag proof')
}finally{for(const stop of effects.reverse())await stop();await rm(sandbox,{recursive:true,force:true})}
