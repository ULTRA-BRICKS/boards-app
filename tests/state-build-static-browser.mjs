// Loads the STATIC dist/board-baseline and dist/board-state output in a real browser and proves
// that ?stateBackend= cannot flip the frozen build config (HYP-1490). No API, database or
// credentials: the files are served by a throwaway loopback file server on an ephemeral port;
// the app picks its backend at module load, before any API call.
//   npm run build:baseline && npm run build:state && node tests/state-build-static-browser.mjs
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';
import {chromium} from 'playwright';

const types = {'.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json'};
function serve(dir) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root + '/') && file !== root) { res.writeHead(403).end(); return; }
    try { const body = await readFile(file); res.writeHead(200, {'content-type': types[extname(file)] ?? 'application/octet-stream'}).end(body); }
    catch { res.writeHead(404).end('{}'); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({server, base: `http://127.0.0.1:${server.address().port}`})));
}

const asks = ['', '?stateBackend=baseline', '?stateBackend=state-lib', '?stateBackend=state-lib-cow', '?stateBackend=nonsense'];
const browser = await chromium.launch();
const results = [];
try {
  for (const [backend, dir] of [['baseline', 'dist/board-baseline'], ['state-lib', 'dist/board-state']]) {
    const {server, base} = await serve(dir);
    try {
      for (const ask of asks) {
        const page = await browser.newPage();
        await page.goto(`${base}/${ask}`);
        await page.waitForFunction(() => document.documentElement.dataset.documentBackend, null, {timeout: 10000});
        const chosen = await page.locator('html').getAttribute('data-document-backend');
        assert.equal(chosen, backend, `${dir} with "${ask}" must stay on ${backend}, got ${chosen}`);
        await page.close();
        results.push(`PASS ${dir} ${ask || '(no query)'} -> ${chosen}`);
      }
    } finally { server.close(); }
  }
} finally { await browser.close(); }
console.log(results.join('\n'));
