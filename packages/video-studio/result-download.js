import {lookup} from 'node:dns/promises';
import {isIP,BlockList} from 'node:net';
import {Agent,Client,ProxyAgent,fetch as transportFetch} from 'undici';
const blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,bits,'ipv4');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');
const blocked6=new BlockList();for(const [ip,bits]of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])blocked6.addSubnet(ip,bits,'ipv6');
export function isPublicAddress(address){const family=isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!blocked6.check(address,'ipv6')}
function refused(){const error=Error('结果下载地址不允许访问本机、内网或特殊网络');error.httpStatus=422;return error}
export async function resolveResultTarget(raw,{resolve=lookup,signal}={}){
 const url=new URL(raw);const hostname=url.hostname.replace(/^\[|\]$/g,'');
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||!hostname||hostname.toLowerCase()==='localhost'||hostname.toLowerCase().endsWith('.localhost'))throw refused();
 signal?.throwIfAborted();const rows=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await new Promise((ok,no)=>{const abort=()=>no(signal.reason);signal?.addEventListener('abort',abort,{once:true});Promise.resolve().then(()=>resolve(hostname,{all:true,verbatim:true})).then(ok,no).finally(()=>signal?.removeEventListener('abort',abort))});
 signal?.throwIfAborted();if(!rows.length||rows.some(r=>!isPublicAddress(r.address)))throw refused();
 return {url,hostname,address:rows[0].address,family:isIP(rows[0].address)};
}
export function pinnedTunnelOptions(options,target){const authority=(target.family===6?'['+target.address+']':target.address)+':'+(target.url.port||(target.url.protocol==='https:'?'443':'80'));return {...options,path:authority,headers:{...options.headers,host:authority}}}
export function createResultDownloader({proxy,resolve=lookup,fetchImpl=transportFetch,method='GET'}={}){
 return async function download(raw,options={}){
  const signal=options.signal||AbortSignal.timeout(60000);const target=await resolveResultTarget(raw,{resolve,signal});let dispatcher;
  if(proxy){const p=new URL(proxy);if(!['http:','https:'].includes(p.protocol))throw Error('结果下载仅支持 HTTP(S) 代理');
   // CONNECT must carry the validated IP; requestTls.lookup alone cannot pin a proxy target.
   dispatcher=new ProxyAgent({uri:proxy,proxyTunnel:true,requestTls:{servername:isIP(target.hostname)?undefined:target.hostname},clientFactory:(url,opts)=>{const client=new Client(url,opts);const connect=client.connect.bind(client);client.connect=(params,...rest)=>connect(pinnedTunnelOptions(params,target),...rest);return client}});
  }else{dispatcher=new Agent({connect:{lookup:(_host,opts,callback)=>opts.all?callback(null,[{address:target.address,family:target.family}]):callback(null,target.address,target.family)}})}
  let ended=false;const close=()=>{if(!ended){ended=true;void dispatcher.destroy().catch(()=>{})}};
  try{
   const response=await fetchImpl(target.url,{method,signal,redirect:'error',dispatcher,...(['POST','PUT'].includes(method)?{body:options.body,headers:options.headers}: {})});
   if(response.status>=300&&response.status<400){await response.body?.cancel();throw refused()}
   if(!response.body){close();return response}
   const reader=response.body.getReader();const abort=()=>{void reader.cancel().catch(()=>{});close()};signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();signal.throwIfAborted()}
   const done=()=>{signal.removeEventListener('abort',abort);close()};
   const body=new ReadableStream({async pull(controller){try{signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();if(chunk.done){done();controller.close()}else controller.enqueue(chunk.value)}catch(error){done();controller.error(error)}},async cancel(reason){try{await reader.cancel(reason)}finally{done()}}},{highWaterMark:0});
   return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){close();throw error}
 };
}
export const downloadResult=createResultDownloader();
