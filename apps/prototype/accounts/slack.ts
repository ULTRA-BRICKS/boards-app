import {
  createHmac,
  timingSafeEqual,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { AccessError, normalizeEmail } from "./policy";
export function verifySlackRequest(
  body: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
): boolean {
  const timestamp = headers.get("x-slack-request-timestamp") || "",
    signature = headers.get("x-slack-signature") || "";
  if (
    !secret ||
    !/^\d{10,12}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    !/^v0=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const expected =
    "v0=" +
    createHmac("sha256", secret)
      .update("v0:" + timestamp + ":" + body)
      .digest("hex");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
export function sealSlackToken(value: string, key: string): string {
  const decoded = Buffer.from(key, "base64");
  if (decoded.length !== 32) throw new AccessError("SLACK_ENCRYPTION_NOT_CONFIGURED", 503);
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", decoded, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}
export function openSlackToken(value: string, key: string): string {
  const decoded = Buffer.from(key, "base64"),
    parts = value.split(".");
  if (decoded.length !== 32 || parts.length !== 3)
    throw new AccessError("INVALID_SLACK_CREDENTIAL", 503);
  const [iv, tag, data] = parts.map((p) => Buffer.from(p, "base64url"));
  if (iv.length !== 12 || tag.length !== 16) throw new AccessError("INVALID_SLACK_CREDENTIAL", 503);
  const decipher = createDecipheriv("aes-256-gcm", decoded, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
export function allowedUnfurl(href: string, origin: string): boolean {
  try {
    const u = new URL(href);
    return (
      u.origin === new URL(origin).origin &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      /^\/s\/[a-f0-9]{64}\/?$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
export type SlackPerson = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  slackUrl: string;
};
export async function slackDirectory(
  token: string,
  expectedTeam: string,
  transport: typeof fetch = fetch,
): Promise<SlackPerson[]> {
  if (!token || !expectedTeam) throw new AccessError("SLACK_NOT_CONNECTED", 503);
  async function call(method: string, body: Record<string, string>) {
    const response = await transport("https://slack.com/api/" + method, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw new AccessError(
        response.status === 429 ? "SLACK_RATE_LIMITED" : "SLACK_REQUEST_FAILED",
        response.status === 429 ? 429 : 502,
      );
    return data;
  }
  const identity = await call("auth.test", {});
  if (identity.team_id !== expectedTeam) throw new AccessError("SLACK_TEAM_MISMATCH", 403);
  let cursor = "";
  const result: SlackPerson[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const data = await call("users.list", { limit: "200", ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(data.members)) throw new AccessError("SLACK_INVALID_DIRECTORY", 502);
    for (const user of data.members) {
      if (
        user.deleted ||
        user.is_bot ||
        user.is_app_user ||
        user.id === "USLACKBOT" ||
        seen.has(user.id)
      )
        continue;
      if (!/^[UW][A-Z0-9]+$/.test(user.id)) continue;
      seen.add(user.id);
      let email = "";
      try {
        email = normalizeEmail(user.profile?.email);
      } catch {}
      let avatar = "";
      try {
        const u = new URL(user.profile?.image_192 || user.profile?.image_72 || "");
        if (
          u.protocol === "https:" &&
          ["avatars.slack-edge.com", "secure.gravatar.com"].includes(u.hostname) &&
          !u.username &&
          !u.password
        )
          avatar = u.href;
      } catch {}
      result.push({
        id: user.id,
        name: String(user.profile?.real_name || user.real_name || user.name || "").slice(0, 120),
        email,
        avatar,
        slackUrl: "https://app.slack.com/team/" + user.id,
      });
    }
    cursor = data.response_metadata?.next_cursor || "";
    if (!cursor) return result;
  }
  throw new AccessError("SLACK_DIRECTORY_TOO_LARGE", 413);
}
export const SLACK_MANIFEST = {
  display_information: {
    name: "Boards",
    description: "Workspace people and shared board previews",
  },
  oauth_config: {
    scopes: { bot: ["users:read", "users:read.email", "links:read", "links:write"] },
    redirect_urls: ["https://boards-app-gamma.vercel.app/accounts/slack/callback"],
  },
  settings: {
    event_subscriptions: {
      request_url: "https://boards-app-gamma.vercel.app/accounts/slack/events",
      bot_events: ["link_shared"],
    },
    interactivity: { is_enabled: false },
    org_deploy_enabled: false,
    socket_mode_enabled: false,
    token_rotation_enabled: false,
  },
  features: {
    bot_user: { display_name: "Boards", always_online: false },
    unfurl_domains: ["boards-app-gamma.vercel.app"],
  },
};
