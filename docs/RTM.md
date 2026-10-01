# جدول رهگیری نیازمندی‌ها (RTM) — وضعیت واقعی (به‌روزرسانی دور ۱۴ — بستن باقی‌مانده‌های ممیزی — ۲۰۲۶-۱۰-۰۱)

این دور: ۸ یافتهٔ ممیزی همه در کد راستی‌آزمایی و برطرف شد؛ بند الف (موتور)، ب (سقف/نشست)، ج (یکپارچگی داده)، د-۹/۱۱ و ه-۱۲/۱۳ با شواهد اجرایی واقعی بسته شدند. `go vet ./...` و `go test ./...` سبز (auth/httpapi/index/noordb/search/xmlparse). پاریتی دو موتور: ۱۲۶/۱۲۶ طلایی یکسان.

دور ۱۴ (بستن شش مورد باقی‌ماندهٔ کاربر): (۱) پاریتی fixture و مقیاس در «یک نشست پیش‌زمینه‌ای» تکرارشدنی شد (`scripts/run-parity-foreground.sh`؛ fixture ۱۲۶/۱۲۶ + مقیاس ۱۹٬۸۸۰ passage پاریتی ۸/۸)؛ (۲) citationOnly روی OpenSearch با فیلد `citation_keys` واقعاً گزینش‌پذیر شد (terms به‌جای match_all؛ q7 مقیاس: ۲۷۶ms پویش کامل → ۶۵ms)؛ (۳) آزمون مقیاس مصنوعی ×۲۸۰ اجرا و اعداد ثبت شد؛ (۴) چرخهٔ کامل ادمین با step-up MFA اتومات شد (TOTP محاسبه‌شده در E2E، تطبیق با Go)؛ (۵) دو باگ واقعی چرخهٔ اصلاح رفع شد (ثبت از UI عملاً شکسته بود: new_text↔new_value و 201 با بدنهٔ خالی)؛ (۶) اعتبارسنجی ایستای compose با ۶۴ آزمون + رفع ۶ نقص واقعی استقرار؛ (۷) ریشهٔ باگ «گارد /admin» محدودساز نرخ ورود بود — اکنون 429 صادقانه و قابل تنظیم با NOOR_LOGIN_RATE_MAX.

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
| AUTH-09 | MFA ادمین (TOTP) + step-up | auth/totp | unit + API + **E2E اتومات دور ۱۴** (تولید کد از seed در helpers/mfa.ts؛ تطبیق Node/Go تأیید شد؛ چرخهٔ انتشار/بازگشت با کد زنده) | ✅ |
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
| ه-۱۲ | suite خودکار E2E با Playwright: ورود/خروج، جست‌وجوی طلایی→بازکردن، خروجی CSV (BOM+۳۰۰ ردیف)، RBAC دو نقش (reader واقعی qa-reader)، فرم جست‌وجوی موبایل (هدف لمسی ≥۴۴px + حالت/دامنه)، اشتراک دوکاربه (highlight→share→کاربر دوم→لغو→410)، چرخهٔ کامل ادمین با step-up MFA (ثبت→اعتبارسنجی→انتشار با TOTP→بازگشت نسل با TOTP) | playwright.config.ts + tests/e2e/{auth,search,smoke,share,admin-stepup}.spec.ts + helpers/mfa.ts | دور ۱۴: ۲۶ تست در دو پروژهٔ desktop/mobile → 24 passed + 2 skip (موبایل‌فرم فقط در پروژهٔ mobile اجرا می‌شود) | ✅ |
| ه-۱۳ | مجموعهٔ طلایی داده‌محور ۱۲۶ پرس‌وجو در ۱۱ گروه روی fixture + اجرای هر دو موتور | internal/search/golden.go + testdata/golden.json + cmd/goldengen | TestGoldenSetLocal PASS؛ پاریتی OS کامل | ✅ |
| دور۱۴-CIT | citationOnly روی OpenSearch دیگر match_all نیست: کلیدهای استناد (`s{sure}`، `s{sure}:a{aya}`؛ بازهٔ آیه باز می‌شود؛ شکل خام+نرمال رقم) در فیلد keyword ‏citation_keys ایندکس و با terms پرس‌وجو می‌شود؛ دقت نهایی همان citationAllows روی متن نمایه | internal/search/citations.go + opensearch.go (mapping/query) + cmd/{osindex,worker} + mapping.json | citations_test.go (۶ آزمون) + پاریتی طلایی ۱۲۶/۱۲۶ پس از تغییر + q7 مقیاس ۲۸۰/۲۸۰ در p50=65ms (کاندید محدود) | ✅ |
| دور۱۴-SCALE | آزمون مقیاس مصنوعی صادقانه: تکرار fixture به ۱۹٬۸۸۰ passage / ۱٬۶۸۰ عنوان (×۲۸۰، ۲۷۴MB) + بنچمارک p50/p95 هر دو موتور + پاریتی شمارش‌ها | cmd/scalefixture + cmd/scalebench + scripts/scale-test.sh | پیش‌فیلتر trigram: صفر fallback؛ strict تا سقف ۴۶۳ms؛ بدون سقف ۸۴هزار موضع در ۱٫۶s (~۱۸µs/موضع)؛ پاریتی ۸/۸ پرس‌وجو محلی↔OS در مقیاس | ✅ (کورپوس مصنوعی = تکرار fixture؛ تنوع واژگانی واقعی ندارد — صادقانه ثبت شد) |
| دور۱۴-DEFER | پاریتی/مقیاس در «یک نشست پیش‌زمینه‌ای» تکرارشدنی (OpenSearch daemon در سندباکس ماندگار نیست) | scripts/run-parity-foreground.sh (بالا آوردن OS → نمایه‌سازی تازه با mapping جدید → اثر فیلتر استنادی → طلایی محلی+پاریتی → اختیاری --with-scale → teardown) | اجرای واقعی کامل: fixture پاریتی ۱۲۶/۱۲۶ + مقیاس ۸/۸ در یک اجرا (لاگ: /tmp/noor-parity-os.log) | ✅ |
| دور۱۴-49 | چرخهٔ اصلاح محتوا قابل‌استفاده شد: endpoint نشانهٔ متن مبنی (`GET /admin/documents/{uid}/revision-info`) + پرکردن خودکار در فرم؛ رفع قرارداد new_text↔new_value (ثبت از UI عملاً شکسته بود)؛ رفع 201 با بدنهٔ خالی (خطای encode نادیده گرفته می‌شد — okStatus + orNullJSON)؛ worker وضعیت overlay را published/failed می‌کند (گیرکردن «building» رفع شد)؛ rollback به نسلِ مفقودفایل → جست‌وجو صادقانه ۰ (نیازمند ساخت مجدد نمایه — محدودیت نگهداری نسل ثبت شد) | internal/httpapi/{admin,server}.go + internal/overlay/overlay.go + cmd/worker/main.go + src/views/admin-view.tsx | admin-stepup.spec.ts: چرخهٔ کامل ۴۷s (هر دو پروژه) + صحت DB (status=published، release_uid، audit) | ✅ |
| دور۱۴-SEC09 | ریشهٔ باگ «گاهی به /login برمی‌گردد»: محدودساز ورود ۵/دقیقه ورودهای پشت‌سرهم E2E را 401 می‌کرد؛ اکنون NOOR_LOGIN_RATE_MAX/WINDOW (پیش‌فرض تولید ۵/دقیقه) + خطای محدودسازی 429 rate_limited (تفکیک از 401) + پاسخ login دارای csrf (حذف مسیر خودترمیمی شکننده) | internal/auth/auth.go + config.go + httpapi/server.go + run-local.sh + src/lib/api.ts | بازتولید ۶ دور: قبل ۴/۶ fail → پس از رفع ۶/۶ سبز؛ کد 429 با curl | ✅ |
| دور۱۴-DEPLOY | اعتبارسنجی ایستای تمام‌عیار compose: ۶۴ آزمون (YAML، COPY/ADD، volumes، env↔کد، Caddyfile↔سرویس‌ها، SEC-07، سخت‌سازی، مالکیت volume، باینری مؤثر) | deploy/validate-compose.py + deploy/.env.example + .dockerignore | اجرا: 61 PASS/0 FAIL/2 WARN/1 DEFER؛ ۶ نقص واقعی رفع شد (worker باینری api را اجرا می‌کرد، NOOR_ENGINE worker، NOOR_API_INTERNAL_URL worker، .dockerignore نشت .env/app.sqlite، مالکیت volume، ENTRYPOINT→CMD) | ✅ (استاتیک؛ اجرای واقعی کانتینر = مانع د-۱۰) |
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
