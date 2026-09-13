import { stackMarkup as makeStack, animateCards } from "./lib/stack";
/** Isolated cloud prototype; no production account or integration is simulated. */
import { installFont } from "./lib/font";
import {
  icon,
  avatar,
  colors,
  collapsedCount,
  drawStrike,
  pencilSound,
  soundEnabled,
  setSound,
} from "./lib/paper";
import { mark, measureAction, report } from "./lib/metrics";
import {
  readJSON,
  writeJSON,
  notebookCacheKey,
  readSnapshot,
  saveSnapshot,
  anonymousExpiry,
} from "./lib/session";
import { artSVG, pickArt } from "../../packages/core/art.mjs";
import {
  createWorkspace,
  newBoard,
  validateWorkspace,
  tasksForPerson,
} from "../../packages/core/workspace.mjs";
import { documents, rank } from "../../packages/core/search.mjs";
import { uid } from "../../packages/core/model.mjs";
import { SyncQueue } from "../../packages/core/sync.mjs";
const API =
  "https://ep-long-pond-ay3myrkz.apirest.c-5.us-east-2.aws.neon.tech/boards_prototype/rest/v1";
const AUTH =
  "https://ep-long-pond-ay3myrkz.neonauth.c-5.us-east-2.aws.neon.tech/boards_prototype/auth";
const $ = (q, r = document) => r.querySelector(q),
  $$ = (q, r = document) => [...r.querySelectorAll(q)],
  app = $("#app"),
  overlays = $("#overlays"),
  status = $("#status");
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const random = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
let params = new URLSearchParams(location.hash.slice(1)),
  cap = params.get("key"),
  shareToken = params.get("share"),
  ws,
  boardId = params.get("board") || "",
  columnId = "",
  version = 0,
  creating = !cap && !shareToken,
  queue,
  undo = [],
  selected = new Set(),
  editor = null,
  accessToken = "",
  expires = 0,
  pendingToken,
  peek,
  openEpoch = 0,
  cacheKey = "",
  verifying = false,
  recoveryUnavailable = false,
  personColors = new Map();
const board = () => ws.boards.find((b) => b.id === boardId) || ws.boards[0];
const say = (s) =>
  (status.textContent =
    s +
    (recoveryUnavailable && queue && queue.sequence > queue.ack
      ? " · Browser draft backup is unavailable; keep this tab open or export a backup."
      : ""));
