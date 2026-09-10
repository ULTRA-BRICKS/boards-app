import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

test('independent Neon type function serves a complete specimen without Git, fonts or secrets',async()=>{
 const r=spawnSync(process.execPath,['scripts/build-neon-type.mjs'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 const {default:handler}=await import('../dist/type-neon/index.mjs');
 const response=await handler.fetch(new Request('https://type.example/'));
 assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/text\/html/);
 const html=await response.text();assert.match(html,/Conloca Sans/);assert.doesNotMatch(html,/src="\/|href="\/|base64,|DATABASE_URL/);
 assert.equal((await handler.fetch(new Request('https://type.example/',{method:'HEAD'}))).body,null);
 assert.equal((await handler.fetch(new Request('https://type.example/missing'))).status,404);
 assert.equal((await handler.fetch(new Request('https://type.example/',{method:'POST'}))).status,405);
 assert.equal((await (await handler.fetch(new Request('https://type.example/health'))).json()).ok,true);
});
