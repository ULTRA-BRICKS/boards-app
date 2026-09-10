export interface PageSummary {
  id: string;
  title: string;
  columns: { id: string; title: string; items: { text: string; done: boolean }[] }[];
}
interface ShelfOptions {
  host: HTMLElement; pages: PageSummary[]; currentId: string; readonly: boolean;
  onOpen(id: string): void; onNew(): void; onColumn(): void; onPhoto(): void; onClose(): void;
}
/** Navigation previews match the page itself. Creating a page is not a form. */
export function pageShelf(options: ShelfOptions): HTMLElement {
  const { host } = options;
  const backdrop = document.createElement("div"); backdrop.className = "backdrop";
  const shelf = document.createElement("section"); shelf.className = "page-shelf";
  shelf.setAttribute("role", "dialog"); shelf.setAttribute("aria-modal", "true"); shelf.setAttribute("aria-label", "Pages");
  const close = document.createElement("button"); close.className = "close"; close.textContent = "×";
  close.setAttribute("aria-label", "Close pages"); close.onclick = options.onClose; shelf.append(close);
  const grid = document.createElement("div"); grid.className = "page-thumbnails";
  for (const page of options.pages) {
    const thumb = document.createElement("button"); thumb.className = "page-thumbnail"; thumb.dataset.page = page.id;
    thumb.setAttribute("aria-current", String(page.id === options.currentId)); thumb.setAttribute("aria-label", page.title || "Untitled page");
    const title = document.createElement("strong"); title.textContent = page.title || "Untitled";
    const preview = document.createElement("span"); preview.className = "thumbnail-columns"; preview.setAttribute("aria-hidden", "true");
    for (const col of page.columns.slice(0, 3)) {
      const mini = document.createElement("span"); mini.className = "thumbnail-column";
      const heading = document.createElement("b"); heading.textContent = col.title; mini.append(heading);
      for (const task of col.items.slice(0, 4)) { const line = document.createElement("i"); line.textContent = (task.done ? "✓ " : "○ ") + task.text; mini.append(line); }
      preview.append(mini);
    }
    thumb.append(title, preview); thumb.onclick = () => options.onOpen(page.id); grid.append(thumb);
  }
  if (!options.readonly) {
    const create = document.createElement("button"); create.className = "page-thumbnail empty-thumbnail";
    create.dataset.newPage = ""; create.setAttribute("aria-label", "New page");
    const mark = document.createElement("span"); mark.textContent = "+";
    const caption = document.createElement("small"); caption.textContent = "a fresh page";
    create.append(mark, caption); create.onclick = options.onNew; grid.append(create);
    const photo = document.createElement("button"); photo.className = "page-thumbnail photo-thumbnail";
    photo.setAttribute("aria-label", "Page from a photo"); photo.innerHTML = '<span aria-hidden="true">▧</span><small>from a photograph</small>';
    photo.onclick = options.onPhoto; grid.append(photo);
    const column = document.createElement("button"); column.className = "shelf-column"; column.textContent = "+ a column on this page";
    column.onclick = options.onColumn; shelf.append(column);
  }
  shelf.prepend(grid); backdrop.append(shelf);
  backdrop.onclick = (event) => { if (event.target === backdrop) options.onClose(); };
  host.replaceChildren(backdrop);
  (grid.querySelector('button[aria-current="true"]') as HTMLButtonElement | null)?.focus();
  return shelf;
}
