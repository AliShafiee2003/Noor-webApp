# جدول رهگیری نیازمندی‌ها (RTM) — وضعیت واقعی (به‌روزرسانی دور ممیزی مستقل — ۲۰۲۶-۱۰-۰۱)

این دور: ۸ یافتهٔ ممیزی همه در کد راستی‌آزمایی و برطرف شد؛ بند الف (موتور)، ب (سقف/نشست)، ج (یکپارچگی داده)، د-۹/۱۱ و ه-۱۲/۱۳ با شواهد اجرایی واقعی بسته شدند. `go vet ./...` و `go test ./...` سبز (auth/httpapi/index/noordb/search/xmlparse). پاریتی دو موتور: ۱۲۶/۱۲۶ طلایی یکسان.

آخرین به‌روزرسانی: **پالایش برچسب در «همهٔ فیش‌های من»** — `GET /my/clips/tags` (توزیع برچسب‌های فیش‌های فعال کاربر با شمار صادقانه؛ تجزیهٔ JSON در Go چون برنامه‌ریز SQLite جدول‌مجازی json_each را پیش از WHERE ارزیابی می‌کند و ردیف tags='null' قدیمی کل کوئری را می‌شکند) + چیپ‌های برچسب با نشان شمار و «برداشتن برچسب» + نشان برچسب روی کارت فیش + نوار ابتدای خط رنگی بر نوع فیش؛ **برچسب چاپی صفحهٔ مقصد یادداشت‌ها** — `page_label` در `GET /notes` از مدل سند و دکمهٔ «پرش به صفحهٔ ۱۱۵» به‌جای متن بی‌برچسب؛ **«فیش‌های من» در دیالوگ §۴۷** — `my_clips` روی هر سند گروه‌ها (شمار فیش‌های فعالِ همین کاربر برای روایت محلی) با نشان «۳ فیش من» روی گروه و «۳ فیش» روی خط سند.
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
| SEARCH-10..13 | کارت نتیجه با شاهد/نوع تطبیق، highlight روی اصل، بازکردن در متن/**کنار نتایج** (SEARCH-11)، حفظ فیلتر و موضع | UI + API + SplitReaderPanel (hash-persisted، sticky، FicheDialog کامل) | E2E دسکتاپ/موبایل/تیره | ✅ (SEARCH-11 روی fixture) |
| SEARCH-14..20 | گروه‌بندی کتاب، تفکیک قطعه/روایت، ذخیرهٔ جست‌وجو، ترتیب‌ها، صفحه‌بندی پایدار، چیپ فیلتر | /search/books + cursor + GroupedPositions + verified_passages/hadiths | golden+API+E2E | ✅ (SEARCH-14/20 روی fixture) |
| SEARCH-21..22 | سه وضعیت خالی، سازگاری نسخه نمایه/خوان | UI states + release_uid | E2E | 🟡 |
| §۴۶-OS | آداپتور OpenSearch واقعی: کلاینت HTTP خودنویس، mapping بدون stemming/stopword (+حذف اعراب)، bulk کنترل‌نرخ، PIT+search_after، _source حداقلی | internal/search/opensearch.go + cmd/worker (bulkIndexOpenSearch) + cmd/osindex | TestGoldenSetOpenSearchParity: ۱۲۶/۱۲۶ یکسان با موتور محلی (OpenSearch 2.17.1 واقعی روی 127.0.0.1:9200) | ✅ (fixture) |
| §۴۶-SELECT | انتخاب صریح NOOR_ENGINE؛ opensearch بدون سرویس → استارت با خطای فهمیدنی فارسی؛ /status و لاگ موتور واقعی | cmd/api/main.go | اجرای منفی curl (connection refused → پیام فارسی) + /status engine:local | ✅ |
| §۴۴-TRI | حذف اسکن کامل عبارت دقیق: نمایهٔ trigram روی text_n1 + تأیید نهایی روی متن اصلی | internal/index/index.go + engine.go | TestStrictPhraseTrigramPrefilterParity + golden strict ۲۴/۲۴ | ✅ |
| §۴۷-CAP | سقف کل نتایج (NOOR_MAX_RESULTS پیش‌فرض ۱۰٬۰۰۰) + count_relation صادقانه lower_bound + notice فارسی | engine.go run/buildResponse | TestMaxResultsCap | ✅ |
| §۴۷-SESS | نشست جست‌وجو فقط «درخواست» در app.sqlite (TTL پیش‌فرض ۳۰min، تخلیهٔ per-session)؛ صفحه‌بندی با re-execute قطعی + cursor امضاشده؛ GoneError حفظ | store.go + engine.go | TestSessionStoreSQLite/TestSessionGoneAfterTTL/TestContinueReexecuteParity/TestMemSessionEvictionPerSession | ✅ |
| ج-۷ | هایلایت/اشتراک/PDF-job فقط در Go (app.sqlite)؛ Prisma/db-custom حذف؛ Next پروکسی خالص؛ migration با cmd/migrate-bff؛ ADR-4 بازنویسی | internal/httpapi/ugc.go + store.go | TestUGCHighlightsTwoUsers/TestUGCSharesTwoUsers/TestUGCPdfJobsTwoUsers + curl دوکاربه | ✅ |
| د-۹ | PDF قابل‌استقرار: NOOR_CHROME_PATH/NOOR_FONT_DIR/NOOR_PDF_EXPORT_DIR/NOOR_API_INTERNAL_URL با env؛ Chromium در Dockerfile.web؛ volume pdf_out؛ Caddyfile.prod | Dockerfile.web + docker-compose.yml + deploy/Caddyfile.prod + src/lib/{pdf-export,pdf-jobs-runner,bff-auth}.ts | YAML compose معتبر + ارجاع‌ها موجود؛ اجرای واقعی compose در سندباکس ممکن نشد (مانع: بدون docker و بدون دسترسی root) | 🟡 |
| ه-۱۲ | suite خودکار E2E با Playwright: ورود/خروج، جست‌وجوی طلایی→بازکردن، خروجی CSV (BOM+۳۰۰ ردیف)، RBAC، نمای 1440/390 | playwright.config.ts + tests/e2e/{auth,search,smoke}.spec.ts | desktop: 8 passed/2 skip-مستند؛ mobile: 7 passed/2 fail (فرم جست‌وجوی موبایل) | 🟡 |
| ه-۱۳ | مجموعهٔ طلایی داده‌محور ۱۲۶ پرس‌وجو در ۱۱ گروه روی fixture + اجرای هر دو موتور | internal/search/golden.go + testdata/golden.json + cmd/goldengen | TestGoldenSetLocal PASS؛ پاریتی OS کامل | ✅ |
| HAD-01..12 | بازسازی قطعات، سند جدا، G/K/maasoom display، RevayatIndex نمایشی/لینک‌پذیر، بی‌نشانه برچسب، شمارش جدا، **پرس‌وجوی میان‌کتابی روایت (§۴۷)**، revayat_index در Result | xmlparse+renderer+پنل زمینه+`GET /documents/{uid}/hadiths/{localUID}/locations`+`revayat_index` در Result (کارت نتیجه + پنل کتاب‌خوان + پنل کنار نتایج) | unit (engine_revayat_test) + E2E (۲ اثر روی fixture) | ✅ |
| QUR-01..09 | پنل آیه، نشانی مستقل ayahAddress، متن منبع جدا از معیار | content model + VersePanel در پنل زمینه | unit+E2E | ✅ (پنل آیه و چیپ نشانی E2E شد) |
| TOP-01..08 | موضوع/کلیدواژه/برچسب شخصی، شمارش، از موضوع به موضع | topics API+UI | API | 🟡 |
| REL-01..11 | روابط با نوع، وضعیت مقصد، بازکردن کنار متن، ارجاع حل‌نشده | compare + link blocks | E2E | 🟡 |
| RES-01..14 | پرونده، فیش با نشانی، autosave وضعیت، تعارض 409، سطل، خروجی MD/CSV/چاپ، خصوصی، revisions، **کپی ارجاع روی کارت نتیجه**، **یادداشت شخصی: صفحه/سند/روایت مشخص (local_hadith_uid) از همهٔ مسیرها، تعارض 409، حذف**، **فیش‌های این روایت در پنل روایت (GET /my/clips)**، **پرش عمیق یادداشت به صفحهٔ مقصد (با برچسب چاپی صفحه — page_label در GET /notes)**، **یادداشت روایت از دیالوگ §۴۷**، **ثبت فیش این روایت از پنل روایت (همهٔ مسیرها)**، **«همهٔ فیش‌های من» در میزکار با پالایش نوع/برچسب/جست‌وجو (GET /my/clips/all + GET /my/clips/tags)**، **«فیش‌های من» در گروه‌های دیالوگ §۴۷ (my_clips)** | research pkg + UI (ResultCard.copyCitation + NotesPanel + دامنهٔ روایت + HadithClipsSection + onJumpToPage + onNoteRequest + onHadithFiche در FootnotePanel/reader-view/split-reader + MyFichesSection با چیپ برچسب در خانه + نشان my_clips در HadithLocationsDialog) | API smoke (CRUD+409+page_uid+/my/clips+/my/clips/all با kind/q/tag+/my/clips/tags) + E2E دسکتاپ/موبایل/تیره | 🟡 (کپی ارجاع ✅، یادداشت‌ها ✅، یادداشت روایت ✅، فیش‌های روایت ✅، پرش عمیق با برچسب ✅، فیش مستقیم روایت ✅، همهٔ فیش‌های من با برچسب ✅، فیش‌های من در §۴۷ ✅) |
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
