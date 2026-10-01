import { expect, test, type Page } from "@playwright/test";

/**
 * سناریوی اشتراک دوکاربره (ه-۱۲: highlight → share → کاربر دوم باز می‌کند → لغو → 410)
 * ساخت هایلایت/اشتراک با fetch داخل صفحه (کوکی و CSRF واقعی همان نشست) و بقیهٔ
 * چرخه از رابط کاربری: بنر هایلایت اشتراکی برای کاربر دوم، لغو از تنظیماتِ مالک،
 * و پیام 410 پس از لغو.
 */

const DOC = "doc-bahar-2";
const PAGE = "p-001";
const BLOCK = "b-0010";
const HIGHLIGHT_TEXT = "باب فضل العلم";

interface FetchResult {
  status: number;
  body: unknown;
}

/** فراخوانی API داخل صفحه — با کوکی و هدر CSRF همان نشست مرورگر */
async function pageFetch(
  page: Page,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<FetchResult> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const session = await fetch("/api/v1/auth/session", { credentials: "include" }).then(
        (r) => r.json() as Promise<{ csrf?: string }>,
      );
      const res = await fetch(`/api/v1${path}`, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Noor-CSRF": session.csrf ?? "e2e",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        /* بدنهٔ خالی (204) */
      }
      return { status: res.status, body: parsed };
    },
    { method, path, body },
  );
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/#/login");
  await page.waitForLoadState("networkidle");
  await page.locator("#username").first().fill(username);
  await page.locator("#password").first().fill(password);
  await page.getByRole("button", { name: /ورود/ }).first().click();
  // دکمهٔ منوی کاربر در دسکتاپ و موبایل هر دو نمایان است (نام در موبایل hidden است)
  await page.getByRole("button", { name: /منوی کاربر/ }).first().waitFor({ timeout: 25_000 });
  await page.waitForLoadState("networkidle");
  // رقابت ذخیرهٔ کوکی مرورگر بلافاصله پس از login — تا معتبرشدن نشست صبر می‌کنیم
  await expect
    .poll(
      async () => {
        try {
          const res = await page.request.get("/api/v1/auth/session");
          const data = (await res.json()) as { user?: unknown };
          return data.user ?? null;
        } catch {
          return null;
        }
      },
      { timeout: 15_000, intervals: [500, 1_000] },
    )
    .toBeTruthy();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: /منوی کاربر/ }).first().click();
  await page.getByRole("menuitem", { name: /خروج از حساب/ }).first().click();
  await page.locator("#username").first().waitFor({ timeout: 15_000 });
}

test("highlight → اشتراک → کاربر دوم می‌بیند → مالک لغو می‌کند → 410", async ({ page }) => {
  test.setTimeout(180_000);

  /* ---------- ۱) مالک (admin): ورود + ساخت هایلایت و لینک اشتراک ---------- */
  await login(page, "admin", "zaB3v-XPngB-fXcYw");
  const ann = await pageFetch(page, "POST", "/annotations", {
    document_uid: DOC,
    page_uid: PAGE,
    block_id: BLOCK,
    start: 0,
    end: 13,
    text: HIGHLIGHT_TEXT,
    color: "green",
  });
  expect(ann.status, JSON.stringify(ann.body)).toBe(201);
  const annUID = (ann.body as { uid: string }).uid;

  const share = await pageFetch(page, "POST", "/shares", {
    kind: "highlight",
    item_id: annUID,
    document_uid: DOC,
    page_uid: PAGE,
    page_label: "۱۱۵",
    work_title: "بحار الأنوار",
    payload: HIGHLIGHT_TEXT,
  });
  expect(share.status, JSON.stringify(share.body)).toBe(201);
  const shareBody = share.body as { uid: string; url_path: string };
  expect(shareBody.url_path).toContain("shared=");

  /* ---------- ۲) کاربر دوم (reader): بنر «هایلایت اشتراکی» ---------- */
  await logout(page);
  await login(page, "qa-reader", "QaReader-2026-x9");
  await page.goto(shareBody.url_path); // url_path خودش با «#/read/…» شروع می‌شود
  const banner = page.getByText(/هایلایت اشتراکی از مدیر سامانه/).first();
  await expect(banner).toBeVisible({ timeout: 20_000 });

  /* ---------- ۳) مالک: لغو از تنظیمات (UI) ---------- */
  await logout(page);
  await login(page, "admin", "zaB3v-XPngB-fXcYw");
  await page.goto("/#/settings");
  await page.getByRole("tab", { name: "اشتراک و خروجی" }).click();
  const shareRow = page.locator("li").filter({ hasText: HIGHLIGHT_TEXT }).first();
  await expect(shareRow).toBeVisible({ timeout: 15_000 });
  await shareRow.getByRole("button", { name: /لغو/ }).click();
  // پس از لغو، با بازخوانی صفحه ردیف از فهرست اشتراک‌های فعال حذف شده است
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("li").filter({ hasText: HIGHLIGHT_TEXT })).toHaveCount(0, {
    timeout: 15_000,
  });

  /* ---------- ۴) کاربر دوم دوباره: پیام 410 ---------- */
  await logout(page);
  await login(page, "qa-reader", "QaReader-2026-x9");
  await page.goto(shareBody.url_path); // url_path خودش با «#/read/…» شروع می‌شود
  await expect(page.getByText(/این اشتراک لغو شده یا وجود ندارد/).first()).toBeVisible({
    timeout: 20_000,
  });

  /* ---------- پاک‌سازی: حذف هایلایت آزمون (best-effort؛ قفل گذرای SQLite 500 ممکن است) ---------- */
  await logout(page);
  await login(page, "admin", "zaB3v-XPngB-fXcYw");
  await pageFetch(page, "DELETE", `/annotations/${annUID}`);
});
