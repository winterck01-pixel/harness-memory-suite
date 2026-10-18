// 有界历史（契约 commandSchema.historyLimits：maxUndoCount=100, maxUndoBytes=64MiB）。
// 一次用户操作（可能含多条语义命令，如多图层拖动）= 一条历史entry = 一次撤销。
// 只存语义命令信封（forward/inverse），不存 ImageData；条数与总字节同时有界，超出淘汰最旧。

const MAX_UNDO_COUNT = 100;
const MAX_UNDO_BYTES = 67108864;
const COALESCE_WINDOW = 800;

function estimateBytes(entry) {
  try {
    return JSON.stringify({ forwards: entry.forwards, inverses: entry.inverses }).length * 2; // UTF-16 粗估上界
  } catch {
    return 1024;
  }
}

export class History {
  constructor({ maxCount = MAX_UNDO_COUNT, maxBytes = MAX_UNDO_BYTES } = {}) {
    this.maxCount = maxCount;
    this.maxBytes = maxBytes;
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * 记录一次可撤销操作。
   * @param forwards 用户命令（可多条）
   * @param inverses 对应反向命令（可多条）
   * @param coalesce {key, within} 连续同 key 操作合并为一条历史（如透明度滑块）
   */
  record(forwards, inverses, coalesce = null) {
    const entry = { forwards: [...forwards], inverses: [...inverses], bytes: 0, coalesceKey: null, at: Date.now() };
    entry.bytes = estimateBytes(entry);
    if (coalesce) {
      const last = this.undoStack[this.undoStack.length - 1];
      if (last && last.coalesceKey === coalesce.key && entry.at - last.at <= (coalesce.within || COALESCE_WINDOW)) {
        // 合并：forwards 更新为最新（redo 重放最终态），inverses 保留最旧（undo 回到合并前）
        last.forwards = [...forwards];
        last.at = entry.at;
        this.redoStack = [];
        return;
      }
      entry.coalesceKey = coalesce.key;
    }
    this.undoStack.push(entry);
    this.bytes += entry.bytes;
    this.redoStack = []; // 新操作使重做栈失效
    this.evict();
  }

  evict() {
    while (this.undoStack.length > this.maxCount || (this.bytes > this.maxBytes && this.undoStack.length > 1)) {
      const dropped = this.undoStack.shift();
      this.bytes -= dropped.bytes;
    }
  }

  popUndo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.bytes -= entry.bytes;
    return entry;
  }

  pushRedo(entry) {
    this.redoStack.push(entry);
    this.bytes += entry.bytes;
  }

  popRedo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.bytes -= entry.bytes;
    return entry;
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }

  stats() {
    return { undoCount: this.undoStack.length, redoCount: this.redoStack.length, bytes: this.bytes };
  }
}
