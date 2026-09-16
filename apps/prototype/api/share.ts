import { escapeHTML as escape } from "../lib/html";
import { renderPNG } from "../../../server/preview.mjs";
import { relay } from "./cloud";
declare const __BOARD_HTML__: string;
const ORIGIN = "https://boards-app-gamma.vercel.app";
const NO_STORE = {
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
async function loadShared(token: string) {
  const auth = await relay(new Request(ORIGIN + "/cloud/token/anonymous"));
  if (!auth.ok) throw Object.assign(Error("Cloud unavailable"), { status: 503 });
  const identity = await auth.json();
  if (typeof identity.token !== "string")
    throw Object.assign(Error("Invalid auth"), { status: 503 });
  const response = await relay(
    new Request(ORIGIN + "/cloud/rpc/read_shared", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + identity.token },
      body: JSON.stringify({ share_token: token }),
    }),
  );
  if (!response.ok)
    throw Object.assign(Error("Shared page unavailable"), { status: response.status });
  const result = await response.json();
  return result.value;
}
export async function shareHandler(
  request: Request,
  options: {
    html?: string;
    loadView?: (token: string) => Promise<any>;
    png?: (view: any) => Uint8Array;
  } = {},
): Promise<Response> {
  const url = new URL(request.url),
    match = /^\/s\/([a-f0-9]{64})(\/og\.png)?\/?$/.exec(url.pathname);
  const token = match?.[1] || (url.pathname === "/api/share" ? url.searchParams.get("token") : "");
  const image =
    !!match?.[2] || (url.pathname === "/api/share" && url.searchParams.get("image") === "1");
  const failure = (status: number) =>
    new Response(
      status === 404 ? "This shared page is unavailable." : "Unable to load this shared page.",
      { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } },
    );
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return failure(404);
  if (!["GET", "HEAD"].includes(request.method)) return failure(405);
  try {
    const view = await (options.loadView || loadShared)(token);
    if (!view?.boards?.length || !view.scope) throw Error("Invalid shared projection");
    if (image) {
      const headers = { ...NO_STORE, "Content-Type": "image/png" };
      if (request.method === "HEAD") return new Response(null, { headers });
      const bytes = (options.png || renderPNG)(view);
      return new Response(new Uint8Array(bytes).buffer, { headers });
    }
    const board = view.boards[0],
      neighbors = new Set(view.neighborIds || []),
      rows = view.boards
        .flatMap((b: any) =>
          b.columns.flatMap((c: any) =>
            c.items.map((t: any) => ({ board: b, column: c, item: t })),
          ),
        )
        .filter((r: any) => !neighbors.has(r.item.id));
    const single = view.scope.kind === "item",
      column = view.scope.kind === "column",
      first = rows[0];
    const title =
      view.scope.kind === "space"
        ? view.boards
            .map((b: any) => b.title || "Untitled")
            .slice(0, 3)
            .join(" · ")
        : [board.title || "Untitled", single || column ? first?.column.title : undefined]
            .filter(Boolean)
            .join(" · ");
    const description = (
      single
        ? first?.item.text || "A shared item"
        : rows
            .slice(0, 4)
            .map((r: any) => r.item.text)
            .join(" · ") || "A shared page"
    ).slice(0, 800);
    const canonical = ORIGIN + "/s/" + token;
    const tags = [
      ["og:type", "website"],
      ["og:title", title],
      ["og:description", description],
      ["og:url", canonical],
      ["og:image", canonical + "/og.png"],
      ["og:image:type", "image/png"],
      ["og:image:width", "1200"],
      ["og:image:height", "630"],
      ["og:image:alt", title + " — " + description],
      ["og:site_name", "Boards"],
    ]
      .map(([key, value]) => `<meta property="${key}" content="${escape(value)}">`)
      .join("");
    const html = (options.html ?? __BOARD_HTML__)
      .replace(/<title>[\s\S]*?<\/title>/, () => "<title>" + escape(title) + " | Boards</title>")
      .replace(
        "</head>",
        () => tags + '<meta name="twitter:card" content="summary_large_image"></head>',
      );
    return new Response(request.method === "HEAD" ? null : html, {
      headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    console.warn(
      JSON.stringify({
        event: "share.preview.failed",
        code: status === 403 || status === 404 ? "UNAVAILABLE" : "UPSTREAM",
      }),
    );
    return failure(status === 401 || status === 403 || status === 404 ? 404 : 503);
  }
}
export default { fetch: (request: Request) => shareHandler(request) };
