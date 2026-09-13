/** Explicit identity linking: proving email never silently merges provider accounts. */
import { createHash, createPublicKey, verify } from "node:crypto";
import { mutate, workspace } from "./store.mjs";
import { hash, token, equal, fail, origin, cookie, cookies, fetchJSON } from "./http.mjs";
import { safeURL } from "../packages/core/workspace.mjs";
const empty = () => ({
  users: {},
  accounts: {},
  tokens: {},
  sessions: {},
  proposals: {},
  limits: {},
});
export const providers = {
  google: {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    exchange: "https://oauth2.googleapis.com/token",
    issuer: "https://accounts.google.com",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    scope: "openid email profile",
    pkce: true,
  },
  github: {
    auth: "https://github.com/login/oauth/authorize",
    exchange: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    pkce: true,
  },
  slack: {
    auth: "https://slack.com/openid/connect/authorize",
    exchange: "https://slack.com/api/openid.connect.token",
    issuer: "https://slack.com",
    jwks: "https://slack.com/openid/connect/keys",
    scope: "openid email profile",
  },
};
export const configuredProviders = (env) =>
  Object.keys(providers).filter(
    (p) => env[p.toUpperCase() + "_CLIENT_ID"] && env[p.toUpperCase() + "_CLIENT_SECRET"],
  );
export const identity = async (store) => (await store.get("identity", "main"))?.value || empty();
const update = (store, fn) =>
  mutate(
    store,
    "identity",
    "main",
    (d) => {
      const now = Date.now();
      for (const k of ["tokens", "sessions", "limits"])
        for (const [id, v] of Object.entries(d[k])) if (v.expires <= now) delete d[k][id];
      return fn(d);
    },
    empty(),
  );
