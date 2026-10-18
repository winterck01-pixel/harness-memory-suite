// 撤销/重做：条目数 100 与总字节 64MB 双上限；撤销也是新 revision（单调递增）。
import { clone } from './commands.js';
import { LIMITS } from './limits.js';

const BAGS = ['projects', 'canvases', 'layers', 'assets'];
function entryBytes(entry) {
  try { return Buffer.byteLength(JSON.stringify(entry), 'utf8'); } catch { return 0; }
}
function restoreSide(store, entry, side) {
  const next = clone(store);
  const snap = entry[side] || {};
  const other = entry[side === 'before' ? 'after' : 'before'] || {};
  const touched = {};
  for (const bag of BAGS) {
    const ids = new Set([...(snap[bag] || []).map(e => e.id), ...(other[bag] || []).map(e => e.id)]);
    touched[bag] = ids;
    for (const id of ids) {
      const e = (snap[bag] || []).find(x => x.id === id);
      if (e) next[bag][id] = clone(e); else delete next[bag][id];
    }
  }
  const now = Date.now();
  for (const id of touched.canvases || []) {
    const e = next.canvases[id];
    if (e) { const prev = store.canvases[id]?.revision ?? -1; e.revision = Math.max(e.revision, prev) + 1; e.updatedAt = now; }
  }
  for (const id of touched.projects || []) { const e = next.projects[id]; if (e) e.updatedAt = now; }
  return next;
}

export class History {
  constructor(store, limits = {}) {
    this.limits = { maxUndoCount: limits.maxUndoCount ?? LIMITS.maxUndoCount, maxUndoBytes: limits.maxUndoBytes ?? LIMITS.maxUndoBytes };
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
    this.store = store;
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get count() { return this.undoStack.length; }
  record(entry) { // 应用命令后调用；entry 来自 applyCommand 结果
    this.undoStack.push(entry);
    this.bytes += entryBytes(entry);
    this.redoStack = [];
    this.trim();
    return entry;
  }
  trim() {
    while (this.undoStack.length > this.limits.maxUndoCount) { const dropped = this.undoStack.shift(); this.bytes -= entryBytes(dropped); }
    while (this.bytes > this.limits.maxUndoBytes && this.undoStack.length > 0) { const dropped = this.undoStack.shift(); this.bytes -= entryBytes(dropped); }
  }
  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.bytes -= entryBytes(entry);
    this.store = restoreSide(this.store, entry, 'before');
    this.redoStack.push(entry);
    return entry;
  }
  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.store = restoreSide(this.store, entry, 'after');
    this.undoStack.push(entry);
    this.bytes += entryBytes(entry);
    this.trim();
    return entry;
  }
}
