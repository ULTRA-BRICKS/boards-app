import { test, expect } from "bun:test";
import { shareHandler } from "../api/share";
import { createWorkspace, projectShare } from "../../../packages/core/workspace.mjs";
test("The application and font specimen are explicitly excluded from indexing", async () => {
  const html = await Bun.file("shell.html").text();
  expect(html).toMatch(/name="robots"[^>]+noindex/);
  const config = await Bun.file("vercel.json").json();
  const header = config.headers
    .find((r: any) => r.source === "/(.*)")
    .headers.find((h: any) => h.key === "X-Robots-Tag");
  expect(header.value).toContain("noindex");
});
test("Public shares remain anonymously fetchable with noindex and OG tags", async () => {
  const view = projectShare(createWorkspace(), { kind: "board", boardId: "roadmap" }),
    html = await Bun.file("shell.html").text();
  const response = await shareHandler(new Request("https://boards.example/s/" + "ab".repeat(32)), {
    html,
    loadView: async () => view,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
  const text = await response.text();
  expect(text).toContain("og:image");
  expect(text).toMatch(/name="robots"[^>]+noindex/);
});
test("Crawler may read shared pages to see noindex; robots is not used as an auth barrier", async () => {
  const robots = await Bun.file("robots.txt").text();
  expect(robots).not.toMatch(/Disallow:\s*\//);
  expect(robots).toContain("Allow: /");
});
test("People screen no longer offers arbitrary JSON file import", async () => {
  const text = await Bun.file("app.mjs").text(),
    start = text.indexOf("function people()"),
    end = text.indexOf("function itemTools(", start),
    ui = text.slice(start, end);
  expect(ui).not.toContain("people-file");
  expect(ui).not.toContain('type="file"');
  expect(ui).not.toContain("Import Slack people");
});
