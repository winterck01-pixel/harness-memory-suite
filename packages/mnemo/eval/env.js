const NOT_ENABLED='Error: 工具未在本轮启用，请先使用 activate_tool_group 加载所需分组；用户关闭工具时不得启用。'
/** Tiny simulated host with the same failure modes as the production tools. */
export class SimEnv{
 constructor(files,{mutateAfterRead=false}={}){this.fs={...files};this.read=new Set();this.active=false;this.mutate=mutateAfterRead;this.mutated=false}
 exec(action){
  const a=action?.args??{},tool=action?.tool
  if(tool==='read'){
   if(!(a.path in this.fs))return {ok:false,text:`Error: ENOENT: no such file or directory, open "${a.path}"`}
   this.read.add(a.path);const out=this.fs[a.path]
   // Simulate a concurrent writer that changes the file right after the first read.
   if(this.mutate&&!this.mutated){this.mutated=true;this.fs[a.path]+='concurrent-change\n';this.stale=new Set([a.path])}
   else this.stale?.delete(a.path)
   return {ok:true,text:out}
  }
  if(tool==='edit'){
   if(!this.read.has(a.path))return {ok:false,text:`Error: cannot modify "${a.path}": file has not been read — read the file, then retry`}
   if(this.stale?.has(a.path))return {ok:false,text:`Error: cannot edit "${a.path}": file changed since it was read — re-read the file, then retry`}
   const body=this.fs[a.path]??''
   if(typeof a.old!=='string'||!body.includes(a.old))return {ok:false,text:`Error: old_string was not found in "${a.path}"`}
   this.fs[a.path]=body.replace(a.old,String(a.new??''));return {ok:true,text:'edited'}
  }
  if(tool==='run_code'){
   const code=String(a.code??'')
   if(/\brequire\s*\(/.test(code))return {ok:false,text:'Error: code run failed (exception): ReferenceError: require is not defined'}
   const m=/writeFileSync\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]/.exec(code)
   if(!m)return {ok:false,text:'Error: code run failed (invalid-output): program completion must be lossless JSON'}
   this.fs[m[1]]=m[2];return {ok:true,text:'null'}
  }
  if(tool==='activate_tool_group'){this.active=true;return {ok:true,text:`activated ${a.group??''}`}}
  if(tool==='bash'){
   if(!this.active)return {ok:false,text:NOT_ENABLED}
   const m=/^write (\S+) (.*)$/s.exec(String(a.command??''))
   if(!m)return {ok:false,text:'Error: unsupported command; use: write <path> <text>'}
   this.fs[m[1]]=m[2];return {ok:true,text:'ok'}
  }
  return {ok:false,text:`Error: unknown tool "${tool}"`}
 }
}
