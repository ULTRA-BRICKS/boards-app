import { defineConfig } from "@playwright/test";
const browser = process.env.BROWSER === "webkit" ? "webkit" : "chromium";
export default defineConfig({
  testDir: "tests/e2e", fullyParallel: false, workers: 1, timeout: 30000, expect: { timeout: 6000 }, retries: 0,
  reporter: [["list"], ["json", { outputFile: `test-results/browser-${browser}.json` }]],
  use: { baseURL: "http://127.0.0.1:5173", browserName: browser, viewport: { width: 1448, height: 1086 }, trace: "retain-on-failure", screenshot: "only-on-failure", ...(browser === "chromium" && process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } : {}) },
  webServer: [
    { command: "bun run demo", url: "http://127.0.0.1:5173/api/status", reuseExistingServer: !process.env.CI, timeout: 30000 },
    { command: "bun run dev:type", url: "http://127.0.0.1:5174/", reuseExistingServer: !process.env.CI, timeout: 30000 },
  ],
});
