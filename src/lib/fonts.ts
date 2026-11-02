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

/** قلم نثر عربی و مطالعه — مشترک میان دسکتاپ و موبایل */
export const PROSE_FONT_OPTIONS: readonly FontOption[] = [
  { id: "amiri", label: "امیری", note: "نسخ کلاسیک، مناسب اعراب‌گذاری متن حدیث" },
  { id: "scheherazade", label: "شهرزاد جدید", note: "نسخ باز و روشن با اعراب بلند" },
  { id: "vazirmatn", label: "وزیرمتن", note: "بدنهٔ مدرن و یکدست با رابط" },
  { id: "b-zar", label: "B Zar", note: "قلم سنتی و آشنای مطبوعاتی و کتابی" },
  { id: "bahij-greta", label: "گرتا", note: "طراحی مدرن و شیوا برای متون و عناوین عربی" },
  { id: "portada", label: "پورتادا", note: "طراحی مدرن، خوانا و متناسب کتب عربی (Portada ARA)" },
  { id: "adobe-naskh", label: "نسخ (Adobe Naskh)", note: "نسخ خوانا و تمیز برای مطالعهٔ طولانی" },
  { id: "far-badr", label: "بدر (Far Badr)", note: "قلم کتابی سنتی" },
  { id: "b-yagut", label: "یاقوت (B Yagut)", note: "قلم سنتی یاقوت" },
  { id: "b-yekan", label: "یکان (B Yekan)", note: "قلم یکان کلاسیک" },
  { id: "vazir", label: "وزیر کلاسیک (Vazir)", note: "نسخهٔ کلاسیک قلم وزیر" },
  { id: "b-traffic", label: "ترافیک (B Traffic)", note: "قلم ساده و باز ترافیک" },
] as const;

/** نگاشت شناسه‌های قدیمی فونت موبایل به شناسه‌های استاندارد `PROSE_FONT_OPTIONS` */
const LEGACY_FONT_MAP: Record<string, string> = {
  Vazirmatn: "vazirmatn",
  BYekan: "b-yekan",
  Far_Badr: "far-badr",
  Greta: "bahij-greta",
  Vazir: "vazir",
  BTraffic: "b-traffic",
  BYagut: "b-yagut",
  AdobeNaskh: "adobe-naskh",
  Inter: "vazirmatn",
};

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
  const normalized = prose && LEGACY_FONT_MAP[prose] ? LEGACY_FONT_MAP[prose] : prose;
  switch (normalized) {
    case "vazirmatn":
      return `${latinPart}, "Vazirmatn", "Amiri", Tahoma, sans-serif`;
    case "scheherazade":
      return `${latinPart}, "Scheherazade New", "Amiri", "Vazirmatn", serif`;
    case "b-zar":
      return `${latinPart}, "B Zar", "Amiri", "Vazirmatn", serif`;
    case "bahij-greta":
      return `${latinPart}, "گرتا", "RM Greta", "Amiri", "Vazirmatn", serif`;
    case "portada":
      return `${latinPart}, "Portada ARA", "Amiri", "Vazirmatn", serif`;
    case "adobe-naskh":
      return `${latinPart}, "RM AdobeNaskh", "Amiri", "Vazirmatn", serif`;
    case "far-badr":
      return `${latinPart}, "RM FarBadr", "Amiri", "Vazirmatn", serif`;
    case "b-yagut":
      return `${latinPart}, "RM BYagut", "Amiri", "Vazirmatn", serif`;
    case "b-yekan":
      return `${latinPart}, "RM BYekan", "Vazirmatn", sans-serif`;
    case "vazir":
      return `${latinPart}, "RM Vazir", "Vazirmatn", sans-serif`;
    case "b-traffic":
      return `${latinPart}, "RM BTraffic", "Vazirmatn", sans-serif`;
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

export const READER_PREFS_STORAGE_KEY = "noor:reader-prefs";

/** خواندن همگام ترجیحات ذخیره‌شدهٔ قلم و خواننده از localStorage برای رندر بدون پرش (FOUT) */
export function loadCachedReaderPrefs(): Partial<ReaderPrefs> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(READER_PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Partial<ReaderPrefs>;
    }
  } catch {
    /* localStorage غیرفعال یا خطای parse */
  }
  return {};
}

/** ذخیرهٔ کش محلی ترجیحات خواننده */
export function saveCachedReaderPrefs(prefs: Partial<ReaderPrefs>): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadCachedReaderPrefs();
    const merged = { ...existing, ...prefs };
    window.localStorage.setItem(READER_PREFS_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* صرف‌نظر در صورت محدودیت storage */
  }
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

/** یک‌بار در آغاز کلاینت — پیش از نخستین رندر، تا پرش قلم (FOUT) رخ ندهد */
export function initFontPrefs(): void {
  if (typeof window === "undefined") return;
  const cached = loadCachedReaderPrefs();
  applyFontPrefs(cached);
}

/** مقدار معتبر قلم نثر — برای پالایش ورودی prefs قدیمی (شامل شناسه‌های قدیمی موبایل) */
export function normalizeProseFont(v: unknown): string {
  if (typeof v === "string" && LEGACY_FONT_MAP[v]) return LEGACY_FONT_MAP[v];
  return PROSE_FONT_OPTIONS.some((o) => o.id === v) ? (v as string) : "amiri";
}
export function normalizeQuranFont(v: unknown): string {
  return QURAN_FONT_OPTIONS.some((o) => o.id === v) ? (v as string) : "amiri-quran";
}
export function normalizeLatinFont(v: unknown): string {
  return LATIN_FONT_OPTIONS.some((o) => o.id === v) ? (v as string) : "source-serif";
}
