import {createHash} from 'node:crypto';


export const MAX_READ_BYTES=6000;
export function validateReadPageArgs(args={},maxOffset=Infinity){
 const offset=args.output_offset??0;
 if(!Number.isSafeInteger(offset)||offset<0||offset>maxOffset)throw new Error('INVALID_OUTPUT_OFFSET');
 if(offset>0&&!args.output_revision)throw new Error('OUTPUT_REVISION_REQUIRED');
 return offset;
}
export const readPageSchema={type:'object',additionalProperties:false,required:['page'],properties:{page:{type:'object',additionalProperties:false,required:['format','text','offset','nextOffset','totalChars','revision','instruction'],properties:{format:{type:'string',const:'json'},text:{type:'string'},offset:{type:'integer'},nextOffset:{oneOf:[{type:'integer'},{type:'null'}]},totalChars:{type:'integer'},revision:{type:'string'},instruction:{type:'string'}}}}};
export function boundReadOutput(value,args={}){
 const text=JSON.stringify(value),revision='kvpage_'+createHash('sha256').update(text).digest('hex').replace(/[0-9a-f]/g,c=>'abcdefghijklmnop'[parseInt(c,16)]);
 const offset=validateReadPageArgs(args,text.length);
 if(args.output_revision&&args.output_revision!==revision)throw new Error('OUTPUT_CHANGED_RESTART_FROM_ZERO');
 if(offset===0&&Buffer.byteLength(text)<=MAX_READ_BYTES)return value;
 if(offset>0&&/^[\uDC00-\uDFFF]$/.test(text[offset]||''))throw new Error('INVALID_OUTPUT_OFFSET');
 const wrap=end=>({page:{format:'json',text:text.slice(offset,end),offset,nextOffset:end<text.length?end:null,totalChars:text.length,revision,instruction:'Concatenate page.text in offset order and parse JSON. Repeat the same tool and original arguments with output_offset=nextOffset and output_revision=revision. If output changed, restart at zero.'}});
 let low=offset,high=text.length;
 while(low<high){const mid=Math.ceil((low+high)/2);if(Buffer.byteLength(JSON.stringify(wrap(mid)))<=MAX_READ_BYTES)low=mid;else high=mid-1;}
 if(low<text.length&&/[\uD800-\uDBFF]/.test(text[low-1]||''))low--;
 if(low===offset&&offset<text.length)throw new Error('OUTPUT_PAGE_BUDGET_EXCEEDED');
 return wrap(low);
}

export function createReadSnapshots({ttlMs=120000,maxEntries=16,maxBytes=2*1024*1024,now=Date.now}={}){
 const entries=new Map();let bytes=0,closed=false;
 const remove=key=>{const item=entries.get(key);if(item){bytes-=item.bytes;entries.delete(key)}};
 const prune=()=>{for(const[key,item]of entries)if(item.expires<=now())remove(key)};
 const keyFor=(identity,args)=>JSON.stringify([identity,Object.fromEntries(Object.entries(args).filter(([k])=>!['output_offset','output_revision'].includes(k)).sort(([a],[b])=>a.localeCompare(b)))]);
 return {
  remember(identity,args,value,verify,revision){prune();const key=keyFor(identity,args),size=Buffer.byteLength(JSON.stringify(value));if(closed||size>maxBytes)throw new Error('OUTPUT_SNAPSHOT_TOO_LARGE');remove(key);while(entries.size>=maxEntries||bytes+size>maxBytes)remove(entries.keys().next().value);entries.set(key,{value,verify,revision,bytes:size,expires:now()+ttlMs});bytes+=size;},
  continuation(identity,args){prune();const item=entries.get(keyFor(identity,args));if(closed||!item||item.revision!==args.output_revision)throw new Error('OUTPUT_SNAPSHOT_EXPIRED_OR_CHANGED_REQUERY_EXPLICITLY');item.verify();return {value:boundReadOutput(item.value,args),verify:item.verify};},
  close(){closed=true;entries.clear();bytes=0}
 };
}
