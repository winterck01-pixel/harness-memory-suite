
export function memoryOptOut(text='') {
 const s=String(text).normalize('NFKC')
 return /(?:不(?:要|再)?|别|禁止|无需)[\s\S]{0,8}(?:读取|读|使用|用|参考|调用|检索|注入|加载)[\s\S]{0,12}(?:记忆|历史记录|mnemo(?:_recall)?)/i.test(s)
  || /(?:本次|这次|本轮|这轮|当前|本回合)[\s\S]{0,8}(?:关闭|禁用|停用)[\s\S]{0,8}(?:记忆|mnemo)/i.test(s)
  || /\b(?:do\s+not|don't|never)\s+(?:read|use|consult|retrieve|inject|call|load)\b[^.!?\n]{0,40}\b(?:memory|memories|mnemo(?:_recall)?)\b/i.test(s)
  || /\b(?:disable|turn\s+off)\s+(?:the\s+)?(?:memory|mnemo)\b/i.test(s)
}
