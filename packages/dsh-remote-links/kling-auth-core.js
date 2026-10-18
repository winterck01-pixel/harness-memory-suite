import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
export const CALLBACK_PORT=25827;
export const REDIRECT='http://localhost:'+CALLBACK_PORT+'/oauth/callback';
export function authorizationUrl(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.hostname!=='klingai.com'||u.port||u.username||u.password||u.hash||u.pathname!=='/auth/authorize'||u.searchParams.get('redirect_uri')!==REDIRECT||u.searchParams.get('response_type')!=='code'||u.searchParams.get('code_challenge_method')!=='S256'||!u.searchParams.get('code_challenge')||!u.searchParams.get('state'))throw Error('INVALID_AUTH_URL');
 for(const key of ['state','redirect_uri','response_type','code_challenge','code_challenge_method'])if(u.searchParams.getAll(key).length!==1)throw Error('INVALID_AUTH_URL');
 return u;
}
export function callbackMatches(url,state){
 if(url.pathname!=='/oauth/callback'||url.searchParams.getAll('state').length!==1)return false;
 const actual=Buffer.from(url.searchParams.get('state')||''),expected=Buffer.from(state||'');
 return expected.length>0&&actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export async function callbackServer({port=CALLBACK_PORT,now=Date.now,deadline,onCode,onDenied}){
 let expected='',used=false,closed=false;
 const server=createServer((req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('content-security-policy',"default-src 'none'; frame-ancestors 'none'");
  const finish=(status,text)=>{res.writeHead(status,{'content-type':'text/plain; charset=utf-8'});res.end(text)};
  if(req.method!=='GET'||req.url.length>16384)return finish(400,'Invalid callback');
  const url=new URL(req.url,'http://localhost');
  if(closed||used||now()>=deadline)return finish(410,'Authorization expired. Return to Harness and retry.');
  if(!callbackMatches(url,expected))return finish(400,'Invalid authorization state');
  if(url.searchParams.has('error')){used=true;finish(400,'Authorization was declined. Return to Harness.');onDenied?.();return}
  const codes=url.searchParams.getAll('code');if(codes.length!==1||!codes[0]||codes[0].length>8192)return finish(400,'Invalid authorization code');
  used=true;finish(200,'Authorization received. Return to Harness to check connection status.');onCode(codes[0]);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 return {setUrl(value){expected=authorizationUrl(value).searchParams.get('state')},async close(){closed=true;server.closeAllConnections?.();await new Promise(r=>server.close(r))}};
}
