# Worklog — میزکار پژوهشی نور (بازنویسی مستقل بر اساس PRD v2)

سند دست‌به‌دست‌دادن بین ایجنت‌ها. هر ایجنت قبل از کار این فایل را می‌خواند و پس از کار، بخش جدید (با `---`) اضافه می‌کند.

## Task ID: 1
Agent: main (coordinator)
Task: تحلیل کامل PRD، بررسی محیط، تدوین اسناد پایه

Work Log:
- PRD کامل (۱۸۳۵ خط، بخش‌های ۱–۵۵) خوانده شد. نیازمندی‌های شناسه‌دار استخراج شد.
- محیط سندباکس بررسی شد: **Docker موجود نیست، OpenSearch قابل اجرا نیست (۴GB RAM، بدون Docker/Java heap)، Go نصب نیست (اما اینترنت و امکان نصب هست)، corpus واقعی نور و app_development.zip موجود نیستند.**
- تصمیم: طبق مجوز صریح کاربر («اگر corpus کامل موجود نیست، زیرساخت و قابلیت‌ها را کامل بساز، ولی پوشش کامل کتابخانه و benchmark واقعی را ادعا نکن») توسعه کامل زیرساخت با fixture انجام می‌شود و همه‌جا صادقانه اعلام می‌شود که اعتبارسنجی با corpus واقعی انجام نشده است.
- اسناد تولید شد: docs/ARCHITECTURE.md (ADR)، docs/API_CONTRACT.md، docs/RTM.md.

Stage Summary:
- معماری مصوب: Go API (mini-services/noor-api، پورت 8080 از طریق gateway با XTransformPort) + Next.js SPA فارسی RTL روی `/` (hash routing به‌دلیل محدودیت پیش‌نمایش) + موتور جست‌وجوی محلی قابل‌تعویض با OpenSearch (قرارداد §۴۶ پیاده شده در اینترفیس engine).
- fixture هم‌ساخت نور تولید می‌شود (فرمت dictionary+DocItem+xml) و RTM وضعیت واقعی هر نیازمندی را ثبت می‌کند.
- محدودیت‌های صادقانه: بدون Docker/OpenSearch در این سندباکس؛ compose تولیدی برای Linux آماده ولی در اینجا آزمون‌نشده.

---
Task ID: T10-a
Agent: frontend-shell
Task: shell/RTL/فونت/auth/router/api-client/خانه/کتابخانه/اثر/تنظیمات

