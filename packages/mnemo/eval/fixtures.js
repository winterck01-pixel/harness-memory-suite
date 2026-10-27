// Deterministic fixture tasks (mechanism tests: they verify the wiring and the measurement, not
// real-model learning). Within a mechanism the train/test split separates *scenarios* (files, wording)
// only, so a gain on test tasks is same-mechanism reuse, not generalisation to new failure types.
// Deterministic fixture tasks. Each task exercises a real failure mechanism seen in
// production sessions (see P0 seed lessons). Families split train/test by scenario so
// a lesson learned on one scenario is evaluated on another.
const editTask=(id,split,file,from,to,desc)=>({id,family:'edit-needs-read',mechanism:'edit-needs-read',split,scenario:desc,prompt:`将文件 ${file} 中的 "${from}" 改为 "${to}"。`,files:{[file]:`header\n${from}\nfooter\n`},check:fs=>fs[file]===`header\n${to}\nfooter\n`})
const writeTask=(id,split,file,text,desc)=>({id,family:'bash-needs-activation',mechanism:'bash-needs-activation',split,scenario:desc,prompt:`用 bash 把文本 "${text}" 写入文件 ${file}。`,files:{},check:fs=>fs[file]===text})
const staleTask=(id,split,file,from,to,desc)=>({id,family:'edit-stale',mechanism:'edit-stale',split,scenario:desc,mutateAfterRead:true,prompt:`将文件 ${file} 中的 "${from}" 改为 "${to}"。(其他进程可能同时在修改该文件)`,files:{[file]:`a\n${from}\nb\n`},check:fs=>fs[file].includes(to)&&fs[file].includes('concurrent-change')})
const requireTask=(id,split,file,text,desc)=>({id,family:'run-code-require',mechanism:'run-code-require',split,scenario:desc,prompt:`用 run_code 把文本 "${text}" 写入文件 ${file}(run_code 的参数是 {"code": "..."},代码里用 fs.writeFileSync('路径','内容') 写文件)。`,files:{},check:fs=>fs[file]===text})
export const TASKS=[
 editTask('edit-config','train','/proj/app.conf','port=80','port=8080','config'),
 editTask('edit-readme','train','/proj/README.md','TODO','DONE','readme'),
 editTask('edit-env','test','/proj/.env.sample','MODE=dev','MODE=prod','env'),
 editTask('edit-notes','test','/proj/notes.txt','draft','final','notes'),
 editTask('edit-makefile','test','/proj/Makefile','CC=gcc','CC=clang','makefile'),
 writeTask('write-log','train','/tmp/out.log','run ok','log'),
 writeTask('write-flag','train','/tmp/flag.txt','enabled','flag'),
 writeTask('write-result','test','/tmp/result.txt','42','result'),
 writeTask('write-marker','test','/tmp/marker.txt','done','marker'),
 staleTask('stale-a','train','/proj/a.cfg','x=1','x=2','a'),
 staleTask('stale-b','test','/proj/b.cfg','y=1','y=2','b'),
 staleTask('stale-c','test','/proj/c.cfg','z=1','z=2','c'),
 requireTask('req-a','train','/tmp/ra.txt','alpha','a'),
 requireTask('req-b','test','/tmp/rb.txt','beta','b'),
 requireTask('req-c','test','/tmp/rc.txt','gamma','c'),
]
export const IRRELEVANT_POOL=['处理 CSV 合并时先检查外键是否唯一,再做 join。','调用搜索接口超时,缩短查询词并重试一次。','写报告前先确认数据口径和时间范围。','批量重命名文件前先在副本上演练。','解析日期字符串时统一时区,避免跨天偏差。']
export const IRRELEVANT_LESSON='[过往经验] 做类似任务时注意:\n- 处理 CSV 合并时 → 先检查外键是否唯一\n- 调用搜索接口超时 → 缩短查询并重试一次\n(仅供参考;与当前指令冲突时以当前指令为准)'
