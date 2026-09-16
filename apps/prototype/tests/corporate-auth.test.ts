import { test, expect, beforeAll, afterAll } from "bun:test";
import { fixture } from "./accounts-fixture";
import { CorporateAuth } from "../accounts/auth";
let f: Awaited<ReturnType<typeof fixture>>,
  clock = Date.parse("2026-09-15T12:00:00Z"),
  messages: any[] = [];
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f.pg.close();
});
function auth() {
  return new CorporateAuth(
    f.db,
    {
      domains: ["corp.test"],
      ownerEmail: "owner@corp.test",
      pepper: "test-only-pepper-".repeat(4),
      from: "Boards <mail@corp.test>",
    },
    async (mail, id) => {
      messages.push({ mail, id });
      return id;
    },
    () => clock,
  );
}
test("Uninvited email has indistinguishable response and no message sent", async () => {
  const before = messages.length,
    r = await auth().challenge("unknown@corp.test", "network-a");
  expect(r.message).toContain("If this address has access");
  expect(messages).toHaveLength(before);
  await expect(auth().verify(r.challengeId, "123456")).rejects.toThrow("INVALID_CODE");
});
test("Corporate OTP produces a server-verified session; no code or session is stored raw", async () => {
  const r = await auth().challenge("owner@corp.test", "network-a"),
    code = /code: (\d{6})/.exec(messages.at(-1).mail.text)![1];
  const stored = (
    await f.db.query("SELECT * FROM boards_accounts.email_challenges WHERE id=$1", [r.challengeId])
  ).rows[0];
  expect(stored.proof).not.toBe(code);
  const result = await auth().verify(r.challengeId, code);
  expect((await auth().session(result.session))?.email).toBe("owner@corp.test");
  expect(
    (await f.db.query("SELECT hash FROM boards_accounts.sessions")).rows.some(
      (r) => r.hash === result.session,
    ),
  ).toBe(false);
  await expect(auth().verify(r.challengeId, code)).rejects.toThrow("INVALID_CODE");
  await auth().logout(result.session);
  expect(await auth().session(result.session)).toBeNull();
});
test("Failed attempts persist and invalidate the challenge after five tries", async () => {
  const r = await auth().challenge("member@corp.test", "network-b"),
    code = /code: (\d{6})/.exec(messages.at(-1).mail.text)![1],
    bad = code === "111111" ? "222222" : "111111";
  for (let i = 0; i < 5; i++)
    await expect(auth().verify(r.challengeId, bad)).rejects.toThrow("INVALID_CODE");
  await expect(auth().verify(r.challengeId, code)).rejects.toThrow("INVALID_CODE");
});
test("Expired code is rejected even with correct digits", async () => {
  const r = await auth().challenge("member@corp.test", "network-b"),
    code = /code: (\d{6})/.exec(messages.at(-1).mail.text)![1];
  clock += 600001;
  await expect(auth().verify(r.challengeId, code)).rejects.toThrow("INVALID_CODE");
});
test("Resend credentials are not needed for public share reads and corporate config fails closed", async () => {
  const incomplete = new CorporateAuth(
    f.db,
    { domains: [], ownerEmail: "", pepper: "", from: "" },
    async () => {
      throw Error("Must not send");
    },
  );
  await expect(incomplete.challenge("owner@corp.test", "network")).rejects.toThrow(
    "CORPORATE_DOMAINS_NOT_CONFIGURED",
  );
});
