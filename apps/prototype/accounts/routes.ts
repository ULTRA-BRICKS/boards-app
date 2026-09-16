import { boundedJSON, boundedText } from "./request-body";
import { SlackService } from "./slack-service";
import { CorporateAuth } from "./auth";
import { WorkspaceService } from "./service";
import { AccessError, requireIdentity } from "./policy";
import { NotificationWorker } from "./notifications";
import { createHash, timingSafeEqual } from "node:crypto";
const HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export type AccountRuntime = {
  auth: CorporateAuth;
  service: WorkspaceService;
  worker: NotificationWorker;
  origin: string;
  cronSecret: string;
  slack?: SlackService;
};
function sessionCookie(req: Request) {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("__Host-boards_session="))
    ?.slice("__Host-boards_session=".length);
}
// Domain-specific payload fields are validated by the service methods.
async function payload(req: Request): Promise<any> {
  const value = await boundedJSON(req);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccessError("INVALID_BODY", 400);
  return value;
}
export function accountRoutes(runtime: AccountRuntime | null) {
  return async (request: Request) => {
    const url = new URL(request.url),
      path = url.pathname.replace(/^\/accounts\/?/, "");
    const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      Response.json(body, { status, headers: { ...HEADERS, ...headers } });
    if (path === "status" && request.method === "GET")
      return reply({
        configured: !!runtime,
        login: "corporate-email",
        slackLogin: false,
        notifications: runtime ? "configured" : "unconfigured",
      });
    if (!runtime) return reply({ code: "ACCOUNTS_NOT_CONFIGURED" }, 503);
    try {
      if (path === "slack/events" && request.method === "POST") {
        if (!runtime.slack) throw new AccessError("SLACK_NOT_CONFIGURED", 503);
        return reply(
          await runtime.slack.event(await boundedText(request, 1_000_000), request.headers),
        );
      }
      if (path === "notifications/run") {
        if (request.method !== "POST") return reply({ code: "METHOD_NOT_ALLOWED" }, 405);
        const supplied = request.headers.get("authorization") || "",
          expected = "Bearer " + runtime.cronSecret;
        if (
          runtime.cronSecret.length < 32 ||
          !timingSafeEqual(
            createHash("sha256").update(supplied).digest(),
            createHash("sha256").update(expected).digest(),
          )
        )
          throw new AccessError("FORBIDDEN", 403);
        const started = performance.now(),
          remaining = () => Math.max(0, 25_000 - (performance.now() - started));
        const weekly = await runtime.worker.enqueueWeekly();
        return reply({
          weekly,
          ...(await runtime.worker.run(20, remaining())),
          slack: await runtime.slack?.processEvents(10, remaining()),
        });
      }
      if (!["GET", "POST", "PUT"].includes(request.method))
        throw new AccessError("METHOD_NOT_ALLOWED", 405);
      if (request.method !== "GET" && request.headers.get("origin") !== runtime.origin)
        throw new AccessError("ORIGIN_FORBIDDEN", 403);
      if (path === "auth/start" && request.method === "POST") {
        const body = await payload(request);
        const ip =
          request.headers.get("x-vercel-forwarded-for")?.split(",")[0] || "unknown-ingress";
        return reply(await runtime.auth.challenge(body.email, ip));
      }
      if (path === "auth/verify" && request.method === "POST") {
        const body = await payload(request),
          result = await runtime.auth.verify(body.challengeId, body.code);
        return reply({ user: result.identity }, 200, {
          "Set-Cookie":
            "__Host-boards_session=" +
            result.session +
            "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800",
        });
      }
      const identity = await runtime.auth.session(sessionCookie(request));
      if (path === "session" && request.method === "GET") return reply({ user: identity });
      if (path === "auth/logout" && request.method === "POST") {
        await runtime.auth.logout(sessionCookie(request));
        return reply({ ok: true }, 200, {
          "Set-Cookie": "__Host-boards_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        });
      }
      const actor = requireIdentity(identity),
        service = runtime.service;
      if (path === "slack/callback" && request.method === "GET") {
        if (!runtime.slack) throw new AccessError("SLACK_NOT_CONFIGURED", 503);
        const result = await runtime.slack.callback(
          actor,
          url.searchParams.get("state") || "",
          url.searchParams.get("code") || "",
        );
        return new Response(null, {
          status: 303,
          headers: {
            ...HEADERS,
            Location:
              runtime.origin +
              "/account.html?view=settings&space=" +
              encodeURIComponent(result.spaceId),
          },
        });
      }
      const integration = /^spaces\/([A-Za-z0-9_-]{1,80})\/slack\/(connect|sync)$/.exec(path);
      if (integration && request.method === "POST") {
        if (!runtime.slack) throw new AccessError("SLACK_NOT_CONFIGURED", 503);
        return reply(
          integration[2] === "connect"
            ? await runtime.slack.begin(actor, integration[1])
            : await runtime.slack.sync(actor, integration[1]),
        );
      }

      if (path === "spaces")
        return request.method === "GET"
          ? reply({ spaces: await service.spaces(actor) })
          : request.method === "POST"
            ? reply(await service.create(actor, await payload(request)), 201)
            : reply({ code: "METHOD_NOT_ALLOWED" }, 405);
      if (path === "profile") {
        if (request.method === "GET") return reply({ profile: await service.getProfile(actor) });
        if (request.method === "PUT") {
          await service.profile(actor, await payload(request));
          return reply({ profile: await service.getProfile(actor) });
        }
      }
      const match =
        /^spaces\/([A-Za-z0-9_-]{1,80})(?:\/(settings|preferences|people|invites|history))?$/.exec(
          path,
        );
      if (match) {
        const [, space, operation] = match;
        if (!operation) {
          if (request.method === "GET") return reply(await service.read(actor, space));
          if (request.method === "PUT") {
            const body = await payload(request);
            return reply(await service.save(actor, space, body.version, body.value));
          }
        }
        if (operation === "settings") {
          if (request.method === "GET")
            return reply({
              ...(await service.getSettings(actor, space)),
              slackAvailable: !!runtime.slack,
            });
          if (request.method === "PUT") {
            await service.settings(actor, space, await payload(request));
            return reply(await service.getSettings(actor, space));
          }
        }
        if (operation === "preferences" && request.method === "PUT") {
          const body = await payload(request);
          await service.preferences(actor, space, body.assignmentMail, body.weeklyMail);
          return reply({ ok: true });
        }
        if (operation === "people" && request.method === "GET")
          return reply({ people: await service.people(actor, space) });
        if (operation === "history" && request.method === "GET")
          return reply(
            await service.history(
              actor,
              space,
              url.searchParams.get("board") || "",
              url.searchParams.get("item") || "",
              url.searchParams.get("before") || undefined,
              Number(url.searchParams.get("limit") || 30),
            ),
          );
        if (operation === "invites" && request.method === "POST") {
          await service.invite(actor, space, await payload(request));
          return reply({ ok: true }, 201);
        }
      }
      return reply({ code: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof AccessError) return reply({ code: error.code }, error.status);
      console.warn(
        JSON.stringify({ event: "accounts.failed", category: "internal", method: request.method }),
      );
      return reply({ code: "REQUEST_FAILED" }, 500);
    }
  };
}
