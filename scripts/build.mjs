import {mkdir,copyFile,rm,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PLACEHOLDER} from '../server/assets.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);const onlyType=process.argv.includes('--type'),out=onlyType?'dist/type-site':'dist/board';await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});for(const file of onlyType?['index.html','style.css','type.mjs']:['index.html','style.css','app.mjs','boot.mjs','refinements.css','photo-review.mjs'])await copyFile(`${onlyType?'apps/type-site':'apps/board'}/${file}`,`${out}/${file}`);for(const pkg of onlyType?['font']:['font','core']){await mkdir(`${out}/packages/${pkg}`,{recursive:true});const files=pkg==='font'?['font.mjs','glyphs.mjs']:['model.mjs','workspace.mjs','sync.mjs','art.mjs','references.mjs','assignees.mjs','workspace-loader.mjs'];for(const file of files)await copyFile(`packages/${pkg}/${file}`,`${out}/packages/${pkg}/${file}`)}if(!onlyType)await writeFile(out+'/placeholder.svg',PLACEHOLDER);

if(!onlyType){await mkdir(out+'/packages/state-lib/dist',{recursive:true});for(const file of ['index.js','core.js','latest-task.js','external-store.js'])await copyFile('packages/state-lib/dist/'+file,out+'/packages/state-lib/dist/'+file);}

console.log(`Built ${out}. No font binaries, credentials or workspace data copied.`);
