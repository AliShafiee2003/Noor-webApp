# Worklog — میزکار پژوهشی نور (بازنویسی مستقل بر اساس PRD v2)

> ⚠️ **توجه**: این فایل در دور ۱۸-فیکس ۱۲ به‌طور تصادفی بازنویسی شد و سپس از خلاصهٔ مکالمه (checkpoint) بازسازی گردید. مدخل‌های فیکس‌های ۱–۱۱ از خلاصهٔ مکالمه (نه متن اصلی) بازسازی شده‌اند و ممکن است جزئیاتِ دقیقِ ورودی‌های اصلی را نداشته باشند. مدخل فیکس ۱۲ کامل و دست‌اول است.

سند دست‌به‌دست‌دادن بین ایجنت‌ها. هر ایجنت قبل از کار این فایل را می‌خواند و پس از کار، بخش جدید (با `---`) اضافه می‌کند.

## Task ID: 1
Agent: main (coordinator)
Task: تحلیل کامل PRD، بررسی محیط، تدوین اسناد پایه
Stage Summary: معماری مصوب: Go API (mini-services/noor-api، پورت 8080) + Next.js SPA فارسی RTL روی `/` (hash routing) + موتور جست‌وجوی محلی قابل‌تعویض با OpenSearch.

---

## Task ID: T10-a
Agent: frontend-shell
Task: shell/RTL/فونت/auth/router/api-client/خانه/کتابخانه/اثر/تنظیمات
Stage Summary: فونت‌ها محلی (Vazirmatn/Amiri)، tokenهای DESIGN.md، تایپ‌های قرارداد، کلاینت API v1، روتر hash دست‌ساز، auth store (zustand)، workspace store، app-shell، login/invite، home، library، work، settings. tsc پاک.

---

## Task ID: T18 (دور ۱۸) — فیکس‌های ۱–۶
Agent: main
Task: رفع گزارش‌های کاربر (دور ۱۸)

Work Log:
- **فیکس ۱ — نشست مهمان**: `/auth/session` مهمان اکنون 200 `{user:null}` به‌جای 401 (قبلاً store مهمان نمی‌شد).
- **فیکس ۲ — آفلاین**: بنر صادقانه + تلاش دوباره به‌جای اسکلتون بی‌پایان؛ QueryClient با `offlineFirst` و `refetchOnReconnect=false` در جست‌وجو.
- **فیکس ۳ — padding متن کتاب‌خوان**: متن زیر نوار شناور خوانا می‌ماند (هر دو نما: پیوسته و صفحه‌محور).
- **فیکس ۴ — انکود ۱۹ نقطهٔ fetch + degrade فوتو-اسکن**: همهٔ مسیرهای `/documents/{uid}/…` با `encodeURIComponent`؛ سند فوتو-اسکن (work 200 ولی `/toc` و `/pages` 404 «مدل صفحه نیست») به‌جای صفحهٔ خطای سراسری با پانل مشترک «متن قابل مطالعه‌ای برای این نسخه موجود نیست.» + توضیح منبع تصویری + دکمهٔ «صفحهٔ اثر» به `#/book/{work.uid}` باز می‌شود. رگرسیون سند متنی معمولی (d-00136-16711) رندر عادی (۲۴۷۳ کاراکتر).
- **فیکس ۵ — نوار ابزار ریدر موبایل تک‌ردیفهٔ ۶۳px**: نوار `<md` از سه‌ردیفهٔ ۱۷۷px به تک‌ردیفهٔ ~۶۳px کاهش یافت (بازگشت + قبلی/بعدی + پرش به صفحه + حالت نمایش + مطالعهٔ متمرکز)؛ ردیف جست‌وجوی ثابت و ردیف تکراری «حالت نمایش/مطالعهٔ متمرکز» حذف شد؛ مود مطالعه در صفحه‌محور قبلی/بعدی گرفت (فقط صفحه‌محور). دسکتاپ دست‌نخورده.
- **فیکس ۶ — «نوار خالی افقی پایین صفحه پس از بازکردن/رفرش»**: ریشه = بازیابی اسکرول مرورگر پس از رفرش کامل روی کانتینرهای `overflow-hidden` + نشت «scrollable overflow» از ردیف پنل‌ها (scrollHeight ~۸۲k). رفع دولایه: (۱) `overflow-hidden` روی ردیف پنل‌ها → rootSH به ۸۸۰؛ (۲) `readerRootRef` + گارد دائمی (scroll-listener capture + ResizeObserver) برای صفرنگه‌داشتن scrollTop ریشه و ردیف. موضع خواندن در پان متن دست‌نخورده. تأیید با شبیه‌سازی چسبندگی سنگین + دو رفرش متوالی.
- tsc پاک (exit 0) پس از هر فیکس.

