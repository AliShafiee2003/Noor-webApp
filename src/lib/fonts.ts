/**
 * سامانهٔ قلم میزکار نور — چهار نقش قلمی با فونت‌های محلی (بدون CDN):
 *
 *  ۱. UI و فارسی: Vazirmatn (ثابت — قلم رابط)
 *  ۲. نثر عربی (متن، سند، پاورقی عربی): انتخاب کاربر — Amiri | Scheherazade New | Vazirmatn
 *  ۳. متن قرآنی (تگ‌های ayah_quote / ayah_text / ayahWord): انتخاب کاربر — Amiri Quran | Scheherazade New
 *     → تخصیص بر اساس «نقش تگ» است، نه حدس زبان کتاب.
 *  ۴. متون لاتین/انگلیسی: شناسایی خودکار بلوک لاتین (src/lib/script.ts) + انتخاب کاربر — Source Serif 4 | Inter
 *
 * استک‌ها «چنداسکریپتی» هستند: در پاراگراف آمیختهٔ عربی/فارسی/لاتین هر نویسه با
 * قلم نقش خودش رندر می‌شود (قلم لاتین نویسهٔ عربی ندارد → عربی به قلم نثر می‌افتد؛
 * نویسه‌های فارسی خاص اگر در قلم نثر نبودند به Vazirmatn می‌رسند).
 *
 * اعمال: applyFontPrefs متغیرهای --font-ui / --font-arabic / --font-quran / --font-latin
 * را روی <html> ست می‌کند (سرویسبدهد: مقدار پیش‌فرض در globals.css هست تا جرقه‌ای دیده نشود).
 * کلاس‌های tailwind: font-sans → ui، font-reader → نثر عربی، font-quranic → قرآنی، font-foreign → لاتین.
 */
import type { ReaderPrefs } from "@/lib/types";

export interface FontOption {
  id: string;
  label: string;
  note: string;
}

/** قلم نثر عربی — «Amiri یا هم‌ارز نسخ مناسب اعراب» */
export const PROSE_FONT_OPTIONS: readonly FontOption[] = [
  { id: "amiri", label: "امیری", note: "نسخ کلاسیک، مناسب اعراب‌گذاری متن حدیث" },
  { id: "scheherazade", label: "شهرزاد جدید", note: "نسخ باز و روشن با اعراب بلند" },
  { id: "vazirmatn", label: "وزیرمتن", note: "بدنهٔ مدرن و یکدست با رابط" },
] as const;

/** قلم قرآنی — انتخاب نهایی بین Amiri Quran و Scheherazade New روی آیات واقعی مجموعه انجام شد */
export const QURAN_FONT_OPTIONS: readonly FontOption[] = [
  { id: "amiri-quran", label: "امیری قرآن", note: "رندر کامل اعراب قرآنی — پیش‌فرض آزمون‌شده" },
  { id: "scheherazade-new", label: "شهرزاد جدید", note: "حرکت‌گذاری باز و فاصله‌های بلند" },
] as const;

/** قلم متون لاتین/انگلیسی (حالت چهارم — شناسایی خودکار) */
export const LATIN_FONT_OPTIONS: readonly FontOption[] = [
  { id: "source-serif", label: "Source Serif", note: "سریف کتابی برای کتب انگلیسی" },
  { id: "inter", label: "Inter", note: "سانس خوانا برای متن لاتین" },
] as const;

/** اندازهٔ پیش‌فرض متن قرآنی — ۲۴px */
export const QURAN_FONT_SIZE_DEFAULT = 24;
/** فاصلهٔ سطر پیش‌فرض متن قرآنی — ≈۲٫۰ */
export const QURAN_LINE_HEIGHT_DEFAULT = 2.0;

const LATIN_STACKS: Record<string, string> = {
  "source-serif": `"Source Serif 4", Georgia, "Times New Roman", serif`,
  inter: `"Inter", "Segoe UI", Arial, sans-serif`,
};

/**
 * خانوادهٔ اول قلم لاتین — فقط نام خانواده، بدون fallback.
 * برای جاسازی در استک‌های عربی/قرآنی به‌کار می‌رود تا `serif` عمومی
 * «قبل از» قلم عربی نیاید (وگرنه نویسه‌های عربی ممکن است به قلم serif
 * پیش‌فرض سامانه برسند، نه Amiri/وزیرمتن).
 */
const LATIN_PRIMARY: Record<string, string> = {
  "source-serif": `"Source Serif 4"`,
  inter: `"Inter"`,
};

export function latinStackFor(pref?: string): string {
  return LATIN_STACKS[pref ?? "source-serif"] ?? LATIN_STACKS["source-serif"];
}

function latinPrimaryFor(pref?: string): string {
  return LATIN_PRIMARY[pref ?? "source-serif"] ?? LATIN_PRIMARY["source-serif"];
}

/** استک نثر عربی — قلم لاتین انتخابی اول است تا ران‌های لاتینِ متن آمیخته با قلم لاتین رندر شوند */
export function arabicStackFor(prose?: string, latin?: string): string {
  const latinPart = latinPrimaryFor(latin);
  switch (prose) {
    case "vazirmatn":
      return `${latinPart}, "Vazirmatn", "Amiri", Tahoma, sans-serif`;
    case "scheherazade":
      return `${latinPart}, "Scheherazade New", "Amiri", "Vazirmatn", serif`;
    default:
      return `${latinPart}, "Amiri", "Scheherazade New", "Vazirmatn", serif`;
  }
}

/** استک قرآنی — اولویت با قلم قرآنی انتخابی؛ سپس جایگزین و نثر */
export function quranStackFor(pref?: string): string {
  return pref === "scheherazade-new"
    ? `"Scheherazade New", "Amiri Quran", "Amiri", "Vazirmatn", serif`
    : `"Amiri Quran", "Scheherazade New", "Amiri", "Vazirmatn", serif`;
}

export function uiStackFor(): string {
  return `"Vazirmatn", "Inter", "Segoe UI", Tahoma, sans-serif`;
}

/** اعمال ترجیحات قلم روی متغیرهای سراسری — در Providers و پس از هر تغییر prefs */
export function applyFontPrefs(prefs?: Partial<ReaderPrefs>): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--font-ui", uiStackFor());
  root.style.setProperty("--font-arabic", arabicStackFor(prefs?.font_family, prefs?.font_latin));
  root.style.setProperty("--font-quran", quranStackFor(prefs?.font_quran));
  root.style.setProperty("--font-latin", latinStackFor(prefs?.font_latin));
}

/** مقدار معتبر قلم نثر — برای پالایش ورودی prefs قدیمی */
export function normalizeProseFont(v: unknown): string {
  return PROSE_FONT_OPTIONS.some((o) => o.id === v) ? (v as string) : "amiri";
}
export function normalizeQuranFont(v: unknown): string {
  return QURAN_FONT_OPTIONS.some((o) => o.id === v) ? (v as string) : "amiri-quran";
}
export function normalizeLatinFont(v: unknown): string {
  return LATIN_FONT_OPTIONS.some((o) => o.id === v) ? (v as string) : "source-serif";
}
