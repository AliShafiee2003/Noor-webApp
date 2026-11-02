/**
 * ترجیحات یکپارچهٔ مطالعه در موبایل:
 * - فیلدهای مشترک تایپوگرافی و نمایش (`font_family`, `font_size`, `line_height`, `display`,
 *   `para_spacing`, `text_align`, `text_dir`, `font_quran`, `quran_font_size`,
 *   `quran_line_height`, `semantic_colors`) مستقیماً از ریشهٔ `ReaderPrefs` خوانده و در همان‌جا
 *   نوشته می‌شوند تا دسکتاپ و موبایل کاملاً هم‌گام باشند.
 * - فیلدهای ویژهٔ لمس و قاب موبایل (`margin`, `progression`, `tap_mode`, `tap_area`, `show_pill`)
 *   در `ReaderPrefs.mobile_reader` نگهداری می‌شوند.
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { useWorkspaceStore } from "@/store/workspace";
import {
  QURAN_FONT_SIZE_DEFAULT,
  QURAN_LINE_HEIGHT_DEFAULT,
  normalizeProseFont,
  normalizeQuranFont,
} from "@/lib/fonts";
import type { MobileReaderPrefs, ReaderPrefs } from "@/lib/types";

export const MOBILE_DIR_KEY_PREFIX = "noor:reader-m:dir:";

export const DEFAULT_MOBILE_PREFS: MobileReaderPrefs = {
  mode: "pages",
  font: "amiri",
  font_size: 20,
  line_height: 1.8,
  para: 0.6,
  align: "auto",
  dir: "auto",
  margin: 20,
  progression: "auto",
  tap_mode: "center",
  tap_area: 0.45,
  show_pill: true,
};

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, n));
};
const pick = <T extends string>(v: unknown, def: T, allowed: readonly T[]): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : def;
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);

function buildUnifiedMobilePrefs(prefsRaw: ReaderPrefs): MobileReaderPrefs {
  const r = (prefsRaw.mobile_reader ?? {}) as Record<string, unknown>;
  const modeFromDisplay =
    prefsRaw.display === "continuous"
      ? "scroll"
      : prefsRaw.display === "paged"
        ? "pages"
        : pick(r.mode, DEFAULT_MOBILE_PREFS.mode, ["pages", "scroll"] as const);
  const rawFont = prefsRaw.font_family ?? (typeof r.font === "string" ? r.font : DEFAULT_MOBILE_PREFS.font);

  return {
    mode: modeFromDisplay,
    font: normalizeProseFont(rawFont),
    font_size: num(prefsRaw.font_size ?? r.font_size, DEFAULT_MOBILE_PREFS.font_size, 12, 36),
    line_height: num(prefsRaw.line_height ?? r.line_height, DEFAULT_MOBILE_PREFS.line_height, 1.2, 2.4),
    para: num(prefsRaw.para_spacing ?? r.para, DEFAULT_MOBILE_PREFS.para, 0, 1.6),
    align: pick(prefsRaw.text_align ?? r.align, "auto", ["auto", "right", "center", "left", "justify"] as const),
    dir: pick(prefsRaw.text_dir ?? r.dir, "auto", ["auto", "rtl", "ltr"] as const),
    margin: num(r.margin, DEFAULT_MOBILE_PREFS.margin, 0, 48),
    progression: pick(r.progression, "auto", ["auto", "rtl", "ltr"] as const),
    tap_mode: pick(r.tap_mode, "center", ["center", "bottom"] as const),
    tap_area: num(r.tap_area, DEFAULT_MOBILE_PREFS.tap_area, 0.1, 1),
    show_pill: bool(r.show_pill, DEFAULT_MOBILE_PREFS.show_pill),
  };
}

/* ---------- جهت اختصاصی هر کتاب ---------- */
export function getBookDir(documentUid: string): "rtl" | "ltr" | null {
  try {
    const v = localStorage.getItem(MOBILE_DIR_KEY_PREFIX + documentUid);
    return v === "rtl" || v === "ltr" ? v : null;
  } catch {
    return null;
  }
}
export function setBookDir(documentUid: string, dir: "rtl" | "ltr" | null) {
  try {
    if (dir) localStorage.setItem(MOBILE_DIR_KEY_PREFIX + documentUid, dir);
    else localStorage.removeItem(MOBILE_DIR_KEY_PREFIX + documentUid);
  } catch {
    /* نادیده */
  }
}

