"""Native WebKit/touch smoke; simulated viewport is not a physical iPhone test."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
base=os.environ.get('TEST_ORIGIN','http://127.0.0.1:5173')
checks=[]
def check(name,value):
 assert value,name
 checks.append(name)
with sync_playwright() as p:
 browser=p.webkit.launch(headless=True)
 context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base,wait_until='networkidle');page.get_by_role('button',name='Open local test workspace').tap();page.wait_for_selector('.paper')
 check('WebKit uses the custom variable font',page.evaluate("document.fonts.check('450 24px \"Conloca Sans\"')"))
 for width in [320,390]:
  page.set_viewport_size({'width':width,'height':844});page.wait_for_timeout(150)
  check(f'No page overflow on touch viewport {width}px',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 page.locator('[data-column-jump="product"]').tap();page.wait_for_timeout(450)
 check('Column navigation works by tapping',page.locator('#column-product').bounding_box()['y']<150)
 row=page.locator('#item-p2');row.locator('.task-text').tap();row.locator('.task-text').fill('Проверить оплату на телефоне');page.keyboard.press('Enter');page.wait_for_timeout(1000)
 page.reload(wait_until='networkidle');page.wait_for_selector('.paper')
 check('WebKit saves Cyrillic and restores a cookie-backed session',page.locator('#item-p2 .task-text').inner_text()=='Проверить оплату на телефоне')
 row.locator('.task-text').tap();row.locator('.task-text').fill('Finish and test billing');page.keyboard.press('Enter');page.wait_for_timeout(900)
 row.locator('.add-person').tap();page.locator('[data-pick="niko"]').tap();page.wait_for_timeout(850)
 check('Touch assignment renders a right-side image',page.locator('#item-p2 [data-person="niko"] img').count()==1)
 row.locator('.add-person').tap();page.locator('[data-pick="niko"]').tap();page.wait_for_timeout(850)
 check('No uncaught WebKit errors',not errors)
 context.close();browser.close()
report={'mode':'native WebKit with simulated touch viewport; not a physical iOS device','checks':checks,'errors':errors}
(ROOT/'test-results').mkdir(exist_ok=True);(ROOT/'test-results/mobile-webkit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
