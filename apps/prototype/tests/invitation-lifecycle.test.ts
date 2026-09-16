import { test, expect } from "bun:test";
import { fixture, actor } from "./accounts-fixture";
import { WorkspaceService } from "../accounts/service";
import { CorporateAuth } from "../accounts/auth";
test("Inviting a colleague adds one assignable person, survives repeated invite and links only after verified email", async () => {
  const f = await fixture();
  let code = "";
  try {
    const service = new WorkspaceService(f.db),
      input = {
        email: "new@corp.test",
        name: "New Colleague",
        role: "member" as const,
        personId: "invited-person",
      };
    await service.invite(actor, "space-one", input);
    await service.invite(actor, "space-one", input);
    const before = await service.read(actor, "space-one");
    expect(before.value.people.filter((p: any) => p.id === input.personId)).toHaveLength(1);
    expect(
      (await service.people(actor, "space-one")).some((p: any) => p.email === input.email),
    ).toBe(false);
    before.value.boards[0].columns[1].items[1].assignees = [input.personId];
    await service.save(actor, "space-one", before.version, before.value);
    const auth = new CorporateAuth(
      f.db,
      {
        domains: ["corp.test"],
        ownerEmail: actor.email,
        pepper: "test-pepper-".repeat(4),
        from: "mail@corp.test",
      },
      async (mail) => {
        code = /code: (\d{6})/.exec(mail.text)![1];
        return "fixture";
      },
    );
    const challenge = await auth.challenge(input.email, "fixture-ip"),
      verified = await auth.verify(challenge.challengeId, code);
    expect(
      (await service.read(verified.identity, "space-one")).value.people.find(
        (p: any) => p.id === input.personId,
      ).name,
    ).toBe(input.name);
    expect(
      (await service.people(actor, "space-one")).find((p: any) => p.email === input.email).personId,
    ).toBe(input.personId);
  } finally {
    await f.pg.close();
  }
});
test("An invitation cannot reuse a person ID already linked to somebody else", async () => {
  const f = await fixture();
  try {
    const service = new WorkspaceService(f.db);
    await expect(
      service.invite(actor, "space-one", {
        email: "new@corp.test",
        name: "Other",
        role: "member",
        personId: "danny",
      }),
    ).rejects.toThrow("PERSON_ALREADY_LINKED");
  } finally {
    await f.pg.close();
  }
});
