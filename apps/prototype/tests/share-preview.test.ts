import { test, expect } from "bun:test";
import { shareHandler } from "../api/share";
import { publicShareURL, shareTokenFromURL } from "../lib/share-links";
import { createWorkspace, projectShare } from "../../../packages/core/workspace.mjs";
const token = "ab".repeat(32),
  url = "https://boards-app-gamma.vercel.app/s/" + token;
const html =
  '<!doctype html><html><head><title>Opening | Boards</title></head><body><main id="app"></main></body></html>';
const view = (scope: any) => projectShare(createWorkspace(), scope);
test("Copying a share strips editing capabilities, query parameters and fragments", () => {
  expect(publicShareURL("https://boards.example/?private=query#key=SECRET", token)).toBe(
    "https://boards.example/s/" + token,
  );
  expect(shareTokenFromURL(url)).toBe(token);
  expect(shareTokenFromURL("https://boards.example/#share=" + token)).toBe(token);
});
test("HTML item preview has board and column, selected text, no unrelated tasks or space", async () => {
  const data = view({ kind: "item", boardId: "roadmap", itemIds: ["p2"], neighbors: false });
  data.name = "PRIVATE SPACE";
  const response = await shareHandler(new Request(url), { html, loadView: async () => data });
  const output = await response.text();
  expect(response.status).toBe(200);
  expect(output).toContain("og:image");
  expect(output).toContain(url + "/og.png");
  expect(output).toContain("Product roadmap");
  expect(output).toContain("Product");
  expect(output).toContain("Finish and test billing");
  expect(output).not.toContain("PRIVATE SPACE");
  expect(output).not.toContain("Fix UI inconsistencies");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
test("Revoked token returns 404 and never renders a cached preview", async () => {
  let renders = 0;
  for (const path of ["", "/og.png"]) {
    const r = await shareHandler(new Request(url + path), {
      html,
      loadView: async () => {
        throw Object.assign(Error("PRIVATE"), { status: 403 });
      },
      png: () => {
        renders++;
        return new Uint8Array();
      },
    });
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("PRIVATE");
  }
  expect(renders).toBe(0);
});
test("Invalid path or method does not reach the database", async () => {
  let reads = 0;
  const loadView = async () => {
    reads++;
    return view({ kind: "board", boardId: "roadmap" });
  };
  expect(
    (await shareHandler(new Request("https://boards.example/s/INVALID"), { html, loadView }))
      .status,
  ).toBe(404);
  expect(
    (await shareHandler(new Request(url, { method: "POST" }), { html, loadView })).status,
  ).toBe(405);
  expect(reads).toBe(0);
});
for (const scope of [
  { kind: "board", boardId: "roadmap" },
  { kind: "column", boardId: "roadmap", columnId: "product" },
  { kind: "item", boardId: "roadmap", itemIds: ["p2"], neighbors: true },
  { kind: "items", boardId: "roadmap", itemIds: ["p1", "p2"] },
  { kind: "space" },
])
  test("Deterministic 1200×630 PNG for " + scope.kind, async () => {
    const response = await shareHandler(new Request(url + "/og.png"), {
      html,
      loadView: async () => view(scope),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const image = Buffer.from(await response.arrayBuffer());
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
  });
test("HTML metadata safely escapes a task that looks like a script", async () => {
  const data = view({ kind: "item", boardId: "roadmap", itemIds: ["p2"] });
  data.boards[0].columns[0].items[0].text = '"><script>alert(1)</script>';
  const response = await shareHandler(new Request(url), { html, loadView: async () => data });
  expect(await response.text()).not.toContain("<script>alert");
});
