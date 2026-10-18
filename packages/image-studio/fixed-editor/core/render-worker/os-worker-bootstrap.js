import {pathToFileURL} from 'node:url';
import {enterWorkerCgroup} from './os-isolation.js';
try{
 const isolation=enterWorkerCgroup();
 if(!process.argv[2])throw Error('worker entry missing');
 const entry=process.argv[2];process.argv=[process.argv[0],entry,...process.argv.slice(3)];
 await import(pathToFileURL(entry).href);
 process.send?.({type:'worker-isolation-ready',isolation});
}catch(error){
 process.send?.({type:'worker-isolation-error',error:'OS隔离初始化失败: '+error.message},()=>process.exit(78));
 if(!process.send)process.exit(78);
}
