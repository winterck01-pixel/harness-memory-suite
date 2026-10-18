// 原子 JSON 存储：tmp 写入 + rename 原子替换；保存中断原文件仍可打开。
import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { join, dirname, basename, resolve, relative, isAbsolute } from 'node:path';

export function createJsonStorage({ root }) {
  const base = resolve(root);
  const file = name => {
    if (typeof name !== 'string') throw new Error('存储路径无效');
    const target = resolve(base, name), rel = relative(base, target);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('存储路径越界');
    return target;
  };
  const tmpFor = name => join(dirname(file(name)), `.${basename(name)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  const ensureParent = async name => { await mkdir(dirname(file(name)), { recursive: true }); };
  return {
    root,
    async init() { await mkdir(root, { recursive: true, mode: 0o700 }); },
    async listNames(subdir = '') {
      try { return await readdir(file(subdir)); }
      catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    },
    async read(name, fallback = null) {
      try { return JSON.parse(await readFile(file(name), 'utf8')); }
      catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
    },
    async write(name, value) {
      await ensureParent(name);
      const tmp = tmpFor(name);
      await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
      await rename(tmp, file(name));
    },
    async readRaw(name) { try { return await readFile(file(name)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    async writeRaw(name, bytes) {
      await ensureParent(name);
      const tmp = tmpFor(name);
      await writeFile(tmp, bytes, { mode: 0o600 });
      await rename(tmp, file(name));
    },
    async remove(name) { try { await unlink(file(name)); } catch (e) { if (e.code !== 'ENOENT') throw e; } },
    file,
  };
}
