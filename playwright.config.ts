import { defineConfig, devices } from "@playwright/test";

/**
 * suite E2E میزکار پژوهشی نور (ه-۱۲) — روی dev server :3000 و Go :8080.
 * کرومِ موجود سندباکس (بدون دانلود مجدد) به‌عنوان executablePath.
 */
const CHROME =
  process.env.E2E_CHROME_PATH ??
  "/home/z/.agent-browser/browsers/chrome-153.0.8010.52/chrome";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    headless: true,
    ignoreHTTPSErrors: true,
    launchOptions: { executablePath: CHROME, args: ["--no-sandbox"] },
    locale: "fa-IR",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
