import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../packages/state-lib/dist/index.js';
import {createDocumentStore} from '../packages/core/document-store.mjs';
import {existsSync} from 'node:fs';
async function action(){assert(existsSync('apps/board/document-action.mjs'),'Implement the after-commit action boundary');return (await import('../apps/board/document-action.mjs')).commitDocumentAction;}
test('failed navigation and document batch never enters the save queue',async()=>{
 const commit=await action(),runtime=new Runtime(),document=createDocumentStore({runtime,initial:{name:'old'}}),selected=runtime.signal('old'),queue=[];
 const state={runtime,batch:fn=>runtime.transaction(fn),documentStore:document};
 assert.throws(()=>commit(state,()=>document.change(d=>{d.name='new';}),()=>{selected.set('new');throw Error('stop');},value=>queue.push(value)),/stop/);
 assert.equal(document.read().name,'old');assert.equal(selected.get(),'old');assert.deepEqual(queue,[]);runtime.dispose();
});
test('committed state is queued even if an observer reports a post-commit failure',async()=>{
 const commit=await action(),runtime=new Runtime(),document=createDocumentStore({runtime,initial:{name:'old'}}),queue=[];
 document.subscribe(()=>{throw Error('observer');});
 assert.throws(()=>commit({runtime,batch:fn=>runtime.transaction(fn),documentStore:document},()=>document.change(d=>{d.name='new';}),()=>{},value=>queue.push(value)),error=>error.committed===true);
 assert.equal(queue.length,1);assert.equal(queue[0].name,'new');runtime.dispose();
});

test('a rolled-back callback cannot forge a committed action',async()=>{
 const commit=await action(),runtime=new Runtime(),document=createDocumentStore({runtime,initial:{name:'old'}}),queue=[];
 assert.throws(()=>commit({runtime,batch:fn=>runtime.transaction(fn),documentStore:document},()=>document.change(d=>{d.name='new';}),()=>{throw Object.assign(Error('rollback'),{committed:true});},value=>queue.push(value)),/rollback/);
 assert.equal(document.read().name,'old');assert.deepEqual(queue,[]);runtime.dispose();
});
test('a publication failure retains the earlier committed observer failure',async()=>{
 const commit=await action(),runtime=new Runtime(),document=createDocumentStore({runtime,initial:{name:'old'}});
 document.subscribe(()=>{throw Error('observer');});
 assert.throws(()=>commit({runtime,batch:fn=>runtime.transaction(fn),documentStore:document},()=>document.change(d=>{d.name='new';}),()=>{},()=>{throw Error('render');}),error=>error.committed===true&&error instanceof AggregateError&&error.errors.length===2);
 assert.equal(document.read().name,'new');runtime.dispose();
});
test('false mutation and nested action do not publish',async()=>{
 const commit=await action(),runtime=new Runtime(),document=createDocumentStore({runtime,initial:{name:'old'}}),queue=[];
 const state={runtime,batch:fn=>runtime.transaction(fn),documentStore:document};
 assert.equal(commit(state,()=>false,()=>{throw Error('must not run');},value=>queue.push(value)),false);
 assert.throws(()=>runtime.transaction(()=>commit(state,()=>true,()=>{},value=>queue.push(value))),/outside another transaction/);
 assert.deepEqual(queue,[]);runtime.dispose();
});
