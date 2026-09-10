/** A portable static import for hosts that accept one HTML file. No font bytes or board data. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFile(resolve(root,path),'utf8');
const sources=await Promise.all(['packages/font/glyphs.mjs','packages/font/font.mjs','apps/type-site/type.mjs'].map(read));
const js=sources.map(source=>source.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'')).join('\n');
const awaitCSS=await read('apps/type-site/style.css');
let html=await read('apps/type-site/index.html');
html=html.replace('<link rel="stylesheet" href="/style.css">',()=>'<style>'+typeEscape(awaitCSS)+'</style>');
function typeEscape(s){return s.replace(/<\/style/gi,'<\\/style')}
html=html.replace('<script type="module" src="/type.mjs"></script>',()=>'<script type="module">'+js.replace(/<\/script/gi,'<\\/script')+'</script>');
await mkdir(resolve(root,'dist/type-standalone'),{recursive:true});
await writeFile(resolve(root,'dist/type-standalone/index.html'),html);
console.log('Bundled independent type site: no network, credentials or prebuilt font files.');
