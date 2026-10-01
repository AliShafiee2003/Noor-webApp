"use client";

/**
 * اسکلت کل اپ — میزکار پژوهشی نور
 * - status=loading → اسکلت تمام‌صفحه
 * - مهمان → فقط صفحهٔ ورود/دعوت رندر می‌شود
 * - کاربر → نوار بالا + ناوبری (دسکتاپ) / منوی همبرگری راست‌بازشو (موبایل)
 */
import { useEffect, useState } from "react";
import {
  BookOpenText,
  Compass,
  FolderOpen,
  Home,
  Library,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { HashLink, setPendingDestination, useRoute, type RouteInfo } from "@/lib/hash-router";
import { roleLabels } from "@/lib/labels";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";
import { LoginView } from "@/views/login-view";
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

interface NavItem {
  path: string;
  label: string;
  icon: typeof Library;
  /** مسیرهای فرعی که این آیتم را فعال می‌کنند */
  match: (path: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/home", label: "خانه", icon: Home, match: (p) => p === "/home" || p === "/" },
  { path: "/library", label: "کتابخانه", icon: Library, match: (p) => p === "/library" || p.startsWith("/book/") },
  { path: "/topics", label: "موضوعات", icon: Compass, match: (p) => p === "/topics" },
  {
    path: "/research",
    label: "پژوهش‌های من",
    icon: FolderOpen,
    match: (p) => p === "/research" || p.startsWith("/project/") || p === "/compare",
  },
  { path: "/settings", label: "تنظیمات", icon: Settings, match: (p) => p === "/settings" },
];

const ADMIN_ITEM: NavItem = {
  path: "/admin",
  label: "مدیریت",
  icon: ShieldCheck,
  match: (p) => p === "/admin",
};

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
          <Button className="mt-2 min-h-11" onClick={() => navigate("/home")}>
            بازگشت به خانه
          </Button>
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
    case "read":
      return seg[1] ? <ReaderView documentUid={seg[1]} /> : <NotFoundView />;
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

/* ---------- نوار بالا ---------- */

function QuickSearch() {
  const { navigate } = useRoute();
  const [q, setQ] = useState("");

  return (
    <form
      role="search"
      className="relative hidden w-full max-w-md items-center sm:flex"
      onSubmit={(e) => {
        e.preventDefault();
        const query = q.trim();
        if (!query) return;
        navigate("/search", { q: query, mode: "normalized_phrase", scope: "library" });
      }}
    >
      <Search
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="min-h-11 pe-9"
        placeholder="جست‌وجو در منابع…"
        aria-label="جست‌وجوی سریع در منابع"
      />
    </form>
  );
}

function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { navigate } = useRoute();

  if (!user) return null;
  const initial = user.display_name.trim().charAt(0) || "؟";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="min-h-11 gap-2 px-2"
          aria-label={`منوی کاربر: ${user.display_name}`}
        >
          <span
            className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {initial}
          </span>
          <span className="hidden max-w-32 truncate text-sm md:inline">
            {user.display_name}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="truncate">{user.display_name}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {roleLabels[user.role] ?? user.role}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings className="size-4" aria-hidden="true" />
          تنظیمات
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            void logout().then(() => navigate("/login", undefined, { replace: true }));
          }}
        >
          <LogOut className="size-4" aria-hidden="true" />
          خروج از حساب
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TopBar({ navItems }: { navItems: NavItem[] }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <HashLink
          to="/home"
          className="flex min-h-11 items-center gap-2 text-start"
          aria-label="خانهٔ میزکار پژوهشی نور"
        >
          <BookOpenText className="size-6 text-primary" aria-hidden="true" />
          <span className="text-sm font-bold leading-6 md:text-base">
            میزکار پژوهشی نور
          </span>
        </HashLink>
        <div className="flex-1" />
        <QuickSearch />
        <UserMenu />
        <MobileNavMenu items={navItems} />
      </div>
    </header>
  );
}

