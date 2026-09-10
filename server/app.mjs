import {configuration} from './configuration.mjs';
export {configuration};
import {getStore,workspace,mutate} from './store.mjs';
import {fail,token,hash,json,body,rawBody,origin,sameOrigin,headers,esc,redirect} from './http.mjs';
import * as auth from './identity.mjs';
import {capabilities,searchWorkspace,illustration,importPhoto} from './ai.mjs';
import {uploadAvatar,providerAvatar,readAsset,PLACEHOLDER} from './assets.mjs';
import {ticket,backlink,syncSlack} from './integrations.mjs';
import {validateWorkspace,normalizePerson,validateScope,projectShare,validId} from '../packages/core/workspace.mjs';
import {uid,validateBoard} from '../packages/core/model.mjs';
import {renderPNG} from './preview.mjs';
const pngCache=new Map();
export async function createShare(store,user,scope){const ws=(await workspace(store)).value,clean=validateScope(scope,ws),id=token();await store.cas('shares',hash(id),0,{scope:clean,by:user.id,created:Date.now(),revoked:false});return id}
export async function shared(store,id){const share=(await store.get('shares',hash(id)))?.value;if(!share||share.revoked)throw fail('Shared link unavailable.',404);const ws=await workspace(store);let view;try{view=projectShare(ws.value,share.scope)}catch{throw fail('The shared selection no longer exists.',404)}return {view,version:ws.version}}
function image(res,a){res.setHeader('Content-Type',a.mime);res.setHeader('Cache-Control','private, max-age=30');res.setHeader('X-Content-Type-Options','nosniff');res.end(Buffer.from(a.data,'base64'))}
export function publicHTML(view,id,env){const base=origin(env),url=base+'/s/'+id,title=view.scope.kind==='space'?'Shared boards':view.boards[0]?.title||'Shared board',cols=view.boards.flatMap(b=>b.columns),focus=view.scope.kind==='item'?cols.flatMap(c=>c.items).find(t=>!view.neighborIds.includes(t.id)):null,description=focus?`${cols[0]?.title||''} · ${focus.text}`:`${cols.length} columns · ${cols.reduce((n,c)=>n+c.items.length,0)} items`;return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${base}/api/og?id=${id}&v=${view.version||0}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/refinements.css"></head><body><main id="app"><p>Opening shared page…</p></main><div id="overlays"></div><div id="toast" role="status"></div><script type="module" src="/boot.mjs"></script></body></html>`}
export function createHandler({env=process.env,store:providedStore}={}){return async function handler(req,res){headers(res);const u=new URL(req.url,'http://internal'),path=u.searchParams.get('route')?'/api/'+u.searchParams.get('route'):(u.pathname.startsWith('/s/')?'/api/share-page':u.pathname);const id=u.pathname.startsWith('/s/')?u.pathname.slice(3):u.searchParams.get('id');try{
 const config=configuration(env);
 if(path==='/api/status'){let cloud='not-configured',user=null;if(config.checks[0].ready){try{const store=providedStore||await getStore(env);await store.init();await workspace(store);cloud=store.kind;user=auth.publicUser(await auth.session(store,req))}catch{config.ready=false;cloud='unavailable';config.checks[0]={...config.checks[0],ready:false,message:'Database could not be reached. Check the server connection string and logs.'}}}return json(res,200,{...config,cloud,user})}
 if(!config.ready)throw fail('Finish cloud and login setup before opening the board.',503);
 const store=providedStore||await getStore(env);
 if(path==='/api/auth/callback'){
  let q=new URLSearchParams(u.searchParams);if(req.method==='POST'){if(!/^application\/x-www-form-urlencoded/.test(req.headers['content-type']||''))throw fail('Invalid callback',415);const form=req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body)?new URLSearchParams(req.body):new URLSearchParams(await rawBody(req,12000));for(const[k,v]of form)q.set(k,v)}await auth.finishOAuth(store,req,res,q,env);return redirect(res,origin(env)+'/');
 }
 if(!['GET','HEAD'].includes(req.method))sameOrigin(req,env);
 if(req.method==='POST'&&path==='/api/auth/start')return json(res,200,await auth.beginOAuth(store,req,res,await body(req,5000),env));
 if(req.method==='POST'&&path==='/api/auth/email')return json(res,200,await auth.magicLink(store,req,await body(req,5000),env));
 if(req.method==='POST'&&path==='/api/auth/verify'){await auth.verifyMagic(store,res,(await body(req,5000)).token,env);return json(res,200,{ok:true})}
 if(req.method==='POST'&&path==='/api/auth/test'){await auth.testLogin(store,res,env);return json(res,200,{ok:true})}
 if(req.method==='GET'&&['/api/shared','/api/share-page','/api/og'].includes(path)){if(!id||!/^[\w-]{40,80}$/.test(id))throw fail('Shared link unavailable.',404);const {view,version}=await shared(store,id);if(path==='/api/shared')return json(res,200,{...view,version});if(path==='/api/share-page'){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end(publicHTML({...view,version},id,env))}const key=hash(id+':'+version+':v04');let png=pngCache.get(key);if(!png){png=renderPNG(view);if(pngCache.size>20)pngCache.clear();pngCache.set(key,png)}res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','no-store');return res.end(png)}
 if(req.method==='GET'&&path==='/api/share-image'){
  if(!id||!/^[\w-]{40,80}$/.test(id))throw fail('Shared link unavailable.',404);
  const {view}=await shared(store,id),artId=u.searchParams.get('art');
  if(!view.boards.some(b=>b.columns.some(c=>c.illustrationId===artId)))throw fail('Drawing not shared.',404);
  const art=(await store.get('art',artId))?.value,a=art&&(await store.get('assets',art.asset))?.value;
  if(!a||a.kind!=='illustration')throw fail('Drawing not found',404);
  res.setHeader('Content-Type',a.mime);res.setHeader('Cache-Control','no-store');return res.end(Buffer.from(a.data,'base64'));
 }
 const user=await auth.requireUser(store,req);
 if(req.method==='POST'&&path==='/api/auth/logout'){await auth.logout(store,req,res,env);return json(res,200,{ok:true})}
 if(req.method==='GET'&&path==='/api/state')return json(res,200,await workspace(store));
 if(req.method==='PUT'&&path==='/api/state'){await auth.limit(store,'write:'+user.id,240,60000);const input=await body(req),old=await workspace(store);if(!Number.isInteger(input.version)||input.version!==old.version)throw fail('Another session changed this workspace. Reload before saving.',409);const next=validateWorkspace({...input.value,id:old.value.id,people:old.value.people,integrations:old.value.integrations});const version=await store.cas('workspace','main',old.version,next);if(!version)throw fail('Another session changed the workspace. Reload before saving.',409);return json(res,200,{version})}
 if(req.method==='GET'&&path==='/api/people')return json(res,200,{people:await auth.members(store,user),requests:await auth.profileRequests(store,user),user:auth.publicUser(user)});
 if(req.method==='POST'&&path==='/api/people'){await auth.limit(store,'people:'+user.id,30,86400000);const input=await body(req,5000),p=normalizePerson({id:uid(),name:input.name,email:input.email});if(!p.email)throw fail('Email is required for invitation and confirmation.');const ws=(await workspace(store)).value;await mutate(store,'workspace','main',w=>{if(w.people.length>=200)throw fail('Workspace people limit reached.');if(w.people.some(x=>x.email.toLowerCase()===p.email.toLowerCase()))throw fail('This email is already in the workspace.',409);w.people.push(p)},ws);return json(res,201,{person:p})}
 if(req.method==='GET'&&path==='/api/avatar'){const a=await providerAvatar(store,id);if(a)return image(res,a);res.setHeader('Content-Type','image/svg+xml');res.setHeader('Cache-Control','private, max-age=30');res.setHeader('X-Avatar-Missing','1');return res.end(PLACEHOLDER)}
 if(req.method==='GET'&&path==='/api/asset'){if(!validId(id))throw fail('Not found',404);return image(res,await readAsset(store,user,id))}
 if(req.method==='POST'&&path==='/api/avatar'){await auth.limit(store,'avatar:'+user.id,30,86400000);return json(res,201,await uploadAvatar(store,user,await body(req,310000)))}
 if(req.method==='POST'&&path==='/api/proposals/confirm'){const input=await body(req,5000);return json(res,200,await auth.approveAvatar(store,user,input.id,input.accept===true))}
 if(req.method==='POST'&&path==='/api/proposals/link'){const input=await body(req,5000);const id=await auth.propose(store,user,{...input,type:'link'});return json(res,201,{id})}
 if(req.method==='POST'&&path==='/api/search'){await auth.limit(store,'search:'+user.id,180,60000);return json(res,200,await searchWorkspace(store,await body(req,5000),env))}
 if(req.method==='POST'&&path==='/api/illustration'){await auth.limit(store,'art:'+user.id,50,3600000);return json(res,200,await illustration(store,await body(req,5000),env))}
 if(req.method==='GET'&&path==='/api/illustration'){const art=(await store.get('art',id))?.value;if(!art)throw fail('Drawing not found',404);return image(res,await readAsset(store,user,art.asset))}
 if(req.method==='POST'&&path==='/api/photo'){return json(res,200,await importPhoto(store,await body(req,1900000),env))}
 if(req.method==='POST'&&path==='/api/import'){const input=await body(req,200000),board={...validateBoard(input.board),id:uid()},ws=(await workspace(store)).value;delete board.people;delete board.integrations;delete board.space;await mutate(store,'workspace','main',w=>{if(w.boards.length>=30)throw fail('Workspace board limit reached.');for(const c of board.columns)for(const t of c.items)t.assignees=[];w.boards.push(board)},ws);return json(res,201,{boardId:board.id})}
 if(req.method==='POST'&&path==='/api/ticket')return json(res,200,await ticket(store,await body(req,5000),env));
 if(req.method==='POST'&&path==='/api/backlink'){const input=await body(req,5000),ws=(await workspace(store)).value;validateScope({kind:'item',boardId:input.boardId,itemIds:[input.itemId]},ws);const page=origin(env)+'/?board='+encodeURIComponent(input.boardId)+'&item='+encodeURIComponent(input.itemId);return json(res,200,await backlink(store,user,input,env,page))}
 if(req.method==='POST'&&path==='/api/slack/sync'){if(!user.owner)throw fail('Only the owner can import the Slack directory.',403);return json(res,200,await syncSlack(store,env))}
 if(req.method==='POST'&&path==='/api/share'){await auth.limit(store,'shares:'+user.id,50,86400000);const id=await createShare(store,user,await body(req,10000));return json(res,201,{id,url:origin(env)+'/s/'+id,preview:origin(env)+'/api/og?id='+id})}
 if(req.method==='POST'&&path==='/api/share/revoke'){const input=await body(req,5000);await mutate(store,'shares',hash(input.id),s=>{if(!s.scope||s.by!==user.id&&!user.owner)throw fail('Not allowed',403);s.revoked=true});return json(res,200,{ok:true})}
 throw fail('Not found',404);
 }catch(e){const validation=/^(Invalid |Unknown |Duplicate|At most |Workspace |Board not found|Column not found|Items not found|Неизвестная|Неверн|Повторяющ|Максимум|Доска больше)/.test(e.message||'');const status=Number(e.status)||(validation?400:500);if(status>=500)console.error('Request failed:',path,e.name);json(res,status,{error:status===500?'Unexpected server error.':e.message||'Request failed.'})}
}}
