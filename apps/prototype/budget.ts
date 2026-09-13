import {gzipSync} from 'node:zlib';
import {readdir,mkdir} from 'node:fs/promises';
const root='../../dist/prototype';
const assets=await readdir(root+'/assets');
const report=[];let gzip=0;
for(const file of assets){
  const bytes=await Bun.file(root+'/assets/'+file).bytes();
  const transfer=gzipSync(bytes).byteLength;gzip+=transfer;
  report.push({file,bytes:bytes.byteLength,gzip:transfer});
  if(transfer>45000)throw Error('Single asset exceeds 45 KB gzip: '+file);
}
if(gzip>100000)throw Error('All browser assets exceed 100 KB gzip');
for(const file of await readdir(root,{recursive:true})){
  if(/\.(?:ttf|otf|woff2?|db|sqlite|env)$/.test(file))throw Error('Forbidden static output: '+file);
  if(/people\.json|slack-profiles|\.private|node_modules/.test(file))throw Error('Private/build input in static output: '+file);
}
await mkdir('../../docs/metrics',{recursive:true});
const value={scope:'All board and independent type-site browser assets',gzipBytes:gzip,budget:100000,assets:report};
await Bun.write('../../docs/metrics/prototype-budget.json',JSON.stringify(value,null,2));
console.log(JSON.stringify(value));
