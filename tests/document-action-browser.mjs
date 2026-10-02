import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const port=Number(process.env.ACTION_TEST_PORT||6945),origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/dev.mjs'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LOCAL_TEST_MODE:'1',LOCAL_DATABASE_PATH:':memory:',PORT:String(port),APP_ORIGIN:origin,AUTH_SECRET:'synthetic-not-a-secret',BOARDS_STATE_BACKEND:'state-lib'},stdio:'ignore'});
let browser;
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/status')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert(ready,'Synthetic app server starts');browser=await chromium.launch();const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 // The observer injection is served only by this local test. No production debug API is added.
 await page.route('**/app.mjs',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\n;globalThis.__actionTestState=S;'});});
 await page.goto(origin);await page.getByRole('button',{name:'Open local test workspace',exact:true}).click();await page.locator('.paper').waitFor();
 await page.evaluate(()=>{globalThis.__actionTestState.boardId.subscribe(()=>{globalThis.__observerCalled=true;throw Error('synthetic committed observer');});});
 await page.getByRole('button',{name:'Boards and columns',exact:true}).click();await page.locator('#new-board').click();await page.locator('#name-form input').fill('Observer recovery');await page.locator('#name-form button').click();
 await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>globalThis.__observerCalled),true);
 assert.equal((await page.locator('.board-title').innerText()).toLowerCase(),'observer recovery','committed new page must render despite observer failure');
 assert.equal(await page.locator('#name-form').count(),0,'committed new-page dialog must close');
 assert.equal(errors.length,1,'the original observer failure still surfaces');
 console.log('PASS: committed new-page action renders and closes the dialog without hiding its observer error');
}finally{await browser?.close();server.kill('SIGTERM');}
