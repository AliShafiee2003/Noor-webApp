"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { initPalette } from "@/lib/palette";
import { useAuthStore } from "@/store/auth";

/* اعمال قالب ذخیره‌شده پیش از نخستین رندر — بدون جرقهٔ تم */
initPalette();

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
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
