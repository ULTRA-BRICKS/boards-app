import { test, expect, beforeAll, afterAll } from "bun:test";
import { createHmac } from "node:crypto";
import { fixture } from "./accounts-fixture";
import { WorkspaceService } from "../accounts/service";
import { SlackService } from "../accounts/slack-service";
import { sealSlackToken } from "../accounts/slack";
let f: Awaited<ReturnType<typeof fixture>>,
  calls: string[] = [];
const clock = Date.parse("2026-09-15T12:00:00Z"),
  key = Buffer.alloc(32, 3).toString("base64"),
  origin = "https://boards.example",
  secret = "signing-fixture";
beforeAll(async () => {
  f = await fixture();
  await f.db.query(
    "INSERT INTO boards_accounts.integrations(space_id,slack_team_id,slack_token_ciphertext,connected_by) VALUES($1,$2,$3,$4)",
    ["space-one", "TEAM", sealSlackToken("fake-bot-token", key), "actor"],
  );
});
afterAll(async () => {
  await f.pg.close();
});
function service() {
  const transport = (async (url: any) => {
    calls.push(String(url));
    return String(url).includes("chat.unfurl")
      ? Response.json({ ok: true })
      : new Response("<html>Shared board</html>");
  }) as typeof fetch;
  return new SlackService(
    f.db,
    new WorkspaceService(f.db),
    { clientId: "fake", clientSecret: "fake", encryptionKey: key, signingSecret: secret, origin },
    transport,
    () => clock,
  );
}
function event(id: string, link = origin + "/s/" + "a".repeat(64)) {
  const raw = JSON.stringify({
      type: "event_callback",
      event_id: id,
      team_id: "TEAM",
      event: { type: "link_shared", channel: "C1", message_ts: "123.456", links: [{ url: link }] },
    }),
    timestamp = String(clock / 1000);
  return {
    raw,
    headers: new Headers({
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature":
        "v0=" +
        createHmac("sha256", secret)
          .update("v0:" + timestamp + ":" + raw)
          .digest("hex"),
    }),
  };
}
test("Signed events are durably acknowledged before slow external work", async () => {
  const e = event("evt-one");
  expect(await service().event(e.raw, e.headers)).toEqual({ ok: true });
  expect(calls).toHaveLength(0);
  expect(
    (await f.db.query("SELECT event_id FROM boards_accounts.event_receipts")).rows,
  ).toHaveLength(1);
});
test("A Slack delivery retry does not duplicate the work item", async () => {
  const e = event("evt-one");
  await service().event(e.raw, e.headers);
  expect(
    (await f.db.query("SELECT event_id FROM boards_accounts.event_receipts")).rows,
  ).toHaveLength(1);
});
test("The worker fetches only a public shared page, never a private editor link", async () => {
  expect((await service().processEvents()).processed).toBe(1);
  expect(calls).toEqual([origin + "/s/" + "a".repeat(64), "https://slack.com/api/chat.unfurl"]);
  expect((await service().processEvents()).processed).toBe(0);
  const e = event("evt-private", origin + "/#key=PRIVATE");
  await service().event(e.raw, e.headers);
  expect(
    (await f.db.query("SELECT event_id FROM boards_accounts.event_receipts")).rows,
  ).toHaveLength(1);
});
