// Template adapter for eval/run.mjs and tools/p0-batch.mjs. Works with any OpenAI-compatible
// chat endpoint. Credentials come from the environment; nothing is read from the harness.
//   LLM_BASE_URL=https://.../v1  LLM_API_KEY=...  LLM_MODEL=...  node eval/run.mjs --adapter eval/adapter.example.mjs ...
// Returns {text, usage}: usage is what the provider reports, so cost can be compared honestly.
export async function complete(messages){
 const {LLM_BASE_URL,LLM_API_KEY,LLM_MODEL}=process.env
 if(!LLM_BASE_URL||!LLM_API_KEY||!LLM_MODEL)throw Error('Set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL')
 const res=await fetch(LLM_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+LLM_API_KEY},body:JSON.stringify({model:LLM_MODEL,messages,temperature:0})})
 if(!res.ok)throw Error('LLM request failed: '+res.status)
 const body=await res.json()
 // Keep complete provider counters; the evaluator can sum input/output when total is absent.
 // An absent or incomplete counter stays unknown rather than becoming a fabricated zero.
 return {text:body.choices?.[0]?.message?.content??'',usage:body.usage??null}
}
