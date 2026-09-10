"""Additional review regressions. Local --harness is labelled; CI uses native HTTP."""
import importlib.util, json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('board_browser',ROOT/'tests/browser.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
results=[]
def check(name,value):
 assert value,name
 results.append(name)
with sync_playwright() as p:
 opts={'headless':True,'args':['--no-sandbox']}
 if os.environ.get('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
 browser=p.chromium.launch(**opts)
 page=browser.new_page(viewport={'width':1448,'height':1086});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 base.mount(page)
 page.get_by_role('button',name='Open local test workspace').click();page.wait_for_selector('.paper')
 row=page.locator('#item-p3');row.hover();row.locator('.add-person').click();page.locator('[data-pick="niko"]').click();page.wait_for_timeout(800)
 check('unrelated S hint survives assignment from S/M',row.locator('[data-resolve-hint="S"]').count()==1)
 row.hover();row.locator('.add-person').click();page.locator('[data-pick="niko"]').click();page.wait_for_timeout(800)
 # Emulate a failed in-flight save, then keep typing before its response arrives.
 page.evaluate('''() => { const original=window.fetch;window.__originalFetch=original;window.__failed=false;window.fetch=async (url,options={})=>{if(String(url).endsWith('/api/state')&&options.method==='PUT'&&!window.__failed){window.__failed=true;await new Promise(r=>setTimeout(r,650));return Response.json({error:'Controlled test failure'},{status:503})}return original(url,options)}; }''')
 editor=page.locator('#item-p2 .task-text');editor.click();editor.fill('Committed before failure');page.keyboard.press('Enter');page.wait_for_timeout(600)
 editor.click();editor.fill('Typed while earlier save failed');page.wait_for_timeout(850)
 page.get_by_role('heading',name='Your last edits are not saved').wait_for()
 with page.expect_download() as download:
  page.get_by_role('button',name='Save a backup',exact=True).click()
 backup=json.loads(Path(download.value.path()).read_text())
 text=next(t['text'] for b in backup['boards'] for c in b['columns'] for t in c['items'] if t['id']=='p2')
 check('backup preserves active unsent text when an earlier request fails',text=='Typed while earlier save failed')
 page.evaluate('() => {window.fetch=window.__originalFetch;}');page.get_by_role('button',name='Retry',exact=True).click();page.wait_for_timeout(900)
 current=page.evaluate("async()=>await(await fetch('/api/state')).json()")
 check('retry saves the last draft, not the old failed snapshot',next(t['text'] for b in current['value']['boards'] for c in b['columns'] for t in c['items'] if t['id']=='p2')=='Typed while earlier save failed')
 editor.click();editor.fill('Finish and test billing');page.keyboard.press('Enter');page.wait_for_timeout(800)
 # Closing a search before its network response must not write into a detached modal.
 page.evaluate('''() => { const original=window.fetch;window.__originalFetch=original;window.fetch=async(url,options={})=>{if(String(url).endsWith('/api/search')){await new Promise(r=>setTimeout(r,650));return Response.json({error:'Controlled late search failure'},{status:503})}return original(url,options)}; }''')
 page.get_by_role('button',name='Search workspace').click();page.get_by_role('searchbox').fill('billing');page.wait_for_timeout(400);page.keyboard.press('Escape');page.wait_for_timeout(750)
 check('late search response does not reopen a closed modal',page.get_by_role('dialog').count()==0)
 page.evaluate('() => {window.fetch=window.__originalFetch;}')
 page.get_by_role('button',name='Notebook settings and profile').click();page.get_by_role('button',name='Sign out',exact=True).click();page.get_by_role('heading',name='Come on in.').wait_for()
 page.keyboard.press('Control+k');check('sign-out clears the private workspace and command palette',page.get_by_role('dialog').count()==0 and page.locator('.task').count()==0)
 # Exercise the actual draft-review module on a separate page, without pretending a model ran.
 draft_page=browser.new_page();draft_page.on('pageerror',lambda e:errors.append(str(e)));draft_page.set_content('<main id="draft"></main>')
 module=base.module_url(str(ROOT/'apps/board/photo-review.mjs'))
 draft={'board':{'title':'From photo','columns':[{'id':'col','title':'Launch','items':[{'id':'a','text':'Ship','tag':'D','assignees':[]},{'id':'b','text':'Unclear','tag':'','assignees':[]}]}]},'warnings':['Check the second line']}
 draft_page.evaluate('''async ({url,draft})=>{ const {reviewPhoto}=await import(url);window.__draft=draft;reviewPhoto(document.querySelector('#draft'),draft,{onConfirm:async value=>window.__accepted=value,onError:e=>{throw e}}); }''',{'url':module,'draft':draft})
 draft_page.get_by_label('Page title',exact=True).fill('Reviewed launch')
 draft_page.get_by_label('Thought',exact=True).first.fill('Ship the reviewed app')
 draft_page.get_by_role('checkbox',name='Include this thought').last.uncheck()
 draft_page.get_by_role('checkbox',name='I checked the transcription.',exact=False).check()
 draft_page.get_by_role('button',name='Confirm and add page').click()
 value=draft_page.evaluate('window.__accepted')
 check('photo draft can be reviewed without editing JSON',value['title']=='Reviewed launch' and value['columns'][0]['items'][0]['text']=='Ship the reviewed app' and len(value['columns'][0]['items'])==1)
 check('photo review never assigns an unverified hint to a real identity',value['columns'][0]['items'][0]['tag']=='D' and value['columns'][0]['items'][0]['assignees']==[])
 check('photo review leaves the original transcription untouched',draft_page.evaluate('window.__draft.board.title')=='From photo')
 check('no uncaught client exceptions in regression scenarios',not errors)
 browser.close()
report={'mode':'HTML harness + local HTTP' if base.HARNESS else 'native Chromium HTTP','checks':results,'errors':errors}
(ROOT/'test-results').mkdir(exist_ok=True);(ROOT/'test-results/browser-review.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
