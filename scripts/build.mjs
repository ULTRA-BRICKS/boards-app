// Static board/type-site build. Usage:
//   node scripts/build.mjs [--type] [--state-backend=baseline|state-lib] [--out=dist/<dir>]
// BOARDS_STATE_BACKEND is the env equivalent of --state-backend (CLI wins).
// An explicit backend writes a state-config.mjs the URL cannot override.
import {mkdir,copyFile,rm,writeFile} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PLACEHOLDER} from '../server/assets.mjs';
import {compileBoard} from './compile-board.mjs';
import {assertStateBackend,renderStateConfig} from './state-config-source.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);

const BOARD_FILES=['index.html','style.css','app.mjs','boot.mjs','refinements.css','photo-review.mjs','state-config.mjs','board-state.mjs','board-commands.mjs','document-action.mjs','board-row-view.mjs'];
const TYPE_FILES=['index.html','style.css','type.mjs'];
const FONT_FILES=['font.mjs','glyphs.mjs'];
const CORE_FILES=['model.mjs','workspace.mjs','sync.mjs','art.mjs','references.mjs','assignees.mjs','workspace-loader.mjs','document-store.mjs','document-store-baseline.mjs','json-draft.mjs','document-publication.mjs'];
const STATE_LIB_DIST=['index.js','core.js','latest-task.js','external-store.js'];
// Scoped state mechanisms (packages/state-lib/scoped) shipped next to the state-lib dist files.
const STATE_LIB_DOM=['immutable-row-delta.mjs','keyed-row-patch.mjs'];
const STATE_LIB_SCOPED=['scope.mjs','scope-core.mjs','scope-baseline.mjs','debounced-latest.mjs'];

function fail(message){console.error(message);process.exit(2)}
function optionValue(argv,name){const hit=argv.find(a=>a.startsWith(`--${name}=`));return hit===undefined?undefined:hit.slice(name.length+3)}

/** Resolves --out; it must stay strictly inside dist/ because it is wiped first. */
function resolveOut(argv,fallback){
  const requested=optionValue(argv,'out');if(requested===undefined)return fallback;
  const rel=relative(resolve('dist'),resolve(requested));
  if(!requested||!rel||isAbsolute(rel)||rel.split(sep).includes('..'))fail(`Invalid --out ${JSON.stringify(requested)}: must be a directory inside dist/.`);
  return `dist/${rel.split(sep).join('/')}`;
}

/** CLI beats env; an explicitly empty CLI value is invalid, an empty env value is unset. */
function resolveBackend(argv,env){
  const cli=optionValue(argv,'state-backend');
  const value=cli!==undefined?cli:(env.BOARDS_STATE_BACKEND||undefined);
  if(value===undefined)return undefined;
  try{return assertStateBackend(value)}catch(error){return fail(error.message)}
}

async function copyInto(out,from,to){
  await mkdir(dirname(`${out}/${to}`),{recursive:true});
  await copyFile(from,`${out}/${to}`);
}

async function copyBoard(out,backend){
  for(const file of BOARD_FILES)if(!(file==='state-config.mjs'&&backend))await copyInto(out,`apps/board/${file}`,file);
  if(backend)await writeFile(`${out}/state-config.mjs`,renderStateConfig(backend));
  for(const file of STATE_LIB_SCOPED)await copyInto(out,`packages/state-lib/scoped/${file}`,`packages/state-lib/scoped/${file}`);
  for(const file of STATE_LIB_DIST)await copyInto(out,`packages/state-lib/dist/${file}`,`packages/state-lib/dist/${file}`);
  for(const file of STATE_LIB_DOM)await copyInto(out,`packages/state-lib/dom/${file}`,`packages/state-lib/dom/${file}`);
  await writeFile(out+'/placeholder.svg',PLACEHOLDER);
}

async function copyPackages(out,onlyType){
  for(const pkg of onlyType?['font']:['font','core'])
    for(const file of pkg==='font'?FONT_FILES:CORE_FILES)await copyInto(out,`packages/${pkg}/${file}`,`packages/${pkg}/${file}`);
}

async function build(){
  const argv=process.argv.slice(2),onlyType=argv.includes('--type');
  const backend=onlyType?undefined:resolveBackend(argv,process.env);
  const out=resolveOut(argv,onlyType?'dist/type-site':'dist/board');
  if(argv.includes('--compile')&&argv.includes('--bundle-only'))fail('Choose compile or bundle-only, not both');
  if(argv.includes('--compile')||argv.includes('--bundle-only')){
    if(onlyType)fail('The separate type site is not a board state entry');
    if(!backend)fail('Compilation requires an explicit state backend');
    await compileBoard({out,backend,specialize:argv.includes('--compile'),prepare:async stage=>{await copyPackages(stage,false);await copyBoard(stage,backend);}});
    return;
  }
  await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
  for(const file of onlyType?TYPE_FILES:[])await copyInto(out,`apps/type-site/${file}`,file);
  await copyPackages(out,onlyType);
  if(!onlyType)await copyBoard(out,backend);
  console.log(`Built ${out}${backend?` (state backend: ${backend})`:''}. No font binaries, credentials or workspace data copied.`);
}
await build();
