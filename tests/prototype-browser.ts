/** Actual Chromium rendering with fixture RPC transport. This is not a live CORS test. */
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateWorkspace, projectShare } from '../packages/core/workspace.mjs';
const root=resolve(import.meta.dir,'..');
const prefix='https://rawcdn.githack.com/ultrabricks/boards-app/0fa587120fbcea53e8c3f805ebec925afcd626ce/';
const built=await Bun.build({entrypoints:[root+'/apps/prototype/app.mjs'],target:'browser',format:'esm',plugins:[{name:'local-pinned-source',setup(b){b.onResolve({filter:/^https:\/\/rawcdn\.githack\.com\//},a=>({path:root+'/'+a.path.slice(prefix.length)}))}}]});
if(!built.success)throw Error(JSON.stringify(built.logs));
const js=await built.outputs[0].text();
let html=await readFile(root+'/apps/prototype/index.html','utf8');
const css=await readFile(root+'/apps/board/style.css','utf8');
html=html.replace(/<link\b[^>]*>/g,'').replace('</head>','<style>'+css+'</style></head>').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const notebooks=new Map<string,{version:number,value:any}>(),shares=new Map<string,any>();
const errors:string[]=[],checks:string[]=[];let failWrites=false;
const check=(name:string,value:unknown)=>{if(!value)throw Error(name);checks.push(name);console.log('PASS',name)};
async function mount(hash=''){
 const page=await browser.newPage({viewport:{width:1448,height:1086},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__bridge',async(input:any)=>{
  const u=new URL(input.url),d=JSON.parse(input.body||'{}');
  if(u.pathname.endsWith('/token/anonymous')){check('anonymous token uses official GET contract',input.method==='GET');return{status:200,body:{token:'fixture-jwt'}}}
  const name=u.pathname.split('/').at(-1);
  if(input.method!=='POST')return{status:405,body:{message:'POST required'}};
  if(name==='notebook'){
   if(!/^[\w-]{43,86}$/.test(d.capability||''))return{status:403,body:{message:'Notebook key required'}};
   if(!d.document){const n=notebooks.get(d.capability);return n?{status:200,body:n}:{status:404,body:{message:'Unavailable',code:'P0002'}}}
   if(failWrites)return{status:503,body:{message:'Injected network error'}};
   validateWorkspace(d.document);const prev=notebooks.get(d.capability);
   if(d.expected_version!==(prev?.version||0))return{status:409,body:{message:'Injected conflict',code:'40001'}};
   const version=(prev?.version||0)+1;notebooks.set(d.capability,{version,value:structuredClone(d.document)});return{status:200,body:{version}};
  }
  if(name==='share_notebook'){
   const n=notebooks.get(d.capability);if(!n)return{status:403,body:{message:'Wrong owner'}};
   if(d.revoke_token){const s=shares.get(d.revoke_token);if(s?.owner!==d.capability)return{status:403,body:{message:'Wrong owner'}};s.revoked=true;return{status:200,body:{revoked:true}}}
   projectShare(n.value,d.scope);const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');shares.set(token,{owner:d.capability,scope:d.scope,revoked:false});return{status:200,body:{token}};
  }
  if(name==='read_shared'){const s=shares.get(d.share_token);if(!s||s.revoked)return{status:403,body:{message:'Shared link unavailable'}};const n=notebooks.get(s.owner)!;return{status:200,body:{version:n.version,value:projectShare(n.value,s.scope)}}}
  return{status:404,body:{message:'Unknown route'}};
 });
 await page.setContent(html,{waitUntil:'domcontentloaded'});
 await page.evaluate((hash)=>{
  if(hash)location.hash=hash;
  history.replaceState=(_a,_b,url)=>{location.hash=new URL(String(url),'https://prototype.example').hash};
  (window as any).fetch=async(url:any,o:any={})=>{const r=await(window as any).__bridge({url:String(url),method:o.method||'GET',body:o.body});return Response.json(r.body,{status:r.status})};
 },hash);
 await page.addScriptTag({type:'module',content:js});
 await page.waitForSelector('.paper',{timeout:10000});
 await page.waitForFunction(()=>[...document.fonts].some(f=>f.family==='Conloca Sans'));
 return page;
}
try{
 const page=await mount();check('15 original thoughts render',await page.locator('.task').count()===15);check('no application header or logo',await page.locator('header').count()===0);
 await mkdir(root+'/docs/screenshots',{recursive:true});await mkdir(root+'/test-results',{recursive:true});
 await page.screenshot({path:root+'/docs/screenshots/prototype-desktop.png',fullPage:true});
 const editHash=await page.evaluate(()=>location.hash),text=page.locator('#i-p2 .task-text');
 await text.click();await text.fill('Биллинг проверен 🙂');await page.keyboard.press('Enter');await page.waitForTimeout(900);
 check('Cyrillic edit persisted through RPC bridge',[...notebooks.values()][0].value.boards[0].columns[1].items[1].text==='Биллинг проверен 🙂');
 const second=await mount(editHash);check('second browser receives saved current state',await second.locator('#i-p2 .task-text').innerText()==='Биллинг проверен 🙂');await second.close();
 await text.click();await text.fill('<img src=x onerror="window.HACKED=1">');await page.keyboard.press('Enter');await page.waitForTimeout(700);
 check('HTML remains plain text',await text.locator('img').count()===0&&await page.evaluate(()=>!(window as any).HACKED));
 await text.click();await text.fill('Finish and test billing @Niko');await page.keyboard.press('Enter');check('mention becomes trailing avatar',await page.locator('#i-p2 [data-person=niko]').count()===1);
 const a=await page.locator('#i-p2 [data-person=danny]').boundingBox(),b=await page.locator('#i-p2 [data-person=niko]').boundingBox();check('avatar chain overlaps',b!.x<a!.x+a!.width);
 await page.locator('#i-p2 [data-person=danny]').hover({position:{x:3,y:12}});check('hovered avatar lifts',await page.locator('#i-p2 [data-person=danny]').evaluate(e=>Number(getComputedStyle(e).zIndex))===30);
 await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('searchbox').fill('billing');check('search responds immediately',await page.locator('.search-result').count()>0);await page.keyboard.press('Escape');
 await page.locator('#i-p2 [data-item-menu]').click();await page.locator('#select-item').click();await page.getByRole('button',{name:'Share',exact:true}).click();await page.locator('#make-share').click();await page.waitForSelector('#share-url');
 const link=await page.locator('#share-url').inputValue(),reader=await mount(new URL(link).hash);check('shared item only',await reader.locator('.task').count()===1);check('shared view cannot edit',await reader.locator('.add-person').count()===0);await reader.close();
 await page.locator('#revoke-share').click();await page.waitForTimeout(150);check('link revoked',[...shares.values()][0].revoked);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Pages',exact:true}).click();await page.getByRole('button',{name:'New page',exact:true}).click();check('new page is inline not modal',await page.getByRole('dialog').count()===0);
 await page.locator('.board-title').fill('Fresh ideas');await page.keyboard.press('Enter');await page.getByRole('button',{name:'New column',exact:true}).click();await page.locator('.column-title').fill('Next');await page.keyboard.press('Enter');await page.locator('.add-item').click();await page.locator('.task-text').fill('A useful step');await page.keyboard.press('Enter');await page.waitForTimeout(850);check('new page and column saved',[...notebooks.values()][0].value.boards.length===2);
 await page.getByRole('button',{name:'Pages',exact:true}).click();await page.locator('[data-page=roadmap]').click();
 for(const width of [320,393,768,1448]){await page.setViewportSize({width,height:900});check('no page overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(width===393)await page.screenshot({path:root+'/docs/screenshots/prototype-mobile.png'});}
 failWrites=true;await text.click();await text.fill('Unsaved draft must survive');await page.keyboard.press('Enter');await page.waitForSelector('.conflict');check('failed cloud save blocks without local fallback',await page.locator('#app').getAttribute('inert')!==null);check('draft retained',await text.innerText()==='Unsaved draft must survive');failWrites=false;await page.locator('#retry').click();await page.waitForTimeout(850);check('retry saves retained draft',[...notebooks.values()][0].value.boards[0].columns[1].items[1].text==='Unsaved draft must survive');
 check('no uncaught browser exceptions',errors.length===0);
 await writeFile(root+'/test-results/prototype-browser.json',JSON.stringify({mode:'Chromium set_content; actual UI source; fixture RPC; NOT deployed HTTP/CORS verification',checks,errors},null,2));
}finally{await browser.close()}
