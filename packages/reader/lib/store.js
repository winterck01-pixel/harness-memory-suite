import {partPage} from './ranges.js'
import { constants } from 'node:fs'
import { mkdir, lstat, realpath, open, rename, unlink, readdir } from 'node:fs/promises'
import { resolve, join, basename, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createSources, hash, raster, within } from './sources.js'
import { object, text, id, integer, requestId, settings, reject } from './validate.js'
import { parseDocument } from './formats.js'
import { marked } from '../vendor/marked.mjs'
import { decodeText } from './text.js'

const DEFAULT_SETTINGS = { theme: 'light', fontSize: 20, lineHeight: 1.95, comicMode: 'scroll' }
const EMPTY = () => ({ schema: 1, books: {}, requests: {}, reading: {}, settings: DEFAULT_SETTINGS, sourceEpoch: 0 })
const clone = value => structuredClone(value)


export function createReaderStore(config, getVault = () => undefined, getProcessing = () => undefined) {
  const root = resolve(config.storageDir), blobs = join(root, 'blobs'), sources = createSources(config, getVault)
  let state, ready, queue = Promise.resolve(), closing = false, lease, diskBytes = 0, sourceRefs = []
  async function privateRead(path, limit) {
    const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await f.stat()
      if (!stat.isFile() || stat.size > limit) reject(500, 'INVALID_READER_STORAGE')
      return await f.readFile()
    } finally { await f.close() }
  }
  async function atomic(path, bytes) {
    const tmp = join(root, `.write-${randomUUID()}`)
    const f = await open(tmp, 'wx', 0o600)
    try { await f.writeFile(bytes); await f.sync() } finally { await f.close() }
    try {
      try { if ((await lstat(path)).isSymbolicLink()) reject(500, 'INVALID_READER_STORAGE') } catch (error) { if (error.code !== 'ENOENT') throw error }
      await rename(tmp, path)
      try {
        const dir = await open(path.startsWith(blobs + '/') ? blobs : root, 'r')
        try { await dir.sync() } finally { await dir.close() }
      } catch (error) { error.published = path === join(root,'catalog.json'); throw error }
    } finally { await unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  async function initialize() {
    if (ready) return ready
    ready = (async () => {
      await mkdir(root, { recursive: true, mode: 0o700 })
      const rootStat=await lstat(root)
      if (rootStat.isSymbolicLink() || rootStat.mode & 0o077 || await realpath(root) !== root) reject(500, 'INVALID_READER_STORAGE')
      await mkdir(blobs, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
      if ((await lstat(blobs)).isSymbolicLink()) reject(500, 'INVALID_READER_STORAGE')
      const lock=join(root,'writer.sqlite')
      for(const path of [lock,`${lock}-journal`,`${lock}-wal`,`${lock}-shm`]){
        try { const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.mode & 0o077)reject(500,'INVALID_READER_STORAGE') }
        catch(error){if(error.code!=='ENOENT')throw error}
      }
      const f=await open(lock,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);await f.close()
      const database=new DatabaseSync(lock)
      try {
        database.exec('PRAGMA busy_timeout=250; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS lease (owner TEXT);')
        database.prepare('INSERT INTO lease(owner) VALUES (?)').run(randomUUID())
        lease=database
      } catch(error){database.close();if(error.errcode===5||error.errcode===6)reject(503,'READER_WRITER_BUSY');throw error}
      try {
        try { state = JSON.parse((await privateRead(join(root, 'catalog.json'), config.maxIndexBytes)).toString('utf8')) } catch (error) {
          if (error.code !== 'ENOENT') throw error
          state = EMPTY()
        }
        validateState(state)
        sourceRefs = collectSourceRefs(state)
        for (const name of await readdir(blobs)) {
          if (!/^[a-f0-9]{64}$/.test(name)) reject(500, 'INVALID_READER_STORAGE')
          const info = await lstat(join(blobs, name))
          if (!info.isFile() || info.isSymbolicLink()) reject(500, 'INVALID_READER_STORAGE')
          diskBytes += info.size
        }
      } catch (error) { lease.close();lease=undefined;throw error }
    })()
    return ready
  }
  function validateState(s) {
    if (s?.schema !== 1 || !s.books || !s.requests || !s.reading) reject(500, 'INVALID_READER_STORAGE')
    settings(s.settings)
    integer(s.sourceEpoch ?? 0, 0, Number.MAX_SAFE_INTEGER)
    for (const [bookId, b] of Object.entries(s.books)) {
      id(bookId); integer(b.latestRevision, 1, 1_000_000)
      if (!Array.isArray(b.versions) || b.versions.length !== b.latestRevision) reject(500, 'INVALID_READER_STORAGE')
      for (const v of b.versions) {
        if (v.bookId !== bookId || !['novel','script','comic','pdf'].includes(v.kind) || !Array.isArray(v.parts)) reject(500, 'INVALID_READER_STORAGE')
        if(v.kind==='pdf')validateHash(v.pdf?.hash)
        for (const p of v.parts) { id(p.id); if (v.kind === 'comic') validateHash(p.hash); else for (const c of p.chunks || []) validateHash(c.hash) }
        if (v.cover) validateHash(v.cover.hash)
      }
    }
  }
  const validateHash = value => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) reject(500, 'INVALID_READER_STORAGE'); return value }
  function serial(fn) {
    if (closing) reject(503, 'READER_CLOSING')
    const job = queue.catch(() => {}).then(async () => { await initialize(); return fn() })
    queue = job
    return job
  }
  function collectSourceRefs(catalog) {
    const refs = new Map()
    for (const book of Object.values(catalog.books)) for (const version of book.versions) {
      for (const ref of [version.cover?.source, version.pdf?.source, ...version.parts.map(part => part.source)]) {
        if (ref) refs.set(JSON.stringify(ref), ref)
      }
    }
    return [...refs.values()]
  }
  function advanceSourceEpoch(next) {
    const epoch = next.sourceEpoch ?? 0
    if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch === Number.MAX_SAFE_INTEGER) reject(500, 'INVALID_SOURCE_EPOCH')
    next.sourceEpoch = epoch + 1
  }
  async function commit(next) {
    const nextRefs = collectSourceRefs(next)
    const bytes = Buffer.from(JSON.stringify(next))
    if (bytes.length > config.maxIndexBytes || bytes.length + diskBytes > config.maxStorageBytes) reject(413, 'READER_STORAGE_LIMIT')
    try { await atomic(join(root, 'catalog.json'), bytes) } catch (error) {
      if (error.published) { state=next; sourceRefs=nextRefs; closing=true }
      throw error
    }
    state = next
    sourceRefs = nextRefs
  }
  async function put(bytes, staged) {
    const key = hash(bytes), path = join(blobs, key)
    try {
      const existing = await privateRead(path, Math.max(config.maxImageBytes, config.maxTextBytes,config.maxDocumentBytes))
      if (hash(existing) !== key) reject(500, 'INVALID_READER_STORAGE')
      return key
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (diskBytes + bytes.length > config.maxStorageBytes) reject(413, 'READER_STORAGE_LIMIT')
    await atomic(path, bytes); diskBytes += bytes.length; staged.set(key, bytes.length)
    return key
  }
  async function rollback(staged) {
    for (const [key, bytes] of staged) { await unlink(join(blobs, key)); diskBytes -= bytes }
  }
  function lookup(bookId, revision, includeDeleted = false) {
    id(bookId)
    const book = state.books[bookId]
    if (!book || (book.deletedAt && !includeDeleted)) reject(404, 'BOOK_NOT_FOUND')
    const rev = revision === undefined ? book.latestRevision : integer(revision, 1, book.latestRevision)
    const v = book.versions[rev - 1]
    return { book, v }
  }
  async function checkBook(v) {
    const refs=new Map(v.parts.filter(p=>p.source).map(p=>[JSON.stringify(p.source),p.source]))
    await Promise.all([...refs.values()].map(ref => sources.check(ref)))
    if(v.pdf)await sources.check(v.pdf.source)
    if (v.cover) await sources.check(v.cover.source)
  }
  function publicBook(v, book) {
    const out = clone(v)
    for (const p of out.parts) { if (p.source?.path) delete p.source.path }
    if (out.cover?.source?.path) delete out.cover.source.path
    if (out.pdf?.source?.path) delete out.pdf.source.path
    return { ...out, latestRevision: book.latestRevision, deletedAt: book.deletedAt || '', scope: 'operator' }
  }
  function summary(v, book) {
    return { bookId:v.bookId, revision:v.revision, latestRevision:book.latestRevision, title:v.title, author:v.author, kind:v.kind, summary:v.summary, tags:v.tags, createdAt:v.createdAt, partCount:v.parts.length, format:v.importInfo?.format, cover:v.cover ? {width:v.cover.width,height:v.cover.height} : null, deletedAt:book.deletedAt || '' }
  }
  function replay(next, rid, digest) {
    const old = next.requests[rid]
    if (old && old.digest !== digest) reject(409, 'REQUEST_ID_CONFLICT')
    return old ? clone(old.result) : null
  }
  async function transaction(input, fn) {
    object(input); const rid = requestId(input.requestId), digest = hash(JSON.stringify(input))
    return serial(async () => {
      const repeated = replay(state, rid, digest)
      if (repeated) return repeated
      const staged = new Map(), next = clone(state)
      try {
        const result = await fn(next, staged)
        next.requests[rid] = { digest, result, at:Date.now() }

        const keys = Object.keys(next.requests)
        for (const old of keys.slice(0, Math.max(0, keys.length - 5000))) delete next.requests[old]
        await commit(next)
        return result
      } catch (error) { if(!error.published)await rollback(staged); throw error }
    })
  }
  async function image(ref, cwd, staged) {
    const source = await sources.source(ref, cwd), bytes = await sources.read(source, 'image')
    if (bytes.length > config.maxImageBytes) reject(413, 'SOURCE_TOO_LARGE')
    const size = raster(bytes, config.maxImagePixels)
    return { ...size, hash:await put(bytes, staged), source, bytes:bytes.length }
  }
  function blocksFromText(body, kind,format) {
    const seen = new Map(), blocks = []
    const markdown=kind==='novel'&&['md','markdown'].includes(format)
    const normalized=body.replace(/\r\n?/g,'\n'),paragraphs=markdown?marked.lexer(normalized).map(token=>token.raw):normalized.split(/\n\s*\n/)
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue
      const chars = Array.from(paragraph)
      for (let start = 0; start < chars.length; start += 6000) {
        const value = chars.slice(start,start + 6000).join(''), fingerprint = hash(value).slice(0,20), count = seen.get(fingerprint) || 0
        seen.set(fingerprint,count + 1)
        blocks.push({ id:`b-${fingerprint}-${count}`, type:kind === 'script' ? 'action' : markdown?'markdown':/^#{1,6} /.test(value) ? 'heading' : 'paragraph', text:value })
      }
    }
    return blocks
  }
  async function normalize(input, bookId, revision, cwd, staged) {
    object(input)
    const title = text(input.title, 240, true), kind = input.kind
    if (!['novel','script','comic'].includes(kind)) reject(400, 'INVALID_BOOK_KIND')
    const tags = input.tags || []
    if (!Array.isArray(tags) || tags.length > 32) reject(400, 'INVALID_TAGS')
    const partsInput = kind === 'comic' ? input.pages : input.chapters
    if (!Array.isArray(partsInput) || !partsInput.length || partsInput.length > config.maxParts) reject(400, 'INVALID_PARTS')
    const parts = [], ids = new Set(); let total = 0
    for (const raw of partsInput) {
      object(raw); const partId = id(raw.id || randomUUID())
      if (kind === 'comic' && partId === 'cover') reject(400, 'RESERVED_PAGE_ID')
      if (ids.has(partId)) reject(400, 'DUPLICATE_PART_ID'); ids.add(partId)
      const part = { id:partId, title:text(raw.title || `#${parts.length + 1}`,240,true) }
      if (kind === 'comic') {
        Object.assign(part,await image(raw.source,cwd,staged),{alt:text(raw.alt || part.title,1000)})
        total += part.bytes
      } else {
        if ([raw.text !== undefined,raw.blocks !== undefined,raw.source !== undefined].filter(Boolean).length !== 1) reject(400, 'CHAPTER_REQUIRES_ONE_CONTENT_SOURCE')
        let blocks
        if (raw.blocks !== undefined) {
          if (kind !== 'script' || !Array.isArray(raw.blocks) || !raw.blocks.length || raw.blocks.length > 10000) reject(400, 'INVALID_SCRIPT_BLOCKS')
          const blockIds = new Set()
          blocks = raw.blocks.map(b => {
            object(b); const blockId = id(b.id || randomUUID())
            if (blockIds.has(blockId)) reject(400,'DUPLICATE_BLOCK_ID'); blockIds.add(blockId)
            if (!['scene','action','dialogue','parenthetical'].includes(b.type)) reject(400,'INVALID_SCRIPT_BLOCK')
            return { id:blockId, type:b.type, text:text(b.text,6000,true), ...(b.type === 'dialogue' ? {speaker:text(b.speaker,160,true)} : {}) }
          })
        } else {
          let body
          if (raw.source) {
            part.source = await sources.source(raw.source,cwd)
            const bytes = await sources.read(part.source,'text')
            body=decodeText(bytes).text
          } else body = text(raw.text,config.maxTextBytes,true)
          blocks = blocksFromText(body,kind,raw.format||(raw.source&&part.source?.path?.match(/\.([^.]+)$/)?.[1]?.toLowerCase()))
          if (!blocks.length) reject(400,'EMPTY_CHAPTER')
        }
        part.textBytes=blocks.reduce((n,b)=>n+Buffer.byteLength(b.text),0)
        total += part.textBytes
        if (total > config.maxTextBytes) reject(413,'BOOK_TEXT_LIMIT')
        part.chunks = []; let batch = [], chars = 0
        const flush = async () => {
          if (!batch.length) return
          const bytes = Buffer.from(JSON.stringify(batch)); part.chunks.push({hash:await put(bytes,staged),firstBlockId:batch[0].id,count:batch.length}); batch=[];chars=0
        }
        for (const b of blocks) { if (chars + b.text.length > 24000 || batch.length >= 100) await flush(); batch.push(b);chars += b.text.length }
        await flush(); part.blockCount = blocks.length
      }
      parts.push(part)
    }
    const cover = input.cover ? await image(input.cover,cwd,staged) : null
    return {bookId,revision,title,kind,author:text(input.author || '',240),summary:text(input.summary || '',2000),tags:tags.map(t=>text(t,80,true)),direction:input.direction === 'rtl' ? 'rtl' : 'ltr',parts,cover,createdAt:new Date().toISOString()}
  }
  async function create(input, cwd, publisherContext) {
    return transaction(input,async(next,staged)=>{
      if(publisherContext)await assertInputAccess(input,publisherContext,cwd)
      if (Object.keys(next.books).length >= config.maxBooks) reject(413,'BOOK_COUNT_LIMIT')
      const bookId = randomUUID(), v = await normalize(input.document,bookId,1,cwd,staged)
      next.books[bookId] = {latestRevision:1,versions:[v],deletedAt:'',...(publisherContext?.actor==='agent'&&isAbsolute(publisherContext.projectId||'')?{ownerProjectId:resolve(publisherContext.projectId)}:{})}
      advanceSourceEpoch(next)
      return summary(v,next.books[bookId])
    })
  }

  async function importDocument(input,cwd,processingContext,publisherContext) {
    return transaction(input,async(next,staged)=>{
      if(publisherContext){await assertInputAccess(input,publisherContext,cwd);if(input.bookId)await assertBookAccess(input.bookId,publisherContext)}
      let bytes,source,filename
      if(input.source){
        if(input.data!==undefined)reject(400,'AMBIGUOUS_SOURCE')
        source=await sources.source(input.source,cwd)
        if(!source.path)reject(415,'DOCUMENT_FILE_REQUIRED')
        filename=basename(source.path);bytes=await sources.read(source,'document')
      }else{
        filename=text(input.filename,240,true)
        if(filename!==basename(filename)||filename.includes('\\'))reject(400,'INVALID_DOCUMENT_NAME')
        const encoded=input.data
        if(typeof encoded!=='string'||!encoded.length||encoded.length>Math.ceil(config.maxDocumentBytes/3)*4||encoded.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))reject(400,'INVALID_DOCUMENT_DATA')
        bytes=Buffer.from(encoded,'base64')
        if(bytes.toString('base64')!==encoded)reject(400,'INVALID_DOCUMENT_DATA')
      }
      let parsed
      if(/\.doc$/i.test(filename)){
        const core=getProcessing();if(core?.version!==1||!core.convertDocument||!processingContext)reject(503,'PROCESSING_UNAVAILABLE')
        const converted=await core.convertDocument({bytes,filename,mediaType:'application/msword',mode:'auto',textBudget:2000000,imageBudget:0,allowRemote:false},processingContext)
        if(converted.sourceFingerprint!==hash(bytes))reject(409,'SOURCE_REFERENCE_CHANGED')
        if(converted.truncated||converted.pages?.some(p=>p.truncated))reject(413,'DOCUMENT_TOO_LARGE')
        if(!converted.pages?.length)reject(415,'EMPTY_DOCUMENT')
        parsed={kind:'novel',format:'doc',warnings:['Legacy DOC imported as document flow; physical pagination and embedded media are not preserved.'],chapters:converted.pages.map((p,i)=>({id:`section-${i+1}`,title:p.section||`第 ${i+1} 节`,text:p.text}))}
        if(source)await sources.check(source)
      }else parsed=await parseDocument(bytes,filename,config)
      const bookId=input.bookId?id(input.bookId):randomUUID()
      let revision=1
      if(input.bookId){const previous=lookup(bookId);if(previous.book.latestRevision!==input.expectedRevision)reject(409,'BOOK_VERSION_CONFLICT');await checkBook(previous.v);if(previous.v.kind!==parsed.kind)reject(400,'BOOK_KIND_CANNOT_CHANGE');revision=previous.book.latestRevision+1}
      else if(Object.keys(next.books).length>=config.maxBooks)reject(413,'BOOK_COUNT_LIMIT')
      const title=text(input.title||parsed.title||filename.replace(/\.[^.]+$/,''),240,true),author=text(input.author||parsed.author||'',240)
      let v
      if(parsed.kind==='pdf'){
        v={bookId,revision,title,author,kind:'pdf',summary:'',tags:[],direction:'ltr',cover:null,createdAt:new Date().toISOString(),pdf:{hash:await put(bytes,staged),mime:'application/pdf',bytes:bytes.length,...(source?{source}:{})},parts:parsed.pages.map((p,i)=>({id:`page-${i+1}`,title:`第 ${i+1} 页`,pageNumber:i+1,...p}))}
      }else{
        v=await normalize({title,author,kind:'novel',chapters:parsed.chapters.map(p=>({...p,format:parsed.format}))},bookId,revision,cwd,staged)
        if(source)for(const p of v.parts)p.source=source
      }
      v.importInfo={format:parsed.format,encoding:parsed.encoding||null,warnings:parsed.warnings,sourceBytes:bytes.length,sourceHash:hash(bytes)}
      if(input.bookId){next.books[bookId].versions.push(v);next.books[bookId].latestRevision=revision}
      else next.books[bookId]={latestRevision:1,versions:[v],deletedAt:'',...(publisherContext?.actor==='agent'&&isAbsolute(publisherContext.projectId||'')?{ownerProjectId:resolve(publisherContext.projectId)}:{})}
      advanceSourceEpoch(next)
      return {...summary(v,next.books[bookId]),importInfo:clone(v.importInfo)}
    })
  }
  async function update(input, cwd,principal) {
    return transaction(input,async(next,staged)=>{
      if(principal){await assertBookAccess(input.bookId,principal);await assertInputAccess(input,principal,cwd)}
      const {book,v} = lookup(input.bookId)
      if (input.expectedRevision !== book.latestRevision) reject(409,'BOOK_VERSION_CONFLICT')
      await checkBook(v)
      let fresh
      if(input.document) fresh = await normalize(input.document,input.bookId,book.latestRevision+1,cwd,staged)
      else {
        const patch=object(input.patch), parts=clone(v.parts)
        const operations=patch.operations||[]
        if(v.kind==='pdf'&&operations.length)reject(400,'PDF_REPLACE_REQUIRES_IMPORT')
        if(!Array.isArray(operations)||operations.length>config.maxParts*2)reject(400,'INVALID_OPERATIONS')
        for(const op of operations){
          object(op)
          if(op.op==='upsert'){
            const raw=object(op.part),partId=id(raw.id)
            const normalized=await normalize({title:v.title,kind:v.kind,[v.kind==='comic'?'pages':'chapters']:[raw]},input.bookId,v.revision+1,cwd,staged)
            const i=parts.findIndex(p=>p.id===partId)
            if(i<0)parts.push(normalized.parts[0]);else parts[i]=normalized.parts[0]
          }else if(op.op==='remove'){
            const i=parts.findIndex(p=>p.id===id(op.id));if(i<0)reject(404,'PART_NOT_FOUND');parts.splice(i,1)
          }else if(op.op==='reorder'){
            if(!Array.isArray(op.ids)||op.ids.length!==parts.length||new Set(op.ids).size!==parts.length)reject(400,'INVALID_PART_ORDER')
            const ordered=op.ids.map(key=>parts.find(p=>p.id===id(key)))
            if(ordered.some(p=>!p))reject(400,'INVALID_PART_ORDER');parts.splice(0,parts.length,...ordered)
          }else reject(400,'INVALID_OPERATION')
        }
        if(!parts.length||parts.length>config.maxParts)reject(400,'INVALID_PARTS')
        if(!['comic','pdf'].includes(v.kind)&&parts.reduce((sum,p)=>sum+p.textBytes,0)>config.maxTextBytes)reject(413,'BOOK_TEXT_LIMIT')
        fresh={...clone(v),revision:book.latestRevision+1,parts,createdAt:new Date().toISOString()}
        for(const key of ['title','author','summary'])if(patch[key]!==undefined)fresh[key]=text(patch[key],key==='summary'?2000:240,key==='title')
        if(patch.tags!==undefined){if(!Array.isArray(patch.tags)||patch.tags.length>32)reject(400,'INVALID_TAGS');fresh.tags=patch.tags.map(t=>text(t,80,true))}
        if(patch.cover!==undefined)fresh.cover=patch.cover===null?null:await image(patch.cover,cwd,staged)
        if(patch.direction!==undefined){if(!['ltr','rtl'].includes(patch.direction))reject(400,'INVALID_DIRECTION');fresh.direction=patch.direction}
      }
      if (fresh.kind !== v.kind) reject(400,'BOOK_KIND_CANNOT_CHANGE')
      next.books[input.bookId].versions.push(fresh);next.books[input.bookId].latestRevision++
      advanceSourceEpoch(next)
      return summary(fresh,next.books[input.bookId])
    })
  }
  async function restore(input,principal) {
    return transaction(input,async(next)=>{
      if(principal){await assertBookAccess(input.bookId,principal,undefined,true);await assertBookAccess(input.bookId,principal,input.restoreRevision,true)}
      const {book,v} = lookup(input.bookId,input.restoreRevision,true)
      if (input.expectedRevision !== book.latestRevision) reject(409,'BOOK_VERSION_CONFLICT')
      await checkBook(v)
      const fresh = {...clone(v),revision:book.latestRevision+1,restoredFrom:v.revision,createdAt:new Date().toISOString()}
      next.books[input.bookId].versions.push(fresh); next.books[input.bookId].latestRevision++;next.books[input.bookId].deletedAt=''
      advanceSourceEpoch(next)
      return summary(fresh,next.books[input.bookId])
    })
  }
  async function trash(input) {
    return transaction(input,async(next)=>{
      const {book} = lookup(input.bookId)
      if (input.expectedRevision !== book.latestRevision) reject(409,'BOOK_VERSION_CONFLICT')
      next.books[input.bookId].deletedAt = new Date().toISOString()
      advanceSourceEpoch(next)
      return {bookId:input.bookId,deleted:true}
    })
  }
  async function get(bookId, revision) { await initialize(); const {book,v}=lookup(bookId,revision);await checkBook(v);lookup(bookId,v.revision);return publicBook(v,book) }
  async function assertKnowledgeAccess(source,context){
    if(!source?.knowledgeId||context?.operator===true)return
    const entry=await getVault()?.get(source.knowledgeId),project=resolve(context?.projectId||'')
    if(!entry||entry.deletedAt||context?.actor!=='agent'||(entry.projectId?entry.projectId!==project:entry.shared!==true&&!(source.path&&within(project,source.path))))reject(403,'SOURCE_PROJECT_ACCESS_DENIED')
  }
  async function assertSourceAccess(bookId,partId,context,revision){
    await initialize();if(closing)reject(503,'READER_CLOSING');const {v}=lookup(bookId,revision),part=v.parts.find(p=>p.id===id(partId));if(!part)reject(404,'CHAPTER_NOT_FOUND')
    await checkBook(v)
    if(context?.operator===true)return
    const source=v.kind==='pdf'?v.pdf?.source:part.source
    await assertKnowledgeAccess(source,context)
    const currentBook=lookup(bookId,v.revision).book
    if(context?.actor==='agent'&&currentBook.ownerProjectId===resolve(context.projectId||''))return
    const grant=currentBook.agentAccess
    if(context?.actor==='agent'&&typeof context.projectId==='string'&&(grant?.scope==='all'||grant?.scope==='projects'&&grant.projects.includes(resolve(context.projectId))))return
    if(context?.actor!=='agent'||typeof context.projectId!=='string'||!source?.path||!within(context.projectId,source.path))reject(403,'SOURCE_PROJECT_ACCESS_DENIED')
    await sources.check(source);lookup(bookId,v.revision)
  }
  async function assertInputAccess(input,context,cwd){
    if(context?.operator===true)return
    if(context?.actor!=='agent'||typeof context.projectId!=='string')reject(403,'TRUSTED_PROJECT_REQUIRED')
    const document=input.document||{},patch=input.patch||{},parts=[...(document.chapters||[]),...(document.pages||[]),...(patch.operations||[]).map(o=>o.part).filter(Boolean)]
    const refs=[input.source,document.cover,patch.cover,...parts.map(p=>p.source)].filter(Boolean)
    for(const ref of refs){const source=await sources.source(ref,cwd);await assertKnowledgeAccess(source,context)
      if(source.path){if(!within(context.projectId,source.path))reject(403,'SOURCE_PROJECT_ACCESS_DENIED')}
      else{const entry=await getVault()?.get(source.knowledgeId);if(!entry||!(entry.shared===true||entry.projectId===context.projectId))reject(403,'SOURCE_PROJECT_ACCESS_DENIED')}
    }
  }
  async function assertBookAccess(bookId,context,revision,includeDeleted=false){
    await initialize();const {v}=lookup(bookId,revision,includeDeleted);await checkBook(v)
    const refs=[v.cover?.source,v.pdf?.source,...v.parts.map(p=>p.source)],checked=new Set();for(const source of refs)if(source?.knowledgeId&&!checked.has(source.knowledgeId)){await assertKnowledgeAccess(source,context);checked.add(source.knowledgeId)}
    const book=lookup(bookId,v.revision,includeDeleted).book
    if(context?.operator===true)return
    if(context?.actor!=='agent'||typeof context.projectId!=='string')reject(403,'SOURCE_PROJECT_ACCESS_DENIED')
    if(book.ownerProjectId===resolve(context.projectId))return
    const grant=book.agentAccess;if(grant?.scope==='all'||grant?.scope==='projects'&&grant.projects.includes(resolve(context.projectId)))return
    if(!v.parts.every(p=>{const source=v.kind==='pdf'?v.pdf?.source:p.source;return source?.path&&within(context.projectId,source.path)}))reject(403,'SOURCE_PROJECT_ACCESS_DENIED')
  }


  function authorizationEpoch(){
    return BigInt('0x' + hash(JSON.stringify([state?.sourceEpoch ?? 0, closing, sources.authority(sourceRefs)])))
  }
  async function getAgentAccess(bookId){await initialize();const {book,v}=lookup(bookId);await checkBook(v);return {bookId,authorizationRevision:book.authorizationRevision||0,scope:book.agentAccess?.scope||'private',projects:clone(book.agentAccess?.projects||[])}}
  async function saveAgentAccess(input){return transaction(input,async next=>{
    const {book,v}=lookup(input.bookId);await checkBook(v);integer(input.expectedAuthorizationRevision,0,Number.MAX_SAFE_INTEGER)
    if(input.expectedAuthorizationRevision!==(book.authorizationRevision||0))reject(409,'AUTHORIZATION_CONFLICT')
    if(!['private','projects','all'].includes(input.scope)||!Array.isArray(input.projects)||input.projects.length>100)reject(400,'INVALID_AUTHORIZATION')
    const projects=[...new Set(input.projects.map(p=>{text(p,4000,true);if(!isAbsolute(p))reject(400,'INVALID_AUTHORIZATION');return resolve(p)}))]
    if(input.scope==='projects'&&!projects.length)reject(400,'INVALID_AUTHORIZATION')
    next.books[input.bookId].agentAccess={scope:input.scope,projects:input.scope==='projects'?projects:[]};next.books[input.bookId].authorizationRevision=(book.authorizationRevision||0)+1;advanceSourceEpoch(next)
    return {bookId:input.bookId,authorizationRevision:next.books[input.bookId].authorizationRevision,...clone(next.books[input.bookId].agentAccess)}
  })}
  async function listParts(input) { return partPage(await get(input.bookId,input.revision),input) }
  async function list({query='',kind='all',offset=0,trash=false}={}) {
    await initialize();text(query,1000);integer(offset,0,1000000)
    if (!['all','novel','script','comic','pdf'].includes(kind)) reject(400,'INVALID_BOOK_KIND')
    const items=[]
    for (const book of Object.values(state.books)) {
      const v=book.versions[book.latestRevision-1]
      if (!!book.deletedAt!==trash || (kind!=='all'&&v.kind!==kind) || ![v.title,v.author,...v.tags].join(' ').toLowerCase().includes(query.toLowerCase())) continue
      try { await checkBook(v) } catch (error) { if ([403,503].includes(error.status)) continue; throw error }
      items.push({...summary(v,book),progress:clone(state.reading[v.bookId]?.progress || null)})
    }
    items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.bookId.localeCompare(b.bookId))
    return {items:items.slice(offset,offset+40),total:items.length,nextOffset:offset+40<items.length?offset+40:null,scope:'operator'}
  }
  async function chunk(bookId,revision,partId,chunkIndex) {
    await initialize(); const {v}=lookup(bookId,revision), part=v.parts.find(p=>p.id===id(partId))
    if (!part || ['comic','pdf'].includes(v.kind)) reject(404,'CHAPTER_NOT_FOUND')
    await sources.check(part.source);integer(chunkIndex,0,part.chunks.length-1)
    const key=validateHash(part.chunks[chunkIndex].hash), bytes=await privateRead(join(blobs,key),config.maxTextBytes)
    if (hash(bytes)!==key) reject(500,'INVALID_READER_STORAGE')
    lookup(bookId,v.revision);await sources.check(part.source);lookup(bookId,v.revision)
    return {blocks:JSON.parse(bytes.toString('utf8')),chunkIndex,chunkCount:part.chunks.length,revision:v.revision,partId:part.id}
  }
  async function asset(bookId,revision,partId) {
    await initialize();const {v}=lookup(bookId,revision), part=partId==='cover'?v.cover:v.kind==='pdf'&&partId==='document'?v.pdf:v.kind==='comic'?v.parts.find(p=>p.id===id(partId)):null
    if (!part) reject(404,'ASSET_NOT_FOUND'); await sources.check(part.source)
    const key=validateHash(part.hash),bytes=await privateRead(join(blobs,key),v.kind==='pdf'&&partId==='document'?config.maxDocumentBytes:config.maxImageBytes)
    if (hash(bytes)!==key) reject(500,'INVALID_READER_STORAGE')
    return {bytes,mime:part.mime,hash:key}
  }
  async function history(bookId) {
    await initialize();const {book,v}=lookup(bookId,undefined,true);await checkBook(v)
    return {bookId,versions:book.versions.map(v=>summary(v,book))}
  }
  async function reading(bookId) {await initialize();const {v}=lookup(bookId);await checkBook(v);return clone(state.reading[bookId]||{serverRevision:0,progress:null,bookmarks:[]})}
  async function anchor(input) {
    object(input); const {v}=lookup(input.bookId,input.revision),p=v.parts.find(p=>p.id===id(input.partId))
    if (!p) reject(400,'INVALID_READING_ANCHOR');await sources.check(p.source);if(v.pdf)await sources.check(v.pdf.source)
    const ratio=input.ratio
    if (typeof ratio!=='number'||!Number.isFinite(ratio)||ratio<0||ratio>1) reject(400,'INVALID_READING_ANCHOR')
    const paginated=['comic','pdf'].includes(v.kind),chunkIndex=paginated?0:integer(input.chunkIndex,0,p.chunks.length-1)
    let blockId=null
    if(!paginated) {
      blockId=id(input.blockId);const content=await chunk(input.bookId,input.revision,p.id,chunkIndex)
      if(!content.blocks.some(b=>b.id===blockId))reject(400,'INVALID_READING_ANCHOR')
    }
    return {revision:v.revision,partId:p.id,chunkIndex,blockId,ratio,updatedAt:new Date().toISOString()}
  }
  async function saveReading(input) {
    return transaction(input,async(next)=>{
      const old=next.reading[id(input.bookId)]||{serverRevision:0,progress:null,bookmarks:[]}
      if(input.expectedServerRevision!==old.serverRevision)reject(409,'READING_CONFLICT')
      const progress=await anchor(input)
      next.reading[input.bookId]={...old,serverRevision:old.serverRevision+1,progress}
      return clone(next.reading[input.bookId])
    })
  }
  async function bookmark(input) {
    return transaction(input,async(next)=>{
      const old=next.reading[id(input.bookId)]||{serverRevision:0,progress:null,bookmarks:[]}
      if(input.expectedServerRevision!==old.serverRevision)reject(409,'READING_CONFLICT')
      const bookmarks=clone(old.bookmarks)
      if(input.removeId) { const i=bookmarks.findIndex(b=>b.id===id(input.removeId));if(i<0)reject(404,'BOOKMARK_NOT_FOUND');bookmarks.splice(i,1) }
      else { if(bookmarks.length>=200)reject(413,'BOOKMARK_LIMIT');bookmarks.push({id:randomUUID(),label:text(input.label||'',240),...await anchor(input)}) }
      next.reading[input.bookId]={...old,serverRevision:old.serverRevision+1,bookmarks}
      return clone(next.reading[input.bookId])
    })
  }
  async function saveSettings(input) {return transaction(input,async(next)=>{next.settings=settings(input.settings);return clone(next.settings)})}
  async function getSettings(){await initialize();return clone(state.settings)}
  async function close() {
    closing=true;await queue.catch(()=>{});await ready?.catch(()=>{})
    if(lease){try{lease.exec('ROLLBACK')}finally{lease.close();lease=undefined}}
  }
    return {initialize,create,importDocument,update,restore,trash,get,assertSourceAccess,assertInputAccess,assertBookAccess,authorizationEpoch,getAgentAccess,saveAgentAccess,listParts,list,chunk,asset,history,reading,saveReading,bookmark,saveSettings,getSettings,close}
}