async function token() {
  if (accessToken && Date.now() < expires) return accessToken;
  if (pendingToken) return pendingToken;
  const cached = readJSON("boards:anonymous-v1");
  if (cached && cached.expires > Date.now() && anonymousExpiry(cached.token) > Date.now()) {
    accessToken = cached.token;
    expires = cached.expires;
    return accessToken;
  }
  pendingToken = (async () => {
    const r = await fetch(AUTH + "/token/anonymous", {
        credentials: "omit",
        signal: AbortSignal.timeout(12000),
      }),
      value = await r.json();
    if (!r.ok || typeof value.token !== "string") throw Error("Cloud connection unavailable.");
    accessToken = value.token;
    expires = anonymousExpiry(accessToken) || Date.now() + 60000;
    if (anonymousExpiry(accessToken) > Date.now())
      writeJSON("boards:anonymous-v1", { token: accessToken, expires });
    mark("token-ready");
    return accessToken;
  })().finally(() => (pendingToken = null));
  return pendingToken;
}
async function rpc(name, input, retry = true) {
  const jwt = await token();
  const r = await fetch(API + "/rpc/" + name, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Profile": "prototype_api",
      "Accept-Profile": "prototype_api",
      Authorization: "Bearer " + jwt,
    },
    body: JSON.stringify(input),
    credentials: "omit",
    signal: AbortSignal.timeout(20000),
  });
  let value;
  try {
    value = await r.json();
  } catch {
    throw Error("The cloud returned an unreadable response.");
  }
  if (r.status === 401 && retry) {
    accessToken = "";
    expires = 0;
    try {
      sessionStorage.removeItem("boards:anonymous-v1");
    } catch {}
    return rpc(name, input, false);
  }
  if (!r.ok)
    throw Object.assign(Error(value.message || value.error || "Cloud request failed"), {
      code: value.code,
      status: r.status,
    });
  return value;
}
function commit() {
  if (!editor) return;
  const e = editor;
  editor = null;
  const value = e.el.innerText.trim().slice(0, e.max);
  e.el.contentEditable = "false";
  e.el.onblur = e.el.onkeydown = e.el.oninput = null;
  if (value !== e.old) change(() => (e.obj[e.key] = value), false, true);
  try {
    if (cacheKey) sessionStorage.removeItem(cacheKey + ":draft");
  } catch {}
}
function change(fn, draw = true, capture = false) {
  if (shareToken || (queue?.paused && !capture)) return;
  if (editor) commit();
  const previous = structuredClone(ws);
  try {
    fn();
    validateWorkspace(ws);
    undo.push(previous);
    if (undo.length > 40) undo.shift();
    queue.change(ws);
    persist();
    if (draw) render();
  } catch (e) {
    ws = previous;
    render();
    say(e.message);
  }
}
async function flush() {
  commit();
  for (let i = 0; i < 250; i++) {
    if (queue.paused) throw Error("Resolve the save conflict first.");
    await queue.flush();
    if (!queue.running && queue.ack === queue.sequence) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw Error("Still saving. Please retry.");
}
function modal(name, html) {
  commit();
  close();
  openEpoch++;
  overlays.innerHTML = `<div class="backdrop"><section class="dialog wide" role="dialog" aria-modal="true" aria-label="${escape(name)}"><button class="close" aria-label="Close">×</button>${html}</section></div>`;
  $(".close").onclick = close;
  $(".backdrop").onclick = (e) => {
    if (e.target === e.currentTarget) close();
  };
  app.inert = true;
  requestAnimationFrame(() => $("input,button:not(.close),[contenteditable]", overlays)?.focus());
}
function close() {
  openEpoch++;
  overlays.replaceChildren();
  app.inert = false;
  peek?.remove();
  peek = null;
}
function backup() {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(ws, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "notebook-backup.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function failSave(message) {
  commit();
  close();
  overlays.innerHTML = `<section class="conflict" role="alertdialog" aria-modal="true" aria-label="Unsaved changes"><h2>Your last changes are not saved.</h2><p>${escape(message)}</p><p>Your draft is still in this page. It has not been replaced with another session's version.</p><div class="quick-actions"><button id="backup">Export draft</button><button id="retry">Retry save</button><button id="reload">Load the cloud version</button></div></section>`;
  app.inert = true;
  $("#backup").onclick = backup;
  $("#retry").onclick = () => {
    close();
    if (!queue.enabled) open();
    else queue.retry();
  };
  $("#reload").onclick = async () => {
    if (!confirm("Discard the unsaved draft? Export it first to keep a copy.")) return;
    if (cacheKey) {
      try {
        sessionStorage.removeItem(cacheKey);
        sessionStorage.removeItem(cacheKey + ":draft");
      } catch {}
    }
    ws = null;
    close();
    await open();
  };
}
function persist() {
  if (cacheKey && queue && !shareToken) {
    recoveryUnavailable = !saveSnapshot(cacheKey, queue.version, ws, queue.sequence > queue.ack);
    if (recoveryUnavailable && queue.sequence > queue.ack) say("Not yet saved to cloud");
  }
}
function updateAddress() {
  if (!ws) return;
  const p = new URLSearchParams(location.hash.slice(1));
  p.set("board", boardId);
  p.set("title", board().title || "Untitled");
  history.replaceState({}, "", location.pathname + location.search + "#" + p);
}
function initQueue(v, enabled) {
  queue?.dispose();
  queue = new SyncQueue({
    send: async ({ document, version }) =>
      rpc("notebook", { capability: cap, expected_version: version, document }),
    onState: (s) => {
      if (s.kind === "saved") {
        persist();
        say("Saved");
        mark("save-complete");
      } else if (s.kind === "saving") say("Saving\u2026");
      else if (s.kind === "pending" || s.kind === "local")
        say(verifying ? "Syncing your changes\u2026" : "Saving\u2026");
      else if (s.kind === "error" || s.kind === "conflict")
        failSave(s.message || "Another session changed this page.");
    },
  });
  queue.configure({ enabled, version: v });
}
function restoreScratch() {
  const draft = readJSON(cacheKey + ":draft");
  if (!draft) return false;
  const b = ws.boards.find((b) => b.id === draft.board),
    c = b?.columns.find((c) => c.id === draft.column),
    t = c?.items.find((t) => t.id === draft.item);
  const obj =
    draft.kind === "text" ? t : draft.kind === "board-title" || draft.kind === "footer" ? b : c;
  const key = draft.kind.endsWith("title") ? "title" : draft.kind;
  if (
    !obj ||
    !["text", "title", "note", "subtitle", "footer"].includes(key) ||
    typeof draft.value !== "string"
  )
    return false;
  obj[key] = draft.value;
  return true;
}
async function open() {
  verifying = true;
  let cached = null;
  try {
    if (!cap && !shareToken) {
      cap = random();
      history.replaceState({}, "", location.pathname + location.search + "#key=" + cap);
    }
    void token().catch(() => {});
    if (!shareToken) {
      cacheKey = await notebookCacheKey(cap);
      cached = readSnapshot(cacheKey);
      if (cached) {
        try {
          ws = validateWorkspace(cached.value);
        } catch {
          cached = null;
        }
        if (cached) {
          if (!ws.boards.some((b) => b.id === boardId)) boardId = ws.boards[0].id;
          if (cached.version === 0) creating = true;
          initQueue(cached.version, false);
          const scratch = restoreScratch();
          if (cached.pending || scratch) queue.change(ws);
          render();
          mark("tab-render");
          say("Checking for changes\u2026");
        }
      }
    }
    const freshCreation = creating && (!cached || cached.version === 0);
    if (freshCreation && !cached) {
      ws = createWorkspace();
      boardId = ws.boards[0].id;
      initQueue(0, false);
      render();
      persist();
      mark("sample-render");
      say("Creating your cloud space…");
    }
    let result;
    if (shareToken) result = await rpc("read_shared", { share_token: shareToken });
    else if (freshCreation) {
      try {
        result = await rpc("notebook", {
          capability: cap,
          expected_version: 0,
          document: createWorkspace(),
        });
        result.value ||= createWorkspace();
      } catch (e) {
        if (e.code !== "40001") throw e;
        result = await rpc("notebook", { capability: cap });
      }
      creating = false;
    } else result = await rpc("notebook", { capability: cap });
    if (editor) commit();
    const dirty = !shareToken && queue && queue.sequence > queue.ack;
    if (dirty && (freshCreation ? result.version > 1 : result.version !== cached?.version)) {
      verifying = false;
      queue.paused = true;
      failSave(
        "This page changed elsewhere while you had a local draft. Export your draft before loading the cloud version.",
      );
      return;
    }
    if (!dirty && !(cached && result.version === cached.version)) {
      ws = shareToken ? result.value : validateWorkspace(result.value);
      version = result.version;
      if (!ws.boards.some((b) => b.id === boardId)) boardId = ws.boards[0].id;
      if (!shareToken) initQueue(version, true);
      render();
    } else queue.configure({ enabled: true, version: result.version });
    verifying = false;
    mark("cloud-ready");
    persist();
    updateAddress();
    say(shareToken ? "Read-only view" : dirty ? "Saving your recovered changes\u2026" : "Saved");
  } catch (e) {
    verifying = false;
    if (ws && queue && !shareToken) {
      queue.enabled = false;
      queue.paused = true;
      failSave(e.message);
      return;
    }
    app.innerHTML =
      '<section class="gate"><h1>Unable to connect</h1><p>' +
      escape(e.message) +
      '</p><button id="connect-again" class="primary">Try again</button></section>';
    $("#connect-again").onclick = () => open();
  }
}

function task(t, c) {
  return (
    '<li class="task ' +
    (t.done ? "done " : "") +
    (selected.has(t.id) ? "selected " : "") +
    (ws.neighborIds?.includes(t.id) ? "neighbor " : "") +
    '" data-item="' +
    escape(t.id) +
    '" data-col="' +
    escape(c.id) +
    '" id="i-' +
    escape(t.id) +
    '"><button class="task-check" data-check aria-label="' +
    (t.done ? "Reopen" : "Complete") +
    ' item" aria-pressed="' +
    t.done +
    '" ' +
    (shareToken ? "disabled" : "") +
    '><span class="ring"></span></button><div class="task-text" tabindex="' +
    (shareToken ? -1 : 0) +
    '" data-edit="text" role="textbox" aria-label="Task text">' +
    escape(t.text) +
    '</div><div class="task-actions">' +
    t.assignees
      .slice(0, 3)
      .map((id, i) => {
        const p = ws.people.find((p) => p.id === id);
        return p
          ? '<button class="avatar-button" data-person="' +
              escape(id) +
              '" style="--order:' +
              (i + 1) +
              '" aria-label="' +
              escape(p.name) +
              '">' +
              avatar(p, personColors.get(id)) +
              "</button>"
          : "";
      })
      .join("") +
    (t.assignees.length > 3
      ? '<button class="avatar-overflow" data-assign aria-label="Show all assignees">+' +
        (t.assignees.length - 3) +
        "</button>"
      : "") +
    (!shareToken
      ? '<button class="add-person" data-assign aria-label="Change assignees">' +
        icon("plus") +
        "</button>"
      : "") +
    "</div>" +
    (!shareToken
      ? '<button class="task-more" data-item-menu aria-label="Item actions">' +
        icon("settings") +
        "</button>"
      : "") +
    "</li>"
  );
}
function render() {
  commit();
  close();
  if (!ws) return;
  const b = board();
  personColors = colors(ws.people);
  document.title = b.title || "Untitled";
  updateAddress();
  app.innerHTML = `<article class="paper"><button class="paper-stack" data-pages aria-label="Show all boards" aria-expanded="false">${makeStack(ws.boards, boardId)}</button><button class="paper-options" data-tools aria-label="Page options">${icon("settings")}</button><div class="paper-caption"><span class="board-title draft-title" data-edit="board-title" data-placeholder="Untitled" tabindex="0">${escape(b.title)}</span><span class="tagline">${escape(b.tagline || "")}</span></div><nav class="column-tabs" aria-label="Board columns">${b.columns.map((c) => `<button data-jump="${c.id}" aria-current="${c.id === (columnId || b.columns[0]?.id) ? "true" : "false"}">${escape(c.title || "Untitled")}</button>`).join("")}</nav><div class="columns" style="--cols:${Math.max(1, b.columns.length)}">${b.columns.map((c, i) => `<section class="column" data-col="${c.id}" id="c-${c.id}"><div class="hero">${artSVG(pickArt(c.title))}<div class="scribble" data-edit="note" tabindex="0">${escape(c.note)}</div></div><h1 class="column-title" data-edit="column-title" data-placeholder="Untitled" tabindex="0">${escape(c.title)}</h1><div class="column-subtitle" data-edit="subtitle" tabindex="0">${escape(c.subtitle)}</div><ul class="tasks">${c.items.map((t) => task(t, c)).join("")}</ul>${!shareToken ? '<button class="add-item" data-add>+ Add a thought</button><button class="column-menu" data-column-menu aria-label="Column actions">⋯</button>' : ""}<div class="end-note">${["Smooth pages.\nHappier people.", "Build useful\nthings.", "Tell the\nstory."][i % 3]}</div></section>`).join("")}${!b.columns.length ? '<section class="empty-column"><button data-new-column aria-label="New column">+</button></section>' : ""}</div><div class="paper-footer"><span data-edit="footer" tabindex="0">${escape(b.footer)}</span><span class="after">Small steps. Big progress.</span></div></article><nav class="edge-tabs" aria-label="Notebook navigation"><button class="edge-tab" data-pages aria-label="Pages">${icon("pages")}<span>Pages</span></button><button class="edge-tab" data-search aria-label="Search">${icon("search")}<span>Find</span></button>${!shareToken ? '<button class="edge-tab" data-people aria-label="People">' + icon("people") + '<span>People</span></button><button class="edge-tab" data-share aria-label="Share">' + icon("share") + "<span>Share</span></button>" : ""}</nav>`;
  bind();
  observeNavigation();
  mark("board-render");
  requestAnimationFrame(() => {
    $$(".task.done").forEach((row) => drawStrike(row));
    mark("board-frame");
  });
}
function bind() {
  app.onclick = (e) => {
    const el = e.target.closest("button,[data-edit]");
    if (!el) return;
    const row = el.closest("[data-item]"),
      col = board().columns.find((c) => c.id === el.closest("[data-col]")?.dataset.col),
      t = col?.items.find((t) => t.id === row?.dataset.item);
    columnId = col?.id || columnId;
    if (col) syncNavigation();
    if (el.hasAttribute("data-pages")) return pages();
    if (el.hasAttribute("data-search")) return search();
    if (el.hasAttribute("data-jump")) {
      columnId = el.dataset.jump;
      navLock = Date.now() + 900;
      syncNavigation();
      $("#c-" + columnId)?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
        inline: "start",
      });
      return;
    }
    if (el.hasAttribute("data-people")) return people();
    if (el.hasAttribute("data-person")) return person(el.dataset.person, row, el);
    if (shareToken) return;
    if (el.hasAttribute("data-edit")) return edit(el, t || col || board());
    if (el.hasAttribute("data-check")) {
      const start = performance.now();
      change(() => (t.done = !t.done), false);
      row.classList.toggle("done", t.done);
      el.setAttribute("aria-pressed", String(t.done));
      el.setAttribute("aria-label", (t.done ? "Reopen" : "Complete") + " item");
      drawStrike(row, true);
      if (t.done) pencilSound();
      requestAnimationFrame(() => measureAction("complete", start));
      return;
    }
    if (el.hasAttribute("data-add")) {
      const id = uid();
      change(() => col.items.push({ id, text: "", done: false, tag: "", assignees: [] }));
      return edit($("#i-" + id + " [data-edit]"), col.items.at(-1));
    }
    if (el.hasAttribute("data-assign")) return assign(t, row);
    if (el.hasAttribute("data-share")) return share();
    if (el.hasAttribute("data-tools")) return tools();
    if (el.hasAttribute("data-new-column")) return addColumn();
    if (el.hasAttribute("data-column-menu")) {
      columnId = col.id;
      return columnTools(col);
    }
    if (el.hasAttribute("data-item-menu")) return itemTools(t, col);
  };
  app.onkeydown = (e) => {
    if (e.target.matches("[data-edit]") && !e.target.isContentEditable && e.key === "Enter") {
      e.preventDefault();
      e.target.click();
    }
  };
  app.onmouseover = (e) => {
    const a = e.target.closest("[data-person]");
    if (a && !peek) previewPerson(a);
  };
  app.onmouseout = (e) => {
    if (e.target.closest("[data-person]")) scheduleClosePreview();
  };
}

