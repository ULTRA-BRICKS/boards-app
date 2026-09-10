/** Publish this repository's board app. Vercel credentials stay with Vercel CLI. */
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {configuration} from '../server/app.mjs';
let env={...process.env};try{env={...env,...parseEnv(await readFile('.env.local','utf8'))}}catch{}
if(!configuration({...env,LOCAL_TEST_MODE:'0'}).ready)throw Error('Run npm run setup first. Database, origin, owner email and a login provider are required.');
if(!/^https:\/\//.test(env.APP_ORIGIN))throw Error('Set APP_ORIGIN to your final HTTPS domain before deploying. OAuth callbacks must use that domain.');
const run=(args,input)=>{const r=spawnSync('npx',['--yes','vercel@latest',...args],{encoding:'utf8',stdio:input?['pipe','inherit','inherit']:'inherit',input,env:process.env});if(r.status!==0)throw Error('Vercel command failed: '+args.slice(0,2).join(' '))};
run(['link','--yes','--project','boards-app']);
const keys=(await readFile('.env.example','utf8')).split('\n').map(s=>s.split('=')[0]).filter(k=>k&&!k.startsWith('#')&&!['LOCAL_TEST_MODE','LOCAL_DATABASE_PATH'].includes(k));
for(const key of keys)if(env[key])run(['env','add',key,'production','--force'],env[key]+'\n');
run(['--prod']);
console.log('Deployment command completed. Verify /api/status, sign-in and a save/reload before sharing the URL.');
