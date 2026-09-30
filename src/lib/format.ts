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
