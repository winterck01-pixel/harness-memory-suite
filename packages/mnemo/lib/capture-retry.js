
export class CaptureRetryQueue {
 constructor({delays=[500,1000,2000,5000,10000],log=()=>{},onError=()=>{}}={}) {
  if(!Array.isArray(delays)||delays.some(x=>!Number.isInteger(x)||x<0))throw Error('Invalid capture retry delays')
  this.delays=delays;this.log=log;this.onError=onError;this.jobs=new Map();this.closed=false
 }
 run(key,scope,run) {
  if(this.closed)return
  if(this.jobs.has(key))return
  const job={key,scope,run,attempts:0,timer:null,error:null,failed:false};this.jobs.set(key,job)
  this.attempt(job)
 }
 attempt(job) {
  if(this.closed)return
  job.timer=null
  try {job.run();this.jobs.delete(job.key)}
  catch(error){
   this.onError(error);job.error=String(error?.message??error);this.log('[mnemo] 捕获待重试: '+job.error)
   const delay=this.delays[job.attempts++]
   if(delay===undefined){job.failed=true;return}
   job.timer=setTimeout(()=>this.attempt(job),delay);job.timer.unref?.()
  }
 }
 retryFailed(scope) {
  for(const job of [...this.jobs.values()])if(job.failed && job.scope===scope){job.failed=false;job.attempts=0;this.attempt(job)}
  return this.report()
 }
 report(){return {pending:[...this.jobs.values()].filter(j=>!j.failed).length,failed:[...this.jobs.values()].filter(j=>j.failed).map(j=>({key:j.key,scope:j.scope,attempts:j.attempts,error:j.error}))}}
 close(){this.closed=true;for(const j of this.jobs.values())clearTimeout(j.timer);this.jobs.clear()}
}
