// Only mask 识别 as a verb at a clause start or after an explicit request prefix.
// Keep length and later 别 directives intact; noun+别 (知识别/这个别) stays conservative.
const consentText = text => text.replace(/(^|[。！？!?；;，,\n])(\s*(?:(?:本轮|这轮|本次|这次|当前)\s*)?(?:(?:请先|请帮我|请|帮我|先)\s*)?)识别/g,'$1$2识认')

const DISCUSSION = /^\s*(?:请)?(?:解释|翻译|分析|讨论|举例|说明|示例|如何|explain|translate|discuss|example)/i
const OPT_OUT = /(?:不要|不许|禁止|别|无需|不需要).{0,12}(?:写入|保存|记录|记入|存入|更新).{0,12}(?:记忆|长期记忆)|(?:不要|别|禁止)(?:记住|记忆)|(?:本轮|这轮|这次).{0,8}(?:不记忆|不记住|不保存记忆|停记)|(?:do not|don't|never)\s+(?:\w+\s+){0,4}(?:remember|memorize)|(?:do not|don't|never).{0,30}(?:save|store|write|update|add).{0,30}memory/i
const TURN_REFUSAL = /(?:本轮|这轮|整轮|本次|这次|此次).{0,8}(?:不要|不许|禁止|别|无需|不需要|不)(?:写入|写|保存|记录|记入|存入|更新|记住|记忆)/i
const WHOLE_TURN = /本轮|这轮|整轮|本次|这次|此次|全部|所有|this\s+(?:turn|conversation|session)|(?:don't|do not)\s+remember\s+this\b/i

const WHOLE_MEMORY_DISABLE = /(?:本次|这次|本轮|这轮|整轮|此次|当前|本回合).{0,8}(?:关闭|禁用|停用).{0,8}(?:记忆|mnemo)|\b(?:disable|turn\s+off)\s+(?:the\s+)?(?:memory|mnemo)\b/i

function wholeMemoryDisable(text) {
 const match=WHOLE_MEMORY_DISABLE.exec(text)
 if (!match) return false
 const action=/(?:关闭|禁用|停用)|\b(?:disable|turn\s+off)\b/i.exec(match[0])
 const before=text.slice(0,match.index+action.index)
 return !/(?:不要|无需|不需要|不许|禁止|别|不)(?:再|去|来|将|把|给|\s){0,4}$|\b(?:do\s+not|don't|never)(?:\s+\w+){0,3}\s*$/i.test(before)
}
const SAVE = /^\s*(?:请)?(?:记住|记得|保存到(?:长期)?记忆|记录到(?:长期)?记忆)|^\s*(?:please\s+)?(?:remember|memorize|save\s+(?:this\s+)?to\s+memory)\b/i


export function directInstructionText(text) {
  const source=String(text ?? '')
  return source.replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/g,(quote,offset)=>{
    if (quote.startsWith('`')) return ' '.repeat(quote.length)
    const before=source.slice(0,offset).split(/[。！？!?；;，,\n]/).at(-1).trim()
    const after=source.slice(offset+quote.length).trim()
    const standalone=!source.slice(0,offset).trim() && /^[。.!！\s]*$/.test(after)
    const adopted=/(?:遵守|执行|照做|按照|按|本轮请|这轮请|本轮要求|这轮要求|follow|obey)\s*[:：]?\s*$/i.test(before)
    return standalone || (adopted && !DISCUSSION.test(before)) ? ' '+quote.slice(1,-1)+' ' : ' '.repeat(quote.length)
  })
}

const normalizeDirective = text => text.replace(/不要忘记|别忘记|do not forget|don't forget/gi,'请记得')


export function captureClauses(text) {
 const source=String(text ?? '')
 const direct=directInstructionText(source)
 let offset=0
 return source.split(/(?<=[。!！?？；;，,\n])|(?<=\.)(?=\s|$)/).map(raw=>{
  const instruction=normalizeDirective(direct.slice(offset,offset+raw.length)).normalize('NFKC').trim()
  offset+=raw.length
  const consent=consentText(instruction)
  const excluded=!DISCUSSION.test(instruction) && (OPT_OUT.test(consent) || TURN_REFUSAL.test(consent) || wholeMemoryDisable(instruction))
  return {raw,instruction,excluded,save:!excluded && SAVE.test(instruction)}
 })
}


export function wholeMemoryOptOut(text) {
 return captureClauses(text).some(c=>c.excluded && wholeMemoryDisable(c.instruction))
}


export function wholeTurnOptOut(text) {
 return captureClauses(String(text ?? '')).some(c=>c.excluded && (WHOLE_TURN.test(c.instruction) || wholeMemoryDisable(c.instruction)))
}


export function selectCaptureText(text) {
 const source=String(text ?? '')
 const clauses=captureClauses(source)
 const hasOptOut=clauses.some(c=>c.excluded)
 if (!hasOptOut) return {text:source,dropped:false,hasOptOut:false,wholeTurn:false}
 const wholeTurn=wholeTurnOptOut(source)
 return {text:wholeTurn ? '' : clauses.filter(c=>c.save).map(c=>c.raw).join(''),dropped:true,hasOptOut:true,wholeTurn}
}


export function detectUserCorrection(text) {
  return directInstructionText(text).split(/[。！？!?；;，,\n]/).some(raw=>{
    const clause=raw.trim()
    if (!clause || DISCUSSION.test(clause)) return false
    return /(?:你|您)(?:刚才|之前|上次|又)?(?:说错|理解错|弄错|搞错|记错|误解)|^(?:不对|错了|纠正一下|更正一下|更正[:：]|纠正[:：])(?:[\s。！!，,:：]|$)|(?:这个|刚才的|之前的)(?:答案|回答|结论|记忆)(?:是)?(?:不对|错了|有误)|\byou\s+(?:(?:got|understood|remembered)\s+(?:it|that|this)\s+wrong|are\s+wrong)\b|^(?:correction\s*:|that(?:'s| is)\s+(?:wrong|incorrect)|i\s+meant\b|not\s+what\s+i\s+asked\b)/i.test(clause)
  })
}


export function filterAgentCaptureText(text) {
  const source=String(text ?? '')
  const kept=source.split(/(?<=[。!?！？；;\n])|(?<=\.)(?=\s+[A-Z])/).filter(raw=>{
    const clause=raw.trim().replace(/[。.!！?？；;]+$/,'').trim()
    if (!clause) return false
    if (/^(?:好的|好|收到|明白|了解|记住了|没问题|谢谢|已完成|完成了|搞定了|已处理|ok|okay|sure|got it|understood|done|thanks)(?:[，,\s]*(?:好的|收到|明白|了解|记住了|谢谢))*$/i.test(clause)) return false
    const content=clause.replace(/^(?:(?:好的|好|收到|明白|了解|没问题|ok|okay|sure|got it|understood)[，,:：\s]+)+/i,'')
    const process=/^(?:我(?:会|将|先|接下来|正在|马上|稍后)|接下来(?:我|会|将)|稍后|待会|正在(?:检查|执行|处理)|i(?:'ll| will| am going to| am checking| am working)|let me|next[, :])/i.test(content)
    const finding=/(?:发现|确认(?:了|结果|配置)|实际(?:限制|结果|配置)|结果(?:是|为|[:：])|原因(?:是|为|[:：])|失败原因|报错[:：]|found\b|verified\b|result\s*[:=]|because\b)/i.test(content)
    const completion=/^(?:我(?:已|已经)(?:完成|修复|部署|处理)|(?:已经|已)(?:完成|修复|部署)|i\s+(?:have\s+|already\s+)?(?:completed|finished|fixed|deployed)\b)/i.test(content)
    const concrete=/\d|(?:\/|[A-Za-z]:\\)\S+|\b\w+\.(?:js|json|py|md|ts|yaml|toml)\b/.test(content)
    if (completion && !finding && !concrete) return false
    return !process || finding
  })
  return kept.join('').trim()
}
