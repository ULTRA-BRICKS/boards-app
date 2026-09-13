import { createHandler } from "./app.mjs";

/** Bridge the existing HTTP contract to Bun/Fetch without opening a Node HTTP server. */
export function fetchHandler(
  options: { env?: NodeJS.ProcessEnv; store?: import("./store.mjs").MemoryStore } = {},
) {
  const handle = createHandler(options);
  return async function dispatch(request: Request): Promise<Response> {
    let bytes: Buffer | undefined;
    if (request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > 2_400_000) {
          await reader.cancel();
          return Response.json({ error: "Payload too large" }, { status: 413 });
        }
        chunks.push(result.value);
      }
      bytes = Buffer.concat(chunks);
    }
    const headers = new Headers();
    const response = {
      statusCode: 200,
      setHeader(name: string, value: string | string[]) {
        headers.delete(name);
        for (const part of Array.isArray(value) ? value : [value]) headers.append(name, part);
      },
      getHeader(name: string) {
        return name.toLowerCase() === "set-cookie" ? headers.getSetCookie() : headers.get(name);
      },
      body: undefined as BodyInit | undefined,
      end(body?: BodyInit) {
        this.body = body;
      },
    };
    await handle(
      {
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers),
        body: bytes,
        socket: { remoteAddress: "fetch-ingress" },
      },
      response,
    );
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.statusCode,
      headers,
    });
  };
}