Work Log:
- API_CONTRACT.md و DESIGN.md (و ARCHITECTURE.md) کامل خوانده شد؛ همهٔ متن‌ها و واژگان رابط دقیقاً از DESIGN.md گرفته شد («جست‌وجو در منابع»، «نام کتاب»، «تطبیق‌های تأییدشده تا این لحظه»، …).
- فونت‌ها محلی شدند: `bun add @fontsource/vazirmatn @fontsource/amiri` و ایمپورت وزن‌های 400/500/600/700 وزیرمتن و 400/700 امیری در layout.tsx؛ Geist حذف شد؛ `html dir="rtl" lang="fa"` + metadata فارسی «میزکار پژوهشی نور».
- globals.css: tokenهای دقیق DESIGN.md به‌صورت CSS vars روی :root و .dark (canvas/surface/reader/text/muted/primary/link/border/control-border/match) با حفظ ساختار @theme inline و نگاشت به متغیرهای shadcn (--background=canvas، --primary و …)؛ متن روی primary روشن سفید، در تیره متن تیره؛ اسکرول‌بار ظریف؛ قطعهٔ عربی با lang="ar"؛ شناسه‌ها با کلاس bidi-ltr (dir=ltr + isolate)؛ touch-target ≥44px در موبایل.
- src/lib/types.ts: کل تایپ‌های قرارداد (User, Work, WorkDetail, DocumentInfo, PagePayload با blocks/spans/footnotes/links, SearchRequest/Response با count fields, Project, Clip, Note, Bookmark, Topic, WorkspaceState, AdminOverview, ApiError…) — بدون any؛ بلوک‌ها ساخت‌یافته‌اند و هرگز innerHTML به‌کار نرفت.
- src/lib/api.ts: کلاینت تایپ‌دار با base `/api/v1` + `XTransformPort=8080` روی همهٔ درخواست‌ها؛ credentials:'include'؛ JSON parse؛ نگاشت خطا به {code,message,trace_id,retryable} با پیام‌های فارسی fallback؛ هدر X-Noor-CSRF فقط برای mutation؛ توکن CSRF فقط در حافظهٔ ماژول؛ تابع apiUrl(path, params).
- src/lib/hash-router.tsx: روتر hash دست‌ساز (parse `#/path?query`، provider، useRoute/navigate/buildHref، گوش‌دادن به hashchange)؛ مقصد پس از ورود در متغیر ماژول (نه localStorage)؛ HashLink برای لینک‌دهی.
- src/store/auth.ts (zustand): status=loading|guest|pending_mfa|authenticated؛ fetchSession روی mount (در AppShell)، login/verifyMfa/logout/acceptInvite؛ خطاها به‌صورت ApiError برگردانده می‌شوند.
- src/store/workspace.ts: ترجیحات خواننده (font_size 16–32، line_height 1.4–2.4، فونت، display) در حافظه + PUT /workspace/prefs با debounce 500ms؛ recent از GET /workspace؛ عبارت/فیلترهای جست‌وجو در hash (نه localStorage).
- src/components/app-shell.tsx: loading → skeleton؛ مهمان → فقط Login/Invite؛ کاربر → نوار بالا (لوگوی متنی «میزکار پژوهشی نور»، جست‌وجوی سریع → `#/search?q=…&mode=normalized_phrase&scope=library`، منوی کاربر) + ناوبری (کتابخانه/موضوعات/پژوهش‌های من/تنظیمات + مدیریت فقط role=admin) + main + فوتر ریز sticky (min-h-screen flex flex-col + mt-auto)؛ موبایل: نوار پایین ۵ آیتمی با آیکون‌ها و safe-area.
- login-view: فرم ورود + حالت کد ۶ رقمی pendingMfa + خطاهای فارسی از ApiError.message + بازگشت به مقصد ذخیره‌شده یا #/home.
- invite-view: code از hash query + display_name + گذرواژه ×۲ با اعتبارسنجی فارسی.
- home-view (خانهٔ جست‌وجومحور): جست‌وجوی اصلی با دو دکمهٔ radio-مانند «متن منابع / نام کتاب»، ۳ ورودی کوتاه، «ادامهٔ مطالعه» از recent با نوار پیشرفت ظریف، پرونده‌های اخیر از GET /projects؛ ارسال → `#/search?q=…&mode=…&scope=…`.
- library-view: GET /works با debounce 250ms، فیلتر زبان/مؤلف، ترتیب عنوان/مجلدات، page_size=20 با «بیشتر» (useQueries + keepPreviousData)؛ badge امکانات؛ «متن جست‌وجوپذیر ندارد» برای کتاب تصویری؛ loading/empty/error فارسی.
- work-view: GET /works/{uid}؛ جلد/مدخل/سایر جدا با kind؛ پوشش هر سند به‌صورت badge صریح (روایت/آیه/پاورقی/موضوع/متن جست‌وجوپذیر + فهرست) با supported/partial/absent/failed؛ هر مقدار null = «ثبت نشده» (حدس ممنوع)؛ دکمهٔ «بازکردن مطالعه» → `#/read/{documentUid}`.
- settings-view (کامل): خواندن (اندازه/فاصله/فونت/حالت نمایش صفحه‌محور-پیوسته با پیش‌نمایش زنده + PUT /workspace/prefs)؛ ظاهر (روشن/تیره/سیستم با next-themes)؛ نشست‌های فعال (GET /auth/sessions + DELETE لغو)؛ خروج.
- stubهای فارسی برای ایجنت‌های بعدی: search-view، reader-view، topics-view، research-view، project-view، compare-view، admin-view (+ components/view-placeholder).
- Providers (client): @tanstack/react-query با staleTime 30s و retry:false + next-themes + Toaster؛ page.tsx فقط `<HashRouterProvider><AppShell/></HashRouterProvider>`.
- آیکون‌ها فقط lucide-react؛ همهٔ fetchها از api.ts؛ هیچ دادهٔ خصوصی/token در hash یا localStorage.
- `bun run lint` پاس شد (بدون خطا)؛ tsc روی src بدون خطا؛ dev server پورت 3000 بدون restart، کامپایل موفق.

