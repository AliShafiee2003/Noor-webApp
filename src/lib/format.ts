/** قالب‌بندی نمایشی فارسی: اعداد و تاریخ‌ها */

/** تبدیل اعداد به ارقام فارسی برای نمایش (مقدار اصلی در کپی حفظ می‌شود) */
export function faNum(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "";
    return value.toLocaleString("fa-IR", { useGrouping: false });
  }
  return value.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export function faDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "medium",
    }).format(date);
  } catch {
    return iso;
  }
}

export function faDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return iso;
  }
}

/**
 * نرمال‌سازی متن فارسی:
 * ۱. یکدست‌سازی کاف و یای عربی (ك → ک، ى/ي → ی)
 * ۲. تبدیل هٔ غیراستاندارد (ۀ → هٔ، ه\u0654 → هٔ)
 * ۳. تصحیح پسوند قمشه‌اى / ه\u200Cا[ىي] → ه‌ای
 * ۴. پیراستن نمادهای اضافی < > یا &lt; &gt;
 * ۵. پاکسازی نیم‌فاصله‌های تکراری و زائد
 */
export function normalizePersian(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/^[<\s]+|[>\s]+$/g, "")
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u0649\u064A]/g, "\u06CC")
    .replace(/\u06C0/g, "\u0647\u0654")
    .replace(/\u0647\u200C\u0627[\u0649\u064A\u06CC]/g, "\u0647\u200C\u0627\u06CC")
    .replace(/[\u200B\uFEFF\u200D\u0640]/g, "")
    .replace(/\u200C{2,}/g, "\u200C")
    .replace(/([\s\p{P}])\u200C+/gu, "$1")
    .replace(/\u200C+([\s\p{P}])/gu, "$1")
    .replace(/^\u200C+|\u200C+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
