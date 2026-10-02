import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../packages/state-lib/dist/index.js';
import {createDocumentStore} from '../packages/core/document-store.mjs';

test('disposing a borrowed document releases its subscriptions without disposing the parent Runtime',()=>{
 const runtime=new Runtime(),other=runtime.signal(0),before=runtime.owned.size;
 const document=createDocumentStore({runtime,initial:{name:'old'}});
 document.subscribe(()=>{});assert(runtime.owned.size>before);
 document.dispose();assert.equal(runtime.owned.size,before);
 other.set(1);assert.equal(other.get(),1);runtime.dispose();
});
test('rejected borrowed cleanup during notification preserves the live document',()=>{
 const runtime=new Runtime(),other=runtime.signal(0),document=createDocumentStore({runtime,initial:{name:'old'}});
 let rejected=false;
 other.subscribe(()=>{assert.throws(()=>document.dispose());rejected=true;});
 other.set(1);assert(rejected);assert.equal(document.read().name,'old');
 document.dispose();runtime.dispose();
});
test('document cleanup remains idempotent after the parent is disposed',()=>{
 const runtime=new Runtime(),document=createDocumentStore({runtime,initial:{name:'old'}});
 document.subscribe(()=>{});runtime.dispose();assert.doesNotThrow(()=>document.dispose());assert.doesNotThrow(()=>document.dispose());
});
