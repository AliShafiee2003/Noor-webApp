/**
 * دور ۱۸-فیکس ۱۲ (فاز ۲) — نشانی‌ساز مسیر واقعی (بدون hash).
 *
 * قرار نهایی کاربر: بخش‌های ساختاری انگلیسی (library/read)، فقط نام کتاب
 * فارسی، و معنادار. hash حذف شد؛ uid همیشه در query سفر می‌کند (w اثر / d
 * سند) و نام اثر صرفاً بخش نمایشیِ path است و هرگز اعتبارسنجی نمی‌شود:
 *   - اطلاعات اثر:  /library/{نام}?w={uid}     (بدون نام: /library/book?w=…)
 *   - مطالعه:       /library/{نام}/read?d={doc}&pg=16
 *     (pg عددی؛ p-016 → 16؛ صفحات غیرعددی مثل p-front خام می‌مانند)
 * سازنده‌های readHref/workHref حالا «فرم روت» می‌سازند (مثل #/read/… قدیمی
 * ولی بدون #)؛ روتر این فرم را به نشانی معنایی ترجمه می‌کند — همهٔ لینک‌دهی
 * درونی از navigate/HashLink می‌گذرد و نام‌دار شدن با اثرِ هویت مسیر یا props
 * slug بلافاصله رخ می‌دهد.
 * سازنده‌های Share (readShareHref/workShareHref) نشانی کامل نهایی می‌سازند
 * برای کپی نشانی/اشتراک — جایی که قالب نهایی مهم است و روتر در دسترس نیست.
 */
"use client";

/** سقف نویسه‌های slug — عناوین خیلی بلند کوتاه می‌شوند */
const SLUG_MAX = 48;

/**
 * تبدیل نام اثر فارسی به segment خوانا و ایمن برای مسیر:
 * - حذف اِعراب و علامت‌های تجویدی
 * - نیم‌فاصله/فاصلهٔ‌مجازی → خطِ-تیره
 * - حذف نویسه‌های نقطه‌گذاری/ناموزون (از جمله % و #)
 * - فاصله‌ها → خطِ-تیره و فشرده‌سازی
 */
export function slugifyFa(title: string | null | undefined): string | null {
  if (!title) return null;
  const s = title
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "") // اعراب و نشانه‌های قرآنی
    .replace(/[\u200c\u200d\u200e\u200f]/g, "-") // نیم‌فاصله و کاراکترهای کنترل دوجهته
    .replace(/[\[\]{}()（）«»"'’‘“”\"…،؛:.,\/\\|?!؟&$%+=~<>@^*#_-]+/g, "-")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return s || null;
}

/** فرم روت مطالعه (بدون #) — روتر به نشانی معنایی ترجمه می‌کند */
export function readHref(documentUid: string): string {
  return `/read/${documentUid}`;
}

/** فرم روت صفحهٔ اثر (بدون #) — روتر به نشانی معنایی ترجمه می‌کند */
export function workHref(workUid: string): string {
  return `/book/${workUid}`;
}

/* ---------- سازنده‌های نشانی نهایی (کپی/اشتراک/خروجی) ---------- */

export interface ReadShareOptions {
  /** عنوان اثر — در دسترس بودن، نام را در path می‌نویسد */
  title?: string | null;
  /** uid صفحه (p-016) — در نشانی عددی می‌آید (pg=16) */
  pgUid?: string | null;
  /** بازهٔ هایلایت (start:end) — عیناً */
  hl?: string | null;
}

/** نشانی کامل مطالعه برای کپی/اشتراک — path معنایی + uid در query (بدون hash) */
export function readShareHref(documentUid: string, opts?: ReadShareOptions): string {
  const slug = slugifyFa(opts?.title) ?? "book";
  const q = new URLSearchParams();
  q.set("d", documentUid);
  if (opts?.pgUid) q.set("pg", pgNumTerm(opts.pgUid));
  if (opts?.hl) q.set("hl", opts.hl);
  return `/library/${encodeURIComponent(slug)}/read?${q.toString()}`;
}

/** نشانی کامل صفحهٔ اثر برای کپی/اشتراک — بدون hash */
export function workShareHref(workUid: string, opts?: { title?: string | null }): string {
  const slug = slugifyFa(opts?.title) ?? "book";
  const q = new URLSearchParams();
  q.set("w", workUid);
  return `/library/${encodeURIComponent(slug)}?${q.toString()}`;
}

/** pg در نشانی عددی است: p-016 → 16 (همان قانون روتر — pgTerm) */
function pgNumTerm(value: string): string {
  return /^p-\d+$/.test(value) ? String(Number.parseInt(value.slice(2), 10)) : value;
}

/* ---------- هویت مسیر: نام‌دار شدن وقتی عنوان رسید ---------- */

/**
 * فاز ۲ — نوشتن نام اثر در path از عنوان واقعی.
 * pathname انتظاری: /library/{x}[/read] — x را با slug عنوان جایگزین می‌کند
 * (ferrals «book» بی‌نام یا نامِ قبلی یا نام لینک قدیمی). query حفظ می‌شود و
 * هیچ رویداد مسیری نمی‌سازد (رندر نمی‌پرد؛ فقط نوار آدرس نام‌دار می‌شود).
 */
export function decoratePathWithSlug(
  title: string | null | undefined,
  head: "book" | "read",
): void {
  if (typeof window === "undefined") return;
  const slug = slugifyFa(title);
  if (!slug) return;
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "library" || parts.length < 2) return;
  if (head === "read") {
    if (parts[parts.length - 1] !== "read") return;
  } else if (parts[parts.length - 1] === "read") {
    return;
  }
  if (parts[1] === slug) return;
  parts[1] = slug;
  window.history.replaceState(
    null,
    "",
    `/${parts.join("/")}${window.location.search}`,
  );
}
