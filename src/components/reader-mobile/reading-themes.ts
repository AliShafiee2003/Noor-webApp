/**
 * گزینه‌های ریدر موبایل — قلم‌ها از سامانهٔ قلم مشترک سایت (`@/lib/fonts`) می‌آیند
 * تا انتخاب کاربر میان دسکتاپ و موبایل یکپارچه باشد.
 */
import { PROSE_FONT_OPTIONS, arabicStackFor, normalizeProseFont } from "@/lib/fonts";

export interface MobileFont {
  id: string;
  fa: string;
  note: string;
  stack: string;
}

export const MOBILE_FONTS: MobileFont[] = PROSE_FONT_OPTIONS.map((o) => ({
  id: o.id,
  fa: o.label,
  note: o.note,
  stack: arabicStackFor(o.id),
}));

export function mobileFontStack(id: string | undefined | null): string {
  return arabicStackFor(normalizeProseFont(id));
}

/* تراز متن — ۵ حالت پروتوتایپ */
export const ALIGN_OPTIONS = ["auto", "right", "center", "left", "justify"] as const;
/* جهت متن — ۳ حالت پروتوتایپ */
export const DIR_OPTIONS = ["auto", "rtl", "ltr"] as const;
/* جهت پیش‌روی صفحات */
export const PROGRESSION_OPTIONS = ["auto", "rtl", "ltr"] as const;
