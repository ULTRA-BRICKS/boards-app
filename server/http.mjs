import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
export const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const hash=s=>createHash('sha256').update(String(s)).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
export const equal=(a,b)=>timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function origin(env){if(!env.APP_ORIGIN)throw fail('APP_ORIGIN must be configured.',503);const u=new URL(env.APP_ORIGIN);if(u.pathname!=='/'||u.search||u.hash||u.username||u.password||!['http:','https:'].includes(u.protocol))throw fail('Invalid APP_ORIGIN',503);if(u.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw fail('HTTPS is required.',503);return u.origin}
export function sameOrigin(req,env){if(req.headers.origin!==origin(env)||req.headers['sec-fetch-site']==='cross-site')throw fail('Invalid request origin.',403)}
export const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split(/=(.*)/s)).filter(s=>s[0]));
export function cookie(res,name,value,env,{maxAge=3600,sameSite='Lax'}={}){const v=`${name}=${value}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${maxAge}${origin(env).startsWith('https:')?'; Secure':''}`;const old=res.getHeader?.('Set-Cookie');res.setHeader('Set-Cookie',old?[...Array.isArray(old)?old:[old],v]:v)}
export function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data))}
export function redirect(res,url){res.statusCode=303;res.setHeader('Location',url);res.setHeader('Cache-Control','no-store');res.end()}
export async function body(req,limit=2400000){if(!/^application\/json\b/.test(req.headers['content-type']||''))throw fail('JSON required',415);const s=await rawBody(req,limit);try{return JSON.parse(s)}catch{throw fail('Invalid JSON')}}
export async function rawBody(req,limit=2400000){if(req.body!==undefined){const s=Buffer.isBuffer(req.body)?req.body.toString('utf8'):typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(s)>limit)throw fail('Payload too large',413);return s}let s='';for await(const c of req){s+=c;if(Buffer.byteLength(s)>limit)throw fail('Payload too large',413)}return s}
export async function fetchJSON(url,options={}){const r=await fetch(url,{signal:AbortSignal.timeout(15000),...options});if(!r.ok)throw fail(`Provider returned HTTP ${r.status}`,502);const data=await r.json();if(data.ok===false||data.success===false||(Array.isArray(data.errors)?data.errors.length>0:!!data.errors))throw fail('Provider rejected the request. Check integration permissions.',502);return data}
export function headers(res){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()')}
