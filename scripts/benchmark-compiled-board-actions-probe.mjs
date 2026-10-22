// In-page measurement probe for scripts/benchmark-compiled-board-actions.mjs, installed with
// page.addInitScript(installProbe, options) before any app code. The synthetic proof in
// tests/benchmark-action-probe-browser.mjs installs this same function, so the boundary it proves is
// the one the matrix measures. It records; it never calls app or store code and never stops,
// cancels or re-dispatches an event.
//
// Probe action-probe-v2 (see PROBE_VERSION and END_BOUNDARIES in the lib):
//  - start: document capture listener on the real trusted event.
//  - end, keydown: a bubble listener on the focused editor element, added by __arm after the app
//    assigned that element's onkeydown. Listeners on one target run in registration order and
//    stopPropagation() in the app handler does not skip it, so this is after the handler returned.
//    Re-assigning onkeydown keeps the handler's original place in that order.
//  - end, click/input: window bubble listener (v1), after delegated app handlers on #app.
//  - a window bubble keydown is still recorded as a diagnostic (windowBubbleMs), never as the end.
// Must stay self-contained: Playwright serialises the function source.
export function installProbe(options) {
  const win = window,
    negative = options?.negative ?? '',
    probeVersion = options?.probeVersion ?? null;
  win.__fetchLog = [];
  win.__pending = 0;
  win.__samples = [];
  const realFetch = win.fetch.bind(win);
  win.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const entry = { url, method: init?.method ?? 'GET', startMs: performance.now(), endMs: null, status: null };
    if (entry.method === 'PUT' && url.includes('/api/state') && typeof init?.body === 'string') entry.body = init.body;
    win.__fetchLog.push(entry);
    win.__pending++;
    return realFetch(input, init).then(
      (response) => {
        entry.endMs = performance.now();
        entry.status = response.status;
        win.__pending--;
        return response;
      },
      (error) => {
        entry.endMs = performance.now();
        entry.error = String(error);
        win.__pending--;
        throw error;
      },
    );
  };
  const rowOf = (id) => document.getElementById('item-' + id);
  const openEditor = () => [...document.querySelectorAll('[contenteditable]')].some((el) => el.isContentEditable);
  const checks = {
    pressed: ({ id, value }) => rowOf(id)?.querySelector('.task-check')?.getAttribute('aria-pressed') === String(value),
    text: ({ id, text, editing, selected, noOpenEditor }) => {
      const row = rowOf(id),
        el = row?.querySelector('.task-text');
      if (!el || el.textContent !== text || el.isContentEditable !== editing) return false;
      if (selected !== undefined && row.classList.contains('selected') !== selected) return false;
      return !noOpenEditor || !openEditor();
    },
    placed: ({ id, column, index }) => {
      const li = rowOf(id);
      if (!li || li.dataset.col !== column) return false;
      const list = [...document.querySelectorAll('#column-' + CSS.escape(column) + ' .task')];
      return (index === -1 ? list.at(-1) : list[index]) === li;
    },
  };
  // Where a sample may end. Negative controls deliberately end too early; the run must then fail.
  const endFor = (spec) =>
    negative === 'early-observer' ? 'document-capture' : negative === 'capture-microtask' ? 'capture-microtask' : spec.boundary;
  let armed = null,
    current = null,
    editorTarget = null;
  const detachEditor = () => {
    editorTarget?.removeEventListener('keydown', onEditorTarget);
    editorTarget = null;
  };
  win.__arm = (spec) => {
    detachEditor();
    armed = { ...spec, appHandlerBeforeProbe: null };
    current = null;
    if (spec.boundary === 'editor-target') {
      const el = document.activeElement;
      armed.appHandlerBeforeProbe = Boolean(el?.isContentEditable) && typeof el.onkeydown === 'function';
      editorTarget = el;
      el?.addEventListener('keydown', onEditorTarget);
    }
  };
  const begin = (event) => {
    if (!armed || current || event.type !== armed.event) return;
    if (armed.key && event.key !== armed.key) return;
    if (armed.selector && !event.target.closest?.(armed.selector)) return;
    const row = event.target.closest?.('[data-item]') ?? document.activeElement?.closest?.('[data-item]');
    current = {
      stage: armed.stage,
      start: performance.now(),
      trusted: event.isTrusted,
      id: row?.dataset.item ?? armed.rowId,
      expectedId: armed.rowId,
      expectAsync: Boolean(armed.awaitSave),
      probeVersion,
      expectedBoundary: armed.boundary,
      appHandlerBeforeProbe: armed.appHandlerBeforeProbe,
      windowBubbleMs: null,
      done: false,
    };
  };
  const finish = (event, where) => {
    if (!armed || !current || current.done || event.type !== armed.endEvent || where !== endFor(armed)) return;
    // Only a keydown end carries a key; an input end never does.
    if (armed.key && event.type === 'keydown' && event.key !== armed.key) return;
    const sample = current,
      spec = armed;
    sample.done = true;
    sample.handlerMs = performance.now() - sample.start;
    sample.boundary = where;
    sample.committedAtHandlerEnd = checks[spec.check.kind](spec.check);
    detachEditor();
    requestAnimationFrame(() => {
      sample.nextFrameMs = performance.now() - sample.start;
      sample.correct = checks[spec.check.kind](spec.check);
      if (!spec.awaitSave) return void win.__samples.push(sample);
      // Shorter than the driver's 15 s STEP_TIMEOUT, so a slow save is recorded as a missed
      // async completion instead of surfacing as a missing sample.
      const deadline = performance.now() + 12000;
      const poll = () => {
        const saves = win.__fetchLog.filter((f) => f.method === 'PUT' && f.startMs >= sample.start && Number.isFinite(f.endMs));
        if (saves.length && win.__pending === 0 && document.querySelector('.save-state')?.textContent === '') {
          sample.asyncSettledMs = performance.now() - sample.start;
          return void win.__samples.push(sample);
        }
        if (performance.now() > deadline) {
          sample.asyncSettledMs = null;
          return void win.__samples.push(sample);
        }
        setTimeout(poll, 1);
      };
      poll();
    });
  };
  function onEditorTarget(event) {
    finish(event, 'editor-target');
  }
  const atWindowBubble = (event) => {
    if (event.type === 'keydown' && current && current.windowBubbleMs === null && (!armed.key || event.key === armed.key))
      current.windowBubbleMs = performance.now() - current.start;
    finish(event, 'window-bubble');
  };
  document.addEventListener('click', begin, true);
  document.addEventListener('keydown', begin, true);
  if (negative === 'early-observer' || negative === 'capture-microtask')
    for (const type of ['click', 'keydown', 'input'])
      document.addEventListener(
        type,
        (event) => (negative === 'early-observer' ? finish(event, 'document-capture') : queueMicrotask(() => finish(event, 'capture-microtask'))),
        true,
      );
  win.addEventListener('click', atWindowBubble);
  win.addEventListener('keydown', atWindowBubble);
  win.addEventListener('input', atWindowBubble);
}