---

## Task ID: T18 (دور ۱۸) — فیکس‌های ۷–۱۱ (هویت کتاب در URL)
Agent: main
Task: نام کتاب در نشانی (فیکس ۷/۸/۹/۱۰/۱۱)

Work Log:
- **فیکس ۷ — «URL هیچ هویتی ندارد؛ نام کتاب باید در url باشد»**: قالب تازهٔ مسیر مطالعه = `#/read/{نام-کتاب}/{d-uid}?pg=…`؛ uid مرجعِ تفسیر مسیر می‌ماند و سگمنت فارسی صرفاً نمایشی است → لینک‌های قدیمی/اشتراکی بدون مهاجرت کار می‌کنند. زیرساخت: `src/lib/href.ts` جدید با `slugifyFa` + `readHref`/`readPath`؛ سازنده‌های لینک به‌روز (۱۶ نقطه). app-shell `case "read"` تشخیص uid از seg[1] یا seg[2] با گارد `d-`؛ reader-view ارتقای خاموش uid-only → نام‌دار؛ work-view سه onOpen؛ result-card/copyCitation، compare-view، split-reader، home-view، my-fiches، project-view، hadith-locations-dialog.
- **فیکس ۸ — «نام اثر در URL دیده نمی‌شود؛ حتی نمایش آن هم %D8… است»**: ریشه: مرورگر بخش `#` را همیشه درصدی نشان می‌دهد. طراحی: نام اثر در path واقعی، hash فقط فنی (`…:3200/{name}#/read/{d-uid}?pg=…`). زیرساخت: `href.ts` بازطراحی (`readHref` uid-only + `applyPathIdentity` با گارد تازگی)؛ app-shell (اثر هویت مسیر)؛ reader-view (اثر رسیدن نام)؛ `src/app/[[...path]]/page.tsx` (optional catch-all) + رفرش مسیر نام‌دار سالم؛ `next.config.ts` rewrites اضافه و سپس **حذف** (App Router مسیر masked را به canonical می‌آورد).
- **فیکس ۹ — «URL صفحهٔ اطلاعات کتاب هم بی‌هویت است»**: `applyPathIdentity` از این‌رو دو head نام‌دار دارد (`read` + `book`)؛ work-view با رسیدن `workQuery.title` هویت می‌نویسد (اثر بعد از `const work = workQuery.data`).
- **فیکس ۱۰ — «چرا اول اسم کتاب اومده؟ مگه زیر کتابخانه نیستیم؟»**: نان‌ریز بخش‌ها: مسیر = `library ← نام-اثر ← read`؛ یعنی اطلاعات اثر `/library/{slug}#/book/{uid}` و مطالعه `/library/{slug}/read#/read/{d-uid}?pg=…`.
- **فیکس ۱۱ — «این متن هشتگ‌دار چیست جلویش؟ /read#/read/…»**: (۱) پسوندِ تکراریِ مسیر (`/read` path + `#/read/` hash) حذف — مسیر فقط `library/نام`؛ تمایز فقط head فنی hash. (۲) هشتگِ خامِ داخل uid (`#` در uidهای ۵۹۶ ورود کاتالوگ) در سازنده‌ها کدگذاری (`#→%23`) و نرمالایز صرف hash در `applyPathIdentity` (بدون نام، بدون تغییر مسیر). پارسر سگمنت‌به‌سگمنت کدگشاست پس هر دو قالب (raw و %23) به همان uid می‌رسند. ۴ سازندهٔ `#/book/` به `workHref` بست شدند.
- tsc پاک (exit 0) پس از هر فیکس.

