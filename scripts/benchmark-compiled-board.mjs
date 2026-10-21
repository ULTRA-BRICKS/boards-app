import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openSync, closeSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { loadavg, cpus } from 'node:os';
import { chromium, webkit, firefox } from 'playwright';
const engineName = process.env.BENCH_ENGINE ?? 'chromium';
const engine = { chromium, webkit, firefox }[engineName];
assert(engine, 'Unknown browser engine');
const port = Number(process.env.BENCH_PORT ?? 6982),
  base = 'http://127.0.0.1:' + port;
const output = resolve(process.env.BENCH_EVIDENCE ?? 'test-results/compiled-board');
mkdirSync(output, { recursive: true });
const counts = (process.env.BENCH_COUNTS ?? '1,30,1200,10000').split(',').map(Number);
assert(counts.every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 10000));
const trials = Number(process.env.BENCH_TRIALS ?? 7);
assert(Number.isSafeInteger(trials) && trials >= 3 && trials <= 17);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const artifactRoot = resolve('dist/specialized-test');
const variants = ['baseline', 'state-lib'].map((name) => ({
  name,
  root: artifactRoot + '-' + name,
  sha256: hash(readFileSync(artifactRoot + '-' + name + '/app.js')),
}));
const log = openSync(output + '/server.log', 'w');
const server = spawn(process.execPath, ['scripts/dev.mjs'], {
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LOCAL_TEST_MODE: '1',
    LOCAL_DATABASE_PATH: ':memory:',
    PORT: String(port),
    APP_ORIGIN: base,
    AUTH_SECRET: 'local-benchmark-fixture',
  },
  stdio: ['ignore', log, log],
});
let browser;
const raw = [],
  startLoad = loadavg();
