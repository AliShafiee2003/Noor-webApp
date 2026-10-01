/**
 * قالب‌های رنگی میزکار — لایهٔ سوم تم (کنار روشن/تیره next-themes).
 * هر قالب، مجموعهٔ کامل توکن‌های raw را در globals.css بازتعریف می‌کند
 * (data-palette روی <html>) — پس کل رابط، نه فقط چند رنگ، هماهنگ عوض می‌شود.
 * انتخاب کاربر فقط در localStorage (بدون ارسال به سرور — ترجیح دستگاهی).
 */
import { useSyncExternalStore } from "react";

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
    name: "زمرد شب",
    note: "قالب پیش‌فرض تیره میزکار",
    swatch: ["#111a1d", "#8ed3bd", "#18252a"],
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

const STORAGE_KEY = "noor-palette";
const DEFAULT_ID = "default";

let current = DEFAULT_ID;
const listeners = new Set<() => void>();
let initialized = false;

function applyToDocument(id: string): void {
  if (typeof document === "undefined") return;
  if (id === DEFAULT_ID) {
    delete document.documentElement.dataset.palette;
  } else {
    document.documentElement.dataset.palette = id;
  }
}

/** یک‌بار در آغاز کلاینت — پیش از نخستین رندر، تا جرقهٔ تم دیده نشود */
export function initPalette(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && stored !== DEFAULT_ID) {
      current = stored;
      applyToDocument(stored);
    }
  } catch {
    /* localStorage در دسترس نیست — قالب پیش‌فرض */
  }
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      current = e.newValue;
      applyToDocument(current);
      listeners.forEach((l) => l());
    }
  });
}

export function getPalette(): string {
  return current;
}

export function setPalette(id: string): void {
  current = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* بی‌خیال ذخیره؛ انتخاب تا پایان نشست برقرار می‌ماند */
  }
  applyToDocument(id);
  listeners.forEach((l) => l());
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
