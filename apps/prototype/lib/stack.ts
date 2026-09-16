import { esc, icon } from "./paper";
type Page = { id: string; title: string };
export function neighboringSheets(boards: Page[], currentId: string, readonly = false) {
  const neighbors = boards.filter((board) => board.id !== currentId).slice(0, 2);
  if (neighbors.length)
    return neighbors.map((board) => ({
      id: board.id,
      title: board.title.trim() || "Untitled",
      fresh: false,
    }));
  return readonly ? [] : [{ id: "", title: "A fresh page", fresh: true }];
}
export function stackMarkup(boards: Page[], currentId: string, readonly = false) {
  return neighboringSheets(boards, currentId, readonly)
    .map(
      (sheet, index) =>
        `<span class="stack-sheet ${index === 0 ? "near" : "far"}" data-fresh="${sheet.fresh}"><span>${esc(sheet.title)}</span>${index === 0 ? `<i>${icon("pages")}</i>` : ""}</span>`,
    )
    .reverse()
    .join("");
}
export function animateCards(root: HTMLElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll<HTMLElement>(".page-thumb").forEach((card, index) => {
    card.animate(
      [
        {
          transform: `translateY(-28px) rotate(${((index % 3) - 1) * 5}deg) scale(.93)`,
          opacity: 0.25,
        },
        { transform: `translateY(0) rotate(${index % 2 ? 1 : -1}deg) scale(1)`, opacity: 1 },
      ],
      {
        duration: 300,
        delay: Math.min(index * 35, 175),
        easing: "cubic-bezier(.16,1,.3,1)",
        fill: "both",
      },
    );
  });
}
