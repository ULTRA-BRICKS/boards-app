const AUTH =
  "https://ep-long-pond-ay3myrkz.neonauth.c-5.us-east-2.aws.neon.tech/boards_prototype/auth/token/anonymous";
const RPC =
  "https://ep-long-pond-ay3myrkz.apirest.c-5.us-east-2.aws.neon.tech/boards_prototype/rest/v1/rpc/";
const targets: Record<string, { url: string; method: string }> = {
  auth: { url: AUTH, method: "GET" },
  notebook: { url: RPC + "notebook", method: "POST" },
  share_notebook: { url: RPC + "share_notebook", method: "POST" },
  read_shared: { url: RPC + "read_shared", method: "POST" },
};
const paths: Record<string, string> = {
  "/cloud/token/anonymous": "auth",
  "/cloud/rpc/notebook": "notebook",
  "/cloud/rpc/share_notebook": "share_notebook",
  "/cloud/rpc/read_shared": "read_shared",
};
const NO_STORE = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function relay(request: Request, transport: typeof fetch = fetch): Promise<Response> {
  const start = performance.now(),
    url = new URL(request.url),
    operation =
      paths[url.pathname] ||
      (url.pathname === "/api/cloud" ? url.searchParams.get("operation") : "");
  if (url.pathname === "/cloud/open" || operation === "open")
    return openNotebook(request, transport);
  const target =
    operation && Object.prototype.hasOwnProperty.call(targets, operation)
      ? targets[operation]
      : undefined;
  const reject = (status: number, code: string) =>
    Response.json({ code }, { status, headers: NO_STORE });
  if (!target) return reject(404, "UNKNOWN_OPERATION");
  if (request.method !== target.method) return reject(405, "METHOD_NOT_ALLOWED");
  const headers = new Headers({ Accept: "application/json" });
  let body: ArrayBuffer | undefined;
  if (target.method === "POST") {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return reject(415, "JSON_REQUIRED");
    const auth = request.headers.get("authorization") || "";
    if (!/^Bearer [A-Za-z0-9_.-]{3,12000}$/.test(auth)) return reject(401, "TOKEN_REQUIRED");
    headers.set("Authorization", auth);
    headers.set("Content-Type", "application/json");
    headers.set("Content-Profile", "prototype_api");
    headers.set("Accept-Profile", "prototype_api");
    if (Number(request.headers.get("content-length")) > 600000)
      return reject(413, "PAYLOAD_TOO_LARGE");
    const reader = request.body?.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 600000) {
          await reader.cancel();
          return reject(413, "PAYLOAD_TOO_LARGE");
        }
        chunks.push(part.value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    body = bytes.buffer;
  }
  // Never propagate cookies, forwarded host, origin, or caller-supplied upstream URLs.
  try {
    const upstream = await transport(target.url, {
      method: target.method,
      headers,
      body,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const raw = await upstream.text();
    if (raw.length > 2000000) return reject(502, "BAD_RESPONSE");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return reject(502, "BAD_RESPONSE");
    }
    console.info(
      JSON.stringify({
        event: "cloud.completed",
        operation,
        status: upstream.status,
        ms: Math.round(performance.now() - start),
      }),
    );
    if (!upstream.ok) {
      if (data?.code === "P0002") return reject(404, "42501");
      if (data?.code === "22023") return reject(400, "INVALID_INPUT");
      if (data?.code === "54000") return reject(429, "CAPACITY");
      const code = ["40001", "42501", "PGRST106", "PGRST202"].includes(data?.code)
        ? data.code
        : "UPSTREAM_ERROR";
      return reject(upstream.status, code);
    }
    return Response.json(data, { status: upstream.status, headers: NO_STORE });
  } catch (error) {
    const timeout = (error as Error)?.name === "TimeoutError";
    console.warn(
      JSON.stringify({
        event: "cloud.failed",
        operation,
        code: timeout ? "TIMEOUT" : "NETWORK",
        ms: Math.round(performance.now() - start),
      }),
    );
    return reject(timeout ? 504 : 502, timeout ? "TIMEOUT" : "NETWORK");
  }
}
export default { fetch: (request: Request) => relay(request) };

const OPEN_BODY_LIMIT = 256,
  OPEN_TIMEOUT_MS = 18000;
async function openNotebook(request: Request, transport: typeof fetch): Promise<Response> {
  const reject = (status: number, code: string) =>
    Response.json({ code }, { status, headers: NO_STORE });
  if (request.method !== "POST") return reject(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    return reject(415, "JSON_REQUIRED");
  if (Number(request.headers.get("content-length")) > OPEN_BODY_LIMIT)
    return reject(413, "PAYLOAD_TOO_LARGE");
  const reader = request.body?.getReader();
  let text = "",
    bytes = 0;
  if (reader)
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > OPEN_BODY_LIMIT) {
          await reader.cancel();
          return reject(413, "PAYLOAD_TOO_LARGE");
        }
        text += new TextDecoder().decode(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    return reject(400, "INVALID_INPUT");
  }
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).length !== 1 ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.capability || "")
  )
    return reject(400, "INVALID_INPUT");
  const budget = AbortSignal.timeout(OPEN_TIMEOUT_MS),
    call = ((url: RequestInfo | URL, init: RequestInit = {}) =>
      transport(url, {
        ...init,
        signal: AbortSignal.any([budget, request.signal, ...(init.signal ? [init.signal] : [])]),
      })) as typeof fetch;
  const auth = await relay(new Request(new URL("/cloud/token/anonymous", request.url)), call);
  if (!auth.ok) return auth;
  const identity = await auth.json();
  if (typeof identity.token !== "string" || !/^[A-Za-z0-9_.-]{3,12000}$/.test(identity.token))
    return reject(502, "BAD_RESPONSE");
  // This path can only read. Caller-supplied documents and version fields were rejected above.
  const response = await relay(
    new Request(new URL("/cloud/rpc/notebook", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + identity.token },
      body: JSON.stringify({ capability: input.capability }),
    }),
    call,
  );
  if (!response.ok) return response;
  const data = await response.json();
  return Response.json({ ...data, token: identity.token }, { headers: NO_STORE });
}
