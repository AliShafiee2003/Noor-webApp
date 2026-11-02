/**
 * قالب‌های رنگی یکپارچهٔ میزکار و مطالعه — پوسته‌های اصلی سایت به‌عنوان پایهٔ رابط کاربری
 * (هدر، فوتر، نوارها و پنل‌ها) به همراه توکن‌های اختصاصی پس‌زمینهٔ مطالعه (--reader) درون هر پوسته.
 * انتخاب کاربر به‌تفکیک حالت (روشن/تیره) در localStorage نگه داشته می‌شود؛
 * با جابه‌جایی حالت، قالبِ همان حالت دوباره اعمال می‌شود.
 */
import { useSyncExternalStore } from "react";
import emeraldNight from "@/design-system/skins/emerald-night.json";

export interface PaletteDef {
  id: string;
  name: string;
  note: string;
  /** رنگ پس‌زمینهٔ صفحهٔ مطالعه (--reader) برای دایرهٔ انتخاب تم */
  bg: string;
  /** رنگ متن صفحهٔ مطالعه (--reader-text) برای حرف «أ» درون دایره */
  text: string;
  /** رنگ فرعی/حاشیهٔ دایره (--reader-muted) */
  sec: string;
  /** سه لکهٔ نمونه: بوم سایت، رنگ اصلی، سطح کارت */
  swatch: readonly [string, string, string];
}

/** ۴ قالب حالت روشن — پوسته‌های اصلی سایت + پس‌زمینهٔ مطالعه (سفید، کرم/سپیا، خاکستری/آسمانی، سبز روشن) */
export const LIGHT_PALETTES: readonly PaletteDef[] = [
  {
    id: "default",
    name: "زمرد روز",
    note: "قالب پیش‌فرض روشن با صفحهٔ مطالعهٔ سفید روشن",
    bg: "#FDFDFB",
    text: "#1F2521",
    sec: "#5D6A62",
    swatch: ["#f7f5ef", "#17665b", "#ffffff"],
  },
  {
    id: "l-parchment",
    name: "کاغذ کهنه",
    note: "کرم گرم و سپیا با مرکب قهوه‌ای — مناسب مطالعهٔ طولانی",
    bg: "#F4E8D1",
    text: "#4A3B28",
    sec: "#7A6A52",
    swatch: ["#faf4e5", "#7a4a21", "#fffaf0"],
  },
  {
    id: "l-mist",
    name: "مه‌آلود",
    note: "خاکستری و آبی آسمانی ملایم با کنتراست آرام",
    bg: "#E2ECF5",
    text: "#1E2A32",
    sec: "#5A6B78",
    swatch: ["#eaecf0", "#2e6e73", "#f8f9fb"],
  },
  {
    id: "l-sage",
    name: "باغ سبز",
    note: "سبز ملایم طبیعی برای آسایش چشم در مطالعهٔ روزانه",
    bg: "#D8ECD9",
    text: "#1C3121",
    sec: "#4E6A54",
    swatch: ["#eef3ea", "#3e7048", "#f9fbf7"],
  },
] as const;

/** ۴ قالب حالت تیره — پوسته‌های اصلی سایت + پس‌زمینهٔ مطالعه (سبز تیره، سیاه، بنفش، قهوه‌ای) */
export const DARK_PALETTES: readonly PaletteDef[] = [
  {
    id: "default",
    name: emeraldNight.name,
    note: "قالب پیش‌فرض تیره با پس‌زمینهٔ مطالعهٔ سبز جنگلی",
    bg: "#0E3A22",
    text: "#D9EBDD",
    sec: "#8FB89F",
    swatch: [emeraldNight.colors.canvas, emeraldNight.colors.primary, emeraldNight.colors.surface],
  },
  {
    id: "d-graphite",
    name: "گرافیت",
    note: "خاکستری دودی با پس‌زمینهٔ مطالعهٔ سیاه شبانه",
    bg: "#14161A",
    text: "#D6DAE0",
    sec: "#8A929C",
    swatch: ["#21252b", "#d9a868", "#282c34"],
  },
  {
    id: "d-ocean",
    name: "اقیانوس",
    note: "فیروزهٔ دریایی با پس‌زمینهٔ مطالعهٔ بنفش گرگ‌ومیش",
    bg: "#30204A",
    text: "#DED9EE",
    sec: "#A79BC8",
    swatch: ["#0a333e", "#62cdbf", "#0e404d"],
  },
  {
    id: "d-walnut",
    name: "چوب گردو",
    note: "قهوه‌ای شبانهٔ گرم برای مطالعه در نور کم",
    bg: "#261A10",
    text: "#EADCCB",
    sec: "#B29B82",
    swatch: ["#221a12", "#d9a05b", "#2b2118"],
  },
] as const;

export type PaletteMode = "light" | "dark";

const LEGACY_KEY = "noor-palette";
const KEY_LIGHT = "noor-palette-light";
const KEY_DARK = "noor-palette-dark";
const DEFAULT_ID = "default";

