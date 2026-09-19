import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium,webkit} from 'playwright';
const port=Number(process.env.EVAL_PORT||6561), base=`http://127.0.0.1:${port}`;
const output=resolve(process.env.PILOT_EVIDENCE||'test-results/state-lib-full');
mkdirSync(output,{recursive:true});
const results=[];
const saved=page=>page.waitForResponse(r=>r.url()===base+'/api/state'&&r.request().method()==='PUT'&&r.status()===200);
async function settle(page){ await page.waitForFunction(()=>document.querySelector('.save-state')?.textContent===''); }
async function more(page,action){await page.getByRole('button',{name:'Notebook settings and profile',exact:true}).click(); const response=saved(page); await page.getByRole('button',{name:action,exact:true}).click(); await response; await settle(page);}
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 for(const backend of ['baseline','state-lib','state-lib-cow']){
  const log=openSync(`${output}/${engine}-${backend}-server.log`,'w');
  const server=spawn(process.execPath,['scripts/dev.mjs'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LOCAL_TEST_MODE:'1',LOCAL_DATABASE_PATH:':memory:',PORT:String(port),APP_ORIGIN:base,AUTH_SECRET:'isolated-board-evaluation-not-a-real-secret'},stdio:['ignore',log,log]});
  let browser;
  try{
   let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch(base+'/api/status')).ok}catch{} if(!ready)await new Promise(r=>setTimeout(r,100));}
   assert(ready,'Synthetic in-memory API must start'); browser=await type.launch();
   const page=await browser.newPage({viewport:{width:1280,height:900}}), errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/?stateBackend='+backend);
   await page.getByRole('button',{name:'Open local test workspace',exact:true}).click();
   await page.locator('.paper').waitFor();await settle(page);
   assert.equal(await page.locator('html').getAttribute('data-document-backend'),backend);
   await page.locator('[data-edit="title"]').click();await page.locator('[data-edit="title"]').fill('Runtime evaluation');
   let response=saved(page);await page.keyboard.press('Enter');await response;await settle(page);
   await page.locator('[data-add-item]').first().click();
   const editor=page.locator('[contenteditable="plaintext-only"]');await editor.fill('Stateful end-to-end item');
   response=saved(page);await page.keyboard.press('Enter');await response;await settle(page);
   let row=page.locator('.task').filter({hasText:'Stateful end-to-end item'});
   const id=await row.getAttribute('data-item'), column=await row.getAttribute('data-col');
   await row.locator('[data-edit="item"]').click();await row.locator('[data-edit="item"]').fill('Renamed persistent item');
   response=saved(page);await page.keyboard.press('Enter');await response;await settle(page);
   row=page.locator(`[data-item="${id}"]`);await row.locator('[data-item-menu]').click();
   await page.getByRole('button',{name:'Move to another column…',exact:true}).click();
   const destination=await page.locator('[data-move]').first().getAttribute('data-move');
   response=saved(page);await page.locator('[data-move]').first().click();await response;await settle(page);
   assert.equal(await page.locator(`[data-item="${id}"]`).getAttribute('data-col'),destination);
   await more(page,'Undo ↶');assert.equal(await page.locator(`[data-item="${id}"]`).getAttribute('data-col'),column);
   await more(page,'Redo ↷');assert.equal(await page.locator(`[data-item="${id}"]`).getAttribute('data-col'),destination);
   let rejectOnce=true;await page.route('**/api/state',async route=>{
    if(route.request().method()==='PUT'&&rejectOnce){rejectOnce=false;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Synthetic stale version'})});}
    return route.continue();
   });
   await page.locator(`[data-item="${id}"] [data-done]`).click();
   await page.getByRole('dialog',{name:'Your last edits are not saved',exact:true}).waitFor();
   assert.equal(await page.locator(`[data-item="${id}"] [data-done]`).getAttribute('aria-pressed'),'true');
   response=saved(page);await page.getByRole('button',{name:'Retry',exact:true}).click();await response;await settle(page);
   await page.reload();await page.locator(`[data-item="${id}"]`).waitFor();
   assert.equal(await page.locator(`[data-item="${id}"] [data-done]`).getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator(`[data-item="${id}"]`).getAttribute('data-col'),destination);
   assert.equal(await page.locator('[data-edit="title"]').textContent(),'RUNTIME EVALUATION');
   await page.screenshot({path:`${output}/${engine}-${backend}-desktop.png`,animations:'disabled'});
   await page.setViewportSize({width:393,height:852});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`${output}/${engine}-${backend}-mobile.png`,animations:'disabled'});
   await page.getByRole('button',{name:'Notebook settings and profile',exact:true}).click();
   await page.getByRole('button',{name:'Sign out',exact:true}).click();
   await page.getByRole('button',{name:'Open local test workspace',exact:true}).waitFor();
   assert.equal(await page.locator('.paper').count(),0);assert.deepEqual(errors,[]);
   results.push({engine,backend,passed:true,titleEdit:true,itemCreateEdit:true,crossColumnMove:true,undoRedo:true,conflictRetryRetainsText:true,reload:true,mobile:true,logoutClearsUI:true});
   console.info('PASS',engine,backend,'real document lifecycle');
  }finally{
   await browser?.close();if(server.exitCode===null){const exit=once(server,'exit');server.kill('SIGTERM');await exit;}closeSync(log);
   writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2)+'\n');
  }
 }
}
assert.equal(results.length,6);