function edit(el, obj) {
  if (shareToken || queue.paused || editor?.el === el) return;
  commit();
  let key = el.dataset.edit;
  if (key === "board-title") {
    obj = board();
    key = "title";
  }
  if (key === "column-title") key = "title";
  el.querySelector(".ink-strike")?.remove();
  const max = key === "text" ? 1000 : key === "title" ? 120 : key === "subtitle" ? 180 : 240;
  editor = { el, obj, key, max, old: obj[key] || "" };
  el.contentEditable = "plaintext-only";
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  el.onkeydown = (e) => {
    if (e.key === "Escape") {
      el.textContent = editor.old;
      commit();
      render();
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const m = /@([^@\n]*)$/.exec(el.textContent);
      if (m && key === "text") {
        const p = ws.people.find((p) => p.name.toLowerCase().startsWith(m[1].toLowerCase()));
        if (p) {
          el.textContent = el.textContent.slice(0, m.index).trim();
          commit();
          change(() => {
            if (!obj.assignees.includes(p.id)) obj.assignees.push(p.id);
          });
          return;
        }
      }
      commit();
      render();
    }
  };
  el.onblur = () =>
    setTimeout(() => {
      if (editor?.el === el) {
        commit();
        render();
      }
    }, 140);
  el.oninput = () => {
    if (cacheKey) {
      const backedUp = writeJSON(cacheKey + ":draft", {
        board: boardId,
        column: el.closest("[data-col]")?.dataset.col,
        item: el.closest("[data-item]")?.dataset.item,
        kind: el.dataset.edit,
        value: el.innerText.slice(0, max),
      });
      if (!backedUp) {
        recoveryUnavailable = true;
        say("Keep this tab open until your changes save");
      }
    }
    if (key !== "text") return;
    const m = /@([^@\n]*)$/.exec(el.textContent);
    const p = m && ws.people.find((p) => p.name.toLowerCase().startsWith(m[1].toLowerCase()));
    if (p) say("Enter to assign " + p.name);
    else {
      const hits = rank(el.textContent, documents(ws), {
        duplicate: true,
        exclude: boardId + ":" + obj.id,
      });
      say(hits[0] ? "Similar thought: " + hits[0].title : "Ink drying…");
    }
  };
}
function addColumn() {
  const c = { id: uid(), title: "", subtitle: "", note: "", icon: "auto", items: [] };
  change(() => board().columns.push(c));
  edit($("#c-" + c.id + " h1"), c);
}
function pages() {
  modal(
    "Pages",
    `<div class="page-grid">${ws.boards
      .map(
        (b) =>
          `<button class="page-thumb" data-page="${b.id}"><strong>${escape(b.title || "Untitled")}</strong><small>${b.columns
            .map(
              (c) =>
                escape(c.title) +
                "<br>" +
                c.items
                  .slice(0, 2)
                  .map((t) => "○ " + escape(t.text))
                  .join("<br>"),
            )
            .join("<br>")}</small></button>`,
      )
      .join(
        "",
      )}${!shareToken ? '<button class="page-thumb new" id="new-page" aria-label="New page">+<small>a fresh page</small></button>' : ""}</div>${!shareToken ? '<div class="quick-actions"><button id="new-column">+ a column on this page</button></div>' : ""}`,
  );
  $(".dialog").classList.add("sheet-shelf");
  animateCards($(".dialog"));
  $$("[data-page]").forEach(
    (e) =>
      (e.onclick = () => {
        boardId = e.dataset.page;
        columnId = "";
        selected.clear();
        render();
      }),
  );
  $("#new-page")?.addEventListener("click", () => {
    const b = newBoard("");
    change(() => {
      ws.boards.push(b);
      boardId = b.id;
    });
    edit($(".board-title"), b);
  });
  $("#new-column")?.addEventListener("click", addColumn);
}
function focus(b, id) {
  boardId = b;
  render();
  const el = $("#i-" + id);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.classList.add("focused");
}
function search() {
  modal(
    "Find a thought",
    '<input id="find" type="search" aria-label="Search workspace" placeholder="A word, a thought, a ticket…"><p class="prototype-note">Word search across these pages. Current page and column come first.</p><div id="hits"></div>',
  );
  const corpus = documents(ws);
  $("#find").oninput = (e) => {
    const hits = rank(e.target.value, corpus, { boardId, columnId });
    $("#hits").innerHTML = hits
      .map(
        (h, i) =>
          `<button class="search-result" data-hit="${i}">${escape(h.title)}<small>${escape(h.boardTitle)} / ${escape(h.columnTitle)}</small></button>`,
      )
      .join("");
    $$("[data-hit]").forEach(
      (b) =>
        (b.onclick = () => {
          const h = hits[+b.dataset.hit];
          focus(h.boardId, h.itemId);
        }),
    );
  };
}
function mini(name, html, anchor) {
  modal(name, html);
  const box = $(".dialog", overlays);
  box.classList.add("mini-popover");
  if (anchor && innerWidth > 700) {
    const r = anchor.getBoundingClientRect();
    box.style.position = "absolute";
    box.style.width = "360px";
    box.style.left = Math.max(12, Math.min(innerWidth - 380, r.right - 340)) + "px";
    box.style.top = Math.max(16, Math.min(innerHeight - 470, r.bottom + 8)) + "px";
  }
}
function refreshTask(t) {
  const c = board().columns.find((c) => c.items.some((i) => i.id === t.id)),
    row = $("#i-" + CSS.escape(t.id));
  if (c && row) row.outerHTML = task(t, c);
}
function assign(t, row) {
  commit();
  mini(
    "Assignees",
    '<div class="picker-caption">Assigned to this item</div><input id="person-filter" type="search" aria-label="Find an assignee" placeholder="Find a person\u2026"><div class="assignment-options"></div><button id="new-person">' +
      icon("assign") +
      " Add a person</button>",
    row?.querySelector(".add-person"),
  );
  const output = $(".assignment-options");
  const draw = () => {
    const q = $("#person-filter").value.toLocaleLowerCase();
    output.innerHTML = ws.people
      .filter((p) => p.name.toLocaleLowerCase().includes(q))
      .map(
        (p) =>
          '<button class="assignment-option" data-pick="' +
          escape(p.id) +
          '" aria-pressed="' +
          t.assignees.includes(p.id) +
          '">' +
          avatar(p, personColors.get(p.id)) +
          "<span>" +
          escape(p.name) +
          '</span><span class="assignment-check">' +
          (t.assignees.includes(p.id) ? icon("check") : "") +
          "</span></button>",
      )
      .join("");
    $$("[data-pick]", output).forEach(
      (button) =>
        (button.onclick = () => {
          change(() => {
            const id = button.dataset.pick;
            t.assignees = t.assignees.includes(id)
              ? t.assignees.filter((x) => x !== id)
              : [...t.assignees, id];
          }, false);
          refreshTask(t);
          draw();
          $('[data-pick="' + button.dataset.pick + '"]', output)?.focus();
        }),
    );
  };
  draw();
  $("#person-filter").oninput = draw;
  $("#new-person").onclick = () => {
    mini(
      "New person",
      '<label>Name<input id="person-name" maxlength="120" autocomplete="name"></label><button id="add-person">Add and assign</button>',
      row,
    );
    $("#add-person").onclick = () => {
      const name = $("#person-name").value.trim();
      if (!name) return;
      const id = uid();
      change(() => {
        ws.people.push({ id, name, email: "", avatar: "", slackUserId: "", slackUrl: "" });
        t.assignees.push(id);
      });
    };
  };
}
function personRows(tasks, expanded = false) {
  const visible = tasks.slice(0, collapsedCount(tasks.length, expanded));
  return (
    '<div class="person-tasks">' +
    visible
      .map(
        (r, i) =>
          '<button class="search-result" data-person-task="' +
          i +
          '">' +
          escape(r.item.text) +
          "<small>" +
          escape(r.boardTitle) +
          " / " +
          escape(r.columnTitle) +
          "</small></button>",
      )
      .join("") +
    "</div>" +
    (tasks.length > 5
      ? '<button class="expand-person" aria-expanded="' +
        expanded +
        '">' +
        (expanded ? "Show less" : "+ " + (tasks.length - 3) + " more tasks") +
        " " +
        icon(expanded ? "up" : "down") +
        "</button>"
      : "")
  );
}
function person(id, row, anchor, expanded = false) {
  const p = ws.people.find((p) => p.id === id);
  if (!p) return;
  const tasks = tasksForPerson(ws, id).filter(
    (r) => !r.item.done && r.item.id !== row?.dataset.item,
  );
  mini(
    p.name,
    '<div class="person-heading">' +
      avatar(p, personColors.get(id)) +
      "<strong>" +
      escape(p.name) +
      '</strong></div><p class="picker-caption">' +
      (row ? "Other open tasks assigned to " : "Open tasks assigned to ") +
      escape(p.name) +
      " \u00B7 " +
      tasks.length +
      "</p>" +
      personRows(tasks, expanded) +
      (row && !shareToken
        ? '<button id="edit-assignments">' +
          icon("assign") +
          " Change assignments on this item</button>"
        : ""),
    anchor,
  );
  $$("[data-person-task]").forEach(
    (e) =>
      (e.onclick = () => {
        const r = tasks[+e.dataset.personTask];
        focus(r.boardId, r.item.id);
      }),
  );
  $(".expand-person")?.addEventListener("click", () => person(id, row, anchor, !expanded));
  $("#edit-assignments")?.addEventListener("click", () => {
    const c = board().columns.find((c) => c.id === row.dataset.col),
      t = c?.items.find((t) => t.id === row.dataset.item);
    if (t) assign(t, row);
  });
}
let peekTimer;
function previewPerson(anchor) {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (!anchor.matches(":hover") || overlays.children.length) return;
    const id = anchor.dataset.person,
      p = ws.people.find((p) => p.id === id),
      row = anchor.closest("[data-item]");
    if (!p) return;
    const tasks = tasksForPerson(ws, id).filter(
      (r) => !r.item.done && r.item.id !== row?.dataset.item,
    );
    peek = document.createElement("section");
    peek.className = "peek";
    peek.setAttribute("aria-label", "Other tasks assigned to " + p.name);
    peek.innerHTML =
      "<strong>" +
      escape(p.name) +
      '</strong><p class="picker-caption">Other open tasks assigned to ' +
      escape(p.name) +
      "</p>" +
      personRows(tasks);
    const rect = anchor.getBoundingClientRect();
    peek.style.left = Math.max(12, Math.min(innerWidth - 348, rect.right - 280)) + "px";
    peek.style.top = Math.max(12, Math.min(innerHeight - 340, rect.bottom + 8)) + "px";
    peek.onmouseenter = () => clearTimeout(peekTimer);
    peek.onmouseleave = scheduleClosePreview;
    document.body.append(peek);
    $$("[data-person-task]", peek).forEach(
      (b) =>
        (b.onclick = () => {
          const r = tasks[+b.dataset.personTask];
          focus(r.boardId, r.item.id);
        }),
    );
    $(".expand-person", peek)?.addEventListener("click", () => {
      peek?.remove();
      peek = null;
      person(id, row, anchor, true);
    });
  }, 180);
}
function scheduleClosePreview() {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (!peek?.matches(":hover")) {
      peek?.remove();
      peek = null;
    }
  }, 180);
}
function people() {
  modal(
    "People",
    '<div class="picker-caption">People in this space</div><div class="people-list">' +
      ws.people
        .map(
          (p) =>
            '<button data-show-person="' +
            escape(p.id) +
            '">' +
            avatar(p, personColors.get(p.id)) +
            "<span>" +
            escape(p.name) +
            "</span><small>" +
            tasksForPerson(ws, p.id).filter((r) => !r.item.done).length +
            " open tasks</small></button>",
        )
        .join("") +
      "</div>" +
      (!shareToken
        ? '<label class="import-people">Import Slack people<input type="file" id="people-file" accept="application/json"></label>'
        : ""),
  );
  $$("[data-show-person]").forEach((b) => (b.onclick = () => person(b.dataset.showPerson)));
  $("#people-file")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || file.size > 1000000) return say("Choose a people export below 1 MB.");
    try {
      const incoming = JSON.parse(await file.text());
      if (!Array.isArray(incoming) || incoming.length > 200) throw Error("Invalid people export");
      change(() => {
        for (const value of incoming) {
          const p = ws.people.find(
            (p) => p.id === value.id || p.name.toLowerCase() === String(value.name).toLowerCase(),
          );
          if (p) {
            if (
              !p.avatar &&
              /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value.avatar || "")
            )
              p.avatar = value.avatar;
          } else
            ws.people.push({
              id: uid(),
              name: String(value.name).slice(0, 120),
              email: "",
              avatar: value.avatar || "",
              slackUserId: "",
              slackUrl: "",
            });
        }
      });
      say("People imported");
    } catch (e) {
      say(e.message);
    }
  });
}

