/** Publish the independent static font site, even without Git or a board deployment. */
import {mkdtemp,cp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCommand,staticDeploymentEnvironment,typeProject,staticConfig} from './deployment.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project=typeProject(),env=staticDeploymentEnvironment();
runCommand(process.execPath,['scripts/build.mjs','--type'],{cwd:root,env});
// Outside the repository: parent .vercel, .env.local and board API cannot be inferred/uploaded.
const stage=await mkdtemp(join(tmpdir(),'boards-type-'));
try {
 await cp(join(root,'dist/type-site'),stage,{recursive:true});
 await writeFile(join(stage,'vercel.json'),JSON.stringify(staticConfig,null,2)+'\n');
 runCommand('npx',['--yes','vercel@latest','link','--cwd',stage,'--yes','--project',project],{env});
 runCommand('npx',['--yes','vercel@latest','deploy','--cwd',stage,'--prod'],{env});
 console.log('Static deployment command finished. Check its returned URL before considering it published.');
} finally {
 await rm(stage,{recursive:true,force:true});
}
