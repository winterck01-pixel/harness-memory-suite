


export const CURVE = {

  DECAY: 0.35,
  S_MIN: 0.01,
  S_MAX: 36500,


  S_CEIL: 2000,
}


export const LEVELS = {
  R_A_ACTIVE: 0.85,
  R_B_LATENT: 0.50,
  R_C_DORMANT: 0.15,


  DAYS_C_DORMANT: 7,
  DAYS_D_ARCHIVED: 60,


  S_D_ARCHIVED: 2.0,
}


export const WAKE = {
  THETA_CUE: 0.30,
  THETA_TRIGGER: 0.35,
  K_BOOST: 0.60,
  ETA: 1.20,
  PROMOTE_RATE: 0.50,


  PROMOTE_DECAY: 0.008,
}


export const RESONANCE = {
  W_JAC: 0.30,
  W_OVC: 0.35,
  W_COS: 0.25,
  W_ENT: 0.10,
}


export const RETRIEVE = {
  R_CUE: 0.42,
  R_ENTITY: 0.28,
  R_LEXICAL: 0.20,
  R_PRIOR: 0.10,


  R_TRUST: 0.10,
  TOP_K: 8,


  MIN_SIGNAL: 0.18,

  MIN_SCORE: 0.22,
}


export const WM = {
  BUDGET_TOKENS: 2000,
  ACT_DECAY_D: 0.5,
  BETA_CUE: 1.2,
  GAMMA_IMPORTANCE: 0.5,

  CONSOLIDATE_MIN_TOUCHES: 3,
  CONSOLIDATE_MIN_SESSIONS: 2,
  CONSOLIDATE_MIN_SPAN_DAYS: 0.5,
}


export const TOKENS = {
  INJECT_HARD_MAX: 900,
  CARD: 400,
  WM: 1200,
  RECALL: 500,
  FLEX: 900,

  CARD_HARD_MAX: 800,

  CARD_MIN_INTERVAL_MIN: 30,
}


export const ROUTER = {

  SLOW_KEYWORDS: [

    '实现', '重构', '修复', '部署', '调试', '编译', '测试', '提交', '审查', '合并',
    '迁移', '优化', '排查', '回滚', '打包', '构建', '安装', '配置', '接入', '对接',

    '帮我写', '帮我改', '帮我做', '帮我查', '帮我看看', '帮我加', '帮我删',
    '设计方案', '出个方案', '写一个', '写个', '做一个', '做个',

    '渲染', '导出', '剪辑', '字幕', '配音', '合成', '出片', '生成',
    '为什么报错', '怎么解决', '分析一下', '看看代码', '这段代码',

    'refactor', 'deploy', 'debug', 'implement', 'migrate', 'benchmark',


    'fix', 'build', 'review', 'render', 'compile',
    'optimize', 'optimise', 'optimization', 'optimizing', 'optimisation',
  ],

  SLOW_EXIT_PATIENCE: 3,

  STICKY_WITHIN_SESSION: true,

  SURPRISE_SOURCES: ['neg_affect', 'low_confidence', 'tool_error', 'user_correct'],


  KNOWN_MIN: 1,


  RECALL_INTENT: [
    '记得', '记不记得', '还记得', '回忆', '回顾', '之前', '上次', '上回', '方才', '刚才',
    '前面', '先前', '那个', '那条', '那个方案', '那个决定', '继续', '接着', '还没', '没弄完',
    '说过', '提过', '定过', '约定', '商量过', '讨论过', '是什么来着', '怎么回事',
    'remember', 'recall', 'previous', 'earlier', 'last time', 'we discussed', 'we decided',
    'what did', 'where were we', 'continue', 'pick up',
  ],


  SLOW_HOLD_TURNS: 6,
}


export const CUES = {

  MAX: 16,

  GOAL_MAX: 8,
}


export const STAGING = {

  TTL_HOURS: 24,


  REPEAT_THRESHOLD: 2,


  NOISE_DF: 0.30,
  NOISE_MIN_OFFERS: 4,

  AFFECT_THRESHOLD: 0.55,

  GOAL_RESONANCE: 0.30,

  FAST_MODE_DEFAULT_DROP: true,

  MAX_POINTERS: 500,
}


export const GATE = {

  ALPHA: 0.05,
  BETA: 0.05,


  EPS_RATIO: 0.5,

  TIERS: [
    { maxN: 60,  mode: 'propose-only', note: '前 3 周：只能提议，必须人工确认' },
    { maxN: 150, mode: 'auto-soft',    note: '允许自动晋升非核心条目' },
    { maxN: Infinity, mode: 'auto',    note: '允许自动晋升核心条目' },
  ],

  PROBE_MIN_SIZE: 20,

  FAIL_MODE: 'closed',
}


export const BACKLOG = {

  MAX_ITEMS: 200,

  STALE_HOURS: 72,

  DRAIN_PER_CALL: 12,
}


export const PROBE = {

  EXPECT_REFUSE: 'refuse',
  EXPECT_COMPLY: 'comply',

  FREEZE_AFTER_FAILS: 2,
}


export const STORE = {
  DIR: '.mnemo',
  LOG: 'events.jsonl',


  STATE: 'runtime-state.json',
  ENTITIES: 'entities.json',
  POINTERS: 'pointers.jsonl',

  READ_CHUNK_BYTES: 1 << 20,

  COMPACT_HINT_BYTES: 8 * 1024 * 1024,

  MAX_ARCHIVES: 3,
}


export const BOUNDS = {

  CAPTURE_RECEIPTS: 5000,
  CUE_VOCABULARY: 4000,
  CONFLICT_ITEMS: 20000,

  STAGING_CAPTURE_KEYS: 5000,

  CUE_KEYS_PER_SCOPE: 4000,

  CUE_PROTECTED: 4000,

  PENDING_ENTRIES: 2000,

  SCOPE_STATS: 64,
}


export const FORGET = {

  S_MAX_ARCHIVED: 2.0,

  MIN_IDLE_DAYS: 60,


  MAX_TOUCHES: 2,


  S_DECAY_PER_DAY: 0.002,

  SWEEP_EVERY_TURNS: 200,
}


export const EVAL = {
  ENABLED: true,
  MIN_SAMPLES: 60,
  AUTO_PROMOTE: false,
  GUARD_DELTA: 0.10,

  VARIANCE: 0.032,
}


export function defaultConfig() {
  return {
    curve: { ...CURVE },
    levels: { ...LEVELS },
    wake: { ...WAKE },
    resonance: { ...RESONANCE },
    retrieve: { ...RETRIEVE },
    cues: { ...CUES },
    wm: { ...WM },
    tokens: { ...TOKENS },
    router: { ...ROUTER, SLOW_KEYWORDS: [...ROUTER.SLOW_KEYWORDS] },
    staging: { ...STAGING },
    gate: { ...GATE },
    backlog: { ...BACKLOG },
    probe: { ...PROBE },
    store: { ...STORE },
    bounds: { ...BOUNDS },
    forget: { ...FORGET },
    eval: { ...EVAL },
  }
}


export function mergeConfig(base, patch) {
  if (!patch) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = { ...base[k], ...v }
    } else {
      out[k] = v
    }
  }
  return out
}
