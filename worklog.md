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

---
Task ID: cron-review-1 (دور نخست بازبینی دوره‌ای)
Agent: main (cron review)
Task: ارزیابی وضعیت، QA مرورگر، رفع اشکال، افزودن قابلیت و polish ظاهری

Work Log:
- سلامت سرویس‌ها تأیید شد (API/worker/Next همه زنده؛ gateway :81 پاسخ ۲۰۰).
- QA با agent-browser: خانه/کتاب‌خوان/پژوهش‌های من بررسی شد؛ هشدارهای قدیمی کنسول (کلید تکراری psg-*) ریشه‌یابی شد: keyهای نسخهٔ قبل از fix بودند؛ ممیزی کامل همهٔ keyها در search-view/compare-view/books-grouped انجام شد (همه یکتا با پسوند index).
- **باگ ساختاری مهم رفع شد (§۱۹)**: عناصر معنایی تو‌در‌توی پاراگراف (آیه داخل <p>، لینک، G/K/maasoom درون سند) توسط fillText صاف می‌شدند و نقش‌شان از دست می‌رفت → بازنویسی fillText با ثبت inline-span (نگاشت تقریبی code point)؛ حالا آیات و لینک‌های درون پاراگراف در مدل حفظ می‌شوند.
- **باگ دادهٔ fixture**: تکرار ناخواستهٔ `</sanadHadith>` در آیتم ۴ بحار (منبع my own) → اصلاح داده، بازتولید fixture و بازسازی نمایه.
- **قابلیت جدید — جست‌وجوی استناد قرآنی (QUR-03)**: Scope.Quran در موتور (sure/aya + بازهٔ ayaFrom–ayaTo با نرمال ارقام)، مسیر citation-only بدون عبارت، helperهای parseCitations/between/numNorm + تست‌های واحد؛ آزمون HTTP: بقره ۲۱۳=۱ نتیجه (بحار)، الرحمن ۳۳–۴۱←۳۵=۱، ←۹۹=۰، regression ۳۰۰-match=۳۰۰ دقیق.
- **قابلیت جدید — READ-13 رنگ‌بندی نقش‌ها**: pref به `semantic_colors` (پیش‌فرض خاموش)؛ Switch در تنظیمات خواننده؛ BlockText/BlockView بدون نقش‌دهی وقتی خاموش است (خنثی و دسترس‌پذیر).
- **قابلیت جدید — WORK-08/09 میان‌برها**: components/shortcuts.tsx — گفت‌وگوی راهنما با دکمهٔ «?» در نوار بالا، دنباله‌های g h/g l/g s/g r/g t، «/» تمرکز جست‌وجو، اجرا نشدن داخل ورودی‌ها، کلید فعال/غیرفعال ذخیره در ترجیحات حساب (PUT /workspace/prefs.shortcuts_enabled). آزمون مرورگر: «?» گفت‌وگو را باز کرد، «/» روی جست‌وجوی سریع فوکوس زد.
- **polish ظاهری (§۴۱)**: لایهٔ components تازه — nav-pill (حالت فعال با قرص primary/10)، quiet-card (سایهٔ کم و hover)، focus-ring، filter-chip با hover و حذف لمسی، hl-mark با کنتراست تیره، ::selection هماهنگ با primary، bottom-bar با safe-area و backdrop-blur. باگ CSS (utility تعریف‌نشدهٔ border-control-border در @apply) → جایگزینی با var مستقیم.
- **UI استناد قرآنی**: فرم پیشرفته (سوره/آیه)، چیپ قابل حذف «استناد: سورهٔ ۲، آیهٔ ۲۱۳»، شروع جست‌وجو بدون عبارت (canSubmit و hasQuery شامل sure)؛ آزمون مرورگر: نتایج بحار با چیپ و شاهد رندر شد.
- lint و tsc پاس (خطاهای examples/skills خارج از دامنه‌اند).

