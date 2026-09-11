/** One isolated verification notebook per run. No real team data or account is used.
 * Run only from an environment with normal external HTTP access. Never print JWTs,
 * editing capabilities, share capabilities or response bodies containing them.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const pinned='https://rawcdn.githack.com/ultrabricks/boards-app/89a117f152df5720705716a25eb59d087d433433/apps/prototype/';
const api='https://ep-long-pond-ay3myrkz.apirest.c-5.us-east-2.aws.neon.tech/boards_prototype/rest/v1';
const auth='https://ep-long-pond-ay3myrkz.neonauth.c-5.us-east-2.aws.neon.tech/boards_prototype/auth';
const origin='https://rawcdn.githack.com';
const checks: {name:string;passed:boolean}[]=[];
function check(name:string,condition:unknown){checks.push({name,passed:!!condition});assert.ok(condition,name);console.log('PASS '+name)}
async function get(url:string){return fetch(url,{headers:{Origin:origin},signal:AbortSignal.timeout(25000)})}
let phase='initialization';
try{
 phase='public entrypoint';
 const html=await get(pinned+'index.html');check('CDN entrypoint responds',html.ok);
 check('HTML content type',html.headers.get('content-type')?.includes('text/html'));
 const document=await html.text();
 const confirmation=/confirm|continue|trust/i.test(document)&&!document.includes('Opening your notebook');
 check('entrypoint or standard CDN confirmation',document.includes('Opening your notebook')||confirmation);
 // A normal content confirmation is not bypassed by this request-only smoke.
 phase='module transport';
 const module=await get(pinned+'app.mjs');check('client module responds',module.ok);
 check('client module MIME is JavaScript',/(?:javascript|ecmascript)/i.test(module.headers.get('content-type')||''));
 phase='anonymous token';
 const response=await get(auth+'/token/anonymous');check('anonymous token endpoint responds',response.ok);
 const proof=await response.json();check('anonymous token is present',typeof proof.token==='string'&&proof.token.length>20);
 const capability=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
 const headers={'Content-Type':'application/json','Accept':'application/json','Content-Profile':'prototype_api','Accept-Profile':'prototype_api',Authorization:'Bearer '+proof.token,Origin:origin};
 async function rpc(name:string,data:unknown){return fetch(api+'/rpc/'+name,{method:'POST',headers,body:JSON.stringify(data),signal:AbortSignal.timeout(25000)})}
 phase='CORS';
 const preflight=await fetch(api+'/rpc/notebook',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,content-profile,accept-profile'},signal:AbortSignal.timeout(25000)});
 check('Data API preflight responds',preflight.ok);
 check('Data API allows prototype origin',[origin,'*'].includes(preflight.headers.get('access-control-allow-origin')||''));
 phase='cloud create';
 const value={schemaVersion:2,id:'smoke',name:'Non-sensitive smoke fixture',people:[],boards:[{id:'b',schemaVersion:1,title:'Cloud smoke',tagline:'',footer:'',typography:{headingWeight:800,bodyWeight:520,width:100},columns:[{id:'c',title:'Checks',subtitle:'',note:'',icon:'auto',items:[{id:'t',text:'Проверка HTTP 🙂',done:false,tag:'',assignees:[]}]}]}]};
 const created=await rpc('notebook',{capability,expected_version:0,document:value});check('cloud create succeeds',created.ok);check('initial version',(await created.json()).version===1);
 phase='cloud read';
 const read=await rpc('notebook',{capability});check('independent read succeeds',read.ok);const saved=await read.json();check('Unicode durable over HTTP',saved.value.boards[0].columns[0].items[0].text==='Проверка HTTP 🙂');
 phase='concurrency';
 const stale=await rpc('notebook',{capability,expected_version:999,document:value});check('stale write rejected',!stale.ok&&(await stale.json()).code==='40001');
 const unknown=await rpc('notebook',{capability:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')});check('foreign notebook is unavailable',!unknown.ok);
 phase='view sharing';
 const share=await rpc('share_notebook',{capability,scope:{kind:'item',boardId:'b',itemIds:['t']}});check('read-only share created',share.ok);const shareToken=(await share.json()).token;
 const visible=await rpc('read_shared',{share_token:shareToken});check('read-only view works',visible.ok);check('private workspace name removed',!(await visible.text()).includes('Non-sensitive smoke fixture'));
 value.boards[0].columns[0].items[0].text='Latest version';
 const update=await rpc('notebook',{capability,expected_version:1,document:value});check('versioned update succeeds',update.ok);
 const current=await rpc('read_shared',{share_token:shareToken});check('share reads current state',(await current.json()).value.boards[0].columns[0].items[0].text==='Latest version');
 const revoke=await rpc('share_notebook',{capability,revoke_token:shareToken});check('revocation succeeds',revoke.ok);
 check('revoked view rejected',!(await rpc('read_shared',{share_token:shareToken})).ok);
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/prototype-live.json',JSON.stringify({mode:'real external HTTP; separate non-sensitive prototype database',checks,cdnConfirmationPresent:confirmation,completeBrowserNavigationVerified:false},null,2));
}catch{
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/prototype-live.json',JSON.stringify({mode:'real external HTTP attempted',failedPhase:phase,checks,passed:false},null,2));
 // Do not log raw provider bodies or the request objects, which contain capabilities.
 throw new Error('Live prototype smoke failed at '+phase+'; see the redacted report.');
}
