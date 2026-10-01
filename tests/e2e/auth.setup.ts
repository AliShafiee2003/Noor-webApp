import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ADMIN_STATE, READER_STATE, API_BASE, GO_BASE, CSRF_VALUE } from "./helpers";

/**
 * آماده‌سازی نشست‌ها (storageState) — پیش از همهٔ پروژه‌ها اجرا می‌شود.
 * ۱) اطمینان از بالا بودن کارساز فرانت (3000) و API (8080)
 * ۲) ساخت کاربر «qa-reader» با دعوت ادمین اگر وجود نداشته باشد
 * ۳) ورود API هر دو کاربر و ذخیرهٔ کوکی نشست در tests/e2e/.auth/*.json
 */

const READER_USERNAME = "qa-reader";
const READER_PASSWORD = "QaReader!2026x";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "zaB3v-XPngB-fXcYw";

async function waitApi(request: import("@playwright/test").APIRequestContext) {
  let lastErr = "";
  for (let i = 0; i < 60; i += 1) {
    try {
      const resp = await request.get(`${API_BASE}/status`, { timeout: 10_000 });
      if (resp.ok()) return;
      lastErr = `status ${resp.status()}`;
    } catch (err) {
      lastErr = String(err).slice(0, 120);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`کارساز فرانت روی ${API_BASE} پاسخگو نشد — آخرین خطا: ${lastErr}`);
}

async function login(
  request: import("@playwright/test").APIRequestContext,
  username: string,
  password: string,
) {
  const resp = await request.post(`${API_BASE}/auth/login`, {
    headers: { "x-noor-csrf": CSRF_VALUE },
    data: { username, password },
    timeout: 20_000,
  });
  expect(resp.ok(), `ورود ${username} موفق بود (کد ${resp.status()})`).toBeTruthy();
  return resp;
}

async function ensureReaderUser(
  request: import("@playwright/test").APIRequestContext,
  adminCookie: string,
) {
  // ورود مستقیم reader = کاربر موجود است
  const probe = await request.post(`${GO_BASE}/api/v1/auth/login`, {
    headers: { "x-noor-csrf": CSRF_VALUE },
    data: { username: READER_USERNAME, password: READER_PASSWORD },
    timeout: 20_000,
  });
  if (probe.ok()) return;

  // ساخت از مسیر مجاز محصول: دعوت ادمین → accept-invite (فقط از Go مستقیم؛
  // مسیر دعوت ادمین در پل BFF هم هست اما برای مستقل‌بودن از وضعیت compile مسیرها مستقیم می‌زنیم)
  const invite = await request.post(`${GO_BASE}/api/v1/admin/invitations`, {
    headers: { "x-noor-csrf": CSRF_VALUE, cookie: adminCookie },
    data: { role: "reader" },
    timeout: 20_000,
  });
  expect(invite.ok(), "ساخت دعوت با کوکی ادمین موفق بود").toBeTruthy();
  const code = (await invite.json())?.code as string;
  expect(code, "کد دعوت برگشت").toBeTruthy();
  const accept = await request.post(`${GO_BASE}/api/v1/auth/accept-invite`, {
    headers: { "x-noor-csrf": CSRF_VALUE },
    data: {
      code,
      username: READER_USERNAME,
      display_name: "کاربر آزمون E2E",
      password: READER_PASSWORD,
    },
    timeout: 20_000,
  });
  expect(accept.ok(), `پذیرش دعوت و ساخت qa-reader موفق بود (کد ${accept.status()})`).toBeTruthy();
}

function cookieOf(stateFile: string): string {
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  return state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

setup("آماده‌سازی نشست admin و qa-reader", async ({ request }) => {
  fs.mkdirSync(path.dirname(ADMIN_STATE), { recursive: true });
  await waitApi(request);

  // ورود admin → state
  await login(request, ADMIN_USERNAME, ADMIN_PASSWORD);
  await request.storageState({ path: ADMIN_STATE });

  // ساخت کاربر خوانندهٔ آزمون در صورت نبود (با کوکی ادمین)
  await ensureReaderUser(request, cookieOf(ADMIN_STATE));

  // ورود reader → state
  await login(request, READER_USERNAME, READER_PASSWORD);
  await request.storageState({ path: READER_STATE });

  setup.info().annotations.push({
    type: "کاربر آزمون",
    description:
      "qa-reader با مسیر مجاز محصول ساخته می‌شود (POST /api/v1/admin/invitations با کوکی ادمین → POST /api/v1/auth/accept-invite). نام کاربری qa-reader / گذرواژه QaReader!2026x",
  });
});
