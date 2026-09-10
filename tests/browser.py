"""Browser checks. --harness runs HTML modules with a real HTTP transport bridge.
The harness is only for restricted runners where Chromium blocks localhost navigation.
It does NOT test native browser cookie/OAuth redirects; use normal mode for that.
"""
from pathlib import Path
from functools import lru_cache
from urllib.request import build_opener, HTTPCookieProcessor, Request
from urllib.error import HTTPError
from http.cookiejar import CookieJar
from urllib.parse import urlparse
import base64, json, os, re, sys, time
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('TEST_ORIGIN', 'http://127.0.0.1:5173')
HARNESS = '--harness' in sys.argv
OUT = ROOT / 'docs' / 'screenshots'
OUT.mkdir(parents=True, exist_ok=True)
@lru_cache(None)
def module_url(path):
    path = Path(path).resolve()
    source = path.read_text()
    def sub(m):
        rel = m[1]
        target = ROOT / rel[1:] if rel.startswith('/') else path.parent / rel
        return 'from ' + json.dumps(module_url(str(target)))
    source = re.sub(r"from\s+['\"]([^'\"]+)['\"]", sub, source)
    return 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()

def mount(page, type_site=False):
    if not HARNESS:
        page.goto(BASE if not type_site else BASE.replace(':5173', ':5174'), wait_until='networkidle')
        return
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    def bridge(source, payload):
        path = payload['path']
        if path.startswith(BASE):
            path = path[len(BASE):]
        if not (path.startswith('/api/') or path == '/placeholder.svg'):
            raise ValueError('The test bridge only serves this local application.')
        data = payload.get('body')
        req = Request(BASE + path, data=data.encode() if data else None, method=payload.get('method', 'GET'), headers={'Origin': BASE, 'Content-Type': 'application/json'})
        try:
            response = opener.open(req, timeout=90)
        except HTTPError as exc:
            response = exc
        raw = response.read()
        return {'status': response.status, 'headers': dict(response.headers), 'body': raw.decode('utf8', errors='replace'), 'b64': base64.b64encode(raw).decode()}
    page.expose_binding('__transport', bridge)
    source = (ROOT / 'apps' / ('type-site' if type_site else 'board') / 'index.html').read_text()
    css = (ROOT / 'apps' / ('type-site' if type_site else 'board') / 'style.css').read_text()
    source = re.sub(r'<link rel="stylesheet"[^>]*>', '<style>'+css+'</style>', source)
    source = re.sub(r'<script type="module"[^>]*></script>', '', source)
    page.set_content(source)
    page.evaluate("""() => {
      history.replaceState = (...args) => { window.__lastNavigation = args[2]; };
      window.fetch = async (url, options={}) => {
        const r = await window.__transport({path:String(url),method:options.method||'GET',body:options.body});
        return new Response(Uint8Array.from(atob(r.b64), c=>c.charCodeAt(0)),{status:r.status,headers:r.headers});
      };
      const resolveImages = () => document.querySelectorAll('img').forEach(img => {
        const src=img.getAttribute('src');
        if(!src || src.startsWith('data:') || img.dataset.resolving===src) return;
        img.dataset.resolving=src;
        window.__transport({path:src}).then(r=>{
          if(r.status!==200)return;
          const mime=r.headers['Content-Type']||r.headers['content-type']||'image/png';
          img.setAttribute('src','data:'+mime+';base64,'+r.b64);
        }).catch(()=>{});
      });
      new MutationObserver(resolveImages).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
    }""")
    page.add_script_tag(type='module', url=module_url(str(ROOT/'apps'/('type-site' if type_site else 'board')/('type.mjs' if type_site else 'app.mjs'))))
    page.wait_for_timeout(400)

