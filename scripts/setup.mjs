/** Local interactive setup. Never put these values in frontend build variables. */
import {createInterface} from 'node:readline/promises';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
const rl=createInterface({input:process.stdin,output:process.stdout});let values={};try{values=parseEnv(await readFile('.env.local','utf8'))}catch{}
async function ask(key,label,def=''){const existing=values[key]||process.env[key]||def;const answer=await rl.question(`${label}${existing?' [configured; Enter to keep]':''}: `);values[key]=answer.trim()||existing}
try{
 console.log('Credentials are saved locally in .env.local (mode 600), never in Git.');
 if(!values.DATABASE_URL&&!process.env.DATABASE_URL){const auto=await rl.question('Use the existing script-board Neon project through your logged-in Neon CLI? [y/N] ');if(/^y/i.test(auto)){const r=spawnSync('npx',['--yes','neonctl@latest','connection-string','--project-id','crimson-hall-13043037','--database-name','scriptboard','--pooled'],{encoding:'utf8',stdio:['inherit','pipe','inherit']});if(r.status!==0)throw Error('Neon CLI did not return a connection. Sign in with npx neonctl auth, then retry.');const value=r.stdout.trim();if(!/^postgres(?:ql)?:\/\//.test(value))throw Error('Neon did not return a PostgreSQL URL.');values.DATABASE_URL=value}}
 await ask('DATABASE_URL','Neon PostgreSQL connection string');await ask('APP_ORIGIN','Public application origin','http://127.0.0.1:5173');await ask('OWNER_EMAIL','Workspace owner email');const mode=(await rl.question('Configure login: google / github / slack / email [github]: ')).trim()||'github';if(mode==='email'){await ask('RESEND_API_KEY','Resend API key');await ask('MAIL_FROM','Verified sender, e.g. Your notebook <hello@example.com>')}else if(['google','github','slack'].includes(mode)){await ask(mode.toUpperCase()+'_CLIENT_ID',mode+' client ID');await ask(mode.toUpperCase()+'_CLIENT_SECRET',mode+' client secret');console.log(`Callback: ${values.APP_ORIGIN}/api/auth/callback?provider=${mode}`)}else throw Error('Unknown login provider.');
 if(/^y/i.test(await rl.question('Configure optional AI drawings and multilingual cloud embeddings? [y/N] '))){await ask('CLOUDFLARE_ACCOUNT_ID','Cloudflare account ID');await ask('CLOUDFLARE_API_TOKEN','Workers AI token');values.EMBEDDING_PROVIDER='cloudflare';values.IMAGE_DAILY_LIMIT||='10'}
 await writeFile('.env.local',Object.entries(values).filter(([,v])=>v).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600});await chmod('.env.local',0o600);console.log('Saved .env.local. Restart the server. Optional provider keys are documented in .env.example.');
}finally{rl.close()}