Stage Summary:
- وضعیت: همهٔ سرویس‌ها سالم؛ جست‌وجوی استناد قرآنی، رنگ‌بندی نقش‌ها و میان‌برها افزوده و آزمون شد؛ دو باگ ساختاری (نقش‌های تو در تو، دادهٔ fixture) رفع شد.
- برای دور بعد: اتصال «پنل آیه» در کتاب‌خوان به citations بلوک‌ها (QUR-01/02)، نمایش RevayatIndex به‌صورت لینک‌پذیر (HAD-08)، گروه‌بندی نتایج بر اساس اثر/جلد در لیست مواضع (SEARCH-14)، و افزودن شمارش جداگانهٔ قطعات/روایت‌ها در پاسخ (TECH-11 کامل).

---
Task ID: cron-review-2 (دور دوم بازبینی دوره‌ای)
Agent: main (cron review)
Task: ارزیابی وضعیت، QA مرورگر، رفع باگ‌ها، افزودن قابلیت‌های PRD (QUR/HAD/SEARCH-14/TECH-11) و polish ظاهری

Work Log:
- سلامت سرویس‌ها تأیید شد (gateway :81، Next :3000، API :8080 با ۶ اثر، worker فعال).
- **باگ‌های یافت‌شده و رفع‌شده در QA مرورگر**:
  1) باگ CSS باقی‌مانده: `border-control-border/60` کلاس ناموجود بود → رنگ `--control-border` و `--paper-2` در `@theme inline` ثبت شد.
  2) کرش `projects.map is not a function` در AddToClipDialog: سرور `{items}` برمی‌گرداند ولی کلاینت آرایه می‌خواست → نرمال‌سازی دو-شکلی. ریشه‌یابی کامل: چند نما queryKey مشترک `["projects"]` با شکل‌های متفاوت کش می‌کردند (کرش `projects.filter` در research-view پس از بازدید از خانه) → helper مشترک `src/lib/projects.ts` با `fetchProjects()` و یکسان‌سازی همهٔ ۵ نقطهٔ مصرف (research/project/home/result-card/fiche-dialog).
  3) کلید پارامتر ناهمسان: کارت نتیجه `?page=` می‌نوشت ولی کتاب‌خوان `pg` می‌خواند → «بازکردن در متن» همیشه به صفحهٔ اول می‌افتاد → هر دو نما (result-card و books-grouped) به `pg` یکسان شدند.
  4) صفحهٔ `p-front` (مصنوعی «آغاز سند») در API حل نمی‌شد (404) → handlePage آن را برای بلوک‌های پیش از نخستین صفحه می‌سازد و در فهرست صفحه‌ها با serial=0 هم می‌آید؛ برچسب «—» حفظ شد (بدون جعل شمارهٔ چاپی) و در UI پرش «آغاز سند» نمایش داده می‌شود.
  5) هایلایت نتیجهٔ جست‌وجو رندر نمی‌شد (زنجیرهٔ سه‌حلقه‌ای): (الف) سرور فقط بازهٔ passage را می‌داد → فیلد `match_offsets` (بازهٔ دقیق تطبیق در مختصات سند = SourceStart+h.Range) افزوده شد؛ (ب) reader-view بدون `hlb`، آفست سطح سند را با طول بلوک اول مقایسه می‌کرد → نگاشت document→block با source_offsets بلوک‌ها (پشتیبانی از شکل آرایه و شیء)؛ (ج) کیس `heading` در BlockView متن خام می‌راند و mark را حذف می‌کرد → از BlockText می‌رود. اسکرول خودکار به `#reader-hl-anchor` (مرکز صفحه، یک بار برای هر بازه) هم افزوده شد.
  6) پنل زمینه هنگام تغییر صفحه بسته نمی‌شد → effect پاک‌سازی روی تغییر currentPageUid.
  7) کلید invalidate قدیمی `["reader","projects"]` در fiche-dialog → `["projects"]`.