export async function limit(store, key, count = 30, windowMs = 3600000) {
  await update(store, (d) => {
    const k = hash(key),
      b = d.limits[k] || { count: 0, expires: Date.now() + windowMs };
    if (b.count >= count) throw fail("Too many requests. Please try later.", 429);
    b.count++;
    d.limits[k] = b;
  });
}
export async function session(store, req) {
  const raw = cookies(req).boards_session;
  if (!raw) return null;
  const d = await identity(store),
    s = d.sessions[hash(raw)];
  if (!s || s.expires <= Date.now() || !d.users[s.userId]) return null;
  return { ...d.users[s.userId], sessionCreated: s.created, sessionHash: hash(raw) };
}
export async function requireUser(store, req) {
  const user = await session(store, req);
  if (!user) throw fail("Sign in first.", 401);
  return user;
}
export async function openSession(store, res, userId, env) {
  const raw = token();
  await update(store, (d) => {
    if (!d.users[userId]) throw fail("Unknown identity", 403);
    d.sessions[hash(raw)] = { userId, created: Date.now(), expires: Date.now() + 7 * 86400000 };
  });
  cookie(res, "boards_session", raw, env, { maxAge: 7 * 86400 });
}
export async function logout(store, req, res, env) {
  await update(store, (d) => {
    delete d.sessions[hash(cookies(req).boards_session || "")];
  });
  cookie(res, "boards_session", "", env, { maxAge: 0 });
}
export function publicUser(user) {
  return user ? { id: user.id, name: user.name, personId: user.id, owner: !!user.owner } : null;
}
export async function members(store, user) {
  const ws = (await workspace(store)).value,
    d = await identity(store);
  return ws.people.map((p) => {
    const u = d.users[p.id],
      pending = Object.values(d.proposals)
        .sort((a, b) => b.created - a.created)
        .find(
          (r) =>
            r.type === "avatar" &&
            r.target === p.id &&
            r.by === user?.id &&
            r.status === "pending" &&
            r.expires > Date.now(),
        );
    return {
      ...p,
      avatar: pending
        ? `/api/asset?id=${pending.asset}`
        : u?.avatarAsset
          ? `/api/asset?id=${u.avatarAsset}`
          : `/api/avatar?id=${p.id}`,
      avatarPending: !!pending,
      accounts: (u?.profiles || []).map((x) => ({ provider: x.provider, url: x.url })),
      isSelf: p.id === user?.id,
    };
  });
}
export async function invitedPerson(store, email, env) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  email = email.toLowerCase().trim();
  const ws = (await workspace(store)).value;
  const existing = ws.people.find((p) => p.email?.toLowerCase() === email);
  if (existing) return existing;
  if (!env.OWNER_EMAIL || email !== env.OWNER_EMAIL.toLowerCase()) return null;
  const p = {
    id: "owner",
    name: email.split("@")[0],
    email,
    avatar: "",
    slackUserId: "",
    slackUrl: "",
  };
  await mutate(
    store,
    "workspace",
    "main",
    (w) => {
      if (!w.people.some((p) => p.id === "owner")) w.people.push(p);
    },
    ws,
  );
  return p;
}
export async function registerProof(
  store,
  proof,
  { env, linkUser = null, proposalId = null } = {},
) {
  if (
    !proof.verified ||
    !Object.hasOwn(providers, proof.provider) ||
    typeof proof.subject !== "string" ||
    !proof.subject ||
    typeof proof.email !== "string" ||
    !proof.email
  )
    throw fail("A verified provider identity is required.", 403);
  const account = proof.provider + ":" + proof.subject;
  const person = linkUser ? { id: linkUser.id } : await invitedPerson(store, proof.email, env);
  // Existing provider accounts may log in even after the provider changes an email.
  return update(store, (d) => {
    const mapped = d.accounts[account];
    if (mapped) {
      if (linkUser && mapped !== linkUser.id)
        throw fail("This account is already linked to someone else.", 409);
      const user = d.users[mapped];
      if (!user) throw fail("Identity record is unavailable.", 403);
      const profile = user.profiles.find(
        (p) => p.provider === proof.provider && p.subject === proof.subject,
      );
      if (profile) {
        profile.avatar = safeURL(proof.avatar, { avatar: true });
        profile.url = safeURL(proof.url);
      }
      if (proposalId) {
        const p = d.proposals[proposalId];
        if (
          !linkUser ||
          !p ||
          p.target !== mapped ||
          p.type !== "link" ||
          p.provider !== proof.provider ||
          p.status !== "pending" ||
          p.expires <= Date.now()
        )
          throw fail("Invalid linking request.", 403);
        p.status = "approved";
      }
      return mapped;
    }
    if (!person) throw fail("This is an invite-only workspace.", 403);
    if (linkUser && (!d.users[linkUser.id] || Date.now() - linkUser.sessionCreated > 10 * 60000))
      throw fail("Sign in again before linking an account.", 403);
    if (!linkUser && d.users[person.id])
      throw fail(
        "Sign in with an existing account, then link this provider from your profile.",
        409,
      );
    if (proposalId) {
      const p = d.proposals[proposalId];
      if (
        !p ||
        p.target !== person.id ||
        p.type !== "link" ||
        p.provider !== proof.provider ||
        p.status !== "pending" ||
        p.expires <= Date.now()
      )
        throw fail("Invalid linking request.", 403);
      p.status = "approved";
    }
    d.users[person.id] ||= {
      id: person.id,
      name: proof.name || person.name,
      email: proof.email,
      owner: proof.email.toLowerCase() === env.OWNER_EMAIL?.toLowerCase(),
      profiles: [],
      avatarAsset: "",
    };
    const user = d.users[person.id];
    user.profiles.push({
      provider: proof.provider,
      subject: proof.subject,
      url: safeURL(proof.url),
      avatar: safeURL(proof.avatar, { avatar: true }),
    });
    d.accounts[account] = person.id;
    return person.id;
  });
}
export async function beginOAuth(store, req, res, input, env) {
  const p = providers[input.provider];
  if (!p || !configuredProviders(env).includes(input.provider))
    throw fail("Configure this login provider first.", 503);
  await limit(store, "oauth:" + req.socket?.remoteAddress, 60);
  let linkUser = null;
  if (input.link) {
    linkUser = await requireUser(store, req);
    if (Date.now() - linkUser.sessionCreated > 10 * 60000)
      throw fail("Sign in again to link an account.", 403);
  }
  const state = token(),
    bind = token(),
    nonce = token(),
    verifier = token(),
    callback = origin(env) + "/api/auth/callback?provider=" + input.provider;
  await update(store, (d) => {
    d.tokens[hash(state)] = {
      kind: "oauth",
      provider: input.provider,
      binding: hash(bind),
      nonce,
      verifier,
      callback,
      linkUser,
      proposalId: input.proposalId || null,
      expires: Date.now() + 10 * 60000,
    };
  });
  cookie(res, "boards_oauth", bind, env, {
    maxAge: 600,
    sameSite: input.provider === "slack" && origin(env).startsWith("https:") ? "None" : "Lax",
  });
  const url = new URL(p.auth);
  const args = {
    client_id: env[input.provider.toUpperCase() + "_CLIENT_ID"],
    redirect_uri: callback,
    response_type: "code",
    scope: p.scope,
    state,
    nonce,
  };
  if (p.pkce) {
    args.code_challenge = createHash("sha256").update(verifier).digest("base64url");
    args.code_challenge_method = "S256";
  }
  if (input.provider === "slack" && env.SLACK_TEAM_ID) args.team = env.SLACK_TEAM_ID;
  for (const [k, v] of Object.entries(args)) url.searchParams.set(k, v);
  return { url: url.href };
}
export function verifyIDToken(raw, { issuer, audience, nonce, jwks, now = Date.now() }) {
  try {
    const parts = raw.split(".");
    if (parts.length !== 3) throw Error();
    const h = JSON.parse(Buffer.from(parts[0], "base64url")),
      p = JSON.parse(Buffer.from(parts[1], "base64url"));
    if (h.alg !== "RS256" || typeof h.kid !== "string") throw Error();
    const jwk = jwks.keys.find(
      (k) => k.kid === h.kid && k.kty === "RSA" && (!k.use || k.use === "sig"),
    );
    if (
      !jwk ||
      !verify(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1]),
        createPublicKey({ key: jwk, format: "jwk" }),
        Buffer.from(parts[2], "base64url"),
      )
    )
      throw Error();
    if (
      p.iss !== issuer ||
      !(Array.isArray(p.aud) ? p.aud : [p.aud]).includes(audience) ||
      (p.azp && p.azp !== audience) ||
      typeof p.exp !== "number" ||
      p.exp * 1000 <= now ||
      typeof p.iat !== "number" ||
      p.iat * 1000 > now + 60000 ||
      !p.sub ||
      !equal(p.nonce, nonce)
    )
      throw Error();
    return p;
  } catch {
    throw fail("Invalid identity token.", 403);
  }
}
const jwksCache = new Map();
async function jwks(url) {
  const old = jwksCache.get(url);
  if (old && old.expires > Date.now()) return old.value;
  const value = await fetchJSON(url);
  jwksCache.set(url, { value, expires: Date.now() + 300000 });
  return value;
}
export async function finishOAuth(store, req, res, query, env) {
  const state = query.get("state") || "",
    provided = query.get("provider"),
    bind = cookies(req).boards_oauth;
  const flow = await update(store, (d) => {
    const x = d.tokens[hash(state)];
    if (
      !x ||
      x.kind !== "oauth" ||
      x.provider !== provided ||
      x.binding !== hash(bind || "") ||
      x.expires <= Date.now()
    )
      throw fail("Login expired or browser mismatch.", 403);
    delete d.tokens[hash(state)];
    return x;
  });
  cookie(res, "boards_oauth", "", env, { maxAge: 0 });
  if (query.get("error") || !query.get("code")) throw fail("Login cancelled.");
  if (flow.linkUser) {
    const current = await session(store, req),
      saved = (await identity(store)).sessions[flow.linkUser.sessionHash];
    if (
      !saved ||
      saved.expires <= Date.now() ||
      saved.userId !== flow.linkUser.id ||
      (current && current.id !== flow.linkUser.id)
    )
      throw fail("Identity changed during linking.", 403);
  }
  const p = providers[provided],
    params = {
      grant_type: "authorization_code",
      client_id: env[provided.toUpperCase() + "_CLIENT_ID"],
      client_secret: env[provided.toUpperCase() + "_CLIENT_SECRET"],
      code: query.get("code"),
      redirect_uri: flow.callback,
    };
  if (p.pkce) params.code_verifier = flow.verifier;
  const response = await fetchJSON(p.exchange, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  });
  if (!response.access_token) throw fail("Login provider did not return an access token.", 502);
  let proof;
  if (provided === "github") {
    const headers = {
      Authorization: "Bearer " + response.access_token,
      Accept: "application/vnd.github+json",
      "User-Agent": "boards-app",
    };
    const profile = await fetchJSON("https://api.github.com/user", { headers }),
      emails = await fetchJSON("https://api.github.com/user/emails", { headers });
    const email = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
    proof = {
      provider: provided,
      subject: String(profile.id),
      email: email?.email,
      verified: !!email,
      name: profile.name || profile.login,
      avatar: profile.avatar_url,
      url: profile.html_url,
    };
  } else {
    const claims = verifyIDToken(response.id_token, {
      issuer: p.issuer,
      audience: params.client_id,
      nonce: flow.nonce,
      jwks: await jwks(p.jwks),
    });
    let profile = claims;
    if (provided === "slack") {
      if (env.SLACK_TEAM_ID && claims["https://slack.com/team_id"] !== env.SLACK_TEAM_ID)
        throw fail("Wrong Slack workspace.", 403);
      profile = await fetchJSON("https://slack.com/api/openid.connect.userInfo", {
        method: "POST",
        headers: { Authorization: "Bearer " + response.access_token },
      });
      if (profile.sub !== claims.sub) throw fail("Slack identity mismatch.", 403);
    }
    proof = {
      provider: provided,
      subject:
        provided === "slack" ? claims["https://slack.com/team_id"] + ":" + claims.sub : claims.sub,
      email: claims.email,
      verified: claims.email_verified === true || claims.email_verified === "true",
      name: profile.name,
      avatar: profile.picture,
      url: provided === "slack" ? `https://app.slack.com/team/${claims.sub}` : "",
    };
  }
  const id = await registerProof(store, proof, {
    env,
    linkUser: flow.linkUser,
    proposalId: flow.proposalId,
  });
  await openSession(store, res, id, env);
  return id;
}
export async function sendMail(env, to, subject, text) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM)
    throw fail("Configure Resend and a verified sender domain first.", 503);
  return fetchJSON("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
  });
}
export async function magicLink(store, req, input, env) {
  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
    throw fail("Enter a valid email.");
  await limit(store, "email:" + email, 3, 3600000);
  await limit(store, "email-total", 80, 86400000);
  const p = await invitedPerson(store, email, env);
  if (!p) return { sent: true };
  const raw = token();
  await update(store, (d) => {
    d.tokens[hash(raw)] = {
      kind: "email",
      email,
      personId: p.id,
      expires: Date.now() + 15 * 60000,
    };
  });
  await sendMail(
    env,
    email,
    "Your sign-in link",
    `Sign in to your private board:\n${origin(env)}/?verify=${raw}\n\nThis one-time link expires in 15 minutes. Ignore this message if you did not request it.`,
  );
  return { sent: true };
}
export async function verifyMagic(store, res, raw, env) {
  const userId = await update(store, (d) => {
    const t = d.tokens[hash(raw)];
    if (!t || t.kind !== "email" || t.expires <= Date.now())
      throw fail("Link expired or already used.", 403);
    delete d.tokens[hash(raw)];
    d.users[t.personId] ||= {
      id: t.personId,
      name: t.email.split("@")[0],
      email: t.email,
      owner: t.email === env.OWNER_EMAIL?.toLowerCase(),
      profiles: [],
      avatarAsset: "",
    };
    const key = "email:" + t.email;
    if (d.accounts[key] && d.accounts[key] !== t.personId)
      throw fail("Email is already connected.", 409);
    d.accounts[key] = t.personId;
    return t.personId;
  });
  await openSession(store, res, userId, env);
}
export async function testLogin(store, res, env) {
  if (env.LOCAL_TEST_MODE !== "1" || env.VERCEL) throw fail("Not found", 404);
  const ws = (await workspace(store)).value;
  await mutate(
    store,
    "workspace",
    "main",
    (w) => {
      if (!w.people.some((p) => p.id === "owner"))
        w.people.push({
          id: "owner",
          name: "Local tester",
          email: "test@example.test",
          avatar: "",
          slackUserId: "",
          slackUrl: "",
        });
    },
    ws,
  );
  await update(store, (d) => {
    d.users.owner ||= {
      id: "owner",
      name: "Local tester",
      email: "test@example.test",
      owner: true,
      profiles: [],
      avatarAsset: "",
    };
  });
  await openSession(store, res, "owner", env);
}
/** Pending profile changes are independent from canonical identity data. */
export async function propose(store, user, input) {
  const ws = (await workspace(store)).value;
  if (!ws.people.some((p) => p.id === input.target)) throw fail("Person not found", 404);
  if (
    !["avatar", "link"].includes(input.type) ||
    (input.type === "link" && !Object.hasOwn(providers, input.provider))
  )
    throw fail("Invalid proposal");
  const id = token().slice(0, 24);
  return update(store, (d) => {
    if (input.type === "avatar" && input.target !== user.id && d.users[input.target]?.avatarAsset)
      throw fail("This person already has a photo. Only they can replace it.", 409);
    const existing = Object.values(d.proposals).find(
      (p) =>
        p.type === input.type &&
        p.target === input.target &&
        p.by === user.id &&
        p.status === "pending" &&
        p.expires > Date.now() &&
        (input.type === "avatar" || p.provider === input.provider),
    );
    if (existing && input.type === "link") return existing.id;
    if (existing) {
      existing.status = "superseded";
      existing.resolved = Date.now();
    }
    d.proposals[id] = {
      id,
      type: input.type,
      target: input.target,
      by: user.id,
      asset: input.asset || "",
      provider: input.provider || "",
      status: "pending",
      baseAvatarRevision: d.users[input.target]?.avatarRevision || 0,
      created: Date.now(),
      expires: Date.now() + 7 * 86400000,
    };
    return id;
  });
}
function replaceAvatar(d, userId, asset, acceptedId = null) {
  const user = d.users[userId];
  if (!user) throw fail("Sign in first.", 401);
  user.avatarAsset = asset;
  user.avatarRevision = (user.avatarRevision || 0) + 1;
  for (const p of Object.values(d.proposals))
    if (
      p.type === "avatar" &&
      p.target === userId &&
      p.status === "pending" &&
      p.id !== acceptedId
    ) {
      p.status = "superseded";
      p.resolved = Date.now();
    }
}
export async function approveAvatar(store, user, id, accept) {
  return update(store, (d) => {
    const p = d.proposals[id];
    if (!p || p.target !== user.id || p.status !== "pending" || p.expires <= Date.now())
      throw fail("Only the owner can respond to a current request.", 403);
    if (!accept) {
      p.status = "rejected";
      p.resolved = Date.now();
      return p;
    }
    if (p.type !== "avatar")
      throw fail("Prove ownership through the provider sign-in to link this account.", 403);
    if ((p.baseAvatarRevision || 0) !== (d.users[user.id]?.avatarRevision || 0))
      throw fail(
        "Your photo changed after this suggestion. Keep your newer photo or upload a new one.",
        409,
      );
    replaceAvatar(d, user.id, p.asset, id);
    p.status = "approved";
    p.resolved = Date.now();
    return p;
  });
}
export async function ownAvatar(store, user, asset) {
  await update(store, (d) => replaceAvatar(d, user.id, asset));
}
export async function profileRequests(store, user) {
  const d = await identity(store);
  return Object.values(d.proposals).filter(
    (p) =>
      (p.target === user.id || p.by === user.id) &&
      p.status === "pending" &&
      p.expires > Date.now(),
  );
}
