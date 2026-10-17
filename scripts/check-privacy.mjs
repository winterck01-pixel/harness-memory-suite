import {readdirSync,readFileSync} from 'node:fs'
import {join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),findings=[]
const skipped=new Set(['.git','node_modules','.cache','.local'])
const rules=[
 ['private-home-path',/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//g],
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
 ['credential-token',/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|ark-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/g],
 ['collaboration-model',/\b(?:gpt[-_. ]*\d[^\s'"`]*|glm[-_. ]*\d[^\s'"`]*|claude[-_. ]*\d[^\s'"`]*|(?:doubao[- ])?seed[-_. ]*\d[^\s'"`]*|a[s]tra)\b/gi],
 ['personal-email',/\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|invalid)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
]
function visit(dir){for(const e of readdirSync(dir,{withFileTypes:true})){if(skipped.has(e.name))continue;const p=join(dir,e.name),r=relative(root,p);if(e.isSymbolicLink()){findings.push({file:r,rule:'source-symlink'});continue}if(e.isDirectory()){visit(p);continue}if(/(?:\.private\.|\.bak|\.jsonl$|^\.env$|\.pem$|\.key$)/.test(e.name)){findings.push({file:r,rule:'private-artifact'});continue}if(r.includes('/vendor/'))continue;const b=readFileSync(p);if(b.includes(0))continue;const text=b.toString('utf8');for(const [rule,pattern]of rules){pattern.lastIndex=0;for(const m of text.matchAll(pattern))findings.push({file:r,line:text.slice(0,m.index).split('\n').length,rule})}}}
visit(root)
if(findings.length){console.error(JSON.stringify({passed:false,findings},null,2));process.exit(1)}
console.log('Privacy pattern checks passed (source only; not a guarantee against unknown sensitive data).')
