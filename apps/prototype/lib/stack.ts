import { esc, icon } from "./paper";
export function stackMarkup(boards: { id: string; title: string }[], currentId: string) {
  const other = boards.filter((board) => board.id !== currentId);
  const far = esc(other[1]?.title || "A fresh page");
  const near = esc(other[0]?.title || "A fresh page");
  return `<span class="stack-sheet far"><span>${far}</span></span><span class="stack-sheet near"><span>${near}</span><i>${icon("pages")}</i></span>`;
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
