"use client";

/**
 * Reader theme = the SITE theme (next-themes light/dark + `data-palette`, see
 * lib/palette.ts and globals.css). The reader has no palette of its own, so the
 * desktop and mobile shells read/write exactly the same state.
 */
import { useCallback } from "react";
import { useTheme } from "next-themes";
import {
  DARK_PALETTES,
  LIGHT_PALETTES,
  getStoredPaletteForMode,
  setPalette,
  usePalette,
  type PaletteDef,
  type PaletteMode,
} from "@/lib/palette";

export interface ReaderThemeTarget {
  mode: PaletteMode;
  /** Palette id for `mode`; omitted = the palette last used in that mode. */
  palette?: string;
}

export function useReaderTheme() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mode: PaletteMode = resolvedTheme === "dark" ? "dark" : "light";
  const palette = usePalette();

  /**
   * Switch mode and/or palette synchronously on the DOM so CSS variables and
   * View Transitions apply on the exact frame of the click (0ms latency).
   */
  const apply = useCallback(
    (target: ReaderThemeTarget) => {
      const nextPalette = target.palette ?? getStoredPaletteForMode(target.mode);
      if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("dark", target.mode === "dark");
        document.documentElement.classList.toggle("light", target.mode === "light");
        document.documentElement.style.colorScheme = target.mode;
      }
      setPalette(nextPalette, target.mode);
      if (target.mode !== mode || theme !== target.mode) {
        setTheme(target.mode);
      }
    },
    [mode, theme, setTheme],
  );

  const toggleMode = useCallback(() => apply({ mode: mode === "dark" ? "light" : "dark" }), [apply, mode]);

  return {
    mode,
    dark: mode === "dark",
    palette,
    apply,
    toggleMode,
    lightPalettes: LIGHT_PALETTES as readonly PaletteDef[],
    darkPalettes: DARK_PALETTES as readonly PaletteDef[],
  };
}

/**
 * One-time mapping of the removed mobile reading themes onto site palettes.
 * Returns null for unknown ids.
 */
export function legacyReadingThemeTarget(id: unknown): Required<ReaderThemeTarget> | null {
  switch (id) {
    case "day":
      return { mode: "light", palette: "default" };
    case "sepia":
      return { mode: "light", palette: "l-parchment" };
    case "sky":
      return { mode: "light", palette: "l-mist" };
    case "night":
      return { mode: "dark", palette: "d-graphite" };
    case "twilight":
      return { mode: "dark", palette: "d-ocean" };
    case "forestNight":
      return { mode: "dark", palette: "default" };
    default:
      return null;
  }
}

/** True when the user already picked a site mode or palette (so a legacy reader theme must not override it). */
export function hasChosenSiteTheme(): boolean {
  try {
    const ls = window.localStorage;
    return !!(ls.getItem("theme") || ls.getItem("noor-palette-light") || ls.getItem("noor-palette-dark"));
  } catch {
    return false;
  }
}
