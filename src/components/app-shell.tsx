"use client";

/**
 * اسکلت کل اپ — میزکار پژوهشی نور
 * - status=loading → اسکلت تمام‌صفحه
 * - مهمان → فقط صفحهٔ ورود/دعوت رندر می‌شود
 * - کاربر → نوار بالا + ناوبری (دسکتاپ) / منوی همبرگری راست‌بازشو (موبایل)
 */
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import { setPendingDestination, useRoute, type RouteInfo } from "@/lib/hash-router";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";
import { SiteHeader, NAV_ITEMS, ADMIN_ITEM } from "@/components/site-header";
import { LoginView } from "@/views/login-view";
import { RecoveryView } from "@/views/recovery-view";
import { InviteView } from "@/views/invite-view";
import { HomeView } from "@/views/home-view";
import { LibraryView } from "@/views/library-view";
import { WorkView } from "@/views/work-view";
import { SettingsView } from "@/views/settings-view";
import { SearchView } from "@/views/search-view";
import { ReaderView } from "@/views/reader-view";
import { TopicsView } from "@/views/topics-view";
import { ResearchView } from "@/views/research-view";
import { ProjectView } from "@/views/project-view";
import { CompareView } from "@/views/compare-view";
import { AdminView } from "@/views/admin-view";

/* ---------- رندر مسیر فعلی ---------- */

function NotFoundView() {
  const { navigate } = useRoute();
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <h1 className="text-lg font-semibold">این نشانی در میزکار یافت نشد</h1>
          <p className="text-sm text-muted-foreground">
            ممکن است نشانی تغییر کرده باشد؛ از «خانه» دوباره شروع کنید.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => navigate("/home")}>بازگشت به خانه</Button>
            <Button variant="outline" onClick={() => window.history.back()}>بازگشت به صفحهٔ قبل</Button>
            <Button variant="ghost" onClick={() => navigate("/search")}>جست‌وجوی منبع</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CurrentView({ route }: { route: RouteInfo }) {
  const seg = route.segments;
  const head = seg[0] ?? "home";
  switch (head) {
    case "home":
    case "login":
      return <HomeView />;
    case "search":
      return <SearchView />;
    case "library":
      return <LibraryView />;
    case "book":
      return seg[1] ? <WorkView uid={seg[1]} /> : <NotFoundView />;
    case "read": {
      /* دور ۱۸-فیکس ۷: قالب تازه #/read/{نام-کتاب}/{d-uid} و قالب قدیمی
         #/read/{d-uid} — uid همیشه سگمنتی است که با «d-» آغاز می‌شود؛
         سگمنت فارسی (slug) صرفاً نمایشی است و نباید اعتبارسنجی شود. */
      const uidArg = seg[1]?.startsWith("d-")
        ? seg[1]
        : seg[2]?.startsWith("d-")
          ? seg[2]
          : null;
      return uidArg ? <ReaderView documentUid={uidArg} /> : <NotFoundView />;
    }
    case "topics":
      return <TopicsView />;
    case "research":
      return <ResearchView />;
    case "project":
      return seg[1] ? <ProjectView uid={seg[1]} /> : <NotFoundView />;
    case "compare":
      return <CompareView />;
    case "settings":
      return <SettingsView />;
    case "admin":
      return <AdminView />;
    case "invite":
      return <InviteView />;
    default:
      return <NotFoundView />;
  }
}

/* ---------- اسکلت بارگذاری ---------- */

function ShellSkeleton({ isReader }: { isReader?: boolean }) {
  if (isReader) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background" aria-busy="true" aria-live="polite">
        <div className="border-b border-border bg-surface">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="h-5 w-40" />
            <div className="flex-1" />
            <Skeleton className="h-10 w-48 rounded-lg" />
            <Skeleton className="size-9 rounded-full" />
          </div>
        </div>
        <div className="flex h-12 items-center justify-between border-b border-border bg-surface px-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
          </div>
        </div>
        <div className="flex flex-1 min-h-0">
          <aside className="hidden w-72 border-e border-border p-3 lg:block xl:w-80">
            <Skeleton className="h-5 w-32 mb-4" />
            <div className="space-y-2.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </aside>
          <div className="flex-1 overflow-hidden bg-reader p-6 md:p-8">
            <div className="mx-auto max-w-[760px] space-y-4">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          </div>
        </div>
        <span className="sr-only">در حال بارگذاری کتاب‌خوان…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" aria-busy="true" aria-live="polite">
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-5 w-40" />
          <div className="flex-1" />
          <Skeleton className="h-10 w-48 rounded-lg" />
          <Skeleton className="size-9 rounded-full" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <span className="sr-only">در حال بارگذاری میزکار…</span>
      </div>
    </div>
  );
}

/* ---------- پوستهٔ اصلی ---------- */

export function AppShell() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const fetchSession = useAuthStore((s) => s.fetchSession);
  const fetchWorkspace = useWorkspaceStore((s) => s.fetchWorkspace);
  const { route } = useRoute();

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    if (status === "authenticated") {
      void fetchWorkspace();
    }
  }, [status, fetchWorkspace]);

  // مقصدِ پس از ورود: هر مسیر غیر-login/invite که مهمان روی آن است حفظ می‌شود (فقط حافظه)
  // فاز ۲: fullHash = نشانی کامل (path+query) — عیناً قابل فراخوانی navigate است.
  useEffect(() => {
    if (status === "guest" && route.path !== "/login" && route.path !== "/invite" && route.path !== "/recovery") {
      setPendingDestination(route.fullHash);
    }
  }, [status, route.path, route.fullHash]);

  const isReader = route.path.startsWith("/read");

  if (route.path === "/recovery")
    return (
      <RouteErrorBoundary routeKey={route.fullHash}>
        <RecoveryView />
      </RouteErrorBoundary>
    );

  if (status === "loading") return <ShellSkeleton isReader={isReader} />;

  if (status === "guest") {
    if (route.path === "/invite")
      return (
        <RouteErrorBoundary routeKey={route.fullHash}>
          <InviteView />
        </RouteErrorBoundary>
      );
    return (
      <RouteErrorBoundary routeKey={route.fullHash}>
        <LoginView />
      </RouteErrorBoundary>
    );
  }

  if (status === "pending_mfa") {
    // نشست نیمهٔ ادمین — تکمیل ورود با کد دومرحله‌ای
    if (route.path === "/invite")
      return (
        <RouteErrorBoundary routeKey={route.fullHash}>
          <InviteView />
        </RouteErrorBoundary>
      );
    return (
      <RouteErrorBoundary routeKey={route.fullHash}>
        <LoginView />
      </RouteErrorBoundary>
    );
  }

  const navItems = user?.role === "admin" ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;

  /* کتاب‌خوان تمام‌صفحه — کنترل هدر و نوار ابزار داخل خود کتاب‌خوان با وضعیت سنجاق انجام می‌شود */
  if (isReader) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background">
        <main className="h-full w-full overflow-hidden">
          <RouteErrorBoundary routeKey={route.fullHash}>
            <CurrentView route={route} />
          </RouteErrorBoundary>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader navItems={navItems} />
      <main className="flex-1 pb-8">
        <RouteErrorBoundary routeKey={route.fullHash}>
          <CurrentView route={route} />
        </RouteErrorBoundary>
      </main>
    </div>
  );
}
