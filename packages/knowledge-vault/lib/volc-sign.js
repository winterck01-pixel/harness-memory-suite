import {createHash,createHmac} from 'node:crypto'
const hash=s=>createHash('sha256').update(s).digest('hex')
const hmac=(key,s)=>createHmac('sha256',key).update(s).digest()

export function signViking(options,date=new Date()){return signVolc({...options,service:"air"},date)}
export function signVolc({endpoint,path,body,accessKey,secretKey,region,service,query="",contentType="application/json"},date=new Date()){
 const stamp=date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),day=stamp.slice(0,8),host=new URL(endpoint).host
 const headers={'content-type':contentType,host,'x-content-sha256':hash(body),'x-date':stamp}
 const names=Object.keys(headers).sort(),signed=names.join(';'),canonical=['POST',path,query,names.map(k=>k+':'+headers[k]+'\n').join(''),signed,hash(body)].join('\n')
 const scope=day+'/'+region+'/'+service+'/request',string=['HMAC-SHA256',stamp,scope,hash(canonical)].join('\n'),key=hmac(hmac(hmac(hmac(secretKey,day),region),service),'request')
 return {...headers,authorization:'HMAC-SHA256 Credential='+accessKey+'/'+scope+', SignedHeaders='+signed+', Signature='+hmac(key,string).toString('hex')}
}