export function useMobilePrefs(documentUid: string) {
  const prefsRaw = useWorkspaceStore((s) => s.prefs);
  const updatePrefs = useWorkspaceStore((s) => s.updatePrefs);
  const prefsLoaded = useWorkspaceStore((s) => s.prefsLoaded);

  const mobile = useMemo<MobileReaderPrefs>(() => buildUnifiedMobilePrefs(prefsRaw), [prefsRaw]);

  const update = useCallback(
    (partial: Partial<MobileReaderPrefs>) => {
      const curRaw = useWorkspaceStore.getState().prefs;
      const curMobile = buildUnifiedMobilePrefs(curRaw);
      const nextMobile: MobileReaderPrefs = { ...curMobile, ...partial };

      const rootPatch: Partial<ReaderPrefs> = {};
      if (partial.mode !== undefined) {
        rootPatch.display = partial.mode === "scroll" ? "continuous" : "paged";
      }
      if (partial.font !== undefined) {
        rootPatch.font_family = normalizeProseFont(partial.font);
      }
      if (partial.font_size !== undefined) {
        rootPatch.font_size = num(partial.font_size, DEFAULT_MOBILE_PREFS.font_size, 12, 36);
      }
      if (partial.line_height !== undefined) {
        rootPatch.line_height = num(partial.line_height, DEFAULT_MOBILE_PREFS.line_height, 1.2, 2.4);
      }
      if (partial.para !== undefined) {
        rootPatch.para_spacing = num(partial.para, DEFAULT_MOBILE_PREFS.para, 0, 1.6);
      }
      if (partial.align !== undefined) {
        rootPatch.text_align = partial.align;
      }
      if (partial.dir !== undefined) {
        rootPatch.text_dir = partial.dir;
      }

      updatePrefs({
        ...rootPatch,
        mobile_reader: nextMobile,
      });
    },
    [updatePrefs],
  );

  const quranPrefs = useMemo(
    () => ({
      font_quran: normalizeQuranFont(prefsRaw.font_quran),
      quran_font_size: num(prefsRaw.quran_font_size, QURAN_FONT_SIZE_DEFAULT, 18, 34),
      quran_line_height: num(prefsRaw.quran_line_height, QURAN_LINE_HEIGHT_DEFAULT, 1.6, 2.8),
      semantic_colors: prefsRaw.semantic_colors === true,
    }),
    [prefsRaw.font_quran, prefsRaw.quran_font_size, prefsRaw.quran_line_height, prefsRaw.semantic_colors],
  );

  const updateRootPrefs = useCallback(
    (patch: Partial<ReaderPrefs>) => {
      updatePrefs(patch);
    },
    [updatePrefs],
  );

  /* تم قدیمی ذخیره‌شده در mobile_reader برای مهاجرت یک‌باره به پالت سایت */
  const legacyReadingTheme = (prefsRaw.mobile_reader as { reading_theme?: unknown } | undefined)?.reading_theme;

  /* جهت مؤثر: override کتاب > تنظیم سراسری؛ auto معادل rtl است (کتب فارسی/عربی) */
  const [dirRev, setDirRev] = useState(0);
  const bookDir = useMemo(() => getBookDir(documentUid), [documentUid, dirRev]);
  const setBookDirection = useCallback(
    (dir: "rtl" | "ltr" | null) => {
      setBookDir(documentUid, dir);
      setDirRev((v) => v + 1);
    },
    [documentUid],
  );
  const clearBookDir = useCallback(() => setBookDirection(null), [setBookDirection]);
  const effectiveDir = useMemo<"rtl" | "ltr">(() => {
    if (bookDir) return bookDir;
    if (mobile.dir === "ltr") return "ltr";
    return "rtl";
  }, [mobile.dir, bookDir]);

  return {
    prefs: mobile,
    update,
    quranPrefs,
    updateRootPrefs,
    legacyReadingTheme,
    effectiveDir,
    bookDir,
    setBookDirection,
    clearBookDir,
    prefsLoaded,
  };
}
