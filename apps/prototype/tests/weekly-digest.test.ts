import { test, expect } from "bun:test";
import { weeklyPeriod } from "../accounts/notifications";
import { assignmentMail } from "../accounts/mail";
test("Digest week switches at Monday 08:00 in the selected workspace timezone", () => {
  const before = Date.parse("2026-09-14T05:59:00Z"),
    after = Date.parse("2026-09-14T06:00:00Z");
  expect(weeklyPeriod(before, "Europe/Belgrade")).toBe("2026-09-07");
  expect(weeklyPeriod(after, "Europe/Belgrade")).toBe("2026-09-14");
  expect(weeklyPeriod(after, "America/New_York")).toBe("2026-09-07");
});
test("Local week follows DST rather than a hard-coded UTC offset", () => {
  expect(weeklyPeriod(Date.parse("2026-10-26T06:59:00Z"), "Europe/Belgrade")).toBe("2026-10-19");
  expect(weeklyPeriod(Date.parse("2026-10-26T07:00:00Z"), "Europe/Belgrade")).toBe("2026-10-26");
});
test("Weekly mail labels existing work accurately and escapes task markup", () => {
  const mail = assignmentMail({
    kind: "weekly",
    from: "Boards <boards@corp.test>",
    recipient: "one@corp.test",
    space: "Studio",
    origin: "https://boards.example",
    spaceId: "space-1",
    tasks: [
      {
        boardId: "board",
        itemId: "item",
        text: "<script>not code</script>",
        boardTitle: "Existing work",
      },
    ],
  });
  expect(mail.subject).toBe("Weekly digest · Studio");
  expect(mail.text).not.toContain("new assignment");
  expect(mail.html).not.toContain("new assignment");
  expect(mail.html).toContain("&lt;script&gt;");
  expect(mail.text).not.toContain("#key=");
});