---

## Task ID: T18-Fix12 (فاز ۲ — مسیر واقعی معنادار، حذف کامل hash)
Agent: main
Task: برداشتن hash از ریشه و روتر مسیر واقعی (path routing) با ساختار انگلیسی و نام کتاب فارسی.

Work Log:
- **ریشهٔ مشکل کشف‌شده**: مرورگر بخش `#` را همیشه درصدی (`%D8…`) نشان می‌دهد — هر طرح معناداری داخل hash بی‌فایده است. همچنین `routeToUrl` uid را از سگمنتِ path بدون `decodeURIComponent` برمی‌داشت و دوباره `URLSearchParams` می‌کرد → uidهای دارای `#` (`d-00166-#…`) **دوباره کدگذاری** می‌شدند (`%2523`) و سند 404 می‌گرفت («این سند در کتابخانهٔ موجود نیست»). این بود ریشهٔ گزارش «لینک خراب پس از انتقال/اشتراک».
- **تغییرات فرانت**:
  - `src/lib/hash-router.tsx` بازنویسی شد: parse از `pathname+search`؛ serialize route→URL معنایی: book `/library/{slug|book}?w={uid}`، read `/library/{slug|book}/read?d={doc}&pg={term}` (pg عددی)، بقیهٔ headها عیناً `/head[/seg]`؛ `popstate` listener؛ boot: قالب‌های قدیمی `#/…` یک‌بار به قالب جدید `replaceState` می‌شوند.
  - `HashLink` نشانی واقعی می‌سازد و کلیکِ ساده را با `preventDefault`+`navigate` طی می‌کند (بدون بازآری صفحهٔ کامل)؛ prop اختیاری `slug` برای نام‌دار شدن بلافاصله.
  - `src/lib/href.ts`: `readHref`/`workHref` به فرم روت (بدون `#`)؛ `readShareHref`/`workShareHref` نشانی کامل معنایی برای کپی/اشتراک؛ `decoratePathWithSlug` (جایگزین `applyPathIdentity`) — pathname را به slug عنوان جایگزین می‌کند بدون رویداد؛ `pgTerm` (p-016→16) در روتر export شد. `safeSlugSegment` در روتر همان قوانین `slugifyFa` را inline می‌کند (بدون چرخهٔ import).
  - `app-shell`: اثر هویت مسیر قدیمی حذف؛ `pendingDestination` اکنون نشانی کامل (`fullHash`) است.
  - `reader-view`: پارامترها از `route.query` (بدون `location.hash`)؛ `requestedPageUid` pg عددی را به uid ترجمه می‌کند (p-front خام می‌گذرد)؛ `goToPage`/tracker/doc-switch/clearShared/onClearHighlight/back-to-book با `navigate`/`replaceState` بازنویسی؛ citation از `location.href` (نشانی کامل معنادار)؛ decorate با عنوان.
  - `work-view`: decorate با عنوان؛ `onOpen` با `{slug: work?.title}`.
  - صفحات لینک‌دهنده (library/home/topics/my-fiches/project/result-card/split-reader/hadith-dialog) با prop `slug` برای نام‌دار شدن بلافاصله.
  - `settings-view`: «بازکردن» اشتراک از `navigate(s.url_path)` (قالب‌های قدیمی `#/…` در روتر نرمال می‌شوند).
  - `components/reader/notes-panel`: ساخت URL اشتراک با join امن (قالب جدید با `/`).
  - `src/app/api/v1/export/search/route.ts`: `deepLink` به قالب جدید (`/library/{slug}/read?d=…&pg=N&hl=…`) با ترجمهٔ pg عددی.