function NavLinks({ items }: { items: NavItem[] }) {
  const { route } = useRoute();
  return (
    <nav
      aria-label="ناوبری اصلی"
      className="hidden border-b border-border bg-surface md:block"
    >
      <ul className="mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto px-4 py-1">
        {items.map((item) => {
          const active = item.match(route.path);
          return (
            <li key={item.path}>
              <HashLink
                to={item.path}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </HashLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ---------- منوی همبرگری موبایل — از راست باز می‌شود ---------- */

function MobileNavMenu({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const { route } = useRoute();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { navigate } = useRoute();

  const close = () => setOpen(false);
  const handleLogout = () => {
    close();
    void logout().then(() => navigate("/login", undefined, { replace: true }));
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="بازکردن منوی ناوبری"
          aria-expanded={open}
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        dir="rtl"
        className="flex w-80 max-w-[86vw] flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border px-5 pb-4 pt-5 text-start">
          <SheetTitle className="flex items-center gap-2 text-base">
            <BookOpenText className="size-5 text-primary" aria-hidden="true" />
            میزکار پژوهشی نور
          </SheetTitle>
          <SheetDescription className="text-xs">
            منوی ناوبری اصلی — برای رفتن به بخش‌ها انتخاب کنید.
          </SheetDescription>
        </SheetHeader>

        <nav aria-label="ناوبری منوی موبایل" className="flex-1 overflow-y-auto px-3 py-3">
          <ul className="space-y-1">
            {items.map((item) => {
              const active = item.match(route.path);
              return (
                <li key={item.path}>
                  <HashLink
                    to={item.path}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-accent"
                    }`}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden="true" />
                    {item.label}
                    {active ? (
                      <span className="ms-auto size-1.5 rounded-full bg-primary" aria-hidden="true" />
                    ) : null}
                  </HashLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {user ? (
          <div className="border-t border-border px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-3">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                aria-hidden="true"
              >
                {user.display_name.trim().charAt(0) || "؟"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.display_name}</p>
                <p className="text-xs text-muted-foreground">
                  {roleLabels[user.role] ?? user.role}
                </p>
              </div>
            </div>
            <Separator className="my-3" />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="min-h-11 flex-1 gap-2"
                onClick={() => {
                  close();
                  navigate("/settings");
                }}
              >
                <Settings className="size-4" aria-hidden="true" />
                تنظیمات
              </Button>
              <Button
                variant="outline"
                className="min-h-11 gap-2 text-destructive hover:text-destructive"
                onClick={handleLogout}
              >
                <LogOut className="size-4" aria-hidden="true" />
                خروج
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/* ---------- اسکلت بارگذاری ---------- */

function ShellSkeleton() {
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
  useEffect(() => {
    if (status === "guest" && route.path !== "/login" && route.path !== "/invite") {
      setPendingDestination(route.fullHash.slice(1));
    }
  }, [status, route.path, route.fullHash]);

  if (status === "loading") return <ShellSkeleton />;

  if (status === "guest") {
    if (route.path === "/invite") return <InviteView />;
    return <LoginView />;
  }

  if (status === "pending_mfa") {
    // نشست نیمهٔ ادمین — تکمیل ورود با کد دومرحله‌ای
    if (route.path === "/invite") return <InviteView />;
    return <LoginView />;
  }

  const navItems = user?.role === "admin" ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar navItems={navItems} />
      <NavLinks items={navItems} />
      <main className="flex-1 pb-8">
        <CurrentView route={route} />
      </main>
      {/* فوتر چسبان — با mt-auto در صفحات کوتاه به ته صفحه می‌چسبد؛ در موبایل هم نمایان */}
      <footer
        className="mt-auto border-t border-border bg-surface py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      >
        <p className="mx-auto w-full max-w-6xl px-4 text-center text-xs text-muted-foreground">
          میزکار پژوهشی نور · ابزار مطالعه و پژوهش در منابع — محتوای نمایشی
        </p>
      </footer>
    </div>
  );
}
