// 受限队列：起始并发 1；准入检查在分配前（超限明确拒绝）；任务状态可查询；失败有临时文件清理钩子。
import { docError } from '../document-core/ids.js';

export function createRenderQueue({ run, concurrency = 1, maxQueued = 20, maxRetainedTasks = 100, policy, now = () => Date.now(), setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout }) {
  if (!Number.isInteger(concurrency) || concurrency !== 1 || !Number.isInteger(maxQueued) || maxQueued < 1 || !Number.isInteger(maxRetainedTasks) || maxRetainedTasks < maxQueued + 1) throw docError('VALIDATION_FAILED', '渲染队列限额无效');
  const waiting = [];
  const tasks = new Map();
  let active = 0;
  let seq = 0;
  const pump = () => {
    while (active < concurrency && waiting.length) {
      const task = waiting.shift();
      active++;
      task.state = 'running';
      task.startedAt = now();
      const timer = st(() => { task.timedOut = true; task.state = 'failed'; task.error = '渲染任务超时'; task.finishedAt = now(); try { task.job.onCancel?.(); } catch {} }, task.timeoutMs);
      Promise.resolve()
        .then(() => run(task.job, task))
        .then(result => { ct(timer); if (!task.timedOut) { task.state = 'completed'; task.result = result; task.finishedAt = now(); } })
        .catch(error => { ct(timer); task.state = 'failed'; task.error = error?.message || String(error); task.finishedAt = now(); })
        .finally(() => {
          active--;
          try { task.job.onCleanup?.(task.timedOut ? 'timeout' : 'done'); } catch {}
          // 超时后仍等待实际run退出再释放并发槽，避免旧任务仍执行时启动第二个。
          task.job = null;
          pump();
        });
    }
  };
  return {
    get concurrency() { return concurrency; },
    get activeCount() { return active; },
    get queuedCount() { return waiting.length; },
    submit(job) {
      if (!job || typeof job !== 'object') throw docError('VALIDATION_FAILED', '渲染任务无效');
      if (policy && job.plan) policy.admitExport(job.plan.width, job.plan.height, job.assets || []);
      if (job.admit) job.admit(); // 分配前准入（由调用方经 resource-policy 提供）
      if (waiting.length >= maxQueued) throw docError('RESOURCE_EXCEEDED', `渲染队列已满（${maxQueued}），任务被拒绝`);
      for (const [id, old] of tasks) { if (tasks.size < maxRetainedTasks) break; if (['completed', 'failed', 'cancelled'].includes(old.state) && old.finishedAt !== undefined && old !== waiting[0]) tasks.delete(id); }
      if (tasks.size >= maxRetainedTasks) throw docError('RESOURCE_EXCEEDED', '渲染任务记录已满');
      const task = { taskId: `job-${++seq}-${now()}`, job, state: 'queued', queuedAt: now(), timeoutMs: job.timeoutMs || 120000 };
      tasks.set(task.taskId, task);
      waiting.push(task);
      pump();
      return task;
    },
    status(taskId) {
      const t = tasks.get(taskId);
      return t ? { taskId, state: t.state, error: t.error, queuedAt: t.queuedAt, startedAt: t.startedAt, finishedAt: t.finishedAt } : null;
    },
    cancel(taskId) {
      const t = tasks.get(taskId);
      if (!t || t.state !== 'queued') return false;
      const i = waiting.indexOf(t);
      if (i >= 0) waiting.splice(i, 1);
      t.state = 'cancelled'; t.finishedAt = now();
      try { t.job.onCleanup?.('cancelled'); } catch {}
      t.job = null;
      return true;
    },
    list() { return [...tasks.values()].map(t => ({ taskId: t.taskId, state: t.state, error: t.error })); },
  };
}
