"""Small public-fixture evaluation, not a production benchmark. Model runs locally on CI."""
from pathlib import Path
import json, os, subprocess, time
import numpy as np
from huggingface_hub import model_info
from sentence_transformers import SentenceTransformer
ROOT=Path(__file__).resolve().parents[2]
MODEL=os.environ.get('EVAL_EMBEDDING_MODEL','intfloat/multilingual-e5-base')
revision=model_info(MODEL).sha
encoder=SentenceTransformer(MODEL,revision=revision,trust_remote_code=False,device='cpu')
queries=[
 ('billing problems','p2'),('ошибки оплаты подписки','p2'),('добавить анимации вместо изображений','l1'),
 ('responsive breakpoints','l3'),('адаптация под размеры экрана','l3'),('Puck component definitions','l4'),
 ('микровзаимодействия интерфейса','l5'),('publish blog articles','l6'),('search engine optimization','l7'),
 ('юридические страницы','l8'),('welcome flow for new users','p3'),('подключить аналитику PostHog','p4'),
 ('записать ролик к запуску','m1'),('set up social accounts','m2'),('инструкция по настройке с агентами','m3')]
pairs=[
 ('Finish and test billing','Complete testing of the payment flow',True),
 ('Fix UI inconsistencies','Исправить несоответствия интерфейса',True),
 ('Create a launch video','Создать видео для запуска',True),
 ('Fix responsive breakpoint inconsistencies','Repair layout inconsistencies at screen breakpoints',True),
 ('Finish and test billing','Create social profiles',False),
 ('Create a launch video','Create social profiles',False),
 ('Enable analytics','Disable analytics',False),
 ('Add a legal page to the footer','Remove legal pages from the footer',False)]
docs=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {createWorkspace} from './packages/core/workspace.mjs';import {documents} from './packages/core/search.mjs';console.log(JSON.stringify(documents(createWorkspace())));"],cwd=ROOT))
def encode(texts,prefix):
 return encoder.encode([prefix+t for t in texts],normalize_embeddings=True,convert_to_numpy=True,batch_size=16)
t0=time.perf_counter();dv=encode([d['text'] for d in docs],'passage: ');qv=encode([q for q,_ in queries],'query: ')
elapsed=time.perf_counter()-t0
payload={'docs':docs,'queries':[{'query':q,'expected':target,'vector':v.tolist()} for (q,target),v in zip(queries,qv)],'vectors':{d['id']:v.tolist() for d,v in zip(docs,dv)}}
js="""import {rank} from './packages/core/search.mjs';let raw='';for await(const c of process.stdin)raw+=c;const p=JSON.parse(raw),vectors=new Map(Object.entries(p.vectors));const result=p.queries.map(q=>({query:q.query,expected:q.expected,lexical:rank(q.query,p.docs).map(h=>h.itemId),hybrid:rank(q.query,p.docs,{queryVector:q.vector,vectors}).map(h=>h.itemId)}));console.log(JSON.stringify(result));"""
run=subprocess.run(['node','--input-type=module','-e',js],input=json.dumps(payload),capture_output=True,text=True,cwd=ROOT,check=True)
retrieval=json.loads(run.stdout)
metrics={}
for mode in ['lexical','hybrid']:
 rr=[1/(r[mode].index(r['expected'])+1) if r['expected'] in r[mode][:10] else 0 for r in retrieval]
 metrics[mode]={'recallAt3':sum(r['expected'] in r[mode][:3] for r in retrieval)/len(retrieval),'MRRAt10':sum(rr)/len(rr)}
pv=encode([text for a,b,_ in pairs for text in [a,b]],'query: ')
duplicates=[{'left':a,'right':b,'duplicateLabel':label,'cosine':float(np.dot(pv[i*2],pv[i*2+1])),'suggestedAt088':float(np.dot(pv[i*2],pv[i*2+1]))>=.88} for i,(a,b,label) in enumerate(pairs)]
guard_input=[{'left':r['left'],'right':r['right'],'similarity':r['cosine']} for r in duplicates]
guard_js="""import {opposedActions} from './packages/core/intent.mjs';let raw='';for await(const c of process.stdin)raw+=c;console.log(JSON.stringify(JSON.parse(raw).map(p=>({opposed:opposedActions(p.left,p.right),suggested:p.similarity>=.88&&!opposedActions(p.left,p.right)}))));"""
grun=subprocess.run(['node','--input-type=module','-e',guard_js],input=json.dumps(guard_input),capture_output=True,text=True,cwd=ROOT,check=True)
for record,guard in zip(duplicates,json.loads(grun.stdout)):
 record['opposedActionGuard']=guard['opposed'];record['suggestedWithGuard']=guard['suggested']
report={'model':MODEL,'revision':revision,'dimension':int(dv.shape[1]),'mode':'real downloaded weights; local CPU inference; public sample tasks only','documents':len(docs),'queries':len(queries),'encodingSeconds':elapsed,'metrics':metrics,'results':retrieval,'duplicateExamples':duplicates,'caveats':['Small hand-written smoke corpus, not a statistically representative benchmark.','Cosine is similarity, not probability of duplicate intent. Opposite actions can remain similar.','No provider credentials, private workspace or hosted app were tested.']}
(ROOT/'test-results').mkdir(exist_ok=True)
(ROOT/'test-results/semantic-quality.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:report[k] for k in ['model','revision','dimension','documents','queries','encodingSeconds','metrics','duplicateExamples','caveats']},ensure_ascii=False,indent=2))
if metrics['hybrid']['recallAt3'] < .8:raise SystemExit('Hybrid recall below the smoke-test floor; inspect report before changing thresholds.')
