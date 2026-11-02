import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * سناریو رسانه — کاور/فیلتر نوع محتوا، سرو فایل با Range و نمایشگر PDF.
 *
 * دادهٔ واقعی: ۱۵۹ PDF اسکن‌شدهٔ فعلی رمزدارند (قفل ناشر)؛ نمایشگر در این حالت
 * پیام آماده‌نبودن نشان می‌دهد. مسیر رندر canvas با فایل نمونهٔ بدون رمز
 * (tests/e2e/fixtures/sample.pdf) و interception همان اندپوینت آزموده می‌شود.
 *
 * درس: پروکسی Next نباید Content-Disposition را رد کند — کروم پاسخ PDF با این
 * هدر را در fetch قطع می‌کند (204) و pdf.js خطای UnexpectedResponse می‌دهد.
 */

const ADMIN = { username: "admin", password: "NoorDev-2026-Temp" };

async function login(page: Page) {
  await page.goto("/#/login");
  await page.waitForLoadState("networkidle");
  await page.locator("#username").first().fill(ADMIN.username, { timeout: 20_000 });
  await page.locator("#password").first().fill(ADMIN.password);
  await page.getByRole("button", { name: /ورود/ }).first().click();
  await page
    .getByRole("button", { name: /منوی کاربر/ })
    .first()
    .waitFor({ timeout: 25_000 });
}

interface WorkItem {
  uid: string;
  title: string;
  cover_uid: string | null;
  formats?: string[];
}

async function listWorks(page: Page, query: string): Promise<{ items: WorkItem[]; total: number }> {
  const res = await page.request.get(`/api/v1/works?${query}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as { items: WorkItem[]; total: number };
}

async function firstPdfWork(page: Page): Promise<WorkItem> {
  const { items } = await listWorks(page, "content=pdf&page_size=1&page=1");
  expect(items.length).toBeGreaterThan(0);
  return items[0];
}

async function firstWorkWithCover(page: Page): Promise<WorkItem> {
  for (let p = 1; p <= 10; p++) {
    const { items } = await listWorks(page, `page_size=100&page=${p}&sort=title`);
    const hit = items.find((w) => w.cover_uid);
    if (hit) return hit;
  }
  throw new Error("اثری با کاور در ۱۰۰۰ اثر نخست یافت نشد");
}

async function pdfDocumentUid(page: Page, workUid: string): Promise<string> {
  const detail = await page.request.get(`/api/v1/works/${encodeURIComponent(workUid)}`);
  expect(detail.status()).toBe(200);
  const body = (await detail.json()) as { documents: Array<{ uid: string; format?: string }> };
  const doc = body.documents.find((d) => d.format === "pdf") ?? body.documents[0];
  expect(doc?.uid).toBeTruthy();
  return doc.uid;
}

test.describe("رسانه در کتابخانه", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "بررسی رسانه روی دسکتاپ");
  });

  test("فیلتر نوع محتوا: «اسکن» فقط آثار اسکن‌شده را می‌آورد", async ({ page }) => {
    await login(page);
    await page.goto("/#/library");
    await page.waitForLoadState("networkidle");

    const scanChip = page.getByRole("button", { name: "اسکن", exact: true });
    await scanChip.click();
    await expect(scanChip).toHaveAttribute("aria-pressed", "true");

    const rows = page.locator("main ul li");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 5); i++) {
      await expect(rows.nth(i).getByText("اسکن‌شده", { exact: true })).toBeVisible();
    }

    const allChip = page.getByRole("button", { name: "همه", exact: true });
    await allChip.click();
    await expect(allChip).toHaveAttribute("aria-pressed", "true");
  });

  test("اثر اسکن‌شدهٔ رمزدار: پیام آماده‌نبودن بدون پرسش رمز", async ({ page }) => {
    await login(page);
    const work = await firstPdfWork(page);
    await page.goto(`/book/${encodeURIComponent(work.uid)}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "بازکردن نسخهٔ اسکن‌شده" }).first().click();
    await expect(page).toHaveURL(/\/read\?d=/, { timeout: 30_000 });
    await expect(page.getByText("نسخهٔ اسکن‌شدهٔ این جلد هنوز آمادهٔ نمایش نیست.")).toBeVisible({
      timeout: 30_000,
    });
    // هیچ ورودی رمزی نباید نمایش داده شود
    await expect(page.locator("input[type=password]")).toHaveCount(0);
  });

  test("نمایشگر PDF با فایل نمونه: canvas، شمار صفحه و دیپ‌لینک pg", async ({ page }) => {
    await login(page);
    const work = await firstPdfWork(page);
    const docUid = await pdfDocumentUid(page, work.uid);

    const fixture = await readFile(path.resolve(__dirname, "fixtures/sample.pdf"));
    let intercepted = 0;
    await page.route(/\/api\/v1\/documents\/[^/]+\/file$/, async (route) => {
      intercepted += 1;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "accept-ranges": "bytes",
          "cache-control": "private, no-cache",
        },
        body: fixture,
      });
    });

    await page.goto(`/library/sample/read?d=${encodeURIComponent(docUid)}&pg=2`);
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible({ timeout: 45_000 });
    await expect
      .poll(async () => canvas.evaluate((el) => (el as HTMLCanvasElement).width), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    // دیپ‌لینک pg=2 در برچسب صفحهٔ رندرشده و شمار صفحهٔ نوار ابزار بازتاب می‌یابد
    await expect(page.locator('canvas[aria-label="صفحهٔ ۲ نسخهٔ اسکن‌شده"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "رفتن به صفحه" }).filter({ visible: true }).first(),
    ).toContainText("۲");
    expect(intercepted).toBeGreaterThan(0);
  });

  test("سرو فایل: 200 + نوع PDF + Range → 206", async ({ page }) => {
    await login(page);
    const work = await firstPdfWork(page);
    const docUid = await pdfDocumentUid(page, work.uid);
    const url = `/api/v1/documents/${encodeURIComponent(docUid)}/file`;

    const full = await page.request.get(url);
    expect(full.status()).toBe(200);
    const headers = full.headers();
    expect(headers["content-type"]).toContain("application/pdf");
    expect(headers["accept-ranges"]).toBe("bytes");
    expect(Number(headers["content-length"] ?? 0)).toBeGreaterThan(0);
    expect(headers["etag"]).toBeTruthy();
    await full.dispose();

    const ranged = await page.request.get(url, { headers: { Range: "bytes=0-99" } });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
    expect((await ranged.body()).length).toBe(100);
    await ranged.dispose();
  });

  test("کاور اثر در فهرست کتابخانه بارگذاری می‌شود", async ({ page }) => {
    await login(page);
    const work = await firstWorkWithCover(page);
    await page.goto("/#/library");
    await page.waitForLoadState("networkidle");
    await page.locator("#library-q").fill(work.title, { timeout: 20_000 });

    const cover = page.locator(`img[alt="جلد ${work.title}"]`).first();
    await expect(cover).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => cover.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
  });
});
