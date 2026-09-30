"use client";

import { AppShell } from "@/components/app-shell";
import { HashRouterProvider } from "@/lib/hash-router";

export default function Page() {
  return (
    <HashRouterProvider>
      <AppShell />
    </HashRouterProvider>
  );
}
