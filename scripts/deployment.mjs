import {spawnSync} from 'node:child_process';

/** Fail on missing CLI, signal termination, and non-zero exit; never report a phantom deploy. */
export function runCommand(command,args,{env=process.env,cwd,spawn=spawnSync,input}={}) {
 const result=spawn(command,args,{cwd,env,input,encoding:'utf8',stdio:input===undefined?'inherit':['pipe','inherit','inherit']});
 if(result.error)throw Error(`Unable to run ${command}: ${result.error.code||'process error'}`);
 if(result.signal||result.status!==0)throw Error(`${command} failed (${result.signal||(result.status??'no exit status')}). No deployment success is assumed.`);
 return result;
}

/** The font deployment must not inherit the board's project ID or application secrets. */
export function staticDeploymentEnvironment(env=process.env) {
 const keys=['PATH','HOME','USER','SHELL','TMPDIR','TEMP','TMP','XDG_CONFIG_HOME','APPDATA','SystemRoot',
  'VERCEL_TOKEN','NEON_API_KEY','CI','NO_COLOR','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','SSL_CERT_FILE','NODE_EXTRA_CA_CERTS'];
 return Object.fromEntries(keys.filter(key=>env[key]!==undefined).map(key=>[key,env[key]]));
}
export function typeProject(env=process.env) {
 const name=env.BOARDS_TYPE_PROJECT||'boards-type';
 if(!/^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/.test(name)||name==='boards-app')
  throw Error('Choose an independent BOARDS_TYPE_PROJECT slug, not the board project.');
 return name;
}
export const staticConfig={version:2,framework:null,buildCommand:null,installCommand:null,outputDirectory:'.'};
