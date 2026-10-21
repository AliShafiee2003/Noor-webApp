/**
 * قالب‌های رنگی میزکار — لایهٔ سوم تم (کنار روشن/تیره next-themes).
 * هر قالب، مجموعهٔ کامل توکن‌های raw را در globals.css بازتعریف می‌کند
 * (data-palette روی <html>) — پس کل رابط، نه فقط چند رنگ، هماهنگ عوض می‌شود.
 * انتخاب کاربر به‌تفکیک حالت (روشن/تیره) در localStorage نگه داشته می‌شود؛
 * با جابه‌جایی حالت، قالبِ همان حالت دوباره اعمال می‌شود.
 */
import { useSyncExternalStore } from "react";
import emeraldNight from "@/design-system/skins/emerald-night.json";

export interface PaletteDef {
  id: string;
  name: string;
  note: string;
  /** سه لکهٔ نمونه: بوم، رنگ اصلی، سطح کارت */
  swatch: readonly [string, string, string];
}

/** قالب‌های حالت روشن */
export const LIGHT_PALETTES: readonly PaletteDef[] = [
  {
    id: "default",
    name: "زمرد روز",
    note: "قالب پیش‌فرض روشن میزکار",
    swatch: ["#f7f5ef", "#17665b", "#ffffff"],
  },
  {
    id: "l-parchment",
    name: "کاغذ کهنه",
    note: "کرم گرم با مرکب قهوه‌ای — دوستدار مطالعهٔ طولانی",
    swatch: ["#faf4e5", "#7a4a21", "#fffaf0"],
  },
  {
    id: "l-mist",
    name: "مه‌آلود",
    note: "خاکستری سرد و کم‌سروصدا با سبزآبی آرام",
    swatch: ["#eaecf0", "#2e6e73", "#f8f9fb"],
  },
  {
    id: "l-sage",
    name: "باغ سبز",
    note: "سبز ملایم طبیعی برای محیط کار روشن",
    swatch: ["#eef3ea", "#3e7048", "#f9fbf7"],
  },
] as const;

/** قالب‌های حالت تیره */
export const DARK_PALETTES: readonly PaletteDef[] = [
  {
    id: "default",
    name: emeraldNight.name,
    note: "قالب پیش‌فرض تیره میزکار",
    swatch: [emeraldNight.colors.canvas, emeraldNight.colors.primary, emeraldNight.colors.surface],
  },
  {
    id: "d-ocean",
    name: "اقیانوس",
    note: "فیروزهٔ عمیق دریایی با درخشش آرام",
    swatch: ["#0a333e", "#62cdbf", "#0e404d"],
  },
  {
    id: "d-graphite",
    name: "گرافیت",
    note: "خاکستری دودی خنثی با کهربای گرم",
    swatch: ["#21252b", "#d9a868", "#282c34"],
  },
  {
    id: "d-walnut",
    name: "چوب گردو",
    note: "قهوه‌ای شبانهٔ گرم برای مطالعه در نور کم",
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

function readStoredId(mode: PaletteMode): string {
  try {
    const fresh = window.localStorage.getItem(storageKeyForMode(mode));
    if (fresh) return fresh;
    /* مهاجرت کلید تک‌حالتهٔ قدیمی */
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      window.localStorage.setItem(KEY_LIGHT, legacy);
      window.localStorage.setItem(KEY_DARK, legacy);
      window.localStorage.removeItem(LEGACY_KEY);
      return legacy;
    }
  } catch {
    /* localStorage در دسترس نیست */
  }
  return DEFAULT_ID;
}

function writeStoredId(mode: PaletteMode, id: string): void {
  try {
    if (id === DEFAULT_ID) {
      window.localStorage.removeItem(storageKeyForMode(mode));
    } else {
      window.localStorage.setItem(storageKeyForMode(mode), id);
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
  current = readStoredId(mode);
  applyToDocument(current);
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY_LIGHT && e.key !== KEY_DARK) return;
    /* همگام‌سازی میان‌تبی: کلید حالت فعلی را دوباره بخوان */
    current = readStoredId(initialMode());
    applyToDocument(current);
    setListeners();
  });
}

/** اعمال قالبِ ذخیره‌شدهٔ یک حالت (بدون نوشتن) — پس از هر تغییر روشن/تیره */
export function applyStoredPaletteForMode(mode: PaletteMode): void {
  const id = readStoredId(mode);
  if (id === current) return;
  current = id;
  applyToDocument(id);
  setListeners();
}

export function getPalette(): string {
  return current;
}

/** انتخاب قالب برای یک حالت — ذخیره به‌تفکیک حالت + اعمال فوری */
export function setPalette(id: string, mode: PaletteMode): void {
  writeStoredId(mode, id);
  current = id;
  applyToDocument(id);
  setListeners();
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
