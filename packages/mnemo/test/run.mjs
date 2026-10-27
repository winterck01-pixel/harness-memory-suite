import {existsSync,readdirSync,readFileSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'

const root=fileURLToPath(new URL('../',import.meta.url)),argv=process.argv.slice(2),options=JSON.parse(process.env.MNEMO_TEST_SANDBOX_OPTIONS??'{}'),files=[]
for(let i=0;i<argv.length;i++){
 const flag=argv[i]
 if(flag==='--'){files.push(...argv.slice(i+1));break}
 if(!['--host-root','--context-policy','--skill-lifecycle'].includes(flag))throw Error('Use --host-root <SDK root>, --context-policy <index.js>, --skill-lifecycle <directory>, then -- <test files>')
 const value=argv[++i];if(!value||value.startsWith('--'))throw Error('Missing test fixture option value')
 if(flag==='--host-root')options.hostDependencyAnchor=join(resolve(value),'package.json')
 if(flag==='--context-policy')options.contextPolicyPath=resolve(value)
 if(flag==='--skill-lifecycle')options.contextPolicyDependencyRoots=[resolve(value)]
}
options.hostDependencyAnchor??=join(root,'package.json')
options.contextPolicyPath??=join(dirname(root),'context-policy','index.js')
options.contextPolicyDependencyRoots??=[join(dirname(dirname(options.contextPolicyPath)),'dsh-skill-lifecycle')]
for(const file of [options.hostDependencyAnchor,options.contextPolicyPath,...options.contextPolicyDependencyRoots])if(!existsSync(file))throw Error('Missing host or companion fixture; provide --host-root, --context-policy and --skill-lifecycle (see test/README.md)')
const require=createRequire(options.hostDependencyAnchor)
const versions={}
for(const name of ['cordis','dsh-scope','dsh-tools','dsh-system-prompt','dsh-ptc-runtime','dsh-fs-local','dsh-ptc-runtime-node','dsh-subprocess-local','dsh-sandbox-local']){
 const qualified='@deepseek-ai/'+name
 let entry;try{entry=require.resolve(qualified)}catch{throw Error('Incomplete host SDK: '+qualified+'; install the pinned test dependencies or choose a complete --host-root')}
 let directory=dirname(entry)
 for(;;){
  const metadata=join(directory,'package.json')
  if(existsSync(metadata)){const pkg=JSON.parse(readFileSync(metadata,'utf8'));if(pkg.name===qualified){versions[name]=pkg.version;break}}
  const parent=dirname(directory);if(parent===directory)throw Error('Cannot identify host SDK package version: '+qualified);directory=parent
 }
}
console.log('# Host SDK versions: '+JSON.stringify(versions))
const selected=files.length?files:readdirSync(join(root,'test')).filter(f=>f.endsWith('.test.js')).sort().map(f=>'test/'+f)
const child=spawn(process.execPath,['--import',fileURLToPath(new URL('./helpers/register-host.mjs',import.meta.url)),'--test',...selected],{cwd:root,stdio:'inherit',env:{...process.env,MNEMO_TEST_SANDBOX_OPTIONS:JSON.stringify(options)}})
child.once('error',error=>{console.error(error.message);process.exitCode=1})
child.once('exit',(code,signal)=>{process.exitCode=signal?1:code??1})