try {
  for (let n = 0; ; n++) {
    try {
      if ((await fetch(base + '/api/status')).ok) break;
    } catch {}
    if (n >= 100) throw Error('Synthetic API did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await engine.launch();
  for (const count of counts) {
    for (let trial = -1; trial < trials; trial++)
      for (const variant of trial % 2 ? [...variants].reverse() : variants) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
          page = await context.newPage(),
          errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route(base + '/**', (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path.startsWith('/api/')) return route.continue();
          const file = resolve(variant.root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
          if (!file.startsWith(variant.root + sep) || !existsSync(file))
            return route.fulfill({ status: 404, body: 'Not a compiled asset' });
          const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
          return route.fulfill({
            status: 200,
            contentType: types[extname(file)] ?? 'application/octet-stream',
            body: readFileSync(file),
          });
        });
        await page.addInitScript(() => {
          window.__interactionSamples = [];
          let current = null,
            structure = false;
          const observer = new MutationObserver((records) => {
            if (!current || !structure) return;
            for (const record of records) {
              for (const node of record.addedNodes)
                if (node instanceof Element)
                  current.addedRows += (node.matches('.task') ? 1 : 0) + node.querySelectorAll('.task').length;
              for (const node of record.removedNodes)
                if (node instanceof Element)
                  current.removedRows += (node.matches('.task') ? 1 : 0) + node.querySelectorAll('.task').length;
            }
          });
          window.__observeOneInteraction = () => {
            structure = true;
            observer.observe(document, { childList: true, subtree: true });
          };
          document.addEventListener(
            'click',
            (event) => {
              const button = event.target.closest?.('.task-check');
              if (!button) return;
              const row = button.closest('[data-item]'),
                id = row.dataset.item,
                expected = button.getAttribute('aria-pressed') !== 'true';
              const sample = {
                start: performance.now(),
                trusted: event.isTrusted,
                diagnostic: structure,
                id,
                expected,
                addedRows: structure ? 0 : null,
                removedRows: structure ? 0 : null,
              };
              current = sample;
              requestAnimationFrame(() => {
                sample.nextFrameMs = performance.now() - sample.start;
                sample.correct =
                  document.querySelector(`#item-${CSS.escape(id)} .task-check`)?.getAttribute('aria-pressed') ===
                  String(expected);
                window.__interactionSamples.push(sample);
                if (structure) {
                  observer.disconnect();
                  structure = false;
                }
                current = null;
              });
            },
            true,
          );
          // Trusted event dispatch may drain microtasks between listeners. Measure after
          // application bubbling, not in a microtask queued by the capture listener.
          window.addEventListener('click', () => {
            if (!current) return;
            current.handlerMs = performance.now() - current.start;
            current.committedAtHandlerEnd =
              document
                .getElementById('item-' + current.id)
                ?.querySelector('.task-check')
                ?.getAttribute('aria-pressed') === String(current.expected);
          });
        });
        await page.goto(base);
        await page.getByRole('button', { name: 'Open local test workspace', exact: true }).click();
        await page.locator('.paper').waitFor();
        const old = await (await page.request.get(base + '/api/state')).json(),
          document = structuredClone(old.value),
          board = document.boards[0],
          column = board.columns[0];
        // Respect the unchanged product limits: 200 rows/column, 1200 rows/board.
        document.boards = Array.from({ length: Math.ceil(count / 1200) }, (_, bi) => {
          const size = Math.min(1200, count - bi * 1200);
          return {
            ...board,
            id: bi ? 'measured-board-' + bi : board.id,
            columns: Array.from({ length: Math.ceil(size / 200) }, (_, ci) => ({
              ...column,
              id: 'measured-' + bi + '-' + ci,
              title: 'Measured ' + ci,
              items: Array.from({ length: Math.min(200, size - ci * 200) }, (_, i) => ({
                id: 'measured-' + (bi * 1200 + ci * 200 + i),
                text: 'Synthetic task ' + (bi * 1200 + ci * 200 + i),
                tag: '',
                done: false,
                assignees: [],
              })),
            })),
          };
        });
        const seed = await page.request.put(base + '/api/state', {
          headers: { Origin: base },
          data: { version: old.version, value: document },
        });
        assert.equal(seed.status(), 200, await seed.text());
        await page.reload();
        await page.locator('.paper').waitFor();
        assert.equal(await page.locator('.task').count(), Math.min(count, 1200));
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('html').getAttribute('data-document-backend'), variant.name);
        await page.evaluate(() => window.__observeOneInteraction());
        await page.locator('.task-check').first().click();
        await page.waitForFunction(() => window.__interactionSamples.length === 1);
        const structure = await page.evaluate(() => window.__interactionSamples[0]);
        assert.equal(structure.addedRows, variant.name === 'baseline' ? Math.min(count, 1200) : 0);
        await page.locator('.task-check').first().click();
        await page.waitForFunction(() => window.__interactionSamples.length === 2);
        await page.evaluate(() => {
          window.__interactionSamples = [];
        });
        for (let i = 0; i < 6; i++) {
          await page.locator('.task-check').first().click();
          await page.waitForFunction((n) => window.__interactionSamples.length > n, i);
        }
        await page.waitForFunction(() => document.querySelector('.save-state')?.textContent === '');
        const samples = await page.evaluate(() => window.__interactionSamples);
        assert(
          samples.every(
            (x) => x.correct && x.trusted && x.committedAtHandlerEnd && Number.isFinite(x.handlerMs) && !x.diagnostic,
          ),
        );
        const stored = await (await page.request.get(base + '/api/state')).json();
        assert.equal(stored.value.boards[0].columns[0].items[0].done, false);
        let heap = null;
        if (engineName === 'chromium') {
          const cdp = await context.newCDPSession(page);
          await cdp.send('HeapProfiler.collectGarbage');
          heap = await cdp.send('Runtime.getHeapUsage');
        }
        assert.deepEqual(errors, []);
        if (trial >= 0)
          raw.push({
            backend: variant.name,
            count,
            visibleRows: Math.min(count, 1200),
            trial,
            structure,
            samples,
            usedHeapBytes: heap?.usedSize ?? null,
            load: loadavg(),
          });
        await context.close();
      }
    console.log('Measured real trusted clicks', count, 'rows');
  }
  const quantile = (values, q) =>
    [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)];
  const summary = [];
  for (const count of counts)
    for (const { name } of variants) {
      const group = raw.filter((x) => x.count === count && x.backend === name),
        samples = group.flatMap((x) => x.samples);
      summary.push({
        count,
        visibleRows: Math.min(count, 1200),
        backend: name,
        pages: group.length,
        events: samples.length,
        handlerMedianMs: quantile(
          samples.map((x) => x.handlerMs),
          0.5,
        ),
        handlerP95Ms: quantile(
          samples.map((x) => x.handlerMs),
          0.95,
        ),
        nextFrameMedianMs: quantile(
          samples.map((x) => x.nextFrameMs),
          0.5,
        ),
        nextFrameP95Ms: quantile(
          samples.map((x) => x.nextFrameMs),
          0.95,
        ),
        rowsRecreatedPerDiagnostic: quantile(
          group.map((x) => x.structure.addedRows),
          0.5,
        ),
        heapMedianBytes:
          engineName === 'chromium'
            ? quantile(
                group.map((x) => x.usedHeapBytes),
                0.5,
              )
            : null,
      });
    }
  for (const variant of variants)
    assert.equal(hash(readFileSync(variant.root + '/app.js')), variant.sha256, 'Build changed during measurement');
  writeFileSync(
    output + '/results.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        node: process.version,
        engine: engineName,
        browser: browser.version(),
        logicalCPUs: cpus().length,
        startLoad,
        endLoad: loadavg(),
        variants,
        method:
          'Equal fixed compiled entries, trusted Playwright clicks, actual synthetic local API saves. One warmup page plus recorded independent pages per size/backend; alternating order. One independent diagnostic click counts recreated task rows; the MutationObserver is disconnected for all numerical timing clicks.',
        limits: [
          'Product limits are unchanged: 200 rows per column and 1200 visible rows per board; the 10000-row workload includes other boards in the same document.',
          'Static files fulfilled from exact build artifacts; this is not network download timing.',
          'Handler is measured in a window bubble listener after the app, with committed-output assertion; next animation frame is not field INP or painted-frame completion.',
          'Chromium-only heap is retained JavaScript after explicit GC, not peak/native DOM memory; other engines report no heap number.',
          'Concurrent host load is recorded; no cross-device or universal tail guarantee.',
        ],
        summary,
        raw,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(summary));
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  closeSync(log);
}
