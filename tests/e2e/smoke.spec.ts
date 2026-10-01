import { test, expect } from "@playwright/test";

test("smoke: chromium باز می‌شود و صفحهٔ ورود رندر می‌شود", async ({ page }) => {
  await page.goto("/#/login");
  await expect(page.getByText("ورود به میزکار")).toBeVisible({ timeout: 30_000 });
});
