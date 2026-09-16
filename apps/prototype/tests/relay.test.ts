import { test, expect } from "bun:test";
import { relay } from "../api/cloud";
const json = { "content-type": "application/json", authorization: "Bearer test.jwt.sig" };
const transport = (fn: any) => fn as typeof fetch;
test("anonymous request strips forwarded hosts cookies and origins", async () => {
  const response = await relay(
    new Request("https://boards.example/cloud/token/anonymous", {
      headers: {
        cookie: "private",
        origin: "https://bad.example",
        "x-forwarded-host": "bad.example",
      },
    }),
    transport(async (url: string, init: RequestInit) => {
      expect(url).toContain("neonauth.");
      const headers = new Headers(init.headers);
      expect([...headers.keys()]).toEqual(["accept"]);
      expect(init.redirect).toBe("error");
      return Response.json({ token: "anonymous-token" });
    }),
  );
  expect(await response.json()).toEqual({ token: "anonymous-token" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
for (const name of ["notebook", "share_notebook", "read_shared"])
  test("RPC relay preserves body and forces minimal schema " + name, async () => {
    const request = new Request("https://boards.example/cloud/rpc/" + name, {
      method: "POST",
      headers: { ...json, "content-profile": "public", cookie: "secret" },
      body: '{"capability":"fixture"}',
    });
    const response = await relay(
      request,
      transport(async (url: string, init: RequestInit) => {
        expect(url).toEndWith("/rpc/" + name);
        expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('{"capability":"fixture"}');
        const h = new Headers(init.headers);
        expect(h.get("content-profile")).toBe("prototype_api");
        expect(h.get("authorization")).toBe(json.authorization);
        expect(h.has("cookie")).toBe(false);
        return Response.json({ version: 1 });
      }),
    );
    expect(response.status).toBe(200);
  });
for (const path of [
  "/api/cloud?operation=https://evil.example",
  "/cloud/rpc/arbitrary",
  "/api/cloud?operation=__proto__",
])
  test("Not an open proxy " + path, async () => {
    expect(
      (
        await relay(
          new Request("https://boards.example" + path),
          transport(() => {
            throw Error("Must not call");
          }),
        )
      ).status,
    ).toBe(404);
  });
test("Mutations require both JSON and a bearer token", async () => {
  const none = transport(() => {
    throw Error("Must not call");
  });
  expect((await relay(new Request("https://boards.example/cloud/rpc/notebook"), none)).status).toBe(
    405,
  );
  expect(
    (
      await relay(
        new Request("https://boards.example/cloud/rpc/notebook", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
        none,
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await relay(
        new Request("https://boards.example/cloud/rpc/notebook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        none,
      )
    ).status,
  ).toBe(401);
});
test("relay refuses oversize writes before the upstream", async () => {
  const response = await relay(
    new Request("https://boards.example/cloud/rpc/notebook", {
      method: "POST",
      headers: json,
      body: "x".repeat(600001),
    }),
    transport(() => {
      throw Error("Must not call");
    }),
  );
  expect(response.status).toBe(413);
});
test("backend SQL error text and set-cookie do not leak through", async () => {
  const r = await relay(
    new Request("https://boards.example/cloud/token/anonymous"),
    transport(async () =>
      Response.json(
        { code: "40001", message: "PRIVATE DATABASE" },
        { status: 409, headers: { "set-cookie": "SECRET" } },
      ),
    ),
  );
  expect(r.status).toBe(409);
  expect(await r.text()).not.toContain("PRIVATE");
  expect(r.headers.has("set-cookie")).toBe(false);
});
test("upstream network errors are structured and never echo raw message", async () => {
  const r = await relay(
    new Request("https://boards.example/cloud/token/anonymous"),
    transport(async () => {
      throw Error("SECRET");
    }),
  );
  expect(r.status).toBe(502);
  expect(await r.json()).toEqual({ code: "NETWORK" });
});
for (const [code, status, publicCode] of [
  ["P0002", 404, "42501"],
  ["22023", 400, "INVALID_INPUT"],
  ["54000", 429, "CAPACITY"],
] as const)
  test("SQL failure remains structured " + code, async () => {
    const response = await relay(
      new Request("https://boards.example/cloud/token/anonymous"),
      transport(async () =>
        Response.json({ code, message: "PRIVATE DATABASE DETAILS" }, { status: 500 }),
      ),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code: publicCode });
  });
