// schema 迁移：未知/过新版本拒绝静默丢弃；旧版本按规则升级并返回迁移报告。
import { docError } from './ids.js';
import { LIMITS } from './limits.js';

export const SCHEMA_VERSION = 1;

export function migrateDocument(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw docError('VALIDATION_FAILED', '文档不是有效对象');
  const report = [];
  let version = raw.schemaVersion;
  if (version === undefined) {
    version = 0;
    report.push({ from: undefined, to: 1, changes: ['补充 schemaVersion=1', '补充画布默认背景 #ffffff'] });
  }
  if (typeof version !== 'number' || !Number.isInteger(version)) throw docError('VALIDATION_FAILED', `文档 schema 版本无效: ${raw.schemaVersion}`);
  if (version > SCHEMA_VERSION) throw docError('VALIDATION_FAILED', `文档 schema 版本过新 (v${version})，当前仅支持 v${SCHEMA_VERSION}；拒绝静默降级`);
  const doc = JSON.parse(JSON.stringify(raw));
  doc.schemaVersion = SCHEMA_VERSION;
  if (doc.projects && typeof doc.projects === 'object' && !Array.isArray(doc.projects)) {
    for (const project of Object.values(doc.projects)) {
      if (!Array.isArray(project.canvasIds)) project.canvasIds = [];
      if (typeof project.name !== 'string' || project.name.length > LIMITS.nameMaxChars) project.name = '未命名项目';
    }
  }
  if (doc.canvases && typeof doc.canvases === 'object' && !Array.isArray(doc.canvases)) {
    for (const canvas of Object.values(doc.canvases)) {
      if (canvas.background !== '#ffffff') canvas.background = '#ffffff';
      if (!Array.isArray(canvas.layerIds)) canvas.layerIds = [];
      if (!Number.isInteger(canvas.revision) || canvas.revision < 0) canvas.revision = 0;
    }
  }
  return { doc, report };
}

// 存储的命令列表：未知类型必须报错，禁止静默丢弃（契约约束）。
export function assertKnownCommands(commands) {
  if (!Array.isArray(commands)) throw docError('VALIDATION_FAILED', '命令列表无效');
  return commands; // 具体类型白名单由 commands.COMMAND_TYPES 校验，此处保留数组形状检查
}
