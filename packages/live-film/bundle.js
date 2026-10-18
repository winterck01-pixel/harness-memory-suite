import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {run} from './media.js';
import {FilmError} from './store.js';
// ZIP_STORED preserves original video bytes and avoids recompressing MP4s.
export async function bundleClips(project,assets,dir){
 await mkdir(dir,{recursive:true});const manifest=join(dir,'bundle-input.json'),output=join(dir,'clips.zip');
 const width=Math.max(2,String(project.shots.length).length);
 const files=project.shots.map((s,i)=>{const c=s.candidates.find(c=>c.id===s.selected),a=assets.find(a=>a.id===c?.assetId&&a.type==='video/mp4');if(!a)throw new FilmError('请为每个片段采用有效视频');return {path:a.path,name:String(i+1).padStart(width,'0')+'.mp4'}});
 await writeFile(manifest,JSON.stringify(files),{mode:0o600});
 try{await run('python3',['-c',`import json,sys,zipfile
with open(sys.argv[1]) as f: rows=json.load(f)
with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as z:
 for row in rows: z.write(row['path'],row['name'])
`,manifest,output],{timeout:300000});return output}catch(e){await unlink(output).catch(()=>{});throw e}finally{await unlink(manifest).catch(()=>{})}
}
