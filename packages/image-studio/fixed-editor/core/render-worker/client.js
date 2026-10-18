// 独立子进程客户端；每进程一次只接一个任务，外围使用受限队列。
import { spawn } from 'node:child_process';
import { unlink,rm } from 'node:fs/promises';
import { docError } from '../document-core/ids.js';
import {workerLaunch,assertWorkerOutput} from './os-isolation.js';
export function createRenderWorkerClient({ scriptPath, spawnImpl = spawn, timeoutMs = 120000, nodePath = process.execPath, env = process.env }) {
  let child = null, seq = 0, pending = null;
  const fail = (c, message) => {
    if (child === c) child = null;
    if (pending?.child === c) { const p = pending; pending = null; clearTimeout(p.timer);
      if (p.outputPath && Number.isInteger(c.pid)) void unlink(`${p.outputPath}.${c.pid}.tmp`).catch(() => {});
      p.reject(docError('MEDIA_OPERATION_FAILED', message)); }
  };
  const ensureChild = () => {
    if (child) return child;
    const launch=workerLaunch({nodePath,scriptPath,env});
    const c = spawnImpl(launch.command, launch.args, { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env:launch.env });
    c._requiresIsolation=launch.hard;
    child = c;
    c.on('message', msg => {
      if(msg.type==='worker-isolation-error'){fail(c,msg.error);try{c.kill('SIGKILL');}catch{}return;}
      if(msg.type==='worker-isolation-ready'){c._isolation=msg.isolation;if(pending?.child===c)pending.send();return;}
      if (pending?.child !== c || pending.jobId !== msg.jobId) return;
      const p = pending; pending = null; clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg); else p.reject(docError('MEDIA_OPERATION_FAILED', msg.error || '渲染 worker 失败'));
    });
    const cleanup=()=>{if(launch.scratch)void rm(launch.scratch,{recursive:true,force:true}).catch(()=>{});};
    c.on('exit', (code,signal) => {fail(c, signal?`渲染已被系统终止（${signal}），请降低画布尺寸或减少图层后重试`:`渲染 worker 退出（code=${code}），任务失败`);cleanup();});
    c.on('error', err => {fail(c, `渲染 worker 启动失败: ${err.message}`);cleanup();});
    return c;
  };
  return {
    get alive() { return !!child; },
    get inflightCount() { return pending ? 1 : 0; },
    get _child() { return child; },
    get isolation() { return child?._isolation||null; },
    async submit(job) {
      if (pending) throw docError('RESOURCE_EXCEEDED', '渲染 worker 忙碌，请经受限队列提交');
      const duration = job.timeoutMs ?? timeoutMs;
      if (!Number.isFinite(duration) || duration <= 0) throw docError('VALIDATION_FAILED', '渲染超时配置无效');
      assertWorkerOutput(job.outputPath,env);
      const c = ensureChild(), jobId = `rw-${++seq}-${Date.now()}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { fail(c, `渲染任务超时（${duration}ms），worker 已终止`); try { c.kill('SIGKILL'); } catch {} }, duration);
        let sent=false;
        const send=()=>{if(sent||pending?.child!==c)return;sent=true;try { c.send({ ...job, jobId }, err => { if (err) { fail(c, `渲染 IPC 失败: ${err.message}`); try { c.kill('SIGKILL'); } catch {} } }); }
        catch (err) { fail(c, `渲染 IPC 失败: ${err.message}`); try { c.kill('SIGKILL'); } catch {} }};
        pending = { child: c, jobId, resolve, reject, timer, outputPath: job.outputPath,send };
        if(!c._requiresIsolation||c._isolation)send();
      });
    },
    async close() {
      const c = child;
      if (!c) return;
      fail(c, '渲染 worker 已关闭');
      try { c.disconnect(); } catch {}
      try { c.kill('SIGKILL'); } catch {}
    },
  };
}
