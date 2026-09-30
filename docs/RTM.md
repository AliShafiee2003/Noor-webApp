# جدول رهگیری نیازمندی‌ها (RTM) — وضعیت واقعی (به‌روزرسانی دور دوم بازبینی دوره‌ای)

آخرین به‌روزرسانی: رفع باگ‌های جریان جست‌وجو→متن (پروژه‌ها، p-front، پارامتر pg، match_offsets، هایلایت سرفصل)؛ افزودن پنل آیه (QUR-01/02)، روایت لینک‌پذیر (HAD-08)، گروه‌بندی مواضع (SEARCH-14) و شمارش تفکیکی (TECH-11) — همه با E2E مرورگر.
جزئیات اجرا: worklog.md؛ راهنمای اجرا: docs/README.md

وضعیت‌ها: ✅ پیاده+آزمون‌شده | 🟡 پیاده‌شده/آزمون محدود | 🔧 اسکلت/پیاده ولی در این محیط آزمون‌ناپذیر | ⬜ انجام‌نشده
مبنا: fixture هم‌ساخت نور (نه corpus واقعی). اعتبارسنجی با corpus واقعی = مانع باقی‌مانده برای همهٔ موارد داده‌محور.

| شناسه | خلاصه | پیاده‌سازی | آزمون پذیرش | وضعیت |
| --- | --- | --- | --- | --- |
| AUTH-01..03 | نشست الزامی، بازگشت به مقصد، خروج/انقضا در سرور | Go httpapi/auth + SPA guard | tests/auth_test.go + E2E | 🟡 |
| AUTH-04..05 | روش استاندارد، Argon2id، محدودسازی تلاش، پیام غیرافشاگر | auth pkg | unit | 🟡 |
| AUTH-06 | ترجیحات متصل به حساب | workspace prefs | API test | 🟡 |
| AUTH-07 | cache خصوصی no-store | Next headers + Go | manual | 🟡 |
| AUTH-08 | مشاهده/لغو نشست‌ها | /auth/sessions | API test | 🟡 |
| AUTH-09 | MFA ادمین (TOTP) + step-up | auth/totp | unit + API | 🟡 |
| LIB-01..05 | فهرست آثار، جست‌وجوی سریع، صفحهٔ اثر، تفکیک جلد/سند، مسیر کوتاه | Go catalog + UI library/work | API+E2E | 🟡 |
| LIB-06 | منتخب/اخیر خصوصی | workspace recent | API | 🟡 |
| LIB-07..10 | مرور موضوعی/زبان/مؤلف، امکانات اثر، بدون حدس فراداده، مرتبط | works filters+features+related | API | 🟡/⬜(related فقط نمایش وضعیت) |
| READ-01..16 | حالت صفحه/پیوسته، فهرست درختی، پرش به صفحهٔ چاپی، تفکیک هم‌نام، پاورقی، تنظیم قلم، اعراب، highlight نتیجه، نشانک/موضع، بارگذاری تدریجی | Reader SPA + pages API | E2E + manual 391/768/1024/1440 | 🟡 |
| READ-17 | کپی نشانی با یک اقدام | UI دکمهٔ کپی | manual | 🟡 |
| SEARCH-01..03 | ساده/دقیق/نرمال/پیشرفته | LocalIndexEngine modes | golden tests | 🟡 |
| SEARCH-04..05 | near، fuzzy اختیاری | engine modes | unit | 🟡 |
| SEARCH-06..09 | دامنه اثر/جلد/زبان/مؤلف/ناشر، scope متن/پاورقی/روایت، scope از کتاب‌خوان | scope filters | golden | 🟡 |
| SEARCH-10..13 | کارت نتیجه با شاهد/نوع تطبیق، highlight روی اصل، بازکردن در متن/کنار متن، حفظ فیلتر و موضع | UI + API | E2E | 🟡 |
| SEARCH-14..20 | گروه‌بندی کتاب، تفکیک قطعه/روایت، ذخیرهٔ جست‌وجو، ترتیب‌ها، صفحه‌بندی پایدار، چیپ فیلتر | /search/books + cursor + GroupedPositions + verified_passages/hadiths | golden+API+E2E | ✅ (SEARCH-14/20 روی fixture) |
| SEARCH-21..22 | سه وضعیت خالی، سازگاری نسخه نمایه/خوان | UI states + release_uid | E2E | 🟡 |
| HAD-01..12 | بازسازی قطعات، سند جدا، G/K/maasoom display، RevayatIndex نمایشی/لینک‌پذیر، بی‌نشانه برچسب، شمارش جدا | xmlparse+renderer+پنل زمینه | unit+E2E | ✅ (HAD-08 با revayat_index در بلوک‌ها) |
| QUR-01..09 | پنل آیه، نشانی مستقل ayahAddress، متن منبع جدا از معیار | content model + VersePanel در پنل زمینه | unit+E2E | ✅ (پنل آیه و چیپ نشانی E2E شد) |
| TOP-01..08 | موضوع/کلیدواژه/برچسب شخصی، شمارش، از موضوع به موضع | topics API+UI | API | 🟡 |
| REL-01..11 | روابط با نوع، وضعیت مقصد، بازکردن کنار متن، ارجاع حل‌نشده | compare + link blocks | E2E | 🟡 |
| RES-01..14 | پرونده، فیش با نشانی، autosave وضعیت، تعارض 409، سطل، خروجی MD/CSV/چاپ، خصوصی، revisions | research pkg + UI | API+two-user test | 🟡 |
| WORK-01..10 | جریان پیوسته، بازگشت به نتایج، هشدار تغییر ذخیره‌نشده، بازیابی میزکار | SPA state | E2E | 🟡 |
| DATA-01..16 | immutable منابع، registry/checksum، dictionary همان فایل، ترتیب ItemNo، گزارش بازگشایی، پوشش، quarantine | noordb+catalog+fixturegen | fixturegen report | 🟡 |
| SEC-01..15 | RBAC سرور، IDOR tests، CSRF/Origin، XSS-safe render، محدود نرخ، audit | auth+httpapi middleware | two-user test | 🟡 |
| ADMIN-01..10 | داشبورد، خطاها، پوشش، overlay چرخه کامل + preview/rollback، کاربران، audit | overlay+admin API+UI | API+E2E | 🟡 |
| TECH-01..20 | بازنویسی بدون کد قدیمی، بودجه سقف‌ها، timeout/cancellation، transaction قواعد، N1 نسخه‌دار، cursor امضاشده، خطا ۴بخشی، overlay اتمیک، RBAC مرکزی، backup سازگار | همه در کد | unit/integration | 🟡 |
| §۴۶ OpenSearch | adapter مطابق قرارداد فیلدها | search/opensearch.go | **آزمون‌ناپذیر در سندباکس** | 🔧 |
| §۵۲ Docker | compose prod + Dockerfileها | deploy/ | **آزمون‌ناپذیر در سندباکس** | 🔧 |
| §۵۳ golden set | ۱۰۰+ query با نتایج مورد انتظار روی fixture | tests/golden | اجرا می‌شود | 🟡 (روی fixture) |
| §۵۴ backup | VACUUM INTO + runbook | adminctl backup | API test | 🟡 |
| عملکرد §۲۷ | SLO | — | benchmark واقعی نیازمند محیط مصوب | ⬜ (توقف صادقانه) |

## توقف‌های شفاف (طبق §۵۵)
1. **فضای ۱۰GB با منابع ~۱۰۰GB جمع‌نشدنی است** — استقرار کامل production تا رفع ظرفیت متوقف می‌ماند (PRD خودش این را تضمین نمی‌کند).
2. corpus واقعی نور و app_development.zip در دسترس نیستند؛ همهٔ داده‌ها fixture هم‌ساخت‌اند.
3. OpenSearch/Docker در این سندباکس اجرا نمی‌شوند؛ adapter و compose آزمون‌نشده‌اند.
4. benchmark/بار ۱۰ کاربر و SLO نیازمند محیط مصوب پایلوت است.
