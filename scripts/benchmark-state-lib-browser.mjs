import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const output=resolve(process.env.PILOT_EVIDENCE||'test-results/state-lib-evaluation');mkdirSync(output,{recursive:true});
const variants=[{name:'baseline',root:resolve(process.env.BASELINE_ROOT||'../boards-app-baseline-evaluation'),port:6581},{name:'state-lib',root:process.cwd(),port:6582}];
if(process.env.STATE_COW==='1')variants.push({name:'state-lib-cow',root:process.cwd(),port:6583});
if(process.env.EVAL_BASE_PORT)variants.forEach((variant,index)=>{variant.port=Number(process.env.EVAL_BASE_PORT)+index;});
const samples=[],servers=[],logs=[];let browser;
const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*q)-1)];
try{
 for(const variant of variants){
  variant.base=`http://127.0.0.1:${variant.port}`;const log=openSync(`${output}/browser-${variant.name}-server.log`,'w');logs.push(log);
  const child=spawn(process.execPath,['scripts/dev.mjs'],{cwd:variant.root,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LOCAL_TEST_MODE:'1',LOCAL_DATABASE_PATH:':memory:',PORT:String(variant.port),APP_ORIGIN:variant.base,AUTH_SECRET:'synthetic-browser-benchmark-only'},stdio:['ignore',log,log]});servers.push(child);
  let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch(variant.base+'/api/status')).ok}catch{}if(!ready)await new Promise(r=>setTimeout(r,100));}assert(ready,`${variant.name} API starts`);
 }
 browser=await chromium.launch();
 for(const count of [30,300,1200]){
  for(let round=-2;round<9;round++){
   for(const variant of round%2?[...variants].reverse():variants){
    const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await page.addInitScript(()=>{window.__firstBoardDOM=null;new MutationObserver((_,observer)=>{if(document.querySelector('.paper')){window.__firstBoardDOM=performance.now();observer.disconnect();}}).observe(document,{childList:true,subtree:true});});
    await page.goto(variant.base+'/?stateBackend='+variant.name);await page.getByRole('button',{name:'Open local test workspace',exact:true}).click();await page.locator('.paper').waitFor();
    const initial=await (await page.request.get(variant.base+'/api/state')).json();const value=structuredClone(initial.value), template=value.boards[0], column=template.columns[0];
    template.columns=Array.from({length:Math.ceil(count/200)},(_,i)=>({...column,id:`bench-column-${i}`,title:`Column ${i}`,items:Array.from({length:Math.min(200,count-i*200)},(_,j)=>({id:`bench-${i*200+j}`,text:`Synthetic task ${i*200+j}`,tag:'',assignees:[],done:false}))}));value.boards=[template];
    const seeded=await page.request.put(variant.base+'/api/state',{headers:{origin:variant.base},data:{version:initial.version,value}});assert.equal(seeded.status(),200,await seeded.text());
    await page.reload();await page.locator('.paper').waitFor();assert.equal(await page.locator('.task').count(),count);if(variant.name!=='baseline')assert.equal(await page.locator('html').getAttribute('data-document-backend'),variant.name);await page.evaluate(()=>document.fonts.ready);
    const firstDOM=await page.evaluate(()=>window.__firstBoardDOM);
    const timings=await page.evaluate(async()=>{
     const values=[];for(let operation=0;operation<12;operation++){
      const start=performance.now();document.querySelector('.task-check').click();const syncMs=performance.now()-start;
      await new Promise(requestAnimationFrame);values.push({syncHandlerAndDOMMs:syncMs,eventToNextFrameMs:performance.now()-start});
     }return values;
    });
    await page.waitForFunction(()=>document.querySelector('.save-state')?.textContent==='');
    await cdp.send('HeapProfiler.collectGarbage');const heap=await cdp.send('Runtime.getHeapUsage');
    const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(x=>({name:new URL(x.name).pathname,bytes:x.encodedBodySize,duration:x.duration})));
    assert.deepEqual(errors,[]);if(round>=0)samples.push({backend:variant.name,count,round,firstBoardDOMMs:firstDOM,usedJSHeapBytes:heap.usedSize,timings,resources});
    await context.close();
   }
  }
  console.info('Measured',count,'tasks on both pinned implementations');
 }
 const summary=[];
 for(const count of [30,300,1200])for(const backend of variants.map(v=>v.name)){
  const group=samples.filter(x=>x.count===count&&x.backend===backend),timings=group.flatMap(x=>x.timings);
  summary.push({count,backend,pageSamples:group.length,eventSamples:timings.length,firstDOMMedianMs:quantile(group.map(x=>x.firstBoardDOMMs),.5),firstDOMP95Ms:quantile(group.map(x=>x.firstBoardDOMMs),.95),handlerDOMMedianMs:quantile(timings.map(x=>x.syncHandlerAndDOMMs),.5),handlerDOMP95Ms:quantile(timings.map(x=>x.syncHandlerAndDOMMs),.95),nextFrameMedianMs:quantile(timings.map(x=>x.eventToNextFrameMs),.5),nextFrameP95Ms:quantile(timings.map(x=>x.eventToNextFrameMs),.95),usedJSHeapMedianBytes:quantile(group.map(x=>x.usedJSHeapBytes),.5)});
 }
 writeFileSync(`${output}/browser-benchmark.json`,JSON.stringify({createdAt:new Date().toISOString(),node:process.version,browser:browser.version(),variants,notes:['Local synthetic SQLite APIs, no production data.','Original baseline source, not a baseline branch that already loads the new runtime.','9 recorded pages after 2 warmups per size/backend, alternating order; 12 real DOM clicks per page.','First DOM is not FCP/LCP; next frame is not field INP. CDP heap excludes native DOM memory.'],summary,samples},null,2)+'\n');
 for(const row of summary)console.info(JSON.stringify(row));
}finally{
 await browser?.close();for(const server of servers)if(server.exitCode===null){const done=once(server,'exit');server.kill('SIGTERM');await done;}for(const log of logs)closeSync(log);
}
