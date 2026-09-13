import { test, expect } from "@playwright/test";
import { createWorkspace } from "../../packages/core/workspace.mjs";

test("word matches render within the input event without waiting for the network", async ({
  page,
}) => {
  const headers = { Origin: "http://127.0.0.1:5173" };
  expect((await page.request.post("/api/auth/test", { headers, data: {} })).ok()).toBeTruthy();
  const state = await (await page.request.get("/api/state")).json();
  expect(
    (
      await page.request.put("/api/state", {
        headers,
        data: { version: state.version, value: createWorkspace() },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await expect(page.locator(".task")).toHaveCount(15);
  await page.route("**/api/search", (route) => route.abort());
  await page.getByRole("button", { name: "Search workspace", exact: true }).click();
  const result = await page.getByRole("searchbox").evaluate((element) => {
    (element as HTMLInputElement).value = "billing";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return document.querySelector(".search-hit .text")?.textContent;
  });
  expect(result).toBe("Finish and test billing");
});
