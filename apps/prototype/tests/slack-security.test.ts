import { test, expect } from "bun:test";
import { createHmac } from "node:crypto";
import {
  verifySlackRequest,
  allowedUnfurl,
  sealSlackToken,
  openSlackToken,
  slackDirectory,
} from "../accounts/slack";
const now = Date.parse("2026-09-15T12:00:00Z"),
  timestamp = String(now / 1000),
  secret = "fixture-signing-secret",
  body = '{"type":"event_callback"}';
function headers(raw = body, time = timestamp) {
  return new Headers({
    "x-slack-request-timestamp": time,
    "x-slack-signature":
      "v0=" +
      createHmac("sha256", secret)
        .update("v0:" + time + ":" + raw)
        .digest("hex"),
  });
}
test("Slack request verification uses the unmodified body", () => {
  expect(verifySlackRequest(body, headers(), secret, now)).toBe(true);
  expect(verifySlackRequest(body + " ", headers(), secret, now)).toBe(false);
});
for (const difference of [-301000, 301000, 86400000])
  test("Reject replayed Slack event " + difference, () => {
    expect(
      verifySlackRequest(body, headers(body, String((now + difference) / 1000)), secret, now),
    ).toBe(false);
  });
test("Encrypted integration token is authenticated and not stored in plaintext", () => {
  const key = Buffer.alloc(32, 7).toString("base64"),
    cipher = sealSlackToken("fixture-private-token", key);
  expect(cipher).not.toContain("fixture-private-token");
  expect(openSlackToken(cipher, key)).toBe("fixture-private-token");
  expect(() => openSlackToken(cipher, Buffer.alloc(32, 8).toString("base64"))).toThrow();
});
for (const path of [
  "/#key=SECRET",
  "/app?space=private",
  "/s/" + "a".repeat(64) + "?key=SECRET",
  "/s/" + "a".repeat(64) + "#secret",
  "/s/short",
])
  test("Private or malformed link never becomes a Slack unfurl " + path, () =>
    expect(allowedUnfurl("https://boards.example" + path, "https://boards.example")).toBe(false),
  );
test("Only public read tokens on this origin can produce unfurls", () => {
  expect(
    allowedUnfurl("https://boards.example/s/" + "a".repeat(64), "https://boards.example"),
  ).toBe(true);
  expect(allowedUnfurl("https://evil.example/s/" + "a".repeat(64), "https://boards.example")).toBe(
    false,
  );
});
test("Directory sync validates the installed team, excludes bots and follows pagination", async () => {
  let pages = 0;
  const transport = (async (url: any) => {
    if (String(url).endsWith("auth.test")) return Response.json({ ok: true, team_id: "TEAM1" });
    pages++;
    return Response.json({
      ok: true,
      members:
        pages === 1
          ? [
              { id: "U1", name: "One", profile: { email: "one@corp.test" } },
              { id: "UBOT", is_bot: true },
              { id: "UOLD", deleted: true },
            ]
          : [{ id: "U2", name: "Two", profile: {} }],
      response_metadata: { next_cursor: pages === 1 ? "next" : "" },
    });
  }) as typeof fetch;
  const rows = await slackDirectory("fixture", "TEAM1", transport);
  expect(rows.map((p) => p.id)).toEqual(["U1", "U2"]);
  expect(pages).toBe(2);
  await expect(slackDirectory("fixture", "WRONG", transport)).rejects.toThrow(
    "SLACK_TEAM_MISMATCH",
  );
});
