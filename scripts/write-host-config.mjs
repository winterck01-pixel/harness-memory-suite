import {parseArgs} from 'node:util'
import {writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {resolve,isAbsolute,join,dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
const {values}=parseArgs({options:{'plugins-root':{type:'string'},'memory-root':{type:'string'},out:{type:'string'},router:{type:'boolean',default:false}}})
for(const key of ['plugins-root','memory-root','out'])if(!values[key]||!isAbsolute(values[key]))throw Error(`Provide an absolute operator-selected --${key}`)
const plugins=resolve(values['plugins-root']),out=resolve(values.out)
if(existsSync(out))throw Error('Output already exists; review it instead of overwriting')
const modules=[['knowledge-vault','knowledge-vault'],['reader','reader'],['file-manager','file-manager'],['skill-manager','dsh-skill-manager'],['skill-lifecycle','dsh-skill-lifecycle'],['memory','mnemo'],['context-policy','context-policy']]
if(values.router)modules.push(['session-router','session-router'])
const rows=modules.map(([id,folder])=>{const file=join(plugins,folder,'index.js');if(!existsSync(file))throw Error('Plugin entry missing: '+folder);return {id,name:pathToFileURL(file).href,...(folder==='mnemo'?{config:{dir:resolve(values['memory-root'])}}:{})}})
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(rows,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Wrote an operator-local host config; review composition and template scope before loading.')