let current = DEFAULT_ID;
const listeners = new Set<() => void>();
let initialized = false;

function storageKeyForMode(mode: PaletteMode): string {
  return mode === "dark" ? KEY_DARK : KEY_LIGHT;
}

/** نرمال‌سازی شناسه‌های پالت به ۸ پوستهٔ استاندارد سایت (۴ روشن + ۴ تیره) */
export function normalizePaletteId(id: string | null | undefined, mode: PaletteMode): string {
  if (!id) return DEFAULT_ID;
  if (mode === "light") {
    if (id === "l-parchment" || id === "sepia") return "l-parchment";
    if (id === "l-mist" || id === "sky") return "l-mist";
    if (id === "l-sage") return "l-sage";
    return DEFAULT_ID;
  }
  if (id === "d-graphite" || id === "night") return "d-graphite";
  if (id === "d-ocean" || id === "twilight") return "d-ocean";
  if (id === "d-walnut") return "d-walnut";
  return DEFAULT_ID;
}

export function getStoredPaletteForMode(mode: PaletteMode): string {
  try {
    const fresh = window.localStorage.getItem(storageKeyForMode(mode));
    if (fresh) return normalizePaletteId(fresh, mode);
    /* مهاجرت کلید تک‌حالتهٔ قدیمی */
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const normLight = normalizePaletteId(legacy, "light");
      const normDark = normalizePaletteId(legacy, "dark");
      window.localStorage.setItem(KEY_LIGHT, normLight);
      window.localStorage.setItem(KEY_DARK, normDark);
      window.localStorage.removeItem(LEGACY_KEY);
      return mode === "dark" ? normDark : normLight;
    }
  } catch {
    /* localStorage در دسترس نیست */
  }
  return DEFAULT_ID;
}

function writeStoredId(mode: PaletteMode, id: string): void {
  const norm = normalizePaletteId(id, mode);
  try {
    if (norm === DEFAULT_ID) {
      window.localStorage.removeItem(storageKeyForMode(mode));
    } else {
      window.localStorage.setItem(storageKeyForMode(mode), norm);
    }
  } catch {
    /* بی‌خیال ذخیره؛ انتخاب تا پایان نشست برقرار می‌ماند */
  }
}

function applyToDocument(id: string): void {
  if (typeof document === "undefined") return;
  if (id === DEFAULT_ID) {
    delete document.documentElement.dataset.palette;
  } else {
    document.documentElement.dataset.palette = id;
  }
}

function setListeners(): void {
  listeners.forEach((l) => l());
}

/** حدس حالت آغازین از تنظیمات next-themes — پیش از رندر، برای پرهیز از جرقهٔ قالب */
function initialMode(): PaletteMode {
  if (typeof window === "undefined") return "dark";
  try {
    const theme = window.localStorage.getItem("theme");
    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
    if (theme === "system") {
      return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
  } catch {
    /* پیش‌فرض زمرد شب */
  }
  return "dark";
}

/** یک‌بار در آغاز کلاینت — پیش از نخستین رندر، تا جرقهٔ قالب دیده نشود */
export function initPalette(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const mode = initialMode();
  current = getStoredPaletteForMode(mode);
  applyToDocument(current);
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY_LIGHT && e.key !== KEY_DARK) return;
    current = getStoredPaletteForMode(initialMode());
    applyToDocument(current);
    setListeners();
  });
}

/** اعمال قالبِ ذخیره‌شدهٔ یک حالت (بدون نوشتن) — پس از هر تغییر روشن/تیره */
export function applyStoredPaletteForMode(mode: PaletteMode): void {
  const id = getStoredPaletteForMode(mode);
  /* همیشه صفت data-palette روی <html> همگام شود تا هرگز از حالت قبلی جا نماند */
  applyToDocument(id);
  if (id === current) return;
  current = id;
  setListeners();
}

export function getPalette(): string {
  return current;
}

/** انتخاب قالب برای یک حالت — ذخیره به‌تفکیک حالت + اعمال فوری */
export function setPalette(id: string, mode: PaletteMode): void {
  const norm = normalizePaletteId(id, mode);
  writeStoredId(mode, norm);
  current = norm;
  applyToDocument(norm);
  setListeners();
}

/** Persist the palette chosen for a mode without touching the live document (used when the mode is not active). */
export function storePaletteForMode(id: string, mode: PaletteMode): void {
  writeStoredId(mode, id);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** هوک خواندن قالب فعلی — با SSR-safe snapshot */
export function usePalette(): string {
  return useSyncExternalStore(subscribe, getPalette, () => DEFAULT_ID);
}

/** فهرست قالب‌های یک حالت نمایش */
export function palettesForMode(resolvedTheme: string | undefined): readonly PaletteDef[] {
  return resolvedTheme === "dark" ? DARK_PALETTES : LIGHT_PALETTES;
}
