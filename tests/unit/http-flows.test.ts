import { test, expect, spyOn, afterEach } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { fetchHandler } from "../../server/fetch-adapter.ts";
import { MemoryStore, NeonStore, mutate, workspace } from "../../server/store.mjs";
import { registerProof, openSession } from "../../server/identity.mjs";
import { createWorkspace, projectShare } from "../../packages/core/workspace.mjs";
import { renderPNG } from "../../server/preview.mjs";
const env = {
  APP_ORIGIN: "https://boards.example",
  DATABASE_URL: "postgresql://fixture/db",
  OWNER_EMAIL: "owner@example.test",
  GITHUB_CLIENT_ID: "fixture",
  GITHUB_CLIENT_SECRET: "fixture",
};
const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK3cAAAAASUVORK5CYII=";
let transport: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
  transport?.mockRestore();
  transport = undefined;
});
function mockFetch(
  fn: (
    input: Parameters<typeof fetch>[0],
    options?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
) {
  transport = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fn, { preconnect: globalThis.fetch.preconnect }),
  );
}
async function harness(extra: Record<string, string> = {}) {
  const store = new MemoryStore();
  await workspace(store);
  const config = { ...env, ...extra };
  const id = await registerProof(
    store,
    {
      provider: "github",
      subject: "123",
      email: env.OWNER_EMAIL,
      name: "Owner",
      verified: true,
      avatar: "",
      url: "",
    },
    Object.assign({ linkUser: null, proposalId: null }, { env: config }),
  );
  let cookie = "";
  await openSession(
    store,
    {
      getHeader() {
        return undefined;
      },
      setHeader(k: string, v: string) {
        if (k === "Set-Cookie") cookie = v.split(";")[0];
      },
    } as never,
    id,
    config,
  );
  const dispatch = fetchHandler({ env: config, store });
  const call = (path: string, method = "GET", value?: unknown, session = cookie) =>
    dispatch(
      new Request(env.APP_ORIGIN + path, {
        method,
        headers: {
          Origin: env.APP_ORIGIN,
          Cookie: session,
          ...(value !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
      }),
    );
  return { store, config, call, cookie, dispatch };
}
test("HTTP authenticated workspace CRUD, malformed inputs, conflict and logout", async () => {
  const h = await harness();
  expect((await h.call("/api/status")).status).toBe(200);
  const initial = await (await h.call("/api/state")).json();
  initial.value.boards[0].title = "Changed via HTTP";
  expect((await h.call("/api/state", "PUT", initial)).status).toBe(200);
  expect((await h.call("/api/state", "PUT", initial)).status).toBe(409);
  const people = await (await h.call("/api/people")).json();
  expect(people.user.owner).toBe(true);
  expect(
    (await h.call("/api/people", "POST", { name: "New", email: "new@example.test" })).status,
  ).toBe(201);
  expect(
    (await h.call("/api/people", "POST", { name: "New", email: "new@example.test" })).status,
  ).toBe(409);
  expect((await h.call("/api/people", "POST", { name: "No address", email: "" })).status).toBe(400);
  expect((await h.call("/api/no-such-route")).status).toBe(404);
  expect((await h.call("/api/auth/logout", "POST", {})).status).toBe(200);
  expect((await h.call("/api/state")).status).toBe(401);
});
test("HTTP all share compositions, revocation, anonymous metadata and cached PNG", async () => {
  const h = await harness();
  for (const kind of ["board", "column", "item", "items", "space"]) {
    const scope = {
      kind,
      boardId: "roadmap",
      columnId: "product",
      itemIds: kind === "items" ? ["p1", "p2"] : ["p2"],
      neighbors: true,
    };
    const created = await h.call("/api/share", "POST", scope);
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await h.call("/api/shared?id=" + id, "GET", undefined, "")).status).toBe(200);
    expect(await (await h.call("/s/" + id, "GET", undefined, "")).text()).toContain("og:image");
    const png = await h.call("/api/og?id=" + id, "GET", undefined, "");
    expect(png.headers.get("Content-Type")).toBe("image/png");
    expect((await png.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await h.call("/api/og?id=" + id, "GET", undefined, "")).status).toBe(200);
    expect((await h.call("/api/share/revoke", "POST", { id })).status).toBe(200);
    expect((await h.call("/api/shared?id=" + id, "GET", undefined, "")).status).toBe(404);
  }
  expect((await h.call("/api/shared?id=bad", "GET", undefined, "")).status).toBe(404);
});
test("HTTP avatar proposals, rejection, approval and asset visibility", async () => {
  const h = await harness();
  expect((await h.call("/api/avatar?id=danny")).headers.get("X-Avatar-Missing")).toBe("1");
  const mine = await (
    await h.call("/api/avatar", "POST", {
      target: "owner",
      image: "data:image/png;base64," + pixel,
    })
  ).json();
  expect((await h.call("/api/avatar?id=owner")).headers.get("Content-Type")).toBe("image/png");
  expect((await h.call("/api/asset?id=" + mine.asset)).status).toBe(200);
  expect(
    (
      await h.call("/api/avatar", "POST", {
        target: "niko",
        image: "data:image/png;base64," + pixel,
      })
    ).status,
  ).toBe(201);
  expect((await h.call("/api/asset?id=missing")).status).toBe(404);
  expect((await h.call("/api/asset?id=..")).status).toBe(404);
  const suggestion = await (
    await h.call("/api/proposals/link", "POST", { target: "owner", provider: "google" })
  ).json();
  expect(
    (await h.call("/api/proposals/confirm", "POST", { id: suggestion.id, accept: false })).status,
  ).toBe(200);
  expect(
    (await h.call("/api/proposals/confirm", "POST", { id: "missing", accept: true })).status,
  ).toBe(403);
});
test("HTTP generated art, scoped anonymous art and import preserve other pages", async () => {
  const h = await harness();
  await h.store.cas("assets", "picture", 0, {
    kind: "illustration",
    mime: "image/png",
    data: pixel,
  });
  await h.store.cas("art", "art-fixture", 0, { asset: "picture" });
  await mutate(h.store, "workspace", "main", (w: ReturnType<typeof createWorkspace>) => {
    w.boards[0].columns[1].illustrationId = "art-fixture";
  });
  const { id } = await (
    await h.call("/api/share", "POST", { kind: "column", boardId: "roadmap", columnId: "product" })
  ).json();
  expect((await h.call("/api/illustration?id=art-fixture")).status).toBe(200);
  expect(
    (await h.call("/api/share-image?id=" + id + "&art=art-fixture", "GET", undefined, "")).status,
  ).toBe(200);
  expect(
    (await h.call("/api/share-image?id=" + id + "&art=art-other", "GET", undefined, "")).status,
  ).toBe(404);
  expect((await h.call("/api/illustration?id=missing")).status).toBe(404);
  expect((await h.call("/api/illustration", "POST", { title: "Marketing" })).status).toBe(200);
  expect(
    (await h.call("/api/photo", "POST", { image: "data:image/png;base64," + pixel })).status,
  ).toBe(503);
  const ws = (await workspace(h.store)).value;
  expect((await h.call("/api/import", "POST", { board: ws.boards[0] })).status).toBe(201);
  expect((await workspace(h.store)).value.boards).toHaveLength(2);
  expect((await h.call("/api/search", "POST", { query: "billing" })).status).toBe(200);
  expect((await h.call("/api/ticket", "POST", { reference: "ENG-12" })).status).toBe(503);
  expect(
    (
      await h.call("/api/backlink", "POST", {
        reference: "a/b#1",
        boardId: "roadmap",
        itemId: "p2",
      })
    ).status,
  ).toBe(503);
  expect((await h.call("/api/slack/sync", "POST", {})).status).toBe(503);
});
test("HTTP GitHub OAuth callback validates browser binding and one-use flow", async () => {
  const h = await harness();
  const started = await h.call("/api/auth/start", "POST", { provider: "github" });
  expect(started.status).toBe(200);
  const location = new URL((await started.json()).url);
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  const binding = started.headers.getSetCookie()[0]!.split(";")[0]!;
  mockFetch(async (input, options) => {
    const url = String(input);
    if (url.includes("access_token")) {
      expect(String(options?.body)).toContain("code_verifier");
      return Response.json({ access_token: "fixture" });
    }
    if (url.endsWith("/emails"))
      return Response.json([{ email: env.OWNER_EMAIL, primary: true, verified: true }]);
    return Response.json({
      id: 123,
      name: "Owner",
      login: "owner",
      avatar_url: "",
      html_url: "https://github.com/owner",
    });
  });
  const path =
    "/api/auth/callback?provider=github&code=ok&state=" + location.searchParams.get("state");
  const result = await h.call(path, "GET", undefined, binding);
  expect(result.status).toBe(303);
  expect(result.headers.getSetCookie().join(";")).toContain("boards_session");
  expect((await h.call(path, "GET", undefined, binding)).status).toBe(403);
});
test("HTTP Google OIDC proof validates signed claims before linking", async () => {
  const h = await harness({ GOOGLE_CLIENT_ID: "google-fixture", GOOGLE_CLIENT_SECRET: "fixture" });
  const started = await h.call("/api/auth/start", "POST", { provider: "google", link: true }),
    url = new URL((await started.json()).url),
    binding = started.headers.getSetCookie()[0]!.split(";")[0]!;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    jwk = { ...publicKey.export({ format: "jwk" }), kid: "fixture-key" };
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture-key" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: "google-fixture",
      sub: "google-123",
      email: env.OWNER_EMAIL,
      email_verified: true,
      name: "Owner",
      nonce: url.searchParams.get("nonce"),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    }),
  ).toString("base64url");
  const unsigned = header + "." + payload,
    jwt =
      unsigned + "." + sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url");
  mockFetch(async (input) =>
    String(input).includes("certs")
      ? Response.json({ keys: [jwk] })
      : Response.json({ access_token: "fixture", id_token: jwt }),
  );
  const result = await h.call(
    "/api/auth/callback?provider=google&code=ok&state=" + url.searchParams.get("state"),
    "GET",
    undefined,
    h.cookie + "; " + binding,
  );
  expect(result.status).toBe(303);
  expect(
    (await (await h.call("/api/people")).json()).people.find(
      (p: { id: string }) => p.id === "owner",
    ).accounts,
  ).toHaveLength(2);
});
test("HTTP magic link does not authenticate until explicit one-time POST", async () => {
  const h = await harness({ RESEND_API_KEY: "fixture", MAIL_FROM: "mail@example.test" });
  let message = "";
  mockFetch(async (_, o) => {
    message = JSON.parse(String(o?.body)).text;
    return Response.json({ id: "fixture" });
  });
  expect((await h.call("/api/auth/email", "POST", { email: env.OWNER_EMAIL })).status).toBe(200);
  const token = /verify=([\w-]+)/.exec(message)![1];
  expect((await h.call("/api/auth/verify", "POST", { token }, "")).status).toBe(200);
  expect((await h.call("/api/auth/verify", "POST", { token }, "")).status).toBe(403);
});
test("Neon driver query contract covers initialize, CAS, read and list", async () => {
  const calls: { q: string; args: unknown[] }[] = [];
  const sql = {
    async query(q: string, args: unknown[] = []) {
      calls.push({ q, args });
      if (q.startsWith("SELECT")) return [{ version: 1, value: { safe: true }, id: "x" }];
      if (q.includes("RETURNING")) return [{ version: 2 }];
      return [];
    },
  };
  const store = new NeonStore(sql);
  await store.init();
  await store.init();
  expect(calls.filter((c) => c.q.startsWith("CREATE"))).toHaveLength(2);
  for (const ns of ["workspace", "assets"]) {
    expect((await store.get(ns, "x"))?.version).toBe(1);
    expect(await store.cas(ns, "x", 0, { text: "';DROP TABLE things" })).toBe(2);
    expect(await store.cas(ns, "x", 1, { text: "value" })).toBe(2);
  }
  expect(await store.list("assets")).toHaveLength(1);
  expect(calls.map((c) => c.q).join(" ")).not.toContain("DROP TABLE");
  const empty = new NeonStore({
    async query() {
      return [];
    },
  });
  expect(await empty.get("workspace", "x")).toBeNull();
  expect(await empty.cas("assets", "x", 1, {})).toBeNull();
});
test("all preview layouts and long focus text produce bounded reproducible images", async () => {
  const h = await harness(),
    ws = (await workspace(h.store)).value;
  for (const n of [0, 1, 2, 3, 4, 6]) {
    const scope = {
      kind: "items",
      boardId: "roadmap",
      itemIds: ws.boards[0].columns
        .flatMap((c: { items: { id: string }[] }) => c.items)
        .slice(0, Math.max(1, n))
        .map((t: { id: string }) => t.id),
    };
    expect(renderPNG(projectShare(ws, scope)).readUInt32BE(16)).toBe(1200);
  }
});
