import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * تولید کد TOTP برای اتومات‌سازی E2E عملیات حساس ادمین (مورد ۵ دور ۱۴).
 *
 * seed ادمین در app.sqlite نگهداری می‌شود (ستون totp_secret، RFC 6238/base32).
 * برای E2E فقط‌خواندنی خوانده می‌شود؛ هیچ رازی در کد یا خروجی تست نمی‌نشیند.
 * الگوریتم دقیقاً همان internal/auth TOTPCode است: HMAC-SHA1، پنجرهٔ ۳۰ ثانیه،
 * ۶ رقم.
 */

const APP_DB = path.resolve(
  __dirname,
  "../../../mini-services/noor-api/data/app.sqlite",
);

/** base32 (RFC 4648، بدون padding) → Buffer */
export function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error("نویسهٔ نامعتبر در secret پایه‌۳۲");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** کد TOTP در زمان مشخص (RFC 6238، SHA1، ۶ رقم) — هم‌سان با auth.TOTPCode */
export function totpAt(secret: string, atMs: number = Date.now()): string {
  const key = base32Decode(secret);
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const sum = createHmac("sha1", key).update(buf).digest();
  const off = sum[sum.length - 1] & 0x0f;
  const code =
    (((sum[off] << 24) | (sum[off + 1] << 16) | (sum[off + 2] << 8) | sum[off + 3]) &
      0x7fffffff) %
    1_000_000;
  return String(code).padStart(6, "0");
}

/** خواندن فقط‌خواندنی secret ادمین از DB برنامه (برای E2E) */
export function adminTotpSecret(): string {
  const script = `
import { Database } from "bun:sqlite";
const db = new Database(process.env.NOOR_APP_DB, { readonly: true });
const row = db.query("SELECT totp_secret FROM users WHERE username = 'admin' AND disabled = 0").get();
process.stdout.write((row && row.totp_secret) ? String(row.totp_secret) : "");
db.close();
`;
  const out = execFileSync("bun", ["-e", script], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, NOOR_APP_DB: APP_DB },
  });
  const secret = out.trim();
  if (!secret) {
    throw new Error("totp_secret ادمین در app.sqlite یافت نشد — MFA setup اجرا نشده است");
  }
  return secret;
}

/** کد فعلی ادمین برای هدر X-Noor-MFA یا دیالوگ step-up */
export function adminMfaCode(): string {
  return totpAt(adminTotpSecret());
}
