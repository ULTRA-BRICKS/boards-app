import { ICONS } from "./icons";
export const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function hash(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return h >>> 0;
}
export function icon(name: string) {
  return `<svg class="ink-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.plus}</svg>`;
}
export function initial(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() || "?";
}
export function colors(people: { id: string }[]) {
  const occupied = new Set<number>(),
    result = new Map<string, string>();
  for (const p of people) {
    let hue = hash(p.id) % 360;
    while (occupied.has(hue)) hue = (hue + 137) % 360;
    occupied.add(hue);
    result.set(p.id, `hsl(${hue} 62% 85%)`);
  }
  return result;
}
export function avatar(p: { id: string; name: string; avatar?: string }, background: string) {
  const picture = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.avatar || "")
    ? p.avatar
    : "";
  return `<span class="avatar" style="--avatar-bg:${background}"><span aria-hidden="true">${esc(initial(p.name))}</span>${picture ? `<img src="${picture}" alt="" decoding="async" loading="lazy">` : ""}</span>`;
}
export function collapsedCount(length: number, expanded = false, n = 3) {
  return expanded || length <= n + 2 ? length : n;
}
export function strikePath(width: number, y: number, seed: number) {
  let n = seed;
  const random = () => {
    n = Math.imul(n ^ (n >>> 15), 1 | n);
    return ((n >>> 0) % 1000) / 1000;
  };
  const points = Array.from(
    { length: 9 },
    (_, i) => `${((i * width) / 8).toFixed(2)},${(y + (random() - 0.5) * 1.3).toFixed(2)}`,
  );
  return { d: "M" + points.join(" L"), width: 1.3 + random() * 0.5 };
}
export function drawStrike(row: HTMLElement, animate = false) {
  row.querySelector(".ink-strike")?.remove();
  if (!row.classList.contains("done")) return;
  const text = row.querySelector<HTMLElement>(".task-text");
  if (!text || text.isContentEditable || !text.firstChild) return;
  const range = document.createRange();
  range.selectNodeContents(text);
  const box = text.getBoundingClientRect();
  const rectangles = Array.from(range.getClientRects()).filter((r) => r.width > 0);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("ink-strike");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", String(box.width));
  svg.setAttribute("height", String(box.height));
  rectangles.forEach((r, i) => {
    const shape = strikePath(
      r.width,
      r.top - box.top + r.height * 0.53,
      hash(row.dataset.item || "") + i,
    );
    const p = document.createElementNS(svg.namespaceURI, "path");
    p.setAttribute("d", shape.d);
    p.setAttribute("transform", `translate(${r.left - box.left} 0)`);
    p.setAttribute("stroke-width", String(shape.width));
    p.setAttribute("pathLength", "1");
    svg.append(p);
    if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches)
      p.animate(
        [
          { strokeDasharray: 1, strokeDashoffset: 1 },
          { strokeDasharray: 1, strokeDashoffset: 0 },
        ],
        { duration: 230, delay: i * 45, easing: "ease-out", fill: "both" },
      );
  });
  text.append(svg);
}
let audio: AudioContext | undefined;
export function soundEnabled() {
  try {
    return localStorage.getItem("boards:sound") !== "off";
  } catch {
    return true;
  }
}
export function setSound(value: boolean) {
  try {
    localStorage.setItem("boards:sound", value ? "on" : "off");
  } catch {}
}
export function pencilSound() {
  if (!soundEnabled()) return;
  try {
    audio ||= new AudioContext();
    void audio.resume();
    const duration = 0.11,
      buffer = audio.createBuffer(1, audio.sampleRate * duration, audio.sampleRate),
      channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++)
      channel[i] = (Math.random() * 2 - 1) * (1 - i / channel.length);
    const source = audio.createBufferSource(),
      filter = audio.createBiquadFilter(),
      gain = audio.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = 2300;
    filter.Q.value = 0.65;
    gain.gain.value = 0.07;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  } catch {
    /* Browser audio policy cannot break task actions. */
  }
}
