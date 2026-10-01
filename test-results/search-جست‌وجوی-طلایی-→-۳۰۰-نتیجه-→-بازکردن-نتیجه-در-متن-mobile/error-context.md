# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: search.spec.ts >> جست‌وجوی طلایی → ۳۰۰ نتیجه → بازکردن نتیجه در متن
- Location: tests/e2e/search.spec.ts:19:5

# Error details

```
TimeoutError: locator.fill: Timeout 20000ms exceeded.
Call log:
  - waiting for locator('#search-query')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]: میزکار پژوهشی نور
    - generic [ref=e7]:
      - generic [ref=e8]:
        - generic [ref=e9]: ورود به میزکار
        - generic [ref=e10]: با نام کاربری و گذرواژهٔ خود وارد شوید.
      - generic [ref=e11]:
        - alert [ref=e12]: تلاش‌های بیش از حد؛ کمی بعد دوباره تلاش کنید
        - generic [ref=e13]:
          - generic [ref=e14]:
            - generic [ref=e15]: نام کاربری
            - textbox "نام کاربری" [ref=e16]: admin
          - generic [ref=e17]:
            - generic [ref=e18]: گذرواژه
            - textbox "گذرواژه" [ref=e19]: zaB3v-XPngB-fXcYw
          - button "ورود" [ref=e20]
    - paragraph [ref=e21]: حساب کاربری با دعوت مدیر سامانه ساخته می‌شود. اگر کد دعوت دارید، از نشانی ارسالی استفاده کنید.
  - region "Notifications (F8)":
    - list
  - button "Open Next.js Dev Tools" [ref=e27] [cursor=pointer]
  - alert [ref=e31]
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | 
  3  | /**
  4  |  * سناریو ۲ — جست‌وجو → بازکردن نتیجه (ه-۱۲-۲) و سناریو ۴ — خروجی CSV (ه-۱۲-۴)
  5  |  * و سناریو ۸ — نمای موبایل/دسکتاپ (ه-۱۲-۸، با دو پروژهٔ playwright).
  6  |  */
  7  | 
  8  | const GOLDEN = "الكعبة بيت الله";
  9  | 
  10 | async function login(page: import("@playwright/test").Page) {
  11 |   await page.goto("/#/login");
  12 |   await page.waitForLoadState("networkidle");
  13 |   await page.locator('#username').first().fill("admin");
  14 |   await page.locator('#password').first().fill("zaB3v-XPngB-fXcYw");
  15 |   await page.getByRole("button", { name: /ورود/ }).first().click();
  16 |   await page.waitForLoadState("networkidle");
  17 | }
  18 | 
  19 | test("جست‌وجوی طلایی → ۳۰۰ نتیجه → بازکردن نتیجه در متن", async ({ page }) => {
  20 |   await login(page);
  21 |   await page.goto("/#/search");
  22 |   await page.waitForLoadState("networkidle");
> 23 |   await page.locator("#search-query").fill(GOLDEN, { timeout: 20_000 });
     |                                       ^ TimeoutError: locator.fill: Timeout 20000ms exceeded.
  24 |   await page.getByRole("button", { name: "جست‌وجو" }).first().click();
  25 |   // شمار تأییدشده — عبارت واقعی: «تطبیق‌های تأییدشده تا این لحظه: ۳۰۰»
  26 |   await expect(page.getByText(/تأییدشده تا این لحظه/).first()).toBeVisible({ timeout: 45_000 });
  27 |   // باز کردن اولین نتیجه در کتاب‌خوان (لینک «بازکردن در متن» در کارت نتیجه)
  28 |   await page.getByRole("link", { name: /بازکردن در متن/ }).first().click({ timeout: 15_000 });
  29 |   await page.waitForURL(/read/, { timeout: 30_000 });
  30 |   await expect(page.getByRole("main").first()).toBeVisible({ timeout: 30_000 });
  31 | });
  32 | 
  33 | test("خروجی CSV جست‌وجو — ۳۰۰ ردیف + BOM", async ({ page }) => {
  34 |   await login(page);
  35 |   await page.goto("/#/search");
  36 |   await page.waitForLoadState("networkidle");
  37 |   await page.locator('#search-query').fill(GOLDEN);
  38 |   await page.getByRole("button", { name: "جست‌وجو" }).first().click();
  39 |   await expect(page.getByText(/تأییدشده تا این لحظه/).first()).toBeVisible({ timeout: 45_000 });
  40 | 
  41 |   const [download] = await Promise.all([
  42 |     page.waitForEvent("download", { timeout: 60_000 }),
  43 |     (async () => {
  44 |       await page.getByRole("button", { name: /دریافت خروجی/ }).first().click();
  45 |       await page.getByRole("menuitem", { name: /CSV/ }).first().click();
  46 |     })(),
  47 |   ]);
  48 |   const path = await download.path();
  49 |   const fs = await import("node:fs");
  50 |   const buf = fs.readFileSync(path!);
  51 |   // BOM UTF-8
  52 |   expect(buf[0]).toBe(0xef);
  53 |   expect(buf[1]).toBe(0xbb);
  54 |   expect(buf[2]).toBe(0xbf);
  55 |   const text = buf.toString("utf8");
  56 |   // ۴ سطر فراداده/هدر + ۳۰۰ ردیف
  57 |   const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  58 |   expect(lines.length).toBeGreaterThanOrEqual(304);
  59 |   expect(text).toContain(GOLDEN);
  60 | });
  61 | 
  62 | test.describe("نمایش واکنش‌گرا", () => {
  63 |   for (const width of [1440, 390]) {
  64 |     test(`نمای ${width}px بدون سرریز افقی`, async ({ page }) => {
  65 |       await page.setViewportSize({ width, height: 900 });
  66 |       await login(page);
  67 |       await page.goto("/#/search");
  68 |       await page.waitForLoadState("networkidle");
  69 |       const overflow = await page.evaluate(
  70 |         () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  71 |       );
  72 |       // تلورانس کوچک برای اسکرول‌بار
  73 |       expect(overflow).toBeLessThanOrEqual(24);
  74 |     });
  75 |   }
  76 | });
  77 | 
```