- **قابلیت‌های جدید (طبق لیست «برای دور بعد» کارlog و RTM)**:
  - QUR-01/02 پنل آیه: چیپ کلیک‌پذیر «البقرة: ٢١٣» روی بلوک ayah_quote و چیپ نشانی روی pهای دارای citations (ayahAddress مستقل) → پنل زمینه با نشانی/شمارهٔ سوره و آیه (faNum)، متن نقل‌شدهٔ کتاب، درون-روایت و disclaimer «این نقلِ کتاب است و با متن معیار قرآن یکسان فرض نمی‌شود».
  - HAD-08 روایت لینک‌پذیر: چیپ «روایت ۱۱۲» روی سند روایت → پنل اطلاعات روایت (شماره، شناسهٔ محلی، توضیح عدم تعمیم شناسهٔ محلی).
  - پشتیبان‌گیری داده: parserGo ثابت شد که `revayatindex` روی بلوک‌های p/hadith_body/sanad/ayah_quote بنشیند (قبلاً فقط در HadithPiece می‌افتاد و خالی می‌ماند) → fixture بازتولید، بازسازی نمایه (71 passage، release جدید).
  - TECH-11 شمارش تفکیکی: پاسخ موتور `verified_passages` (قطعه‌های متمایز) و `verified_hadiths` (روایت‌های متمایز با کلید doc/local_uid) جدا از occurrences/books؛ UI خط شمارش: «۲ (شمارش کامل) — شامل ۱ قطعهٔ متمایز و ۱ روایت متمایز».
  - SEARCH-14 گروه‌بندی مواضع: component `GroupedPositions` — گروه‌بندی اثر→جلد با Collapsible و badge شمار؛ تک‌اثر → فهرست ساده؛ جمع گروه‌ها = کل (بدون دوبارشماری).
- **polish ظاهری**: کارت نتیجه (font-reader امیری برای شاهد، نشان نوع تطبیق با رنگ متمایز exact/normalized/linguistic/fuzzy، خط منبع آیکون‌دار، hover سایه و -translate-y-px، anim-rise ورود نرم)، قهرمان خانه (hero-surface با نوار گرادیان بالایی و نشان لوزی CSS، تیتر و چینش مرکزی، توضیح «فقط مواضع تأییدشده با نشانی دقیق»)، quiet-card در گروه‌ها.
- **آزمون‌ها**: golden regression پس از هر تغییر Go: «ما الرسول وما النبی»=2 دقیق، «الكعبة بيت الله»=300 دقیق؛ unit tests همهٔ پکیج‌ها پاس؛ E2E مرورگر دسکتاپ + موبایل (390px: bottom-sheet پنل‌ها، hero موبایل، bottom-bar) + dark mode.
- E2E کامل فیش: انتخاب واقعی موس → دکمهٔ شناور ثبت فیش → ساخت پرونده درون دیالوگ → ذخیره → clip_count=1 در سرور؛ سپس پاک‌سازی دادهٔ آزمون (سطل).
- اسناد: API_CONTRACT.md (match_offsets، verified_passages/hadiths، قرارداد p-front و پارامتر pg)، RTM.md (وضعیت QUR/HAD-08/SEARCH-14/TECH-11 → ✅ روی fixture).

Stage Summary:
- وضعیت: همهٔ سرویس‌ها سالم؛ زنجیرهٔ جست‌وجو→متن (نشانی دقیق + هایلایت + اسکرول) کامل شد و E2E شد؛ پنل آیه، روایت لینک‌پذیر، گروه‌بندی مواضع و شمارش تفکیکی افزوده شد؛ lint/tsc/unit/golden پاس.
- برای دور بعد (پیشنهاد): آوردن «بازکردن در متن کنار نتایج» (split view SEARCH-11)، شمارش روایت‌ها در کارت نتیجه، استخراج «این روایت در چه کتاب‌هایی» به کارت نتیجه، و در صورت فراهم‌شدن منابع: ورود corpus واقعی و اعتبارسنجی parser با ۳ فایل مرجع PRD.
- محدودیت صادقانهٔ ثابت: همهٔ آزمون‌ها روی fixture هم‌ساخت نور است؛ OpenSearch/Docker/corpus واقعی در سندباکس نیست (RTM 🔧).

