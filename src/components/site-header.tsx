"use client";

import { useState } from "react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { HashLink, useRoute } from "@/lib/hash-router";
import { roleLabels } from "@/lib/labels";
import { useAuthStore } from "@/store/auth";
import { cn } from "@/lib/utils";

export interface NavItem {
  path: string;
  label: string;
  icon: typeof Library;
  /** مسیرهای فرعی که این آیتم را فعال می‌کنند */
  match: (path: string) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/home", label: "خانه", icon: Home, match: (p) => p === "/home" || p === "/" },
  {
    path: "/library",
    label: "کتابخانه",
    icon: Library,
    match: (p) => p === "/library" || p.startsWith("/book/") || p.startsWith("/read/"),
  },
  { path: "/topics", label: "موضوعات", icon: Compass, match: (p) => p === "/topics" },
  {
    path: "/research",
    label: "پژوهش‌های من",
    icon: FolderOpen,
    match: (p) => p === "/research" || p.startsWith("/project/") || p === "/compare",
  },
  { path: "/settings", label: "تنظیمات", icon: Settings, match: (p) => p === "/settings" },
];

export const ADMIN_ITEM: NavItem = {
  path: "/admin",
  label: "مدیریت",
  icon: ShieldCheck,
  match: (p) => p === "/admin",
};

/* ---------- نوار بالای جست‌وجو و کاربر ---------- */

export function QuickSearch() {
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
        navigate("/search", { q: query, mode: "text", flex: "similar", scope: "library" });
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

export function UserMenu() {
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

export function MobileNavMenu({ items }: { items: NavItem[] }) {
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

export function TopBar({ navItems }: { navItems: NavItem[] }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-chrome/95 backdrop-blur supports-[backdrop-filter]:bg-chrome/85">
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

export function NavLinks({ items }: { items: NavItem[] }) {
  const { route } = useRoute();
  return (
    <nav
      aria-label="ناوبری اصلی"
      className="hidden border-b border-border bg-chrome md:block"
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

export interface SiteHeaderProps {
  navItems?: NavItem[];
  className?: string;
}

/**
 * هدر اصلی سایت شامل نوار جست‌وجو، منوی کاربر، آیکون‌ها و لینک‌های ناوبری
 */
export function SiteHeader({ navItems, className }: SiteHeaderProps) {
  const user = useAuthStore((s) => s.user);
  const items = navItems ?? (user?.role === "admin" ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS);

  return (
    <div className={cn("w-full bg-chrome shrink-0", className)}>
      <TopBar navItems={items} />
      <NavLinks items={items} />
    </div>
  );
}
