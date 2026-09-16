import { test, expect } from "bun:test";
import { fixture } from "./accounts-fixture";
import { WorkspaceService } from "../accounts/service";
import { SlackService } from "../accounts/slack-service";
import { sealSlackToken } from "../accounts/slack";
test("Permanently failing Slack events stop after five attempts and respect retry delay", async () => {
  const f = await fixture();
  let now = Date.parse("2026-09-16T12:00:00Z"),
    posts = 0;
  const key = Buffer.alloc(32, 3).toString("base64"),
    origin = "https://boards.example";
  try {
    await f.db.query(
      "INSERT INTO boards_accounts.integrations(space_id,slack_team_id,slack_token_ciphertext,connected_by) VALUES($1,$2,$3,$4)",
      ["space-one", "TEAM", sealSlackToken("fixture-token", key), "actor"],
    );
    await f.db.query(
      "INSERT INTO boards_accounts.event_receipts(event_id,payload) VALUES($1,$2::jsonb)",
      [
        "failed-event",
        JSON.stringify({
          team_id: "TEAM",
          event: {
            channel: "C1",
            message_ts: "1.2",
            links: [{ url: origin + "/s/" + "a".repeat(64) }],
          },
        }),
      ],
    );
    const transport = (async (input: any) => {
      if (String(input).includes("chat.unfurl")) {
        posts++;
        return Response.json({ ok: false, error: "service_unavailable" }, { status: 503 });
      }
      return new Response("<html>Shared</html>");
    }) as typeof fetch;
    const service = new SlackService(
      f.db,
      new WorkspaceService(f.db),
      {
        origin,
        clientId: "fixture",
        clientSecret: "fixture",
        signingSecret: "fixture",
        encryptionKey: key,
      },
      transport,
      () => now,
    );
    await service.processEvents();
    expect(posts).toBe(1);
    await service.processEvents();
    expect(posts).toBe(1);
    for (let i = 0; i < 6; i++) {
      now += 3600000;
      await service.processEvents();
    }
    expect(posts).toBe(5);
    const row = (
      await f.db.query("SELECT * FROM boards_accounts.event_receipts WHERE event_id=$1", [
        "failed-event",
      ])
    ).rows[0];
    expect(row.state).toBe("held");
    expect(row.attempts).toBe(5);
  } finally {
    await f.pg.close();
  }
});
