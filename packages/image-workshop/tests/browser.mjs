import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

test('image workshop source uses live-film shared modules and has a built client bundle',async()=>{
  await access(new URL('../build.mjs',import.meta.url));
  const source=await readFile(new URL('../client.jsx',import.meta.url),'utf8');
  assert.equal(source.includes('../dsh-live-film/'),false,'stale dsh-live-film imports should not return');
  assert.ok(source.includes('../live-film/image-edit.jsx'),'workshop should reuse the live-film image editor');
  const bundle=await readFile(new URL('../client.js',import.meta.url),'utf8');
  assert.ok(bundle.includes('id:"dsh-image-workshop"'),'client bundle should register the image workshop module');
  assert.ok(bundle.includes('sessionId: promptSessionId'),'UI image submissions should persist the current session ID for Agent tools and remote delivery');
});


test('image workshop protects protocol enums from browser translation',async()=>{
 const source=await readFile(new URL('../client.jsx',import.meta.url),'utf8');
 assert.match(source,/<main\b[^>]*\btranslate="no"/);
 assert.match(source,/className="iw dsh-plugin-surface notranslate"/);
});
