import { createHash } from 'node:crypto';
import { readFile,writeFile,readdir,rm } from 'node:fs/promises';
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
type Change={path:string;base:string;result:string;edits:[number,number,string][]};
for(const name of (await readdir('.delivery')).filter(n=>/^(app|photo|other)\.json$/.test(n)).sort()){
 const changes:Change[]=JSON.parse(await readFile('.delivery/'+name,'utf8'));
 for(const change of changes){
  if(!/^(?:apps\/|packages\/|server\/|scripts\/|tests\/|\.gitignore$|package\.json$|vercel\.json$)/.test(change.path)||change.path.includes('..'))throw Error('Path not allowed');
  const source=await readFile(change.path,'utf8');
  if(sha(source)!==change.base)throw Error('Base changed; refusing to overwrite '+change.path);
  const points=Array.from(source);let boundary=points.length;
  for(const [start,end,text]of [...change.edits].reverse()){
   if(start<0||end<start||end>boundary)throw Error('Invalid edit bounds');
   points.splice(start,end-start,...Array.from(text));boundary=start;
  }
  const result=points.join('');
  if(sha(result)!==change.result)throw Error('Transferred source checksum mismatch: '+change.path);
  await writeFile(change.path,result);
 }
}
await rm('api/index.js',{force:true});
console.log('Source transforms applied with before/after SHA-256 verification.');
