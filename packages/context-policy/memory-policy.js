// Only mask 识别 as a verb at a clause start or after an explicit request prefix.
// Keep length and later 别 directives intact; noun+别 (知识别/这个别) stays conservative.
const consentText = text => text.replace(/(^|[。！？!?；;，,\n])(\s*(?:(?:本轮|这轮|本次|这次|当前)\s*)?(?:(?:请先|请帮我|请|帮我|先)\s*)?)识别/g,'$1$2识认')

/** Current human input only; never apply this detector to stored memory/tool output. */
export function memoryOptOut(text='') {
 const s=consentText(String(text).normalize('NFKC'))
 return /(?:不(?:要|再)?|别|禁止|无需)[\s\S]{0,8}(?:读取|读|使用|用|参考|调用|检索|注入|加载)[\s\S]{0,12}(?:记忆|历史记录|mnemo(?:_recall)?)/i.test(s)
  || /(?:本次|这次|本轮|这轮|当前|本回合)[\s\S]{0,8}(?:关闭|禁用|停用)[\s\S]{0,8}(?:记忆|mnemo)/i.test(s)
  || /\b(?:do\s+not|don't|never)\s+(?:read|use|consult|retrieve|inject|call|load)\b[^.!?\n]{0,40}\b(?:memory|memories|mnemo(?:_recall)?)\b/i.test(s)
  || /\b(?:disable|turn\s+off)\s+(?:the\s+)?(?:memory|mnemo)\b/i.test(s)
}
