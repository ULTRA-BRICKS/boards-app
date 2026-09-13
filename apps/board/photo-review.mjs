/** A transcription is edited on a draft sheet, not through a creation wizard. */
export function reviewPhoto(
  host,
  draft,
  { onConfirm, onCancel = () => {}, onError = () => {} } = {},
) {
  const board = structuredClone(draft.board);
  const sheet = document.createElement("article");
  sheet.className = "paper draft-paper";
  sheet.dataset.draft = "";
  const field = (label, text, tag = "div", max = 1000) => {
    const element = document.createElement(tag);
    element.textContent = text || "";
    element.contentEditable = "plaintext-only";
    element.setAttribute("role", "textbox");
    element.setAttribute("aria-label", label);
    element.setAttribute("aria-multiline", tag === "div" ? "true" : "false");
    element.dataset.placeholder = tag === "h1" ? "Untitled" : "Write here…";
    element.addEventListener("beforeinput", (event) => {
      if (element.textContent.length >= max && !event.inputType.startsWith("delete"))
        event.preventDefault();
    });
    return element;
  };
  const title = field("Page title", board.title, "h1", 120);
  title.className = "draft-title";
  sheet.append(title);
  const warnings = document.createElement("p");
  warnings.className = "draft-margin";
  warnings.textContent =
    (draft.warnings || []).join(" · ") ||
    "A first transcription — adjust any line before keeping the page.";
  sheet.append(warnings);
  const columns = document.createElement("div");
  columns.className = "columns draft-columns";
  columns.style.setProperty("--cols", String(board.columns.length));
  const entries = [];
  for (const column of board.columns) {
    const section = document.createElement("section");
    section.className = "column";
    const heading = field("Column title", column.title, "h2", 120);
    section.append(heading);
    const rows = [];
    for (const item of column.items) {
      const row = document.createElement("div");
      row.className = "task draft-task";
      const keep = document.createElement("button");
      keep.type = "button";
      keep.className = "task-check";
      keep.setAttribute("aria-label", "Include this thought");
      keep.setAttribute("aria-pressed", "true");
      keep.innerHTML = '<span class="ring"></span>';
      keep.onclick = () => {
        const included = keep.getAttribute("aria-pressed") !== "true";
        keep.setAttribute("aria-pressed", String(included));
        row.classList.toggle("excluded", !included);
      };
      const text = field("Thought", item.text);
      text.className = "task-text";
      const hint = field("Unconfirmed assignee hint", item.tag, "span", 24);
      hint.className = "draft-hint";
      hint.dataset.placeholder = "@";
      row.append(keep, text, hint);
      section.append(row);
      rows.push({ item, keep, text, hint });
    }
    columns.append(section);
    entries.push({ column, heading, rows });
  }
  sheet.append(columns);
  const actions = document.createElement("footer");
  actions.className = "draft-actions";
  const cancel = document.createElement("button");
  cancel.textContent = "Leave draft";
  cancel.onclick = onCancel;
  const keepPage = document.createElement("button");
  keepPage.className = "keep-page";
  keepPage.textContent = "Keep this page ↗";
  keepPage.onclick = async () => {
    const value = {
      ...board,
      title: title.textContent.trim().slice(0, 120),
      columns: entries
        .map(({ column, heading, rows }) => ({
          ...column,
          title: heading.textContent.trim().slice(0, 120),
          items: rows
            .filter((r) => r.keep.getAttribute("aria-pressed") === "true")
            .map((r) => ({
              ...r.item,
              text: r.text.textContent.trim().slice(0, 1000),
              tag: r.hint.textContent.trim().slice(0, 24),
              assignees: [],
            }))
            .filter((t) => t.text),
        }))
        .filter((c) => c.items.length),
    };
    if (!value.title || !value.columns.length || value.columns.some((c) => !c.title))
      return onError(
        new Error("Give this page and its columns a title, and keep at least one line."),
      );
    keepPage.disabled = true;
    try {
      await onConfirm(value);
    } catch (error) {
      onError(error);
    } finally {
      if (keepPage.isConnected) keepPage.disabled = false;
    }
  };
  const note = document.createElement("small");
  note.textContent = "A new page. Your existing pages stay as they are.";
  actions.append(cancel, note, keepPage);
  sheet.append(actions);
  host.replaceChildren(sheet);
  return sheet;
}
