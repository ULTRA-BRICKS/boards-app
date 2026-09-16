import { test, expect } from "bun:test";
import { fixture, actor } from "./accounts-fixture";
import { WorkspaceService } from "../accounts/service";
import { SlackService } from "../accounts/slack-service";
import { sealSlackToken } from "../accounts/slack";
const origin = "https://boards.example",
  key = Buffer.alloc(32, 4).toString("base64");
const config = {
  clientId: "fixture",
  clientSecret: "fixture",
  encryptionKey: key,
  signingSecret: "fixture",
  origin,
};
async function connected() {
  const f = await fixture();
  await f.db.query(
    "INSERT INTO boards_accounts.integrations(space_id,slack_team_id,slack_token_ciphertext,connected_by) VALUES($1,$2,$3,$4)",
    ["space-one", "TEAM", sealSlackToken("fixture-bot", key), "actor"],
  );
  return f;
}
const token = (n: number) => n.toString(16).padStart(64, "0");
test("Slack probes run concurrently, discard duplicate URLs and exclude failed previews", async () => {
  const f = await connected();
  let inflight = 0,
    peak = 0,
    calls = 0,
    unfurled: string[] = [];
  try {
    const urls = [1, 2, 3, 1].map((n) => ({ url: origin + "/s/" + token(n) }));
    await f.db.query(
      "INSERT INTO boards_accounts.event_receipts(event_id,payload) VALUES($1,$2::jsonb)",
      [
        "parallel",
        JSON.stringify({
          team_id: "TEAM",
          event: { channel: "C1", message_ts: "1.2", links: urls },
        }),
      ],
    );
    const transport = (async (url: any, init: any) => {
      if (String(url).endsWith("chat.unfurl")) {
        unfurled = Object.keys(JSON.parse(init.body).unfurls);
        return Response.json({ ok: true });
      }
      calls++;
      inflight++;
      peak = Math.max(peak, inflight);
      await Bun.sleep(25);
      inflight--;
      return new Response("fixture", { status: String(url).endsWith(token(2)) ? 404 : 200 });
    }) as typeof fetch;
    const result = await new SlackService(
      f.db,
      new WorkspaceService(f.db),
      config,
      transport,
    ).processEvents();
    expect(result.processed).toBe(1);
    expect(peak).toBe(3);
    expect(calls).toBe(3);
    expect(unfurled).toEqual([origin + "/s/" + token(1), origin + "/s/" + token(3)]);
  } finally {
    await f.pg.close();
  }
});
test("Insufficient Slack execution budget leaves the event pending without network calls", async () => {
  const f = await connected();
  try {
    await f.db.query(
      "INSERT INTO boards_accounts.event_receipts(event_id,payload) VALUES($1,$2::jsonb)",
      [
        "deferred",
        JSON.stringify({
          team_id: "TEAM",
          event: { channel: "C1", message_ts: "1.2", links: [{ url: origin + "/s/" + token(1) }] },
        }),
      ],
    );
    let calls = 0;
    const transport = (async () => {
      calls++;
      return Response.json({ ok: true });
    }) as typeof fetch;
    const service = new SlackService(f.db, new WorkspaceService(f.db), config, transport);
    expect(await service.processEvents(10, 1000)).toEqual({ processed: 0 });
    expect(calls).toBe(0);
    expect(
      (
        await f.db.query(
          "SELECT state FROM boards_accounts.event_receipts WHERE event_id='deferred'",
        )
      ).rows[0].state,
    ).toBe("pending");
  } finally {
    await f.pg.close();
  }
});
test("Directory sync preserves existing identity and manual avatar, and is repeatable", async () => {
  const f = await connected();
  try {
    const person = f.document.people.find((p: any) => p.id === "danny")!;
    person.slackUserId = "U1";
    person.avatar = "data:image/jpeg;base64,AA==";
    await f.db.query("UPDATE boards_accounts.spaces SET document=$2::jsonb WHERE id=$1", [
      "space-one",
      JSON.stringify(f.document),
    ]);
    const transport = (async (url: any) =>
      Response.json(
        String(url).endsWith("auth.test")
          ? { ok: true, team_id: "TEAM" }
          : {
              ok: true,
              members: [
                {
                  id: "U1",
                  name: "External Danny",
                  profile: {
                    email: "different@corp.test",
                    image_72: "https://avatars.slack-edge.com/replacement.jpg",
                  },
                },
                { id: "U2", name: "New member", profile: { email: "new@corp.test" } },
              ],
              response_metadata: { next_cursor: "" },
            },
      )) as typeof fetch;
    const service = new SlackService(f.db, new WorkspaceService(f.db), config, transport);
    const first = await service.sync(actor, "space-one");
    expect(first.added).toBe(1);
    expect((await service.sync(actor, "space-one")).added).toBe(0);
    const document = (
      await f.db.query("SELECT document FROM boards_accounts.spaces WHERE id=$1", ["space-one"])
    ).rows[0].document;
    const original = document.people.find((p: any) => p.slackUserId === "U1");
    expect(original.id).toBe("danny");
    expect(original.avatar).toBe("data:image/jpeg;base64,AA==");
    expect(original.name).toBe("Danny");
    expect(document.people.filter((p: any) => p.slackUserId === "U2")).toHaveLength(1);
    expect(
      (
        await f.db.query("SELECT account_id FROM boards_accounts.members WHERE space_id=$1", [
          "space-one",
        ])
      ).rows,
    ).toHaveLength(2);
  } finally {
    await f.pg.close();
  }
});
