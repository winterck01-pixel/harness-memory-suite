import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectCrossOrigin} from './index.js';

test('state-changing video-studio requests reject foreign Origin',async()=>{
 const bad=new Request('http://dsh.internal/api/video-studio/tasks',{method:'POST',headers:{origin:'https://evil.example',host:'127.0.0.1:3080'}});
 const blocked=rejectCrossOrigin(bad);
 assert.equal(blocked.status,403);
 const same=new Request('http://dsh.internal/api/video-studio/tasks',{method:'POST',headers:{origin:'http://127.0.0.1:3080',host:'127.0.0.1:3080'}});
 assert.equal(rejectCrossOrigin(same),null);
});
