import {DatabaseSync} from 'node:sqlite';
import {mkdir,open,rename,unlink,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

// tasks.json remains the rollback source. This index is rebuilt from it at startup.
export function createTaskHistory({directory,mirrorPath=join(directory,'tasks.json'),maxResident=200}){
 const residentLimit=Math.max(1,Math.min(200,Math.floor(maxResident)||200));
 let db,upsert,invalid=false;
 const available=()=>{if(invalid||!db)throw Error('任务历史索引不可用，请重启以从完整任务记录恢复');};
 const decode=row=>row?JSON.parse(row.json):undefined;
 function put(task){if(typeof task.id!=='string'||!task.id)throw Error('任务历史缺少记录 ID');upsert.run(task.id,task.sessionId||'',task.status||'',Number(task.createdAt)||0,task.remoteId||'',(!['completed','failed','rejected','cancelled','canceled'].includes(task.status)||!!task.pendingResult)?1:0,JSON.stringify(task));}
 async function initialize(rows){
  if(db)throw Error('任务历史已经初始化');
  const cacheDir=join(directory,'.task-history');await mkdir(cacheDir,{recursive:true,mode:0o700});await chmod(cacheDir,0o700);
  const dbPath=join(cacheDir,'index.sqlite');
  // A stale/corrupt derived database must never prevent loading canonical history.
  await unlink(dbPath).catch(error=>{if(error.code!=='ENOENT')throw error;});await unlink(dbPath+'-journal').catch(error=>{if(error.code!=='ENOENT')throw error;});
  db=new DatabaseSync(dbPath);await chmod(dbPath,0o600);
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE; CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL, created_at REAL NOT NULL, remote_id TEXT NOT NULL, keep_hot INTEGER NOT NULL, json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS tasks_recent ON tasks(created_at DESC); CREATE INDEX IF NOT EXISTS tasks_session ON tasks(session_id,created_at DESC); CREATE INDEX IF NOT EXISTS tasks_remote ON tasks(remote_id); CREATE INDEX IF NOT EXISTS tasks_hot ON tasks(keep_hot);');
  upsert=db.prepare('INSERT INTO tasks(id,session_id,status,created_at,remote_id,keep_hot,json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id,status=excluded.status,created_at=excluded.created_at,remote_id=excluded.remote_id,keep_hot=excluded.keep_hot,json=excluded.json');
  db.exec('BEGIN IMMEDIATE');
  try{db.exec('DELETE FROM tasks');const seen=new Set();for(const task of rows){if(seen.has(task.id))throw Error('任务历史包含重复记录 ID');seen.add(task.id);put(task);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 }
 function page({limit=200,offset=0,sessionId,status}={}){
  available();
  limit=Math.max(1,Math.min(200,Math.floor(Number(limit))||200));offset=Math.max(0,Math.floor(Number(offset))||0);
  const clauses=[],args=[];if(sessionId!==undefined){clauses.push('session_id=?');args.push(String(sessionId));}if(status!==undefined){clauses.push('status=?');args.push(String(status));}
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const total=db.prepare('SELECT COUNT(*) AS total FROM tasks'+where).get(...args).total;
  const tasks=db.prepare('SELECT json FROM tasks'+where+' ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').all(...args,limit,offset).map(decode);
  return {tasks,total,nextOffset:offset+tasks.length<total?offset+tasks.length:null};
 }
 const residentWhere=' WHERE id IN (SELECT id FROM tasks ORDER BY created_at DESC,rowid DESC LIMIT ?) OR keep_hot=1 ORDER BY created_at DESC,rowid DESC';
 function recent(){available();return db.prepare('SELECT json FROM tasks'+residentWhere).all(residentLimit).map(decode);}
 function residentIds(){available();return db.prepare('SELECT id FROM tasks'+residentWhere).all(residentLimit).map(row=>row.id);}
 async function save(tasks){
  available();
  const tmp=mirrorPath+'.'+randomUUID()+'.tmp';let file,mirrored=false;
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const task of tasks)put(task);
   await mkdir(dirname(mirrorPath),{recursive:true,mode:0o700});file=await open(tmp,'wx',0o600);
   await file.writeFile('[');let first=true;
   // Iterate one row at a time: no all-history array or JSON string during a save.
   for(const row of db.prepare('SELECT json FROM tasks ORDER BY rowid').iterate()){await file.writeFile((first?'':',')+row.json);first=false;}
   await file.writeFile(']');await file.sync();await file.close();file=undefined;
   await rename(tmp,mirrorPath);mirrored=true;db.exec('COMMIT');
  }catch(error){/* The canonical mirror wins if the derived commit fails after rename. */if(mirrored)invalid=true;try{db.exec('ROLLBACK');}catch{}try{await file?.close();}catch{}await unlink(tmp).catch(()=>{});throw error;}
 }
 return {initialize,save,recent,residentIds,page,find:id=>{available();return decode(db.prepare('SELECT json FROM tasks WHERE id=?').get(id));},findRemote:remoteId=>{available();return decode(db.prepare('SELECT json FROM tasks WHERE remote_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(remoteId));},close:()=>{db?.close();db=undefined;}};
}
