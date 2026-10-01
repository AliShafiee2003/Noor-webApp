import type { HighlightColor } from "@/lib/types";

/**
 * رنگ‌های هایلایت (§۷-الف-۳) — مپ مقدار ذخیره‌شده → کلاس Tailwind.
 * رنگ‌ها در هر دو حالت روشن/تیره خوانا هستند (تن‌های ۱۵–۳۵٪ روی زمینهٔ خواننده).
 */
export const HIGHLIGHT_COLORS: Array<{ value: HighlightColor; label: string; className: string; dotClass: string }> = [
  {
    value: "yellow",
    label: "زرد",
    className: "bg-[color-mix(in_srgb,#eab308_32%,transparent)]",
    dotClass: "bg-yellow-500",
  },
  {
    value: "green",
    label: "سبز",
    className: "bg-[color-mix(in_srgb,#22c55e_28%,transparent)]",
    dotClass: "bg-green-500",
  },
  {
    value: "blue",
    label: "فیروزه‌ای",
    className: "bg-[color-mix(in_srgb,#14b8a6_28%,transparent)]",
    dotClass: "bg-teal-500",
  },
  {
    value: "pink",
    label: "صورتی",
    className: "bg-[color-mix(in_srgb,#ec4899_26%,transparent)]",
    dotClass: "bg-pink-500",
  },
  {
    value: "orange",
    label: "نارنجی",
    className: "bg-[color-mix(in_srgb,#f97316_30%,transparent)]",
    dotClass: "bg-orange-500",
  },
];

export function isHighlightColor(v: string): v is HighlightColor {
  return HIGHLIGHT_COLORS.some((c) => c.value === v);
}

export function highlightClass(color: string): string {
  return HIGHLIGHT_COLORS.find((c) => c.value === color)?.className ?? HIGHLIGHT_COLORS[0].className;
}

/** رنگ CSS خام برای جاهایی که کلاس نمی‌شود گذاشت (PDF/HTML چاپی) */
export function highlightCss(color: string): string {
  switch (color) {
    case "green":
      return "rgba(34,197,94,0.30)";
    case "blue":
      return "rgba(20,184,166,0.30)";
    case "pink":
      return "rgba(236,72,153,0.28)";
    case "orange":
      return "rgba(249,115,22,0.32)";
    default:
      return "rgba(234,179,8,0.34)";
  }
}
