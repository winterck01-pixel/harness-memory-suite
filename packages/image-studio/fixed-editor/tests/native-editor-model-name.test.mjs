import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeEditorModelName} from '../native-host.js';

test('native editor model projection prefers declared display name over internal model id',()=>{
  assert.equal(nativeEditorModelName({displayName:'WorkRally · Seedream 5 Lite'},'mcp:workrally:image:opaque'),'WorkRally · Seedream 5 Lite');
  assert.equal(nativeEditorModelName({label:'Readable label'},'internal-id'),'Readable label');
  assert.equal(nativeEditorModelName({},'internal-id'),'internal-id');
});
