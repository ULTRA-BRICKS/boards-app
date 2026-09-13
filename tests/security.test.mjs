import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { MemoryStore, workspace, mutate } from "../server/store.mjs";
import {
  identity,
  registerProof,
  verifyIDToken,
  openSession,
  session,
  propose,
  approveAvatar,
  members,
  magicLink,
  verifyMagic,
  testLogin,
  limit,
} from "../server/identity.mjs";
import { uploadAvatar, readAsset, imageBytes, trustedAvatar } from "../server/assets.mjs";
import { createHandler } from "../server/app.mjs";
import { cookie as setCookie, hash } from "../server/http.mjs";
const env = {
  APP_ORIGIN: "https://boards.example",
  OWNER_EMAIL: "owner@example.test",
  DATABASE_URL: "postgresql://test",
  GITHUB_CLIENT_ID: "test",
  GITHUB_CLIENT_SECRET: "test",
};
const proof = (provider, subject, email = "owner@example.test") => ({
  provider,
  subject,
  email,
  verified: true,
  name: subject,
  avatar: "",
  url: "",
});
function response() {
  const h = {};
  return {
    statusCode: 200,
    setHeader(k, v) {
      h[k] = v;
    },
    getHeader(k) {
      return h[k];
    },
    end(b = "") {
      this.output = String(b);
    },
    headers: h,
  };
}
async function setup() {
  const s = new MemoryStore();
  await workspace(s);
  const id = await registerProof(s, proof("github", "123"), { env });
  const res = response();
  await openSession(s, res, id, env);
  const req = { headers: { cookie: res.headers["Set-Cookie"].split(";")[0] } };
  return { s, id, user: await session(s, req), cookie: req.headers.cookie };
}
async function request(
  handler,
  path,
  { method = "GET", data, cookie, origin = env.APP_ORIGIN } = {},
) {
  const req = {
      url: path,
      method,
      body: data,
      headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
      socket: { remoteAddress: "127.0.0.1" },
    },
    res = response();
  await handler(req, res);
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.output,
    json: () => JSON.parse(res.output),
  };
}
test("sessions are opaque hashed server records, HTTP-only and secure", async () => {
  const { s, cookie, user } = await setup(),
    d = await identity(s);
  assert.equal(user.id, "owner");
  assert.ok(d.sessions[hash(cookie.split("=")[1])]);
  assert.ok(!JSON.stringify(d).includes(cookie.split("=")[1]));
  const r = response();
  setCookie(r, "session", "opaque", env);
  assert.match(r.headers["Set-Cookie"], /HttpOnly/);
  assert.match(r.headers["Set-Cookie"], /Secure/);
});
test("verified email alone never merges a second OAuth provider", async () => {
  const { s } = await setup();
  await assert.rejects(() => registerProof(s, proof("google", "g-1"), { env }), /existing account/);
});
test("recent authenticated account explicitly links; same provider identity cannot be stolen", async () => {
  const { s, user } = await setup();
  assert.equal(await registerProof(s, proof("google", "g1"), { env, linkUser: user }), "owner");
  await mutate(s, "workspace", "main", (w) =>
    w.people.push({
      id: "other",
      name: "Other",
      email: "other@example.test",
      avatar: "",
      slackUserId: "",
      slackUrl: "",
    }),
  );
  const otherId = await registerProof(s, proof("github", "456", "other@example.test"), { env });
  assert.equal(otherId, "other");
  await assert.rejects(
    () =>
      registerProof(s, proof("google", "g1"), {
        env,
        linkUser: { id: "other", sessionCreated: Date.now() },
      }),
    /already linked/,
  );
});
test("linking another provider requires recent authentication", async () => {
  const { s, user } = await setup();
  await assert.rejects(
    () =>
      registerProof(s, proof("google", "g1"), {
        env,
        linkUser: { ...user, sessionCreated: Date.now() - 660000 },
      }),
    /again/,
  );
});
test("new provider identity for uninvited email is denied", async () => {
  const s = new MemoryStore();
  await assert.rejects(
    () => registerProof(s, proof("github", "999", "stranger@example.test"), { env }),
    /invite-only/,
  );
});
test("prototype provider names cannot become linking requests", async () => {
  const { s, user } = await setup();
  await assert.rejects(
    () => propose(s, user, { type: "link", target: user.id, provider: "toString" }),
    /Invalid/,
  );
});
test("third-party link proposal still requires target OAuth proof", async () => {
  const { s, user } = await setup();
  const id = await propose(
    s,
    { id: "someone" },
    { type: "link", target: user.id, provider: "google" },
  );
  assert.equal((await identity(s)).proposals[id].status, "pending");
  await registerProof(s, proof("google", "g2"), { env, linkUser: user, proposalId: id });
  assert.equal((await identity(s)).proposals[id].status, "approved");
});
test("expired linking request is rejected", async () => {
  const { s, user } = await setup();
  const id = await propose(s, user, { type: "link", target: user.id, provider: "google" });
  await mutate(s, "identity", "main", (d) => (d.proposals[id].expires = 0));
  await assert.rejects(
    () => registerProof(s, proof("google", "g3"), { env, linkUser: user, proposalId: id }),
    /Invalid linking/,
  );
});
test("avatar URLs allow only known HTTPS image CDNs", () => {
  for (const u of [
    "http://127.0.0.1/x",
    "https://avatars.githubusercontent.com.evil.test/x",
    "https://user:pass@avatars.githubusercontent.com/x",
    "https://avatars.githubusercontent.com:1234/x",
  ])
    assert.equal(trustedAvatar(u), null);
  assert.ok(trustedAvatar("https://avatars.githubusercontent.com/u/123"));
});
test("SVG and mismatched image types cannot be uploaded", () => {
  assert.throws(() => imageBytes("data:image/svg+xml;base64,PHN2Zz4="));
  assert.throws(() =>
    imageBytes("data:image/png;base64," + Buffer.from("not-a-png-long-enough").toString("base64")),
  );
});
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK3cAAAAASUVORK5CYII=";
test("proposed avatar is immediate for uploader, hidden for other people until owner approval", async () => {
  const { s, user } = await setup();
  const r = await uploadAvatar(s, { id: "danny" }, { target: "owner", image: pixel });
  assert.equal(r.status, "pending");
  assert.equal(
    (await members(s, { id: "danny" })).find((p) => p.id === "owner").avatarPending,
    true,
  );
  assert.equal(
    (await members(s, { id: "niko" })).find((p) => p.id === "owner").avatarPending,
    false,
  );
  await assert.rejects(() => readAsset(s, { id: "niko" }, r.asset), /approval/);
  await assert.rejects(() => approveAvatar(s, { id: "danny" }, r.proposalId, true), /Only/);
  await approveAvatar(s, user, r.proposalId, true);
  assert.equal((await readAsset(s, { id: "niko" }, r.asset)).mime, "image/png");
  assert.equal(
    (await members(s, { id: "niko" })).find((p) => p.id === "owner").avatarPending,
    false,
  );
});
test("another person cannot replace an existing approved avatar", async () => {
  const { s, user } = await setup();
  await uploadAvatar(s, user, { target: "owner", image: pixel });
  await assert.rejects(
    () => uploadAvatar(s, { id: "danny" }, { target: "owner", image: pixel }),
    /already has a photo/,
  );
});
test("OIDC validates RS256 signature, issuer, audience, expiry and nonce", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "k1";
  const claims = {
    iss: "https://issuer",
    aud: "client",
    sub: "subject",
    nonce: "expected",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const make = (p) => {
    const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url"),
      b = Buffer.from(JSON.stringify(p)).toString("base64url");
    return (
      h +
      "." +
      b +
      "." +
      sign("RSA-SHA256", Buffer.from(h + "." + b), privateKey).toString("base64url")
    );
  };
  const o = { issuer: claims.iss, audience: "client", nonce: "expected", jwks: { keys: [jwk] } };
  assert.equal(verifyIDToken(make(claims), o).sub, "subject");
  for (const changes of [{ aud: "attacker" }, { nonce: "bad" }, { exp: 1 }, { iss: "other" }])
    assert.throws(() => verifyIDToken(make({ ...claims, ...changes }), o));
  assert.throws(() => verifyIDToken(make(claims).replace(/.$/, "!"), o));
});
test("global request limit is durable and rejects over-cap", async () => {
  const s = new MemoryStore();
  await limit(s, "email", 2);
  await limit(s, "email", 2);
  await assert.rejects(
    () => limit(s, "email", 2),
    (e) => e.status === 429,
  );
});
test("email sign-in is explicitly submitted and can only be used once (mock email transport)", async (t) => {
  const { s } = await setup();
  let email;
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    email = JSON.parse(opts.body);
    return Response.json({ id: "email-id" });
  });
  await magicLink(
    s,
    { headers: {}, socket: {} },
    { email: "owner@example.test" },
    { ...env, RESEND_API_KEY: "mock", MAIL_FROM: "board@example.test" },
  );
  const raw = /verify=([\w-]+)/.exec(email.text)[1];
  assert.ok(!(await identity(s)).tokens[raw]);
  await verifyMagic(s, response(), raw, env);
  await assert.rejects(() => verifyMagic(s, response(), raw, env), /expired|used/);
});
test("missing cloud/auth returns setup instead of private state", async () => {
  const h = createHandler({ env: { APP_ORIGIN: env.APP_ORIGIN }, store: new MemoryStore() });
  assert.equal((await request(h, "/api/status")).json().ready, false);
  assert.equal((await request(h, "/api/state")).status, 503);
});
test("unauthenticated state and writes are rejected", async () => {
  const h = createHandler({ env, store: new MemoryStore() });
  assert.equal((await request(h, "/api/state")).status, 401);
  assert.equal((await request(h, "/api/state", { method: "PUT", data: {} })).status, 401);
});
test("CSRF origin and stale version checks reject writes; profile fields cannot be forged", async () => {
  const { s, cookie } = await setup(),
    h = createHandler({ env, store: s }),
    old = await workspace(s);
  assert.equal(
    (
      await request(h, "/api/state", {
        method: "PUT",
        cookie,
        origin: "https://evil.example",
        data: { version: old.version, value: old.value },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(h, "/api/state", {
        method: "PUT",
        cookie,
        data: { version: 0, value: old.value },
      })
    ).status,
    409,
  );
  old.value.people[0].email = "stolen@example.test";
  old.value.boards[0].title = "Changed";
  assert.equal(
    (
      await request(h, "/api/state", {
        method: "PUT",
        cookie,
        data: { version: old.version, value: old.value },
      })
    ).status,
    200,
  );
  const current = await workspace(s);
  assert.equal(current.value.people[0].email, "");
  assert.equal(current.value.boards[0].title, "Changed");
});
test("test login cannot run in a Vercel deployment", async () => {
  const s = new MemoryStore();
  await assert.rejects(
    () => testLogin(s, response(), { ...env, LOCAL_TEST_MODE: "1", VERCEL: "1" }),
    (e) => e.status === 404,
  );
});
test("unclassified server failure never returns credentials", async () => {
  const { s, cookie } = await setup(),
    h = createHandler({ env, store: s });
  s.get = async () => {
    throw Error("postgresql://user:SECRET@db");
  };
  const r = await request(h, "/api/state", { cookie });
  assert.equal(r.status, 500);
  assert.ok(!r.body.includes("SECRET"));
});
