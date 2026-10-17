import {integer,text,reject} from './validate.js'
export function partPage(manifest,{query='',offset=0,limit=40}={}){
 text(query,1000);integer(offset,0,1000000);integer(limit,1,100)
 const needle=query.toLocaleLowerCase(),items=manifest.parts.map((p,index)=>({id:p.id,title:p.title,index,...(p.pageNumber?{pageNumber:p.pageNumber}:{}),...(p.chunks?{chunkCount:p.chunks.length}:{}),...(p.width?{width:p.width,height:p.height}:{} )})).filter(p=>`${p.id} ${p.title}`.toLocaleLowerCase().includes(needle));
 return {bookId:manifest.bookId,revision:manifest.revision,items:items.slice(offset,offset+limit),total:items.length,partCount:manifest.parts.length,offset,nextOffset:offset+limit<items.length?offset+limit:null}
}
export async function boundedManifest(store,input){
 const manifest=await store.get(input.bookId,input.revision),page=partPage(manifest,input)
 const {parts,pdf,cover,...metadata}=manifest
 return {...metadata,cover:cover?{width:cover.width,height:cover.height}:null,parts:page.items,partCount:page.partCount,total:page.total,offset:page.offset,nextOffset:page.nextOffset}
}
export async function chapterRange(store,input){
 const {blockOffset=0,textOffset=0,textLimit=4000,blockLimit=40}=input
 integer(blockOffset,0,1000000);integer(textOffset,0,1000000);integer(textLimit,1,8000);integer(blockLimit,1,100)
 const chunk=await store.chunk(input.bookId,input.revision,input.partId,input.chunkIndex)
 if(blockOffset>=chunk.blocks.length)reject(400,'INVALID_CHAPTER_RANGE')
 const blocks=[];let remaining=textLimit,index=blockOffset,offset=textOffset
 while(index<chunk.blocks.length&&remaining>0&&blocks.length<blockLimit){
  const original=chunk.blocks[index],chars=Array.from(original.text);if(offset>chars.length)reject(400,'INVALID_CHAPTER_RANGE')
  const count=Math.min(remaining,chars.length-offset);blocks.push({...original,text:chars.slice(offset,offset+count).join(''),textOffset:offset,textLength:chars.length});remaining-=count;offset+=count
  if(offset===chars.length){index++;offset=0}else break
 }
 return {...chunk,bookId:input.bookId,blocks,offsetUnit:'unicode-codepoints',blockCount:chunk.blocks.length,nextRange:index<chunk.blocks.length?{blockOffset:index,textOffset:offset}:null,nextChunkIndex:index===chunk.blocks.length&&chunk.chunkIndex+1<chunk.chunkCount?chunk.chunkIndex+1:null,citation:{bookId:input.bookId,revision:chunk.revision,partId:chunk.partId,chunkIndex:chunk.chunkIndex,blockOffset,textOffset}}
}
