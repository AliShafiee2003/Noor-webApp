# T10-a — frontend-shell (بخش ۱ از ۴ فرانت‌اند)

## خلاصهٔ کار
پوستهٔ کامل SPA فارسی RTL «میزکار پژوهشی نور» ساخته شد: RTL + فونت‌های محلی، توکن‌های رنگی DESIGN.md، کلاینت تایپ‌دار API v1، روتر hash دست‌ساز، استورهای zustand (auth/workspace)، پوستهٔ اپ (نوار بالا/ناوبری/تب‌های موبایل/فوتر sticky)، صفحات ورود/دعوت/خانه/کتابخانه/اثر/تنظیمات (کامل) و stubهای فارسی برای بقیهٔ viewها.

## فایل‌های این ایجنت (مالکیت)
- `src/app/layout.tsx` — dir=rtl lang=fa، @fontsource/vazirmatn (400/500/600/700) + @fontsource/amiri (400/700)، metadata فارسی، Providers (QueryClient staleTime 30s retry:false + next-themes + Toaster).
- `src/app/globals.css` — tokenهای دقیق §۴۱ روی :root/.dark + نگاشت shadcn (@theme inline حفظ شده)، اسکرول‌بار ظریف، bidi-ltr، choice-chip، touch-target ≥44px.
- `src/app/page.tsx` — فقط HashRouterProvider + AppShell.
- `src/lib/api.ts` — base `/api/v1`، همهٔ درخواست‌ها با `?XTransformPort=8080`، credentials:include، خطا → {code,message,trace_id,retryable} فارسی، هدر X-Noor-CSRF فقط mutation، CSRF فقط حافظهٔ ماژول، `apiUrl(path, params)`.
- `src/lib/types.ts` — کل تایپ‌های قرارداد API v1 (بدون any).
- `src/lib/hash-router.tsx` — parse `#/path?query`، provider/useRoute/navigate/buildHref/HashLink، مقصد پس از ورود در متغیر ماژول.
- `src/lib/labels.ts`، `src/lib/format.ts` — واژگان DESIGN.md، faNum/faDate/faDateTime.
- `src/store/auth.ts` — status: loading|guest|pending_mfa|authenticated؛ login/verifyMfa/logout/acceptInvite؛ خطاها ApiError.
- `src/store/workspace.ts` — prefs خواننده (حافظه + PUT /workspace/prefs با debounce)؛ recent؛ prefsSaveState.
- `src/components/app-shell.tsx` — skeleton/مهمان/کاربر؛ نوار بالا + جست‌وجوی سریع (`#/search?q=&mode=normalized_phrase&scope=library`)؛ ناوبری (مدیریت فقط admin)؛ BottomTabs موبایل؛ فوتر ریز دسکتاپ با mt-auto.
- `src/components/providers.tsx`، `src/components/feedback.tsx` (ListSkeleton/EmptyState/ErrorState)، `src/components/view-placeholder.tsx`.
- `src/views/login-view.tsx`، `src/views/invite-view.tsx`، `src/views/home-view.tsx`، `src/views/library-view.tsx`، `src/views/work-view.tsx`، `src/views/settings-view.tsx` — کامل.
- Stubها (برای ایجنت‌های بعدی): `src/views/{search,reader,topics,research,project,compare,admin}-view.tsx`.

## قرارداد props برای viewهای بعدی
- `SearchView()`, `TopicsView()`, `ResearchView()`, `CompareView()`, `AdminView()` بدون prop؛
- `ReaderView({ documentUid: string })`, `ProjectView({ uid: string })`.
- صفحهٔ read پارامتر `page` در hash query می‌پذیرد (`#/read/{uid}?page={page_uid}`) — home-view همین را می‌فرستد.

## تصمیم‌های مهم
1. mode «نام کتاب» در hash = `strict_phrase` (نام قرارداد API؛ در UI فقط «نام کتاب») + `scope=titles`؛ تبدیل نهایی scope در سرویس جست‌وجوی بک/فرانتِ ایجنت بعدی.
2. عبارت و فیلترهای جست‌وجو فقط در hash (کلیدهای `q`, `mode`, `scope`) — لینک اشتراکی؛ token/دادهٔ خصوصی هرگز در hash/localStorage.
3. کتابخانه: صفحه‌بندی تدریجی «بیشتر» با useQueries + keepPreviousData + remount کلیددار روی تغییر فیلتر.
4. دادهٔ null در UI = «ثبت نشده» (LIB-09) — حدس ممنوع.
5. فوتر فقط دسکتاپ؛ موبایل نوار پایین + safe-area دارد.

## وضعیت
- `bun run lint` ✅ بدون خطا؛ `tsc --noEmit` روی src ✅؛ dev server (پورت 3000) بدون restart کامپایل موفق.
- کارهای باز برای ایجنت‌های بعدی: پیاده‌سازی stubها (جست‌وجو/کتاب‌خوان/موضوعات/پژوهش/مقایسه/مدیریت).
