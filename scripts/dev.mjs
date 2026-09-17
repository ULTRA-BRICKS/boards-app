import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHandler} from '../server/app.mjs';
import {headers} from '../server/http.mjs';
import {PLACEHOLDER} from '../server/assets.mjs';
import {getStore,workspace,mutate} from '../server/store.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=Number(process.env.PORT||5173),host='127.0.0.1';process.chdir(root);process.env.APP_ORIGIN||=`http://${host}:${port}`;
if(process.env.LOCAL_TEST_MODE==='1'&&!process.env.VERCEL){await mkdir('.data',{recursive:true});const store=await getStore();const ws=await workspace(store);try{const people=JSON.parse(await readFile('.seed-people.json','utf8'));await mutate(store,'workspace','main',w=>{w.people=Array.isArray(people)?people:people.people},ws.value)}catch{}console.log('EXPLICIT LOCAL TEST MODE: SQLite, test login, no cloud or real OAuth.');}
const handler=createHandler(),types={'.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'};
types['.js']='text/javascript; charset=utf-8';
const server=createServer(async(req,res)=>{const url=new URL(req.url,`http://${host}:${port}`),p=url.pathname;if(p.startsWith('/api/')||p.startsWith('/s/'))return handler(req,res);headers(res);res.setHeader('Cache-Control','no-cache');if(p==='/placeholder.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end(PLACEHOLDER)}let path;if(p==='/'||p==='/index.html')path='apps/board/index.html';else if(['/app.mjs','/boot.mjs','/style.css','/refinements.css','/photo-review.mjs'].includes(p))path='apps/board'+p;else if(/^\/packages\/(font|core)\/[a-z-]+\.mjs$/.test(p))path=p.slice(1);else if(/^\/packages\/state-lib\/dist\/(index|core|latest-task|external-store)\.js$/.test(p))path=p.slice(1);else{res.statusCode=404;return res.end('Not found')}try{const content=await readFile(resolve(root,path));res.setHeader('Content-Type',Object.entries(types).find(([ext])=>path.endsWith(ext))?.[1]||'text/plain');res.end(content)}catch{res.statusCode=404;res.end('Not found')}});
server.listen(port,host,()=>console.log(`Board: http://${host}:${port}\nType specimen: npm run dev:type\nUnconfigured cloud/auth opens setup, never a local-only editor.`));
