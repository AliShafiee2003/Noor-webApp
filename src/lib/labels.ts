/**
 * واژگان رابط (طبق DESIGN.md) — هیچ شناسهٔ فنی در UI نمایش داده نمی‌شود.
 */
import type { CoverageState, DocumentCoverage, WorkFeatures } from "@/lib/types";

export const featureLabels: Record<keyof WorkFeatures, string> = {
  hadith: "روایت",
  quran: "آیه",
  footnotes: "پاورقی",
  links: "ارجاع",
  topics: "موضوع",
  media: "رسانه",
  searchable_text: "متن جست‌وجوپذیر",
};

export const coverageLabels: Record<CoverageState, string> = {
  supported: "پوشش کامل",
  partial: "پوشش ناقص",
  absent: "ندارد",
  failed: "پردازش ناموفق",
  unknown: "نامشخص",
};

export const coverageKeys: Array<{
  key: keyof DocumentCoverage;
  label: string;
}> = [
  { key: "hadith", label: "روایت" },
  { key: "quran", label: "آیه" },
  { key: "footnotes", label: "پاورقی" },
  { key: "topics", label: "موضوع" },
  { key: "searchable_text", label: "متن جست‌وجوپذیر" },
];

/** برچسب نوع سند؛ برچسب نامعلوم به‌صورت «سند» نمایش داده می‌شود. */
export function documentKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "volume":
      return "جلد";
    case "intro":
    case "introduction":
      return "مدخل";
    case "appendix":
      return "ضمیمه";
    case "index":
      return "فهرست";
    default:
      return "سند";
  }
}

/** برچسب فرمت محتوا (فاز رسانه) — text/pdf/image/audio از پسوند منبع مشتق می‌شوند. */
export function documentFormatLabel(format: string | null | undefined): string {
  switch (format) {
    case "text":
      return "نسخهٔ متنی";
    case "pdf":
      return "نسخهٔ اسکن‌شده";
    case "image":
      return "جلد";
    case "audio":
      return "نسخهٔ صوتی";
    default:
      return "سند";
  }
}

export const languageLabels: Record<string, string> = {
  ar: "عربی",
  fa: "فارسی",
};

export function languageLabel(lang: string | null | undefined): string {
  if (!lang) return "";
  return languageLabels[lang] ?? lang;
}

export const roleLabels: Record<string, string> = {
  admin: "مدیر سامانه",
  reader: "خواننده",
};

export const matchTypeLabels: Record<string, string> = {
  exact: "عبارت دقیق",
  normalized: "عبارت نرمال‌شده",
  linguistic: "تطبیق تقریبی",
  fuzzy: "تطبیق تقریبی",
};

export const searchModeLabels: Record<string, string> = {
  strict_phrase: "عبارت دقیق",
  normalized_phrase: "عبارت نرمال‌شده",
  all_words: "جست‌وجوی واژه‌ها",
  any_words: "جست‌وجوی واژه‌ها",
  near: "جست‌وجوی هم‌جوار",
  linguistic: "تطبیق تقریبی",
  long_quote: "نقل‌قول بلند",
};
