"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { DirectionProvider } from "@radix-ui/react-direction";
import { Toaster } from "@/components/ui/toaster";
import { initPalette, applyStoredPaletteForMode } from "@/lib/palette";
import { applyFontPrefs, initFontPrefs } from "@/lib/fonts";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";

/* اعمال قالب و قلم ذخیره‌شده پیش از نخستین رندر — بدون جرقهٔ تم و قلم */
initPalette();
initFontPrefs();

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  /* ترجیحات قلم: همگام با اولین رندر (بدون جرقهٔ قلم) + پس از هر تغییر */
  const prefs = useWorkspaceStore((s) => s.prefs);
  applyFontPrefs(prefs);
  useEffect(() => {
    applyFontPrefs(prefs);
  }, [prefs]);

  /* نشست باطل‌شده (منقضی/ revoked): بازگشت لطیف به صفحهٔ ورود — یک‌بار در هر رویداد */
  useEffect(() => {
    const onUnauthorized = () => {
      const auth = useAuthStore.getState();
      if (auth.status === "authenticated") void auth.fetchSession();
    };
    window.addEventListener("noor:unauthorized", onUnauthorized);
    return () => window.removeEventListener("noor:unauthorized", onUnauthorized);
  }, []);

  return (
    <DirectionProvider dir="rtl">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {/* با تغییر روشن/تیره (حتی همگام با سامانه)، قالب ذخیره‌شدهٔ همان حالت اعمال می‌شود */}
          <PaletteModeSync />
          {children}
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </DirectionProvider>
  );
}

/** همگام‌سازی قالب رنگی با حالت فعال — پس از هر تغییر روشن/تیره */
function PaletteModeSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    applyStoredPaletteForMode(resolvedTheme === "dark" ? "dark" : "light");
  }, [resolvedTheme]);
  return null;
}
