export function shareTokenFromURL(href: string): string | null {
  const url = new URL(href);
  const path = /^\/s\/([a-f0-9]{64})\/?$/.exec(url.pathname);
  return path?.[1] || new URLSearchParams(url.hash.slice(1)).get("share");
}
export function publicShareURL(href: string, token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error("Invalid share token");
  return new URL("/s/" + token, new URL(href).origin).href;
}
