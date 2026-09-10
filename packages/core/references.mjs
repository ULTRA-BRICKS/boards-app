/** Parse references without treating arbitrary pasted URLs as trusted API endpoints. */
export function references(text,repo=''){
 const found=[],occupied=[];const add=(start,end,data)=>{if(occupied.some(([a,b])=>start<b&&end>a))return;occupied.push([start,end]);found.push({start,end,...data})};
 for(const m of String(text).matchAll(/https:\/\/(?:github\.com\/[^\s<>]+|linear\.app\/[^\s<>]+)/g)){
  const raw=m[0].replace(/[.,;!?)}\]]+$/,'');let u;try{u=new URL(raw)}catch{continue}
  if(u.hostname==='github.com'){const p=/^\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)(?:\/|$)/.exec(u.pathname);if(p)add(m.index,m.index+raw.length,{provider:'github',repo:p[1]+'/'+p[2],number:Number(p[4]),kind:p[3]==='pull'?'pr':'issue',label:`${p[1]}/${p[2]}#${p[4]}`,url:`https://github.com/${p[1]}/${p[2]}/${p[3]}/${p[4]}`})}
  else{const p=/\/issue\/([A-Z][A-Z0-9]*-\d+)(?:\/|$)/i.exec(u.pathname);if(p)add(m.index,m.index+raw.length,{provider:'linear',kind:'issue',identifier:p[1].toUpperCase(),label:p[1].toUpperCase(),url:u.origin+u.pathname})}
 }
 for(const m of String(text).matchAll(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/g))add(m.index,m.index+m[0].length,{provider:'github',repo:m[1],number:Number(m[2]),kind:'issue',label:m[0],url:`https://github.com/${m[1]}/issues/${m[2]}`});
 for(const m of String(text).matchAll(/\b[A-Z][A-Z0-9]{1,12}-\d+\b/g))add(m.index,m.index+m[0].length,{provider:'linear',kind:'issue',identifier:m[0],label:m[0],url:''});
 if(/^[\w.-]+\/[\w.-]+$/.test(repo))for(const m of String(text).matchAll(/(?:^|\s)(?:(PR|pull request)\s*)?#(\d+)\b/gi)){const start=m.index+(m[0].startsWith(' ')?1:0);add(start,m.index+m[0].length,{provider:'github',repo,number:Number(m[2]),kind:m[1]?'pr':'issue',label:m[0].trim(),url:`https://github.com/${repo}/${m[1]?'pull':'issues'}/${m[2]}`})}
 return found.sort((a,b)=>a.start-b.start);
}
export function referenceKey(r){return r.provider==='github'?`github:${r.repo}:${r.number}`:`linear:${r.identifier}`}
