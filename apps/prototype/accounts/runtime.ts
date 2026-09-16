import { SlackService } from "./slack-service";
import { postgresDatabase } from "./database";
import { CorporateAuth } from "./auth";
import { WorkspaceService } from "./service";
import { NotificationWorker } from "./notifications";
import { deliverMail } from "./mail";
import { accountRoutes, type AccountRuntime } from "./routes";
export function accountConfiguration(env: Record<string, string | undefined>) {
  const fields = {
    database: "BOARDS_DATABASE_URL",
    domains: "BOARDS_CORPORATE_DOMAINS",
    owner: "BOARDS_OWNER_EMAIL",
    mailKey: "RESEND_API_KEY",
    sender: "MAIL_FROM",
    pepper: "BOARDS_AUTH_SECRET",
    origin: "APP_ORIGIN",
  };
  const missing = Object.entries(fields)
    .filter(([, key]) => !env[key])
    .map(([name]) => name);
  if (env.BOARDS_ACCOUNTS_ENABLED !== "1") missing.push("activation");
  return { ready: missing.length === 0, missing };
}
let cached: AccountRuntime | null | undefined;
export function runtime(env = process.env): AccountRuntime | null {
  if (cached !== undefined) return cached;
  if (!accountConfiguration(env).ready) return null;
  const origin = new URL(env.APP_ORIGIN!);
  if (origin.protocol !== "https:") throw Error("HTTPS origin is required");
  const db = postgresDatabase(env.BOARDS_DATABASE_URL!),
    service = new WorkspaceService(db);
  const mail = { from: env.MAIL_FROM!, origin: origin.origin, key: env.RESEND_API_KEY! };
  const auth = new CorporateAuth(
    db,
    {
      domains: env.BOARDS_CORPORATE_DOMAINS!.split(",").map((s) => s.trim()),
      ownerEmail: env.BOARDS_OWNER_EMAIL!,
      pepper: env.BOARDS_AUTH_SECRET!,
      from: mail.from,
    },
    (message, id) => deliverMail(mail.key, message, id),
  );
  cached = {
    auth,
    service,
    worker: new NotificationWorker(db, mail),
    origin: origin.origin,
    cronSecret: env.CRON_SECRET || "",
    slack:
      env.SLACK_CLIENT_ID &&
      env.SLACK_CLIENT_SECRET &&
      env.SLACK_SIGNING_SECRET &&
      env.SLACK_TOKEN_KEY
        ? new SlackService(db, service, {
            clientId: env.SLACK_CLIENT_ID,
            clientSecret: env.SLACK_CLIENT_SECRET,
            signingSecret: env.SLACK_SIGNING_SECRET,
            encryptionKey: env.SLACK_TOKEN_KEY,
            origin: origin.origin,
          })
        : undefined,
  };
  return cached;
}
export default { fetch: (request: Request) => accountRoutes(runtime())(request) };