- **تغییرات بک‌اند (Go)**: `shareURLPath` به `/library/book/read?d=…&pg=N&shared=…` (pg عددی)؛ `pageTerm` اضافه شد؛ importهای `regexp`/`strconv`؛ تست `ugc_test` به `wantURL` جدید به‌روز شد؛ `go vet`/`go test ./internal/httpapi/` پاک (۱۷٫۶s).
- **رفع ریشهٔ double-encode**: `routeToUrl` uid را قبل از `sp.set` با `decodeURIComponent` می‌گذراند (legacy boot و settings-share) — uidهای دارای `#` یک‌باره (`%23`) کدگذاری می‌شوند.

تأیید زنده (مرورگر، تب کاربر):
- بارگذاری تمیز `http://127.0.0.1:3200/` (hash خالی)، خانه/کتابخانه/اثر/مطالعه با URL معنادار و بی‌هشتگ.
- ردیف‌های کتابخانه بلافاصله `/library/{نام-کتاب}?w={uid}` (بدون jump براکت پس از یکسان‌سازی slug).
- reader متنی `/library/1000-سؤال-…/read?d=…` باز شد؛ deep-link `&pg=16` روی سند فوتو-اسکن پایدار (degrade منصفانه).
- لینک کهنهٔ `#/read/d-00166-#…?pg=p-016` **یک‌بار ترجمه** شد به `/library/عدة-…/read?pg=16&d=d-00166-%23…` (single-encode، سند باز شد — قبل از رفع double-encode 404 می‌گرفت).
- صفحهٔ اثر `/library/عدة-…?w=…` با نام‌دار شدن پس از رسیدن عنوان.
- API :8080 healthz 200؛ Go تست پاک؛ tsc --noEmit exit 0.

Stage Summary:
- مسیر نهایی مصوب کاربر: ساختار انگلیسی (`library`/`read`) + فقط نام کتاب فارسی + معنادار، کاملاً بدون hash: `…:3200/library/{نام-کتاب}` (اطلاعات اثر، `?w={uid}`) و `…:3200/library/{نام-کتاب}/read?d={doc}&pg={N}` (مطالعه). uidها در query سفر می‌کنند (یکتا) و نام صرفاً نمایشی است.
- فایل‌های تغییریافته: src/lib/hash-router.tsx (بازنویسی به path routing)، src/lib/href.ts، src/components/app-shell.tsx، src/views/{reader,work,settings,home,library,topics,project,compare}-view.tsx، src/components/{search/{result-card,split-reader,hadith-locations-dialog},home/my-fiches-section,reader/notes-panel}.tsx، src/app/api/v1/export/search/route.ts، mini-services/noor-api/internal/httpapi/ugc.go + ugc_test.go.
- محدودیت‌های صادقانه: (۱) سرور dev (next dev :3200) یک‌بار در حین تست‌های Fast Refresh از کار افتاد و دوباره راه‌اندازی شد — بدون اثر روی سورس؛ (۲) پوشهٔ `data/` و `data/sources/catalog.json` دست‌نخورده ماندند؛ (۳) تست‌های زندهٔ کامل‌تر (جست‌وجو→بازکردن در متن، مقایسه، پرونده، موبایل، مهمان+pending destination) در این دور انجام نشد — کد مسیرها/لینک‌ها معادل فاز ۱ است و رگرسیون پیش‌بینی نمی‌شود، ولی یک دور کامل بعدی توصیه می‌شود.
- برای ایجنت بعدی: (۱) `routeToUrl` هر uid را decode می‌کند — اگر uid جدیدی با `%` یا `#` اضافه شد، دوباره decode نکنید (idempotent نیست برای uidهایی که خودشان `%23` لفظی دارند — در کاتالوگ نیستند ولی اگر بودند باید encode شوند قبل از route); (۲) `HashLink` onClick را با `{...rest}` قبل از onClick خودش می‌گذارد — handler کاربر اول اجرا می‌شود؛ (۳) `fullHash` اکنون نشانی کامل (path+query) است نه hash — هر کدی که `.slice(1)` می‌زند باید به‌روز شود (app-shell انجام شد؛ جست‌وجوی دیگر برای `.slice(1)` روی fullHash).

---
