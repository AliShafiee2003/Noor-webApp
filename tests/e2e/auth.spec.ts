import { expect, test, type Page } from "@playwright/test";

/**
 * سناریو ۱ — ورود/خروج (ه-۱۲-۱) و سناریو ۷ — RBAC دو نقش (ه-۱۲-۷).
 * رابط کاملاً فارسی است؛ selectorها بر پایهٔ متن/placeholder فارسی.
 *
 * درس دور ممیزی: محدودساز نرخ ورود (SEC-09) در تولید ۵/دقیقه است؛ در محیط E2E
 * با NOOR_LOGIN_RATE_MAX بالا می‌رود و خطای محدودسازی اکنون 429 صادقانه است.
 * helper ورود منتظر «موفقیت یا خطا» می‌ماند و خطای محدودسازی را صریح گزارش می‌کند.
 */

export async function login(page: Page, username: string, password: string) {
  await page.goto("/#/login");
  await page.waitForLoadState("networkidle");
  const userField = page.locator("#username").first();
  await userField.fill(username, { timeout: 20_000 });
  await page.locator("#password").first().fill(password);
  await page.getByRole("button", { name: /ورود/ }).first().click();
  // انتظار برای نتیجهٔ ورود: منوی کاربر (موفق) یا پیام خطا — جلوگیری از رقابت
  // دکمهٔ منوی کاربر در دسکتاپ و موبایل هر دو نمایان است
  const outcome = await Promise.race([
    page
      .getByRole("button", { name: /منوی کاربر/ })
      .first()
      .waitFor({ timeout: 25_000 })
      .then(() => "ok" as const),
    page
      .locator(".text-destructive")
      .first()
      .waitFor({ timeout: 25_000 })
      .then(async () => {
        const msg = await page.locator(".text-destructive").first().textContent();
        return ("error:" + (msg ?? "")) as string;
      }),
  ]).catch(() => "timeout" as const);
  if (outcome !== "ok") {
    throw new Error(
      `ورود ${username} ناموفق — نتیجه: ${outcome} (اگر «بیش از حد» است، محدودساز نرخ فعال شده: NOOR_LOGIN_RATE_MAX را بررسی کنید)`,
    );
  }
  await page.waitForLoadState("networkidle");
}

export async function logout(page: Page) {
  // خروج از منوی کاربر (همیشه در دسترس، مستقل از تب فعال تنظیمات)
  await page.getByRole("button", { name: /منوی کاربر/ }).first().click();
  await page.getByRole("menuitem", { name: /خروج از حساب/ }).first().click();
  await page.locator("#username").first().waitFor({ timeout: 15_000 });
}

test.describe("ورود و خروج", () => {
  test("ورود موفق admin و مشاهدهٔ نام کاربر", async ({ page }) => {
    await login(page, "admin", "NoorDev-2026-Temp");
    await page.goto("/");
    // نام کاربر در برچسب دسترس‌پذیری دکمهٔ منوی کاربر است — در دسکتاپ و موبایل
    await expect(
      page.getByRole("button", { name: /منوی کاربر: مدیر سامانه/ }).first(),
    ).toBeVisible({ timeout: 20_000 });
    // در دسکتاپ نام متنِ نمایان هم هست
    if (test.info().project.name === "desktop") {
      await expect(page.getByText("مدیر سامانه").first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test("رمز غلط رد می‌شود", async ({ page }) => {
    await page.goto("/#/login");
    await page.locator("#username").first().fill("admin");
    await page.locator("#password").first().fill("wrong-password-123");
    await page.getByRole("button", { name: /ورود/ }).first().click();
    await expect(
      page
        .locator("text=رمز")
        .or(page.locator("[role=alert]"))
        .or(page.locator(".text-destructive"))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("خروج از حساب", async ({ page }) => {
    await login(page, "admin", "NoorDev-2026-Temp");
    await logout(page);
    await page.goto("/");
    // پس از خروج، فرم ورود یا نبود نام کاربر
    await expect(page.getByText("مدیر سامانه")).toHaveCount(0, { timeout: 15_000 });
  });
});

test.describe("RBAC دو نقش", () => {
  test("admin به پنل مدیریت دسترسی دارد", async ({ page }) => {
    await login(page, "admin", "NoorDev-2026-Temp");
    await page.goto("/#/admin");
    await page.waitForLoadState("networkidle");
    // پنل مدیریت رندر می‌شود (نه فرم ورود، نه پیام منع دسترسی)
    await expect(page.locator("#username")).toHaveCount(0);
    await expect(page.getByText("مدیریت سامانه").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("دسترسی فقط برای مدیر سامانه")).toHaveCount(0);
  });

  test("reader منوی مدیریت ندارد و پنل مدیریت برای او بسته است", async ({ page }) => {
    await login(page, "qa-reader", "QaReader-2026-x9");
    // دکمهٔ منوی کاربر در دسکتاپ و موبایل نمایان است (نام در موبایل hidden است)
    await expect(page.getByRole("button", { name: /منوی کاربر/ }).first()).toBeVisible({
      timeout: 15_000,
    });
    // آیتم «مدیریت» در ناوبری نیست (دسکتاپ) و در منوی موبایل هم نیست
    await expect(page.getByRole("link", { name: "مدیریت" })).toHaveCount(0);
    // تلاش مستقیم برای /#/admin → کارت منع دسترسی، نه پنل
    await page.goto("/#/admin");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("دسترسی فقط برای مدیر سامانه").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("مدیریت سامانه", { exact: true })).toHaveCount(0);
  });
});
