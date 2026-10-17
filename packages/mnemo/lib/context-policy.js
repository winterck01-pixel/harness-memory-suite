import {captureClauses,wholeMemoryOptOut} from './capture-policy.js'


export function memoryOptOut(text='') {
 if (wholeMemoryOptOut(text)) return true
 return captureClauses(text).some(({instruction:s})=>{
  if (/^\s*(?:请)?(?:不(?:用|要|必)|无需|别)(?:再)?(?:联系|关联|结合|参考|引入|使用)(?:我(?:的)?|任何|具体|以往|之前|过去|私人|个人|相关|的|\s)*(?:项目|历史|经历|记忆)(?:[。！!\s]*$|[，,])/u.test(s)) return true
  if (/^\s*(?:do\s+not|don't|no\s+need\s+to)\s+(?:relate|connect|refer|link)\b[^.!?\n]{0,35}\b(?:personal|private|specific|past)\s+(?:projects?|history|memories)\b/i.test(s)) return true
  if (/^\s*(?:请)?(?:解释|翻译|分析|讨论|举例|说明|示例|如何|explain|translate|discuss|example)/i.test(s)) return false
  return /(?:不(?:要|再)?|别|禁止|无需)[\s\S]{0,8}(?:读取|读|使用|(?<!禁|停)用|参考|调用|检索|注入|加载)[\s\S]{0,12}(?:记忆|历史记录|mnemo(?:_recall)?)/i.test(s)
   || /\b(?:do\s+not|don't|never)\s+(?:read|use|consult|retrieve|inject|call|load)\b[^.!?\n]{0,40}\b(?:memory|memories|mnemo(?:_recall)?)\b/i.test(s)
 })
}
export function silentMemory(reason='not-needed') {return {mode:'off',reason,text:'',payload:'',tokens:0,blocks:[],sections:[],hits:[],spontaneous:[],cues:[],entities:[],routing:{mode:'fast',triggers:[],reason},shouldEmit:false,changed:false,latencyMs:0}}
