import {FormData as TransportFormData} from 'undici';
export function transportOptions(options={}){
 const body=options.body;
 if(!body||body instanceof TransportFormData||typeof body.entries!=='function'||Object.prototype.toString.call(body)!=='[object FormData]')return options;
 const converted=new TransportFormData();
 for(const [name,value] of body.entries())if(typeof value==='string')converted.append(name,value);else converted.append(name,value,value.name||'reference');
 const headers={...options.headers};for(const key of Object.keys(headers))if(key.toLowerCase()==='content-type')delete headers[key];
 return {...options,headers,body:converted};
}
