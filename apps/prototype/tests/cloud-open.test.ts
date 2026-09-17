import { test, expect } from "bun:test";
import { relay } from "../api/cloud";
const request = (body: unknown) =>
  new Request("https://boards.example/cloud/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const cap = "k".repeat(43);
test("Cold board open obtains anonymous authorization and reads in one browser request", async () => {
  const calls: any[] = [];
  const transport = (async (url: any, init: any) => {
    calls.push({ url, init });
    return String(url).includes("neonauth")
      ? Response.json({ token: "a.b.c" })
      : Response.json({ version: 5, value: { id: "fixture" } });
  }) as typeof fetch;
  const response = await relay(request({ capability: cap }), transport);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(calls).toHaveLength(2);
  expect(
    JSON.parse(
      String(
        calls[1].init.body instanceof ArrayBuffer
          ? new TextDecoder().decode(calls[1].init.body)
          : calls[1].init.body,
      ),
    ),
  ).toEqual({ capability: cap });
  expect(new Headers(calls[1].init.headers).get("authorization")).toBe("Bearer a.b.c");
  expect(await response.json()).toEqual({ version: 5, value: { id: "fixture" }, token: "a.b.c" });
});
for (const body of [
  { capability: cap, document: {} },
  { capability: "invalid" },
  null,
  {},
  { capability: cap, expected_version: 0 },
])
  test(
    "Read-only bootstrap rejects mutation or malformed input " + JSON.stringify(body),
    async () => {
      let calls = 0;
      const response = await relay(request(body), (async () => {
        calls++;
        throw Error("Must not call");
      }) as typeof fetch);
      expect(response.status).toBe(400);
      expect(calls).toBe(0);
    },
  );
test("Rejected notebook access never returns a token or private backend error", async () => {
  const response = await relay(request({ capability: cap }), (async (url: any) =>
    String(url).includes("neonauth")
      ? Response.json({ token: "a.b.c" })
      : Response.json({ code: "P0002", message: "PRIVATE" }, { status: 404 })) as typeof fetch);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ code: "42501" });
});
