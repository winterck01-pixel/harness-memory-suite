import test from 'node:test';
import assert from 'node:assert/strict';
import {markDownloadFailure} from './resilience.js';

test('partial saved results remain completed and deliverable after later download failure',()=>{
 const task={results:[{id:'saved',path:'/tmp/saved.bin'}]};
 markDownloadFailure(task,Error('download failed'),10,1);
 assert.equal(task.status,'completed');
 assert.equal(task.stage,'download_failed');
 assert.equal(task.errorCode,'RESULT_DOWNLOAD_FAILED');
 assert.match(task.error,/已保存的结果会先投递/);
});
