import test from 'node:test';
import assert from 'node:assert/strict';
import {runCommand,staticDeploymentEnvironment,typeProject,staticConfig} from '../scripts/deployment.mjs';

test('deployment fails rather than pretending success when the CLI is missing or killed',()=>{
 for(const result of [{status:null,error:{code:'ENOENT'}},{status:null,signal:'SIGTERM'},{status:1}])
  assert.throws(()=>runCommand('npx',[],{spawn:()=>result}));
 assert.equal(runCommand('npx',[],{spawn:()=>({status:0})}).status,0);
});
test('font deployment does not inherit board credentials or project identity',()=>{
 const env=staticDeploymentEnvironment({PATH:'/bin',HOME:'/home/me',VERCEL_TOKEN:'allowed-auth',VERCEL_PROJECT_ID:'board',VERCEL_ORG_ID:'org',DATABASE_URL:'secret',GITHUB_TOKEN:'secret',RESEND_API_KEY:'secret',LOCAL_TEST_MODE:'1'});
 assert.deepEqual(env,{PATH:'/bin',HOME:'/home/me',VERCEL_TOKEN:'allowed-auth'});
});
test('independent static project has no install/build command and cannot default to boards-app',()=>{
 assert.equal(typeProject({}),'boards-type');assert.throws(()=>typeProject({BOARDS_TYPE_PROJECT:'boards-app'}));
 assert.throws(()=>typeProject({BOARDS_TYPE_PROJECT:'../board'}));assert.equal(staticConfig.installCommand,null);
 assert.equal(staticConfig.buildCommand,null);assert.equal(staticConfig.outputDirectory,'.');
});
