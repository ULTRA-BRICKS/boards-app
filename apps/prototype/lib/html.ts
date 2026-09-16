const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
/** Escapes text and quoted HTML attributes. Not a URL or CSS sanitizer. */
export function escapeHTML(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ENTITIES[character]!);
}
