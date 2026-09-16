const SPACE_KEY = /^[A-Za-z0-9_-]{43}$/;
export type SpaceBookmark = { key: string; name: string; visited: number };
const STORAGE = "boards:spaces-in-this-tab";
export function normalizeSpaces(input: unknown): SpaceBookmark[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .filter((value) => {
      if (
        !value ||
        typeof value !== "object" ||
        typeof value.key !== "string" ||
        !SPACE_KEY.test(value.key) ||
        seen.has(value.key) ||
        typeof value.name !== "string" ||
        value.name.length > 120 ||
        !Number.isFinite(value.visited)
      )
        return false;
      seen.add(value.key);
      return true;
    })
    .slice(0, 25)
    .map((value) => ({ key: value.key, name: value.name, visited: value.visited }));
}
export function listSpaces(): SpaceBookmark[] {
  try {
    return normalizeSpaces(JSON.parse(sessionStorage.getItem(STORAGE) || "[]"));
  } catch {
    return [];
  }
}
export function rememberSpace(key: string, name: string): boolean {
  try {
    const current = { key, name, visited: Date.now() },
      all = normalizeSpaces([current, ...listSpaces().filter((space) => space.key !== key)]);
    sessionStorage.setItem(STORAGE, JSON.stringify(all));
    return all.some((space) => space.key === key);
  } catch {
    return false;
  }
}
export function spaceLocation(href: string, key: string, name: string): string {
  if (!SPACE_KEY.test(key)) throw Error("Invalid space address");
  const url = new URL(href);
  url.pathname = "/";
  url.hash = new URLSearchParams({ key, title: name }).toString();
  return url.href;
}
export function keyFromSpaceLink(href: string, origin: string): string {
  const url = new URL(href);
  if (url.origin !== origin || !["/", "/index.html"].includes(url.pathname))
    throw Error("Use a Boards editing link from this site.");
  const key = new URLSearchParams(url.hash.slice(1)).get("key") || "";
  if (!SPACE_KEY.test(key))
    throw Error("This is not an editing link. Public read-only links do not grant space access.");
  return key;
}
