# میزکار پژوهشی نور — راهنمای اجرا و عملیات

بازنویسی مستقل محصول بر اساس PRD v2 (`upload/noor-research-prd-v2-go-nextjs-fa.md`).

## معماری اجراشده

| جزء | مسیر | پورت | توضیح |
| --- | --- | --- | --- |
| فرانت (SPA فارسی RTL) | `src/` | 3000 | Next.js 16 App Router؛ کل اپ روی `/` با hash routing |
| API Go | `mini-services/noor-api` | 8080 | modular monolith؛ نویسندهٔ `app.sqlite` (§۳۹) |
| worker | همان ماژول (`cmd/worker`) | — | ساخت نمایه از طریق endpoint داخلی API |
| gateway | Caddyfile | 81 | مسیرها: `/…?XTransformPort=8080` → API؛ بقیه → Next |

## اجرای محلی (سندباکس)

```bash
# ۱) تولید منابع آزمون (fixture هم‌ساخت نور) — فقط بار اول
cd mini-services/noor-api && ./bin/fixturegen -dir ./data/sources

# ۲) اجرا (api + worker)
NOOR_SERVICE_TOKEN=dev-internal-token ./run-local.sh

# ۳) فرانت
cd /home/z/my-project && bun run dev   # پورت 3000 (در حال اجرا)

# ۴) ورود اولیه ادمین (کد دعوت یک‌بارمصرف — بدون رمز ثابت در source)
cd mini-services/noor-api
./bin/adminctl -cmd bootstrap-admin -username admin
# سپس در رابط: صفحهٔ ورود → «قبول دعوت» (#/invite?code=...)
```

آزمون سریع سلامت:
```bash
curl "http://127.0.0.1:81/api/v1/status?XTransformPort=8080"
```

## حساب‌ها و نقش‌ها
- هیچ حساب demo یا ورود خودکار وجود ندارد (§۵۰).
- bootstrap ادمین فقط با کد دعوت یک‌بارمصرف از `adminctl`؛ نقش‌ها دقیقاً `admin` و `reader`.
- MFA ادمین: «تنظیمات → ورود دومرحله‌ای» (TOTP). انتشار اصلاح و تغییر نقش نیاز به کد MFA دارد.

## داده‌ها
- `mini-services/noor-api/data/app.sqlite` — حساب/نشست/پژوهش/overlay/release/job/audit
- `mini-services/noor-api/data/index.sqlite` — نسل نمایهٔ فعال (immutable per release؛ worker نویسنده)
- `mini-services/noor-api/data/sources/*.db` — منابع نور فقط‌خواندنی + `catalog.json`
- **corpus واقعی نور در این محیط موجود نبود**؛ مجموعهٔ fixture طبق §۳۰/§۵۳ PRD تولید شده است.

## عملیات
- **پشتیبان‌گیری سازگار** (§۵۴): `./bin/adminctl -cmd backup -out ./data/backups/app-<ts>.sqlite` (VACUUM INTO)
- **بازسازی نمایه**: مدیریت → کارها → «ساخت مجدد نمایه» (نسل جدید؛ انتشار pointer اتمیک؛ rollback از مدیریت → نسل‌ها)
- **اصلاح منبع**: مدیریت → اصلاحات: پیش‌نویس → اعتبارسنجی → پیش‌نمایش → انتشار (با MFA) → rollback. اصل منابع هرگز تغییر نمی‌کند.
- **logها**: `mini-services/noor-api/api.log` و `worker.log`؛ `dev.log` برای Next.

## استقرار تولید (Linux — آزمون‌نشده در سندباکس)
`deploy/docker-compose.yml` + `deploy/Dockerfile.{api,web}` طبق §۵۲ نوشته شده‌اند:
- منابع روی bind mount فقط‌خواندنی؛ app volume فقط برای API؛ OpenSearch تک‌گرهی روی شبکهٔ داخلی با TLS.
- multi-stage build؛ container غیر-root؛ healthcheck؛ بدون PostgreSQL/Redis.
- **دروازه‌های §۳۳ قبل از استقرار الزامی‌اند** (فضا، inventory، `x86_64`، نگاشت‌ها، مجوز انتشار).

## محدودیت‌های صادقانه (تفکیک دقیق)
1. **اجرا و آزمون‌شده در این محیط**: pipeline استخراج/نمایه/جست‌وجو (حالت‌ها، verifier، cursor، شمارش ۳۰۰رخدادی)، احراز هویت/RBAC/MFA، دادهٔ پژوهشی با ownership+409، overlay/نسل/rollback، خروجی‌ها، رابط کامل فارسی RTL (دسکتاپ/موبایل).
2. **آزمون روی fixture هم‌ساخت، نه corpus واقعی**: اعتبارسنجی فرمت واقعی نور (AES/LZW واقعی، تنوع شِما) هنوز انجام نشده — نصب وابسته به fixture اعتبارسنجی می‌شود.
3. **آزمون‌ناپذیر در این سندباکس**: OpenSearch adapter (قرارداد §۴۶ پیاده، بدون اجرا)، Docker Compose تولید، benchmark و SLO §۲۷، آزمون بار ۱۰ کاربر.
4. **توقف‌های §۵۵**: فضای ۱۰GB با منابع ~۱۰۰GB جمع‌نشدنی است؛ ادعای پوشش کامل کتابخانه نمی‌شود.
