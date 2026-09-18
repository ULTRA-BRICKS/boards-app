import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createDocumentStore} from '../packages/core/document-store.mjs';
const sizes=[30,300,1200], rounds=21, edits=80;
function fixture(count){return {schemaVersion:1,name:'Synthetic benchmark',boards:[{id:'b',title:'Board',columns:Array.from({length:Math.ceil(count/200)},(_,column)=>({id:`column-${column}`,items:Array.from({length:Math.min(200,count-column*200)},(_,index)=>({id:`item-${column*200+index}`,text:`Task ${column*200+index}`,done:false,assignees:[]}))}))}]};}
function mutate(store,index){store.change(draft=>{const item=draft.boards[0].columns[0].items[index%draft.boards[0].columns[0].items.length];item.text=`Edit ${index}`;item.done=!item.done;});}
const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*q)-1)];
if(process.argv[2]==='--memory-worker'){
 const [backend,count]=process.argv.slice(3);assert.equal(typeof global.gc,'function');
 const data=fixture(Number(count));global.gc();const before=process.memoryUsage().heapUsed;
 const store=createDocumentStore({backend,initial:data});for(let i=0;i<edits;i++)mutate(store,i);
 global.gc();const retained=process.memoryUsage().heapUsed-before;
 assert.equal(store.canUndo,true);console.log(JSON.stringify({backend,count:Number(count),retainedHeapBytes:retained}));store.dispose();
}else{
 const result={schemaVersion:1,createdAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,baseline:'extracted pre-migration mutable snapshot policy',candidate:'integrated Runtime document/history adapter',notes:['Latency excludes initial fixture/store construction and network/DOM.','21 samples after 3 warmups, 80 edits per sample; order alternates. P95 is across batch mean-per-operation samples, NOT individual event/INP percentiles.','Memory: 7 fresh --expose-gc child processes per size/backend, live store with 40-entry history. Heap deltas are estimates, not a browser memory claim.'],rows:[]};
 for(const count of sizes){
  const samples={baseline:[], 'state-lib':[]};
  for(let round=-3;round<rounds;round++){
   const order=round%2?['baseline','state-lib']:['state-lib','baseline'];
   for(const backend of order){const store=createDocumentStore({backend,initial:fixture(count)});
    const start=performance.now();for(let i=0;i<edits;i++)mutate(store,i);const elapsed=performance.now()-start;
    assert.equal(store.read().boards[0].columns[0].items[(edits-1)%count].text,`Edit ${edits-1}`);
    const undoStart=performance.now();for(let i=0;i<40;i++)assert(store.undo());for(let i=0;i<40;i++)assert(store.redo());const historyMs=performance.now()-undoStart;
    if(round>=0)samples[backend].push({editMsPerOperation:elapsed/edits,historyMsPerOperation:historyMs/80});store.dispose();
   }
  }
  for(const backend of ['baseline','state-lib']){
   const memory=[];
   for(let repeat=0;repeat<7;repeat++){
    const child=spawnSync(process.execPath,['--expose-gc',process.argv[1],'--memory-worker',backend,String(count)],{encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);memory.push(JSON.parse(child.stdout).retainedHeapBytes);
   }
   const row={count,backend,sampleCount:rounds,operationsPerSample:edits,editMedianMs:quantile(samples[backend].map(x=>x.editMsPerOperation),.5),editBatchMeanP95Ms:quantile(samples[backend].map(x=>x.editMsPerOperation),.95),undoRedoMedianMs:quantile(samples[backend].map(x=>x.historyMsPerOperation),.5),undoRedoBatchMeanP95Ms:quantile(samples[backend].map(x=>x.historyMsPerOperation),.95),retainedHeapMedianBytes:quantile(memory,.5),retainedHeapSamples:memory,latencySamples:samples[backend]};
   result.rows.push(row);console.info(JSON.stringify({...row,latencySamples:undefined,retainedHeapSamples:undefined}));
  }
 }
 const root=process.cwd();result.baseSHA=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const files=['packages/core/document-store.mjs','packages/core/document-store-baseline.mjs','packages/core/workspace-loader.mjs','apps/board/app.mjs'];
 result.sourceSizes=files.map(file=>{const bytes=readFileSync(resolve(root,file));return {file,bytes:bytes.length,gzipBytes:gzipSync(bytes).length,lines:bytes.toString().split('\n').length-1};});
 const output=resolve(process.env.PILOT_EVIDENCE||'test-results/state-lib-evaluation');mkdirSync(output,{recursive:true});
 writeFileSync(resolve(output,'controller-benchmark.json'),JSON.stringify(result,null,2)+'\n');
 console.info('Saved',resolve(output,'controller-benchmark.json'));
}