if __name__ == '__main__':
    report = {'mode':'HTML harness + real local HTTP API' if HARNESS else 'native browser navigation','checks':[],'errors':[]}
    def check(name, condition):
        assert condition, name
        report['checks'].append(name)
    with sync_playwright() as p:
        opts = {'headless':True, 'args':['--no-sandbox','--disable-dev-shm-usage']}
        if os.environ.get('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
        browser = p.chromium.launch(**opts)
        page=browser.new_page(viewport={'width':1448,'height':1086},device_scale_factor=1)
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        mount(page)
        page.get_by_role('button',name='Open local test workspace').click()
        page.wait_for_selector('.paper')
        page.wait_for_timeout(1000)
        check('15 seed tasks', page.locator('.task').count()==15)
        check('No app header or brand', page.locator('header').count()==0 and page.get_by_text('Scriptboard',exact=True).count()==0)
        check('Avatars are images',page.locator('img.avatar').count()>0)
        check('Desktop canvas fits viewport',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        page.mouse.move(1,1);page.wait_for_timeout(250)
        page.screenshot(path=str(OUT/'board-desktop.png'),full_page=True)
        if '--smoke' not in sys.argv:
            row=page.locator('#item-p2')
            row.hover();page.wait_for_timeout(230)
            check('Assignee circle appears on hover',float(row.locator('.add-person').evaluate('(el)=>getComputedStyle(el).opacity'))>.1)
            bounds=row.locator('.task-text').bounding_box();avatar=row.locator('.task-actions').bounding_box()
            check('Avatar is right of text',avatar['x']>=bounds['x']+bounds['width']-1)
            row.locator('[data-done]').click();page.wait_for_timeout(900)
            check('Completion toggles', 'done' in row.get_attribute('class'))
            row.locator('[data-done]').click();page.wait_for_timeout(900)
            editor=page.locator('#item-p2 [data-edit]')
            editor.click();editor.fill('Finish and test billing carefully');page.keyboard.press('Enter');page.wait_for_timeout(900)
            check('Inline text editing saves',page.locator('#item-p2 .task-text').inner_text()=='Finish and test billing carefully')
            editor.click();editor.fill('Finish and test billing');page.keyboard.press('Enter');page.wait_for_timeout(900)
            editor.click();editor.fill('Replace PNGs with Lottie animations');page.wait_for_timeout(1000)
            check('Duplicate dropdown appears while typing',page.get_by_text('Possible text duplicate',exact=True).count()==1)
            page.keyboard.press('Escape');page.wait_for_timeout(200)
            editor.click();editor.fill('Finish and test billing @Ni');page.wait_for_timeout(250)
            check('Mention popup filters people',page.locator('.mentions [data-pick="niko"]').count()==1)
            page.keyboard.press('Enter');page.wait_for_timeout(900)
            check('Confirmed mention becomes right-side image',page.locator('#item-p2 [data-person="niko"] img').count()==1 and '@Ni' not in page.locator('#item-p2 .task-text').inner_text())
            row.hover();row.locator('[data-assign]').last.click();page.locator('[data-pick="niko"]').click();page.wait_for_timeout(900)
            check('Assignee can be removed without changing text',page.locator('#item-p2 [data-person="niko"]').count()==0)
            page.get_by_role('button',name='Search workspace').click()
            page.get_by_role('searchbox').fill('billing');page.wait_for_timeout(1000)
            check('Workspace search finds billing',page.locator('.search-hit').count()>0)
            page.keyboard.press('Escape')
            page.locator('#item-p2 [data-person]').click()
            check('Person tasks show page and column',page.locator('.dialog').get_by_text('Product roadmap / Product',exact=True).count()>0)
            page.keyboard.press('Escape')
            page.locator('#item-p2 [data-item-menu]').click();page.get_by_role('button',name='Share this item',exact=True).click()
            page.get_by_role('button',name='Create view link',exact=True).click();page.wait_for_selector('#share-url',timeout=30000)
            check('Share URL is a short capability', '/s/' in page.locator('#share-url').input_value() and len(page.locator('#share-url').input_value())<150)
            page.wait_for_timeout(500);page.screenshot(path=str(OUT/'share-dialog.png'))
            page.get_by_role('button',name='Revoke',exact=True).click();page.wait_for_timeout(300)
            check('Share revocation',page.get_by_text('Link revoked.',exact=True).count()==1)
            page.keyboard.press('Escape')
        for width in [393,700,768,1100]:
            page.set_viewport_size({'width':width,'height':852});page.wait_for_timeout(250)
            check(f'No page overflow at {width}px',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            if width==393:
                page.evaluate('document.activeElement?.blur()');page.mouse.move(1,1);page.wait_for_timeout(250)
                page.screenshot(path=str(OUT/'board-mobile.png'),full_page=True)
                page.screenshot(path=str(OUT/'board-mobile-viewport.png'))
        type_page=browser.new_page(viewport={'width':1448,'height':1086},device_scale_factor=1)
        type_page.on('pageerror',lambda e:report['errors'].append(str(e)))
        mount(type_page,True);type_page.wait_for_timeout(500)
        type_page.locator('#weight').fill('800');type_page.locator('#width').fill('115')
        check('Separate font site axes work','800' in type_page.locator('.editable').evaluate('(el)=>getComputedStyle(el).fontVariationSettings'))
        type_page.screenshot(path=str(OUT/'type-site.png'),full_page=True)
        check('No uncaught client exceptions',len(report['errors'])==0)
        browser.close()
    (ROOT/'docs'/'browser-verification.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
