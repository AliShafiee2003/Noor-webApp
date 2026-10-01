import { expect, test, type Page } from "@playwright/test";
import { adminMfaCode } from "./helpers/mfa";

/**
 * سناریو ۵ دور ۱۴ — چرخهٔ کامل ادمین با step-up MFA (قبلاً فقط دستی آزمون می‌شد):
 * ثبت اصلاح محتوایی → اعتبارسنجی → انتشار با کد دومرحله‌ای → ساخت نسل توسط worker →
 * بازگشت به نسل پیشین با کد دومرحله‌ای.
 *
 * کد TOTP همان RFC 6238 سمت Go است و از seed ادمین در DB برنامه (فقط‌خواندنی)
 * محاسبه می‌شود — تطبیق پیاده‌سازی Node/Go در round-14 ثابت شد (کد یکسان).
 * ادعاها روی وضعیت واقعی ردیف‌ها/نسل‌ها هستند نه توست (مقاوم به زمان‌بندی).
 */

const OVERLAY_REASON = "آزمون E2E دور ۱۴ — چرخهٔ کامل اصلاح";

async function loginAdmin(page: Page) {
  await page.goto("/#/login");
  await page.waitForLoadState("networkidle");
  await page.locator("#username").first().fill("admin");
  await page.locator("#password").first().fill("zaB3v-XPngB-fXcYw");
  await page.getByRole("button", { name: /ورود/ }).first().click();
  await page.getByText("مدیر سامانه").first().waitFor({ timeout: 25_000 });
  await page.waitForLoadState("networkidle");
}

async function gotoTab(page: Page, tabLabel: string) {
  await page.getByRole("tab", { name: tabLabel }).first().click();
}

/** پرکردن دیالوگ کد دومرحله‌ای (input-otp) با کد محاسبه‌شده و انتظار برای بسته‌شدن */
async function fillMfaAndSubmit(page: Page, submitLabel: RegExp) {
  const code = adminMfaCode();
  const dialog = page.getByRole("dialog").filter({ hasText: "کد تأیید" }).first();
  await dialog.waitFor({ timeout: 10_000 });
  // input-otp: input واقعی ممکن است داخل یا هم‌سطح ریشه باشد؛ از نقش textbox استفاده می‌کنیم
  const otpInput = dialog.getByRole("textbox").first();
  await otpInput.fill(code);
  await dialog.getByRole("button", { name: submitLabel }).click();
  await dialog.waitFor({ state: "hidden", timeout: 20_000 });
}

test("چرخهٔ کامل ادمین: اصلاح → اعتبارسنجی → انتشار (MFA) → بازگشت نسل (MFA)", async ({ page }) => {
  test.setTimeout(240_000);
  await loginAdmin(page);
  await page.goto("/#/admin");
  await gotoTab(page, "اصلاحات");

  /* ---------- ۱) ثبت پیش‌نویس اصلاح ---------- */
  await page.getByRole("button", { name: "اصلاح جدید" }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "اصلاح جدید" }).first();
  await dialog.waitFor({ timeout: 10_000 });

  // اثر و سند
  await dialog.locator("#overlay-work").click();
  await page.getByRole("option").first().click();
  await dialog.locator("#overlay-doc").click();
  await page.getByRole("option").first().click();

  // نشانهٔ متن مبنی باید خودکار پر شود (رفع گاف دور ۱۴)
  await expect(dialog.locator("#overlay-base-hash")).not.toHaveValue("", { timeout: 15_000 });
  const baseHash = await dialog.locator("#overlay-base-hash").inputValue();
  expect(baseHash).toMatch(/^sha256:/);

  await dialog.locator("#overlay-reason").fill(OVERLAY_REASON);
  await dialog.locator("#overlay-new-text").fill("متن آزمونی برای چرخهٔ اصلاح E2E؛ پس از بازگشت نسل بی‌اثر می‌شود.");
  await dialog.getByRole("button", { name: "ثبت پیش‌نویس" }).click();

  // دیالوگ بسته می‌شود و ردیف پیش‌نویس تازه در فهرست ظاهر می‌شود
  await dialog.waitFor({ state: "hidden", timeout: 20_000 });
  const row = page.locator("li").filter({ hasText: OVERLAY_REASON }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText("پیش‌نویس")).toBeVisible();

  /* ---------- ۲) اعتبارسنجی → وضعیت «اعتبارسنجی‌شده» ---------- */
  await row.getByRole("button", { name: "اعتبارسنجی" }).click();
  await expect(row.getByText("اعتبارسنجی‌شده")).toBeVisible({ timeout: 20_000 });

  /* ---------- ۳) انتشار با کد دومرحله‌ای ---------- */
  await row.getByRole("button", { name: "انتشار اصلاحات" }).click();
  await fillMfaAndSubmit(page, /انتشار/);

  /* ---------- ۴) انتظار برای ساخت نسل: وضعیت «منتشر شد» ---------- */
  let published = false;
  for (let i = 0; i < 36 && !published; i++) {
    await page.waitForTimeout(4_000);
    await gotoTab(page, "داشبورد");
    await gotoTab(page, "اصلاحات");
    published = (await row.getByText("منتشر شد").count()) > 0;
  }
  expect(published, "اصلاح پس از ~۱۴۰ ثانیه منتشر نشد (worker نسل را نساخت)").toBe(true);

  /* ---------- ۵) بازگشت به نسل پیشین با کد دومرحله‌ای ---------- */
  await gotoTab(page, "نسل‌ها");
  const rollbackBtn = page.getByRole("button", { name: /بازگشت به این نسل/ }).first();
  await expect(rollbackBtn).toBeVisible({ timeout: 20_000 });
  await rollbackBtn.click();
  await fillMfaAndSubmit(page, /بازگشت نسل/);

  // پس از بازگشت، دوباره نشانهٔ «نسخهٔ فعال» دیده می‌شود (نسل بازگشتی فعال شد)
  await expect(page.getByText("نسخهٔ فعال").first()).toBeVisible({ timeout: 20_000 });

  /* ---------- ۶) بازگرداندن سامانه به حالت سازگار: ساخت مجدد نمایه ---------- */
  // rollback فقط pointer را عقب می‌برد؛ فایل نمایهٔ فعلی نسلِ تازه‌تر است. با
  // ساخت مجدد نمایه، نسل تازه‌ای ساخته و منتشر می‌شود تا pointer↔file هم‌خوان بماند.
  await pageFetchAdmin(page, "POST", "/admin/index/rebuild", {});
  // تا بازگشت جست‌وجوی طلایی به ۳۰۰ موضع (نشانهٔ هم‌خوانی نسل و نمایه) صبر می‌کنیم
  let verified = 0;
  for (let i = 0; i < 40 && verified !== 300; i++) {
    await page.waitForTimeout(3_000);
    const sr = await pageFetchAdmin(page, "POST", "/search", {
      query: "الكعبة بيت الله",
      mode: "strict_phrase",
      scope: { target: "library" },
      page_size: 5,
    });
    verified = (sr.body as { verified_occurrences?: number }).verified_occurrences ?? 0;
  }
  expect(verified, "جست‌وجوی طلایی پس از ساخت مجدد باید ۳۰۰ موضع بدهد").toBe(300);
});

/** فراخوانی API ادمین داخل صفحه (کوکی/CSRF واقعی نشست) */
async function pageFetchAdmin(
  page: Page,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
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
        /* 204 */
      }
      return { status: res.status, body: parsed };
    },
    { method, path, body },
  );
}
