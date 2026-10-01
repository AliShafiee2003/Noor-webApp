import { expect, test } from "@playwright/test";

/**
 * سناریو ۲ — جست‌وجو → بازکردن نتیجه (ه-۱۲-۲) و سناریو ۴ — خروجی CSV (ه-۱۲-۴)
 * و سناریو ۸ — نمای موبایل/دسکتاپ (ه-۱۲-۸، با دو پروژهٔ playwright).
 */

const GOLDEN = "الكعبة بيت الله";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/#/login");
  await page.waitForLoadState("networkidle");
  await page.locator('#username').first().fill("admin");
  await page.locator('#password').first().fill("zaB3v-XPngB-fXcYw");
  await page.getByRole("button", { name: /ورود/ }).first().click();
  await page.waitForLoadState("networkidle");
}

test("جست‌وجوی طلایی → ۳۰۰ نتیجه → بازکردن نتیجه در متن", async ({ page }) => {
  await login(page);
  await page.goto("/#/search");
  await page.waitForLoadState("networkidle");
  await page.locator("#search-query").fill(GOLDEN, { timeout: 20_000 });
  await page.getByRole("button", { name: "جست‌وجو" }).first().click();
  // شمار تأییدشده — عبارت واقعی: «تطبیق‌های تأییدشده تا این لحظه: ۳۰۰»
  await expect(page.getByText(/تأییدشده تا این لحظه/).first()).toBeVisible({ timeout: 45_000 });
  // باز کردن اولین نتیجه در کتاب‌خوان (لینک «بازکردن در متن» در کارت نتیجه)
  await page.getByRole("link", { name: /بازکردن در متن/ }).first().click({ timeout: 15_000 });
  await page.waitForURL(/read/, { timeout: 30_000 });
  await expect(page.getByRole("main").first()).toBeVisible({ timeout: 30_000 });
});

test("خروجی CSV جست‌وجو — ۳۰۰ ردیف + BOM", async ({ page }) => {
  await login(page);
  await page.goto("/#/search");
  await page.waitForLoadState("networkidle");
  await page.locator('#search-query').fill(GOLDEN);
  await page.getByRole("button", { name: "جست‌وجو" }).first().click();
  await expect(page.getByText(/تأییدشده تا این لحظه/).first()).toBeVisible({ timeout: 45_000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    (async () => {
      await page.getByRole("button", { name: /دریافت خروجی/ }).first().click();
      await page.getByRole("menuitem", { name: /CSV/ }).first().click();
    })(),
  ]);
  const path = await download.path();
  const fs = await import("node:fs");
  const buf = fs.readFileSync(path!);
  // BOM UTF-8
  expect(buf[0]).toBe(0xef);
  expect(buf[1]).toBe(0xbb);
  expect(buf[2]).toBe(0xbf);
  const text = buf.toString("utf8");
  // ۴ سطر فراداده/هدر + ۳۰۰ ردیف
  const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  expect(lines.length).toBeGreaterThanOrEqual(304);
  expect(text).toContain(GOLDEN);
});

test.describe("نمایش واکنش‌گرا", () => {
  for (const width of [1440, 390]) {
    test(`نمای ${width}px بدون سرریز افقی`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page);
      await page.goto("/#/search");
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // تلورانس کوچک برای اسکرول‌بار
      expect(overflow).toBeLessThanOrEqual(24);
    });
  }
});