---
Task ID: cron-review-3 (دور سوم بازبینی دوره‌ای)
Agent: main (cron review)
Task: ارزیابی وضعیت، QA مرورگر، رفع باگ موتور جست‌وجو، افزودن «این روایت در چه کتاب‌هایی» (§۴۷) و پنل متن کنار نتایج (SEARCH-11)

Work Log:
- سلامت سرویس‌ها تأیید شد (gateway :81، Next :3000، API :8080، worker زنده).
- **QA کامل با agent-browser**: ورود، جست‌وجو (golden ۳۰۰ تطبیق)، کتاب‌خوان با هایلایت، موضوعات، پژوهش‌های من، مدیریت (داشبورد)، تنظیمات — همه سالم؛ sweep همهٔ نماها با ردیاب خطای کنسول = صفر خطا؛ موبایل ۳۹۰px سالم. (نکته: ظاهر مشکوک «lKey» در page-renderer.tsx با بازرسی بایتی od رد شد — فایل سالم و `[hlKey]` بود؛ خطای نمایشی ابزارها.)
- **باگ ساختاری موتور جست‌وجو یافت و رفع شد (SEARCH حیاتی)**: پیش‌فیلتر کاندید، `COUNT(DISTINCT t.token)` را با «شمار توکن‌های عبارت با تکرار» مقایسه می‌کرد؛ هر عبارت دارای واژهٔ تکراری (مثل «الرسول ما الرسول» یا «وأن الرسول ما الرسول») همیشه صفر نتیجه می‌داد. رفع: مقایسه با شمار واژه‌های **متمایز** (dedupStrings) در `run()`. رگرسیون واحد افزوده شد: `internal/search/engine_repeated_test.go` (عبارت تکراری در normalized_phrase و all_words + صحت هایلایت) — همهٔ تست‌های Go پاس.
- **قابلیت جدید — «این روایت در چه کتاب‌هایی آمده؟» (§۴۷/HAD)**:
  - Backend: `GET /documents/{uid}/hadiths/{localUID}/locations` — متن بدنه از بلوک‌های مدل ساخته می‌شود (بدون سند، HAD-02/03)؛ جست‌وجوی normalized_phrase **پلکانی**: متن کامل بدنه (سقف ۲۰۴۸؛ بیشتر→برش در مرز واژه + `query_truncated`) → بخش آغازین ۱۶۰ → ۶۰ نویسه؛ **اجتماع کتاب‌ها از همهٔ گذرها** بدون دوبارشماری (هر اثر از گذر کشفشده)؛ `passes` گزارش شفاف هر گذر؛ disclaimer §۴۷ در پاسخ. شناسه روایت به هر سه شکل پذیرفته می‌شود (h-101 / doc:h-101 / %3A).
  - Fixture: نقل‌قول جزئی میان‌کتابی h-303 در سفینة البحار افزوده شد (آزمون واقعی چندکتابی)؛ fixture بازتولید و نمایه بازسازی شد (release جدید).
  - Frontend: `hadith-locations-dialog.tsx` — شناسنامهٔ روایت (شمارهٔ ۱۱۲، طول، excerpt با فونت امیری)، شمارش صادقانه «۲ اثر — ۲ موضع تأییدشده»، گروه‌ها با شاهد هایلایت‌شده و «بازکردن در متن»، برچسب شفاف «این اثر با جست‌وجوی بخش آغازین پیدا شد» برای نقل جزئی، عینِ disclaimer سرور. در کارت نتیجه: چیپ «روایت» + دکمهٔ «در کدام کتاب‌ها؟» (فقط برای نتایج دارای local_hadith_uid).
