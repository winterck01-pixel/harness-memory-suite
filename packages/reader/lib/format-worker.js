import { parentPort, workerData } from 'node:worker_threads'
import { inflateRawSync } from 'node:zlib'
import { posix, extname } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { marked } from '../vendor/marked.mjs'
import { decodeText } from './text.js'
const require=createRequire(import.meta.url),sax=require('../vendor/sax.cjs')
const {bytes:raw,filename,limits}=workerData,bytes=Buffer.from(raw)
const bad=(code,status=422)=>{throw Object.assign(new Error(code),{code,status})}
const digest=s=>createHash('sha256').update(s).digest('hex').slice(0,16)

function splitText(body,format) {
  if(['md','markdown'].includes(format)){
    const chapters=[];let pieces=[],title='正文'
    const flush=()=>{const text=pieces.join('').trim();if(text)chapters.push({id:`c-${chapters.length+1}-${digest(text)}`,title:title.slice(0,240),text});pieces=[]}
    for(const token of marked.lexer(body)){if(token.type==='heading'&&token.depth<=3){flush();title=token.text}pieces.push(token.raw)}
    flush();return chapters
  }
  const lines=body.split('\n'),chapters=[];let current=[],title='正文'
  const heading=line=>/^(?:第[零〇一二三四五六七八九十百千万两\d]+(?:[章节卷部]|回(?:\s|[：:、.．（(]|$))|番外(?:卷|\s|[：:、.．\d一二三四五六七八九十]|$))/.test(line)
  const flush=()=>{const text=current.join('\n').trim();if(text)chapters.push({id:`c-${chapters.length+1}-${digest(text)}`,title:title.slice(0,240),text});current=[]}
  for(const line of lines){const trimmed=line.trim();if(trimmed.length<=240&&heading(trimmed)){flush();title=trimmed.replace(/^#{1,6}\s+/,'')}current.push(line)}
  flush();return chapters
}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0})
function crc(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0}
function safeName(name){if(!name||name.includes('\0')||name.includes('\\')||name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').some(p=>p==='..'||p==='.'))bad('UNSAFE_ARCHIVE_PATH');return name}

function zip(input){
  let end=-1;for(let i=input.length-22;i>=Math.max(0,input.length-65557);i--)if(input.readUInt32LE(i)===0x06054b50&&i+22+input.readUInt16LE(i+20)===input.length){end=i;break}
  if(end<0||input.readUInt16LE(end+4)||input.readUInt16LE(end+6))bad('INVALID_DOCUMENT_ARCHIVE')
  const count=input.readUInt16LE(end+10),size=input.readUInt32LE(end+12),offset=input.readUInt32LE(end+16)
  if(count!==input.readUInt16LE(end+8)||count>10000||count===65535||offset+size>end)bad('ARCHIVE_LIMIT')
  const entries=new Map();let pos=offset,total=0
  for(let i=0;i<count;i++){
    if(pos+46>offset+size||input.readUInt32LE(pos)!==0x02014b50)bad('INVALID_DOCUMENT_ARCHIVE')
    const flags=input.readUInt16LE(pos+8),method=input.readUInt16LE(pos+10),checksum=input.readUInt32LE(pos+16),packed=input.readUInt32LE(pos+20),unpacked=input.readUInt32LE(pos+24),nl=input.readUInt16LE(pos+28),extra=input.readUInt16LE(pos+30),comment=input.readUInt16LE(pos+32),attrs=input.readUInt32LE(pos+38),local=input.readUInt32LE(pos+42)
    if(pos+46+nl+extra+comment>offset+size||flags&1||![0,8].includes(method)||unpacked===0xffffffff||packed===0xffffffff)bad('ENCRYPTED_OR_UNSUPPORTED_ARCHIVE')
    const name=safeName(new TextDecoder('utf-8',{fatal:true}).decode(input.subarray(pos+46,pos+46+nl)))
    if(entries.has(name)||(attrs>>>16&0xf000)===0xa000)bad('UNSAFE_ARCHIVE_PATH')
    total+=unpacked;if(total>limits.maxDocumentBytes*4||unpacked>limits.maxTextBytes||unpacked>Math.max(1024*1024,packed*200))bad('ARCHIVE_LIMIT')
    if(local+30>offset||input.readUInt32LE(local)!==0x04034b50||input.readUInt16LE(local+8)!==method||input.readUInt16LE(local+6)&1)bad('INVALID_DOCUMENT_ARCHIVE')
    const lnl=input.readUInt16LE(local+26),lex=input.readUInt16LE(local+28),start=local+30+lnl+lex
    if(start+packed>offset||!input.subarray(local+30,local+30+lnl).equals(input.subarray(pos+46,pos+46+nl)))bad('INVALID_DOCUMENT_ARCHIVE')
    entries.set(name,{start,packed,unpacked,method,checksum});pos+=46+nl+extra+comment
  }
  if(pos!==offset+size)bad('INVALID_DOCUMENT_ARCHIVE')
  const cache=new Map()
  return {has:name=>entries.has(name),read(name){const e=entries.get(safeName(name));if(!e)bad('DOCUMENT_RESOURCE_MISSING');if(cache.has(name))return cache.get(name);let result
    try{const src=input.subarray(e.start,e.start+e.packed);result=e.method===0?Buffer.from(src):inflateRawSync(src,{maxOutputLength:Math.max(1,e.unpacked)})}catch{bad('INVALID_DOCUMENT_ARCHIVE')}
    if(result.length!==e.unpacked||crc(result)!==e.checksum)bad('INVALID_DOCUMENT_ARCHIVE');cache.set(name,result);return result}}
}
function xml(bytes){
  let body;try{body=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{bad('INVALID_DOCUMENT_XML')}
  body=body.replace(/<!DOCTYPE\s+html(?:\s+PUBLIC\s+"[^"<>\[\]]*"\s+"[^"<>\[\]]*"|\s+SYSTEM\s+"[^"<>\[\]]*")?\s*>/gi,'')
  if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(body))bad('UNSAFE_DOCUMENT_XML')
  body=body.replace(/&(nbsp|copy|reg|mdash|ndash|hellip);/g,(_,name)=>`&#${{nbsp:160,copy:169,reg:174,mdash:8212,ndash:8211,hellip:8230}[name]};`)
  const parser=sax.parser(true,{xmlns:true}),root={name:'root',attrs:{},children:[]},stack=[root];let count=0
  parser.onopentag=node=>{if(++count>200000||stack.length>128)bad('DOCUMENT_XML_LIMIT');const item={name:node.local,uri:node.uri,attrs:Object.fromEntries(Object.values(node.attributes).map(a=>[a.name,a.value])),children:[]};stack.at(-1).children.push(item);stack.push(item)}
  parser.onclosetag=()=>stack.pop();parser.ontext=s=>stack.at(-1).children.push(s);parser.oncdata=parser.ontext;parser.onerror=()=>bad('INVALID_DOCUMENT_XML');parser.write(body).close();return root
}
const children=(n,name)=>n.children.filter(c=>typeof c!=='string'&&(!name||c.name===name))
const all=(n,name)=>children(n).flatMap(c=>[...(c.name===name?[c]:[]),...all(c,name)])
const value=n=>n.children.map(c=>typeof c==='string'?c:value(c)).join('')
function docx(archive){
  if(archive.has('word/vbaProject.bin'))bad('MACRO_DOCUMENT_UNSUPPORTED')
  const types=xml(archive.read('[Content_Types].xml'))
  if(!all(types,'Override').some(n=>n.attrs.PartName==='/word/document.xml'&&n.attrs.ContentType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'))bad('INVALID_DOCX')
  const tree=xml(archive.read('word/document.xml')),paragraphs=all(tree,'p'),chapters=[];let lines=[],title='正文',images=false
  const flush=()=>{const text=lines.join('\n\n').trim();if(text)chapters.push({id:`c-${chapters.length+1}-${digest(text)}`,title:title.slice(0,240),text});lines=[]}
  const headingStyles=new Set(['Title','Heading1','Heading2','Heading3'])
  if(archive.has('word/styles.xml'))for(const style of all(xml(archive.read('word/styles.xml')),'style')){const level=all(style,'outlineLvl')[0]?.attrs['w:val'];if(level!==undefined&&Number(level)<=2)headingStyles.add(style.attrs['w:styleId'])}
  for(const p of paragraphs){const style=all(p,'pStyle')[0]?.attrs['w:val'],heading=headingStyles.has(style)||/^Heading[1-3]$/i.test(style||'');const tokens=[]
    function walk(n){for(const c of n.children){if(typeof c==='string')continue;if(c.name==='t')tokens.push(value(c));else if(['tab'].includes(c.name))tokens.push('\t');else if(['br','cr'].includes(c.name))tokens.push('\n');else if(['drawing','pict','object'].includes(c.name)){images=true;tokens.push('[图片或嵌入对象：请查看原文件]')}else if(!['instrText','del','pPr'].includes(c.name))walk(c)}}
    walk(p);const text=tokens.join('').trim();if(!text)continue;if(heading){flush();title=text}lines.push(text)
  }
  flush();return {chapters,warnings:['DOCX_TEXT_REFLOW',...(images?['EMBEDDED_MEDIA_NOT_IMPORTED']:[])]}
}
function resolveResource(base,href){let decoded;try{decoded=decodeURIComponent(href.split('#')[0])}catch{bad('UNSAFE_ARCHIVE_PATH')};if(!decoded||/^[a-z][a-z\d+.-]*:/i.test(decoded)||decoded.startsWith('//')||decoded.startsWith('/')||decoded.includes('\\'))bad('REMOTE_DOCUMENT_RESOURCE');const result=posix.normalize(posix.join(posix.dirname(base),decoded));return safeName(result)}
function xhtmlText(tree){let images=false;const lines=[]
  function walk(n){if(['script','style','iframe','object','embed','head','svg','audio','video'].includes(n.name))return;if(n.name==='img'){images=true;lines.push(`[图片：${n.attrs.alt||'请查看原文件'}]`);return}if(n.name==='br')lines.push('\n');for(const c of n.children){if(typeof c==='string')lines.push(c);else walk(c)}if(['p','div','section','h1','h2','h3','li','tr','blockquote'].includes(n.name))lines.push('\n\n')}
  const body=all(tree,'body')[0];if(!body)bad('INVALID_EPUB_CONTENT');walk(body);return {text:lines.join('').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim(),images}
}
function epub(archive){
  if(archive.has('META-INF/encryption.xml')||archive.has('META-INF/rights.xml'))bad('ENCRYPTED_DOCUMENT_UNSUPPORTED')
  if(archive.read('mimetype').toString('utf8').trim()!=='application/epub+zip')bad('INVALID_EPUB')
  const packagePath=safeName(all(xml(archive.read('META-INF/container.xml')),'rootfile')[0]?.attrs['full-path'])
  const pack=xml(archive.read(packagePath)),manifest=new Map(all(pack,'item').map(n=>[n.attrs.id,n.attrs])),refs=all(pack,'itemref'),chapters=[];let images=false
  const layout=all(pack,'meta').find(n=>n.attrs.property==='rendition:layout');if(layout&&value(layout).trim()==='pre-paginated')bad('FIXED_LAYOUT_EPUB_UNSUPPORTED')
  if(!refs.length||refs.length>limits.maxParts)bad('INVALID_EPUB_SPINE')
  for(const ref of refs){if(ref.attrs.linear==='no')continue;const item=manifest.get(ref.attrs.idref);if(!item||!['application/xhtml+xml','text/html'].includes(item['media-type']))bad('UNSUPPORTED_EPUB_SPINE_ITEM')
    const resource=resolveResource(packagePath,item.href),tree=xml(archive.read(resource)),body=xhtmlText(tree);images||=body.images;if(!body.text)continue
    const title=all(tree,'h1')[0]||all(tree,'h2')[0]||all(tree,'title')[0];chapters.push({id:`c-${chapters.length+1}-${digest(resource)}`,title:(title?value(title).trim():`章节 ${chapters.length+1}`).slice(0,240),text:body.text})
  }
  return {chapters,title:all(pack,'title')[0]?value(all(pack,'title')[0]).trim():undefined,author:all(pack,'creator')[0]?value(all(pack,'creator')[0]).trim():undefined,warnings:['EPUB_TEXT_REFLOW',...(images?['EMBEDDED_MEDIA_NOT_IMPORTED']:[])]}
}
async function parse(){
  const format=extname(filename).slice(1).toLowerCase();if(!['txt','md','markdown','pdf','docx','epub'].includes(format))bad(format==='doc'?'LEGACY_DOC_REQUIRES_CONVERSION':'UNSUPPORTED_DOCUMENT_FORMAT',415)
  if(format==='pdf'){
    if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))bad('INVALID_PDF')
    const {PDFDocument}=require('../vendor/pdf-lib.cjs');let pdf
    try{pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false,throwOnInvalidObject:true})}catch(error){bad(/encrypt/i.test(error.message)?'ENCRYPTED_DOCUMENT_UNSUPPORTED':'INVALID_PDF')}
    let pages;try{pages=pdf.getPages()}catch{bad('INVALID_PDF')};if(!pages.length||pages.length>limits.maxParts)bad('DOCUMENT_PAGE_LIMIT')
    const sizes=pages.map(p=>{let {width,height}=p.getCropBox();if(Math.abs(p.getRotation().angle)%180===90)[width,height]=[height,width];if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>14400||height>14400)bad('INVALID_PDF_PAGE');return{width,height}})
    return {format,kind:'pdf',pages:sizes,warnings:['PDF_PAGINATED_NO_OCR']}
  }
  let result
  if(['txt','md','markdown'].includes(format)){const decoded=decodeText(bytes);result={chapters:splitText(decoded.text,format),encoding:decoded.encoding,warnings:[]}}
  else result=format==='docx'?docx(zip(bytes)):epub(zip(bytes))
  if(!result.chapters.length||result.chapters.length>limits.maxParts)bad('DOCUMENT_CHAPTER_LIMIT')
  const textBytes=result.chapters.reduce((n,p)=>n+Buffer.byteLength(p.text),0);if(textBytes>limits.maxTextBytes)bad('BOOK_TEXT_LIMIT',413)
  return {...result,kind:'novel',format,textBytes}
}
try{parentPort.postMessage({result:await parse()})}catch(error){parentPort.postMessage({error:error.code||'DOCUMENT_PARSE_FAILED',status:error.status||422})}