Stage Summary:
- فایل‌های ساخته‌شده: src/app/layout.tsx، src/app/globals.css، src/app/page.tsx، src/lib/{api,types,hash-router.tsx,labels,format}، src/store/{auth,workspace}، src/components/{app-shell,providers,feedback,view-placeholder}، src/views/{login-view,invite-view,home-view,library-view,work-view,settings-view} + stubهای {search-view,reader-view,topics-view,research-view,project-view,compare-view,admin-view}.
- تصمیم‌های مهم: (۱) mode «نام کتاب» در hash = strict_phrase (هم‌نام قرارداد API؛ در UI فقط «نام کتاب») و scope=titles که در لایهٔ سرویس جست‌وجو به scope مناسب تبدیل می‌شود؛ (۲) فیلترهای جست‌وجو فقط در hash نگه داشته می‌شوند تا لینک اشتراکی کار کند؛ (۳) صفحه‌بندی کتابخانه با useQueries و دکمهٔ «بیشتر» (بدون پِیجینیشن کلاسیک) برای حفظ اسکرول آرام؛ (۴) PrefsSaveState برای بازخورد «در حال ذخیره…/ذخیره شد/ناموفق» طبق DESIGN.md؛ (۵) فوتر فقط دسکتاپ (موبایل نوار پایین دارد)؛ (۶) برای viewهای ایجنت‌های بعدی، قرارداد props تثبیت شد: ReaderView({documentUid}), ProjectView({uid}) و بقیه بدون prop.
- برای ایجنت‌های بعدی (T-b/T-c/T-d): از `useWorkspaceStore` برای ترجیحات خواننده استفاده کنید؛ خطاها را با `errorMessage(err)` بگیرید؛ ناوبری فقط با HashLink/navigate؛ عبارت و فیلترهای جست‌وجو را در hash بنویسید (کلیدهای q، mode، scope).

---
Task ID: T10-d
Agent: research-views
Task: تکمیل چهار view stub — پژوهش‌های من / پروندهٔ پژوهش / مقایسه / مدیریت