- **قابلیت جدید — پنل متن کنار نتایج (SEARCH-11)**:
  - `split-reader.tsx`: همان PageRenderer کتاب‌خوان + نگاشت هایلایت سند→بلوک + اسکرول نرم درون پنل؛ پاورقی/آیه/روایت در پنل زمینه؛ **فیش کامل با FicheDialog** (انتخاب متن → ثبت فیش)؛ ناوبری قبلی/بعد با فهرست صفحه‌ها؛ «بازکردن در کتاب‌خوان کامل»؛ بدون PUT موضع (کتاب‌خوان مرجع ادامهٔ مطالعه می‌ماند).
  - مختصات پنل در hash (spd/spp/sph/spdl/spwt/spk) — پایدار در refresh و برگشت (WORK-13/§۴۱)؛ مواضع/فیلترها/عبارت هرگز از دست نمی‌روند.
  - چینش: با پنل باز، گرید xl دوستونه (نتایج | پنل ۴۴٪ sticky)؛ جست‌وجوهای ذخیره‌شده موقتاً جای خود را می‌دهند؛ موبایل/تبلت: پنل زیر نتایج تمام‌عرض. باگ sticky رفع شد (کلاس sticky به آیتم گرید منتقل شد).
  - کارت نتیجهٔ باز در پنل: حاشیه/رینگ primary + `aria-current`.
- **polish ظاهری**: سربرگ گرادیانی پنل + سایهٔ نرم + anim-rise؛ footer پنل با شمار صفحه و aria-live؛ دکمه‌ها همگی ≥44px لمسی؛ حالت تیره با screenshot تأیید شد (هایلایت طلایی/کنتراست mark).
- **رگرسیون طلایی پس از همهٔ تغییرات**: «الكعبة بيت الله»=۳۰۰ دقیق (strict و normalized)؛ «ما الرسول وما النبي»=۳ (با نقل تازهٔ سفینه — انتظاری)؛ «وأن الرسول ما الرسول»=۲ (قبلاً ۰ — اثبات رفع باگ)؛ استناد بقره ۲:۲۱۳=۱. lint/tsc/Go vet/Go test همه پاس. E2E نهایی split + lookup بدون خطای کنسول.
- اسناد: API_CONTRACT.md (قرارداد کامل endpoint جدید)، RTM.md (دور سوم؛ SEARCH-10..13 و HAD ✅).

Stage Summary:
- وضعیت: همهٔ سرویس‌ها سالم؛ یک باگ صحت جست‌وجو (واژهٔ تکراری) رفع و تست رگرسیون گرفت؛ دو قابلیت بزرگ PRD (پرس‌وجوی میان‌کتابی روایت §۴۷، SEARCH-11) پیاده و E2E شد؛ lint/tsc/unit/golden پاس؛ دسکتاپ/موبایل/تیره با اسکرین‌شات تأیید شد.
- محدودیت صادقانهٔ ثابت: همهٔ آزمون‌ها روی fixture هم‌ساخت نور است؛ corpus واقعی/OpenSearch/Docker در سندباکس نیست (RTM 🔧/🟡). شمار golden «ما الرسول وما النبی» از ۲ به ۳ به‌دلیل نقل‌قول عمدی تازه در fixture تغییر کرد (در کارlog قبلی ۲ ثبت شده بود).
- برای دور بعد (پیشنهاد): افزودن دکمهٔ «در کدام کتاب‌ها؟» به پنل روایت کتاب‌خوان (FootnotePanel kind=hadith)، نمایش «روایت ۱۱۲» در کارت نتیجه از پاسخ (revayat_index اکنون فقط در lookup است — می‌تواند به Result اضافه شود)، و در صورت فراهم‌شدن منابع: ورود corpus واقعی و اعتبارسنجی parser با ۳ فایل مرجع PRD.