function itemTools(t, c) {
  modal(
    "Item actions",
    '<div class="stack"><button id="select-item">Select / deselect for sharing</button><button id="up">Move up ↑</button><button id="down">Move down ↓</button><button id="delete-item">Remove this thought</button></div>',
  );
  $("#select-item").onclick = () => {
    if (selected.has(t.id)) selected.delete(t.id);
    else selected.add(t.id);
    render();
  };
  for (const [s, d] of [
    ["up", -1],
    ["down", 1],
  ])
    $("#" + s).onclick = () =>
      change(() => {
        const i = c.items.indexOf(t);
        c.items.splice(i, 1);
        c.items.splice(Math.max(0, i + d), 0, t);
      });
  $("#delete-item").onclick = () => {
    if (confirm("Remove this thought? Undo is available."))
      change(() => (c.items = c.items.filter((x) => x.id !== t.id)));
  };
}
function columnTools(c) {
  modal(
    "Column actions",
    '<div class="stack"><button id="share-col">Share this column</button><button id="left">Move column left</button><button id="remove-col">Remove column</button></div>',
  );
  $("#share-col").onclick = () => share("column");
  $("#left").onclick = () =>
    change(() => {
      const a = board().columns,
        i = a.indexOf(c);
      a.splice(i, 1);
      a.splice(Math.max(0, i - 1), 0, c);
    });
  $("#remove-col").onclick = () => {
    if (confirm("Remove the column and all its thoughts?"))
      change(() => (board().columns = board().columns.filter((x) => x.id !== c.id)));
  };
}
function tools() {
  mini(
    "Page options",
    '<div class="options-list"><button id="undo">' +
      icon("undo") +
      ' Undo last change</button><button id="export">' +
      icon("download") +
      ' Export backup</button><button id="sound" aria-pressed="' +
      soundEnabled() +
      '">' +
      icon(soundEnabled() ? "sound" : "muted") +
      " Completion sound: " +
      (soundEnabled() ? "on" : "off") +
      '</button><button id="metrics">' +
      icon("settings") +
      " Loading measurements</button></div>",
    $("[data-tools]"),
  );
  $("#undo").disabled = !undo.length;
  $("#undo").onclick = () => {
    ws = undo.pop();
    queue.change(ws);
    persist();
    render();
  };
  $("#export").onclick = backup;
  $("#sound").onclick = () => {
    setSound(!soundEnabled());
    tools();
  };
  $("#metrics").onclick = () => {
    const data = report();
    modal(
      "Loading measurements",
      '<pre class="metrics-report">' +
        escape(JSON.stringify(data, null, 2)) +
        '</pre><button id="export-metrics">Download measurements</button>',
    );
    $("#export-metrics").onclick = () => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "boards-loading.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  };
}
async function share(kind) {
  try {
    kind ||= selected.size === 1 ? "item" : selected.size ? "items" : "board";
    modal(
      "Share a view",
      `<label>View<select id="scope"><option value="board">Current page</option><option value="column">Current column</option><option value="items" ${!selected.size ? "disabled" : ""}>Selected thoughts</option><option value="space">All pages</option></select></label><p class="prototype-note">Read-only. Anyone with the link can view this selection. Names are included; contact and account details are excluded. Changes stay current.</p><button id="make-share">Create read-only link ↗</button><div id="share-result"></div>`,
    );
    $("#scope").value = kind === "item" ? "items" : kind;
    const epoch = openEpoch;
    $("#make-share").onclick = async () => {
      try {
        const kind = $("#scope").value,
          scope = {
            kind: kind === "items" && selected.size === 1 ? "item" : kind,
            boardId,
            columnId: columnId || board().columns[0]?.id,
            itemIds: [...selected],
            neighbors: false,
          };
        await flush();
        const r = await rpc("share_notebook", { capability: cap, scope });
        if (epoch !== openEpoch) {
          await rpc("share_notebook", { capability: cap, revoke_token: r.token });
          return;
        }
        const link = new URL(location.href);
        link.hash = "share=" + r.token;
        $("#share-result").innerHTML =
          `<label>Read-only link<input readonly id="share-url" value="${escape(link.href)}"></label><div class="quick-actions"><button id="copy-share">Copy</button><button id="revoke-share">Revoke</button><a id="open-share" target="_blank" rel="noopener noreferrer" href="${escape(link.href)}">Open ↗</a></div>`;
        $("#copy-share").onclick = () =>
          navigator.clipboard.writeText(link.href).catch(() => $("#share-url").select());
        const resultPanel = $("#share-result");
        $("#revoke-share").onclick = async () => {
          try {
            await rpc("share_notebook", { capability: cap, revoke_token: r.token });
            if (epoch === openEpoch && resultPanel.isConnected)
              resultPanel.textContent = "Link revoked.";
          } catch (e) {
            say(e.message);
          }
        };
      } catch (e) {
        say(e.message);
      }
    };
  } catch (e) {
    say(e.message);
  }
}
window.addEventListener("beforeunload", (e) => {
  if (editor || (queue && queue.sequence > queue.ack)) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !editor) close();
  if ((e.ctrlKey || e.metaKey) && e.key === "k" && ws) {
    e.preventDefault();
    search();
  }
  if (e.key === "Tab" && overlays.children.length) {
    const focusable = $$("button:not(:disabled),input,select,a[href]", overlays);
    const first = focusable[0],
      last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
void installFont()
  .then(() => {
    mark("font-ready");
    $$(".task.done").forEach((row) => drawStrike(row));
  })
  .catch(() => {});
void open();

let navLock = 0,
  navFrame = 0;
function syncNavigation() {
  $$("[data-jump]").forEach((button) =>
    button.setAttribute("aria-current", String(button.dataset.jump === columnId)),
  );
}
function observeNavigation() {
  if (!board().columns.some((c) => c.id === columnId)) columnId = board().columns[0]?.id || "";
  syncNavigation();
}
window.addEventListener(
  "scroll",
  () => {
    if (navFrame || !ws || innerWidth > 700 || Date.now() < navLock) return;
    navFrame = requestAnimationFrame(() => {
      navFrame = 0;
      let current = $$(".column")[0];
      for (const column of $$(".column"))
        if (column.getBoundingClientRect().top <= 115) current = column;
      if (current) {
        columnId = current.dataset.col;
        syncNavigation();
      }
    });
  },
  { passive: true },
);
window.addEventListener("resize", () => {
  if (ws) {
    observeNavigation();
    $$(".task.done").forEach((row) => drawStrike(row));
  }
});
document.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.closest(".avatar")) image.remove();
  },
  true,
);
const registerShell = () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
};
if (document.readyState === "complete") registerShell();
else window.addEventListener("load", registerShell, { once: true });