Work Log:
- API_CONTRACT.md و DESIGN.md و بخش‌های T10-a (الگوی سبک) خوانده شد؛ فقط ۴ فایل stub ویرایش شد و هیچ فایل دیگری دست نخورد.
- research-view («پژوهش‌های من»): GET /projects با پشتیبانی از هر دو شکل پاسخ (آرایهٔ خام و {items})؛ کارت پرونده (نام، شمار فیش با faNum، تاریخ faDate) و کلیک → #/project/{uid}؛ گفت‌وگوی ساخت پرونده (POST /projects)؛ بایگانی/خروج از بایگانی با PATCH {archived, version} — تعارض 409 پیام فارسی سرور («این مورد در جای دیگری ویرایش شده است…») را در گفت‌وگو نشان می‌دهد و دکمهٔ «بارگذاری نسخهٔ فعلی» invalidate می‌کند؛ حذف با AlertDialog تأیید → پیام «پرونده به سطل بازیافت رفت»؛ تب‌های همه/فعال/بایگانی با شمارنده.
- project-view (پروندهٔ پژوهش، prop {uid}): فیش‌ها با GET /projects/{uid}/clips?state=active|trashed&q&tag؛ کارت فیش: نوع (نقل‌قول اصل/متن خوانده‌شده/یادداشت)، نقل‌قول، بیان خوانده‌شده، یادداشت، برچسب‌ها، خط منبع (عنوان اثر از نقشهٔ /works + صفحهٔ چاپی) و «بازگشت به منبع» → #/read/{documentUid}?pg={page_uid} (RES-08)؛ ویرایش یادداشت با PATCH {version, note} — 409 → GET /clips/{uid} و گفت‌وگوی انتخاب بین «نسخهٔ شما» و «نسخهٔ موجود در سامانه» با دو اقدام «حفظ نسخهٔ من» (PATCH با version فعلی سرور) و «حفظ نسخهٔ سامانه» (RES-14)؛ حذف → سطل + تب «سطل بازیافت» با بازیابی POST /clips/{uid}/restore (RES-09)؛ تاریخچه GET /clips/{uid}/revisions در گفت‌وجو (هر نسخه: شماره/تاریخ/یادداشت)؛ خروجی Markdown/CSV/چاپ: POST /exports → 202 {export_uid} → polling GET /exports/{uid} با refetchInterval تا done/failed → «بارگیری فایل» با window.open(apiUrl(/exports/{uid}/download)) شامل XTransformPort (RES-10/11)؛ جست‌وجوی debounced فیش‌ها + فیلتر برچسب به‌صورت چیپ از تگ‌های موجود.
- compare-view (مقایسه): دو ستون کاملاً مستقل (xl:grid-cols-2)؛ هر ستون: انتخاب اثر (GET /works) → انتخاب جلد/سند (GET /works/{uid}) → صفحه (GET /documents/{uid}/pages و /pages/{pageUID}) با پرش قبلی/بعدی و Select پرش؛ جست‌وجوی مستقل هر ستون با POST /search (mode=all_words، scope document) و لیست نتایج «تطبیق‌های تأییدشده تا این لحظه» + پرش به صفحهٔ نتیجه با برجسته‌سازی (نگاشت بازهٔ سطح سند به بازهٔ داخل بلوک در locateHighlight — بدون innerHTML)؛ نوار بالای هر ستون: عنوان اثر/جلد/صفحه + «کپی نشانی» (ارجاع متنی + #/read/{doc}?pg={page})؛ موبایل: تب سریع «ستون اول/ستون دوم» با hidden xl:block (هرگز دو ستون باریک)؛ خطای هر ستون مستقل (ErrorState + تلاش دوباره) و ستون دیگر را خراب نمی‌کند (REL-05/06).
- admin-view («مدیریت»، فقط role=admin؛ در غیر این صورت کارت «دسترسی فقط برای مدیر سامانه»): داشبورد GET /admin/overview — ۹ کارت آماری (آثار/اسناد/کاربران/نشست فعال/اصلاحات در انتظار/کار فعال/فضای داده با formatBytes فارسی/منابع/نسخهٔ فعال) + نکتهٔ ADMIN-10؛ تب کارها (GET /admin/jobs با refetchInterval 8s، لغو کار، «ساخت مجدد نمایه» با AlertDialog تأیید → POST /admin/index/rebuild)؛ تب اصلاحات: فهرست با وضعیت فارسی (پیش‌نویس/اعتبارسنجی‌شده/…)، فرم اصلاح جدید (اثر→سند وابسته، نوع جایگزینی متن/فراداده، دلیل، متن جدید، نشانهٔ متن مبنا با dir=ltr) → POST /admin/overlays، اعتبارسنجی (409 hash → پیام سطری)، پیش‌نمایش (before/after + هشدار تغییر متن مبنا + شمار ارجاع‌های متأثر) و انتشار با کد ۶ رقمی؛ تب نسل‌ها (GET /admin/releases + نشان «نسخهٔ فعال» با مقایسهٔ release_uid داشبورد + بازگشت نسل با کد)؛ تب کاربران (دعوت POST /admin/invitations → نمایش کد یک‌بارمصرف با هشدار «پس از بستن دوباره نمایش داده نمی‌شود» + کپی، غیرفعال/فعال با تأیید، تغییر نقش با Select + کد ۶ رقمی)؛ تب حسابرسی (GET /admin/audit جدول با نگاشت فارسی رویداد/موضوع و شناسه‌ها bidi-ltr)؛ همهٔ تب‌ها loading (skeleton)/error/empty فارسی.
- الگوی MFA: چون api.ts (طبق قاعدهٔ «فقط ۴ فایل») قابل تغییر نبود، helper محلی postWithMfa در admin-view با fetch + apiUrl + getCsrfToken از همان api.ts نوشته شد (credentials include، X-Noor-CSRF، X-Noor-MFA) و خطا به ApiError با پیام فارسی نگاشت می‌شود؛ گفت‌وگوی عمومی MfaDialog با InputOTP ۶ رقمی (reset کد با الگوی تنظیم state در زمان رندر).
- QA با curl روی gateway (XTransformPort=8080): ورود با حساب bootstrap، ساخت/409/حذف پرونده، فهرست فیش، چرخهٔ کامل خروجی (202→done→download با Content-Disposition)، و همهٔ ۶ مسیر admin بررسی و با شکل‌های پیاده‌سازی هم‌خوان شد؛ فیلد progress_note کارها هم добав شد. دادهٔ آزمون حذف شد (سطل).
- `bun run lint` بدون خطا؛ tsc روی ۴ فایل بدون خطا (خطاهای pre-existing در reader-view/examples از این تسک نیست)؛ dev server بدون restart کامپایل موفق.

Stage Summary:
- فایل‌های تغییرکرده: src/views/research-view.tsx، src/views/project-view.tsx، src/views/compare-view.tsx، src/views/admin-view.tsx (فقط همین ۴ + worklog).
- تصمیم‌های مهم: (۱) درخواست‌های حساس MFA با helper محلی postWithMfa (api.ts دست‌نخورده ماند)؛ (۲) برجسته‌سازی نتیجهٔ جست‌وجو در مقایسه با نگاشت آفست سطح سند به بلوک (PageRenderer highlight block-relative است)؛ (۳) تعارض فیش (RES-14) با دو دکمهٔ صریح «حفظ نسخهٔ من/حفظ نسخهٔ سامانه» و PATCH مجدد با version سرور؛ (۴) صفحات مقایسه در حالت‌های خطا/خالی مستقل و پیام صریح «ستون دیگر تحت تأثیر قرار نمی‌گیرد»؛ (۵) کد دعوت فقط یک‌بار نمایش داده می‌شود با هشدار امنیتی.
- برای ایجنت بعدی: اگر خواستید MFA عمومی شود، postWithMfa را می‌توان به api.ts منتقل کرد (امضا: postWithMfa(path, body, code))؛ نگاشت‌های فارسی وضعیت‌ها در بالای admin-view نگه داشته می‌شوند.
## Task ID: 2..12 (پایان فاز ساخت — گزارش یکپارچه)
Agent: main (coordinator) + T10-a..d subagents
Task: پیاده‌سازی کامل محصول طبق PRD

Work Log:
- **بک‌اند Go (mini-services/noor-api، پورت 8080)**: 
  - `fixturegen` (۶ اثر/۷ سند fixture هم‌ساخت نور: روایت چندقطعه‌ای، سند/G/K/maasoom، آیه بدون والد، sharh، Link، تگ ناشناخته، صفحهٔ هم‌نام، ۳۰۰ تطبیق، موارد N1)
  - `noordb` (بازکردن mode=ro، کشف schema، dictionary همان فایل با طول متغیر، بازگشایی، گزارش خطا) + `xmlparse` (بلوک ساخت‌یافته، spans، مرز DocItem/صفحه با index-محور، تگ ناشناخته حفظ، HAD-01)
  - `norm` N1 نسخه‌دار (ي/ی، ك/ک، اعراب مصوب، ارقام، نیم‌فاصله، نگاشت code point کامل؛ ة/ه و همزه یکی نمی‌شوند — TECH-10)
  - `index` (passage با anchor و role_ranges، نمایهٔ وارون، عنوان‌ها) + `search` (۷ حالت §۴۴، verifier روی متن مؤثر، کلید dedupe با offset مطلق، cursor امضاشده HMAC، BooksGrouped فقط تأییدشده، 410 منقضی)
  - `auth` (Argon2id 64MiB/t3/p1 + rehash، نشست digest-only، TOTP RFC6238 + step-up، دعوت یک‌بارمصرف، bootstrap ادمین، محافظت آخرین ادمین، rate-limit)
  - `research` (پرونده/فیش snapshot کامل TECH-08/یادداشت/نشانک/جست‌وجوی ذخیره/میزکار؛ ownership، 409 نسخه، سطل، revisions)
  - `overlay` (چرخهٔ §۴۹ + preview + انتشار pointer اتمیک + outbox + audit + rollback)؛ `jobs` (claim اتمیک، lease)؛ `exportpkg` (MD/JSON/CSV ایمن/چاپ)؛ `httpapi` (RBAC مرکزی، خطای ۴بخشی فارسی، CSRF/Origin، no-store، سقف‌های §۳۸، مسیر داخلی service-token)
- **باگ‌های کلیدی یافت و رفع شد در حین آزمون**: نگاشت byte/code point در جست‌وجوی عبارت (عربی)، صفحهٔخراب به‌علت اشاره‌گر سلیس، استدلال dedupe نادرست (محلی↔مطلق)، bind آرگومان‌های candidate، NULL scan در login، stale-connection نمایه (inode reuse → بررسی release معنایی)، binary قدیمی پس از restart (پترن pkill)
- **آزمون‌ها**: unit (N1/مرز/cursor/TOTP/رمز/indexRunes) پاس؛ golden HTTP: «ما الرسول وما النبي»=2 رخداد واقعی، «الكعبة بيت الله»=300/300 دقیق (TECH-13)، بدون نتیجه=state متمایز، strict≠normalized (ي عربی فقط در دقیق می‌آید)
- **فرانت (T10-a..d)**: shell RTL + فونت‌های محلی + router hash + api client + auth/invite/خانه/کتابخانه/اثر/تنظیمات؛ کتاب‌خوان کامل (فهرست درختی، صفحه‌محور/پیوسته، پرش چاپی، پاورقی پنل، سند قابل جمع با HAD-10، فیش با وضعیت ذخیره، highlight قابل پاک، نشانک، کپی نشانی، keyboard)؛ جست‌وجو (فرم حالت‌ها، چیپ‌ها، دو سطح مواضع/کتاب‌های تأییدشده با disclaimer §۴۷، شمارش «تا این لحظه» + ادامهٔ بررسی، سه وضعیت خالی، ذخیرهٔ جست‌وجو)؛ موضوعات؛ پژوهش‌های من (تعارض 409 با نمایش دو نسخه، سطل، خروجی‌ها با polling)؛ مقایسهٔ دوستونه مستقل؛ مدیریت کامل (داشبورد، jobs، overlay چرخهٔ کامل با MFA، نسل‌ها/rollback، کاربران/دعوت، audit)
- **E2E با agent-browser از طریق gateway :81**: ورود → خانه → جست‌وجو → کارت نتیجه (نوع تطبیق/شاهد/بازکردن در متن/افزودن به فیش) → کتاب‌خوان (breadcrumb، toolbar، فهرست، سند، پاورقی، نشانهٔ جست‌وجو) — screenshot تأیید شد؛ باگ‌های runtime (نسخهٔ تکراری key، children undefined، data shape) رفع شد
- **تحویل عملیاتی**: deploy/docker-compose.yml + Dockerfile.{api,web} (§۵۲، آزمون‌نشده در سندباکس)، docs/README.md (راهنمای اجرا/عملیات/backup/rollback)، docs/RTM.md (وضعیت واقعی هر نیازمندی)، docs/API_CONTRACT.md، docs/ARCHITECTURE.md، docs/DESIGN.md
- **Cron**: تسک webDevReview هر ۱۵ دقیقه ثبت شد (job_id 427097)

Stage Summary:
- محدودیت‌های صادقانه: corpus واقعی/app_development.zip موجود نبود → fixture طبق §۳۰؛ OpenSearch/Docker در سندباکس اجرا نمی‌شوند → adapter/compose نوشته‌شده و آزمون‌نشده؛ benchmark/SLO نیازمند محیط مصوب؛ توقف ۱۰GB/۱۰۰GB طبق §۵۵ برقرار است.
- اقدام بعدی پیشنهادی: import corpus واقعی → inventory/پایلوت ظرفیت §۳۷ → اعتبارسنجی parser با ۳ فایل مرجع PRD → golden set روی متن واقعی → benchmark.
