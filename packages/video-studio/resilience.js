export function gate(limit=2){
 let active=0,closed=false;const waiting=[];
 function drain(){while(!closed&&active<limit&&waiting.length){const job=waiting.shift();active++;Promise.resolve().then(job.fn).then(job.resolve,job.reject).finally(()=>{active--;drain()})}}
 return {run(fn){if(closed)return Promise.reject(Error('服务正在停止'));return new Promise((resolve,reject)=>{waiting.push({fn,resolve,reject});drain()})},close(){closed=true;for(const job of waiting.splice(0))job.reject(Error('服务正在停止'))}};
}
export function delayFor(failures,base,retryAfter=0){return Math.min(300000,Math.max(retryAfter,base*2**Math.min(Math.max(failures-1,0),6)))}
export function httpError(message,response){const error=Error(message);error.httpStatus=response.status;const retry=response.headers.get('retry-after');error.retryAfter=retry?Math.max(0,Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now()):0;return error}
export function terminalHttp(error){return [400,401,403,404,405,410,413,422].includes(error.httpStatus)}
export function safeError(error){return String(error?.message||error||'操作失败').replace(/Bearer\s+\S+/gi,'Bearer [已隐藏]').replace(/\bsk[-_][A-Za-z0-9_-]+/g,'[密钥已隐藏]').replace(/https?:\/\/\S+/g,'[服务地址]').replace(/\/(?:home|Users|tmp)\/\S+/g,'[文件路径]').slice(0,700)}
export function markDownloadFailure(task,error,base,maxAttempts=5){
 task.downloadFailures=(task.downloadFailures||0)+1;task.errorCode='RESULT_DOWNLOAD_FAILED';
 task.stage=task.downloadFailures>=maxAttempts||terminalHttp(error)?'download_failed':'downloading';
 task.status=task.stage==='download_failed'?(task.results?.length?'completed':'failed'):'polling';
 task.nextPollAt=Date.now()+delayFor(task.downloadFailures,base,error.retryAfter);
 task.error='生成已完成，结果保存失败：'+safeError(error)+(task.status==='polling'?'；将仅重试下载，不重新生成。':task.results?.length?'；已保存的结果会先投递，失败下载可稍后重试，不会重新提交生成。':'；可重新下载，不会重新提交生成。');
}
