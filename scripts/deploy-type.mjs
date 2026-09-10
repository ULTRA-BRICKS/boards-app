/** Independent static site; never deploy the board API or copy its environment. */
import {spawnSync} from 'node:child_process';
const build=spawnSync(process.execPath,['scripts/build.mjs','--type'],{stdio:'inherit'});
if(build.status!==0)process.exit(build.status||1);
const deploy=spawnSync('npx',['--yes','vercel@latest','--cwd','dist/type-site','--prod'],{stdio:'inherit'});
process.exit(deploy.status||0);
