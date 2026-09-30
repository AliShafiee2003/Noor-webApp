# ADR — تصمیم‌های معماری (میزکار پژوهشی نور، نسخهٔ جدید مستقل)

## ADR-1: بک‌اند Go به‌صورت سرویس مجزا (modular monolith)
- مسیر: `mini-services/noor-api` (ماژول Go مستقل)، پورت **8080**، دسترسی مرورگر از طریق gateway با `?XTransformPort=8080` (فقط مسیر نسبی).
- ساختار: `cmd/api`, `cmd/worker`, `cmd/adminctl`, `cmd/fixturegen` + `internal/{config,store,catalog,noordb,xmlparse,norm,index,search,auth,research,overlay,jobs,exportpkg,httpapi,audit}`.
- Router: `chi` استاندارد؛ driver: `modernc.org/sqlite` (بدون CGO) طبق PRD §۳۸.
- طبق PRD §۳۹ فقط Go API نویسندهٔ `app.sqlite` است؛ worker وضعیت job را از طریق endpoint داخلی API ثبت می‌کند.

## ADR-2: موتور جست‌وجو — اینترفیس قابل‌تعویض
- اینترفیس `search.Engine` با دو پیاده‌سازی:
  1. **LocalIndexEngine** (فعال در این سندباکس): خط استخراج مستقل (fixture SQLite نور → decoder → parser امن → N1 → passage با anchor و نگاشت offset) و نمایهٔ وارون در `index.sqlite` مشتق؛ سپس بازیابی کاندید → **verifier روی متن مؤثر همان نسخه** → نتایج تأییدشده با شاهد/offset/highlight، dedupe با کلید document+range، cursor پایدار opaque امضاشده، شمارش صادقانه (verified_occurrences, count_relation, continuation_available). قرارداد دقیق §۴۴–۴۷ پیاده شده.
  2. **OpenSearchAdapter** (اسکلت تولید): mapping و query ساز مطابق §۴۶ (text_n1 بدون stopword/stemming، dynamic strict، _source حداقلی، PIT+search_after). **در این سندباکس قابل اجرا و آزمون نیست** — وضعیت در RTM: «پیاده‌سازی‌شده، آزمون‌نشده (نیازمند محیط production)». Elasticsearch دوم نصب نمی‌شود.
- هیچ جست‌وجوی سراسری SQLiteها را در هر درخواست اسکن نمی‌کند.

## ADR-3: فرانت — SPA روی `/` با hash routing
- محدودیت سندباکس: کاربر فقط route `/` را می‌بیند؛ بنابراین کل محصول یک SPA روی `src/app/page.tsx` است و ناوبری داخلی با hash (`#/search?q=...`, `#/read/{documentUid}?page=...`).
- این با WORK-10/RES-08 سازگار است (لینک پایدار = hash؛ پس از ورود بازیابی می‌شود). عبارت و فیلترهای عمومی در hash؛ token/دادهٔ خصوصی هرگز.
- استک: TanStack Query (server state)، Zustand (وضعیت میزکار)، shadcn/ui بازبینی‌شده برای RTL، Tailwind 4 با tokenهای §۴۱.
- فونت‌ها **محلی**: Vazirmatn (UI) و Amiri (متن عربی) از پکیج‌های @fontsource — بدون CDN.

## ADR-4: داده‌ها
- منابع نور: فقط‌خواندنی در `mini-services/noor-api/data/sources/*.db` (fixture هم‌ساخت تولیدشده توسط `cmd/fixturegen`؛ **corpus واقعی در سندباکس موجود نیست**).
- `app.sqlite`: کاربران/نشست‌ها/دعوت‌ها/پروژه‌ها/فیش‌ها/یادداشت‌ها/نشانک‌ها/جست‌وجوهای ذخیره/ترجیحات/overlay/release/job/outbox/audit — فقط Go API نویسنده.
- `index.sqlite` (نسل نمایه، immutable per release): worker می‌سازد؛ API فقط می‌خواند. نسخهٔ فعال با pointer `active_release` در app.sqlite (اتمیک + outbox + audit).
- Prisma پروژهٔ Next در این محصول استفاده نمی‌شود (مالک دادهٔ برنامه، Go API است — PRD §۳۹).

## ADR-5: امنیت
- Argon2id (64MiB, t=3, p=1) با rehash در ورود؛ session token تصادفی ≥256bit، فقط digest در DB؛ کوکی HttpOnly SameSite=Lax (`Secure`/نام `__Host-` در تولید، در سندباکس بدون Secure چون preview ممکن است http باشد).
- RBAC مرکزی: هر route صریحاً `public|auth|owner|admin`؛ MFA (TOTP RFC6238 دست‌نویس + تست) برای ادمین و step-up انتشار/تغییر نقش.
- CSRF: کنترل Origin + هدر `X-Noor-CSRF` برای mutation (double-submit در حافظهٔ JS، نه localStorage).
- درخواست‌ها محدود: rate-limit ورود/جست‌وجو/export، page_size 20–50، طول query ≤2048 codepoint (طول بیشتر → long_quote).
- رندر فرانت فقط از بلوک‌های ساخت‌یافته API (whitelist component) — XML خام هرگز به dangerouslySetInnerHTML نمی‌رود.
- bootstrap ادمین با دعوت یک‌بارمصرف از `adminctl` (بدون رمز ثابت در source).

## ADR-6: انحراف‌های ثبت‌شده از PRD (به‌دلیل سندباکس، با دلیل و اثر)
1. worker به‌صورت پروسهٔ مجزا (`cmd/worker`) پیاده شده ولی در سندباکس داخل همان host اجرا می‌شود؛ نوشتن job از طریق endpoint داخلی API با service token.
2. OpenSearch نصب/آزمون نشده (۴GB RAM). LocalIndexEngine قرارداد کامل را دارد.
3. Docker Compose نوشته می‌شود ولی در سندباکس اجرا/آزمون نمی‌شود (Docker موجود نیست) — وضعیت در RTM شفاف.
4. فونت/asset: همه محلی.
5. بازیابی رمز: چون سرویس ایمیل نیست، مسیر «کمک ادمین با ثبت audit» (طبق §۵۰).
6. TLS/پروکسی production در compose پیش‌بینی شده؛ در سندباکس gateway Caddy جای آن را می‌گیرد.
