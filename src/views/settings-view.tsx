"use client";

/**
 * تنظیمات — خواندن (ترجیحات مطالعه با PUT /workspace/prefs)،
 * ظاهر (روشن/تیره با next-themes)، نشست‌های فعال، خروج.
 */
import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { LogOut, MonitorSmartphone, Moon, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api";
import { useRoute } from "@/lib/hash-router";
import { faDateTime } from "@/lib/format";
import type { SessionInfo } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";

/* ---------- بخش خواندن ---------- */

function PrefsSaveIndicator() {
  const saveState = useWorkspaceStore((s) => s.prefsSaveState);
  const updatePrefs = useWorkspaceStore((s) => s.updatePrefs);
  if (saveState === "idle") return null;
  if (saveState === "saving") {
    return (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        در حال ذخیرهٔ ترجیحات…
      </p>
    );
  }
  if (saveState === "saved") {
    return (
      <p className="text-xs text-ayah" aria-live="polite">
        ترجیحات ذخیره شد.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2" aria-live="assertive">
      <p className="text-xs text-destructive">ذخیرهٔ ترجیحات ناموفق بود.</p>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 md:min-h-9"
        onClick={() => updatePrefs({}, { persist: true })}
      >
        تلاش دوباره
      </Button>
    </div>
  );
}

function ReadingTab() {
  const prefs = useWorkspaceStore((s) => s.prefs);
  const updatePrefs = useWorkspaceStore((s) => s.updatePrefs);

  const previewStyle: React.CSSProperties = {
    fontSize: `${prefs.font_size}px`,
    lineHeight: prefs.line_height,
    fontFamily:
      prefs.font_family === "vazirmatn"
        ? "var(--font-ui)"
        : "var(--font-arabic)",
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ترجیحات مطالعه</CardTitle>
          <CardDescription>
            این تنظیمات روی متن مطالعه در همهٔ منابع اعمال می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="pref-font-size">اندازهٔ قلم متن مطالعه</Label>
              <span className="text-sm tabular-nums text-muted-foreground" dir="ltr">
                {prefs.font_size}px
              </span>
            </div>
            <Slider
              id="pref-font-size"
              value={[prefs.font_size]}
              min={16}
              max={32}
              step={1}
              aria-label="اندازهٔ قلم متن مطالعه"
              onValueChange={(v) => {
                const size = v[0];
                if (typeof size === "number") updatePrefs({ font_size: size });
              }}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="pref-line-height">فاصلهٔ سطرها</Label>
              <span className="text-sm tabular-nums text-muted-foreground" dir="ltr">
                {prefs.line_height.toFixed(1)}
              </span>
            </div>
            <Slider
              id="pref-line-height"
              value={[prefs.line_height]}
              min={1.4}
              max={2.4}
              step={0.1}
              aria-label="فاصلهٔ سطرها"
              onValueChange={(v) => {
                const lh = v[0];
                if (typeof lh === "number") updatePrefs({ line_height: lh });
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pref-font-family">قلم متن مطالعه</Label>
            <Select
              value={prefs.font_family}
              onValueChange={(v) => updatePrefs({ font_family: v })}
            >
              <SelectTrigger id="pref-font-family" className="min-h-11 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="amiri">امیری (متن عربی)</SelectItem>
                <SelectItem value="vazirmatn">وزیرمتن</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>حالت نمایش</Label>
            <RadioGroup
              value={prefs.display}
              onValueChange={(v) => updatePrefs({ display: v === "continuous" ? "continuous" : "paged" })}
              className="flex flex-wrap gap-4"
            >
              <div className="flex min-h-11 items-center gap-2">
                <RadioGroupItem value="paged" id="display-paged" />
                <Label htmlFor="display-paged" className="cursor-pointer font-normal">
                  صفحه‌محور
                </Label>
              </div>
              <div className="flex min-h-11 items-center gap-2">
                <RadioGroupItem value="continuous" id="display-continuous" />
                <Label htmlFor="display-continuous" className="cursor-pointer font-normal">
                  پیوسته
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="rounded-xl border border-border bg-reader p-5">
            <p
              lang="ar"
              dir="rtl"
              style={previewStyle}
              className="text-foreground"
            >
              إنّما الْعِلْمُ نُورٌ يَهْدِي بِهِ اللَّهُ مَنْ يَشَاءُ؛ وَالْعِلْمُ
              مِفْتَاحُ الْفَهْمِ.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              پیش‌نمایش متن مطالعه
            </p>
          </div>

          <PrefsSaveIndicator />
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- بخش ظاهر ---------- */

const subscribeNoop = () => () => {};

function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  // بدون effect/setState: پس از hydration مقدار سمت کلاینت true می‌شود.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">ظاهر میزکار</CardTitle>
        <CardDescription>حالت نمایش رابط را برگزینید.</CardDescription>
      </CardHeader>
      <CardContent>
        {!mounted ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : (
          <RadioGroup
            value={theme ?? "system"}
            onValueChange={setTheme}
            className="grid gap-3 sm:grid-cols-3"
          >
            {(
              [
                { value: "light", label: "روشن", icon: Sun },
                { value: "dark", label: "تیره", icon: Moon },
                { value: "system", label: "هماهنگ با سامانه", icon: MonitorSmartphone },
              ] as const
            ).map((option) => (
              <Label
                key={option.value}
                htmlFor={`theme-${option.value}`}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border p-4 font-normal transition-colors hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem value={option.value} id={`theme-${option.value}`} />
                <option.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                {option.label}
              </Label>
            ))}
          </RadioGroup>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- بخش نشست‌ها ---------- */

function SessionsTab() {
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const { navigate } = useRoute();

  const sessionsQuery = useQuery<SessionInfo[]>({
    queryKey: ["auth-sessions"],
    queryFn: () => api.get<SessionInfo[]>("/auth/sessions"),
  });

  const revokeMutation = useMutation({
    mutationFn: (uid: string) => api.del(`/auth/sessions/${encodeURIComponent(uid)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    },
  });

  const handleLogout = async () => {
    await logout();
    navigate("/login", undefined, { replace: true });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">نشست‌های فعال</CardTitle>
          <CardDescription>
            دستگاه‌هایی که هم‌اکنون با حساب شما وارد شده‌اند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessionsQuery.isLoading ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <span className="sr-only">در حال بارگیری نشست‌ها…</span>
            </div>
          ) : sessionsQuery.isError ? (
            <ErrorState
              message={errorMessage(sessionsQuery.error, "بارگیری نشست‌ها ناموفق بود.")}
              onRetry={() => void sessionsQuery.refetch()}
            />
          ) : (sessionsQuery.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              نشستی یافت نشد.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {(sessionsQuery.data ?? []).map((session) => (
                <li key={session.uid} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {session.current ? "این دستگاه" : "دستگاه دیگر"}
                      </span>
                      {session.current ? (
                        <Badge variant="secondary" className="font-normal">
                          نشست فعلی
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={session.user_agent ?? undefined}>
                      {session.user_agent ?? "مرورگر ناشناس"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {session.ip ? (
                        <>
                          نشانی:{" "}
                          <span className="bidi-ltr inline-block">{session.ip}</span> ·{" "}
                        </>
                      ) : null}
                      آخرین فعالیت: {faDateTime(session.last_seen)}
                    </p>
                  </div>
                  {!session.current ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 shrink-0 md:min-h-9"
                      disabled={revokeMutation.isPending}
                      onClick={() => revokeMutation.mutate(session.uid)}
                    >
                      لغو نشست
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {revokeMutation.isError ? (
            <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {errorMessage(revokeMutation.error, "لغو نشست ناموفق بود؛ دوباره تلاش کنید.")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">خروج از حساب</CardTitle>
          <CardDescription>پس از خروج، برای دسترسی دوباره باید وارد شوید.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" className="min-h-11 gap-2" onClick={() => void handleLogout()}>
            <LogOut className="size-4" aria-hidden="true" />
            خروج از حساب
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- صفحهٔ تنظیمات ---------- */

export function SettingsView() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold">تنظیمات</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ترجیحات مطالعه، ظاهر میزکار و نشست‌های شما.
        </p>
      </header>

      <Tabs defaultValue="reading" dir="rtl">
        <TabsList className="mb-4 flex h-auto w-full flex-wrap gap-1">
          <TabsTrigger value="reading" className="min-h-11 flex-1 md:min-h-9">
            خواندن
          </TabsTrigger>
          <TabsTrigger value="appearance" className="min-h-11 flex-1 md:min-h-9">
            ظاهر
          </TabsTrigger>
          <TabsTrigger value="sessions" className="min-h-11 flex-1 md:min-h-9">
            نشست‌ها
          </TabsTrigger>
        </TabsList>
        <TabsContent value="reading">
          <ReadingTab />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>
        <TabsContent value="sessions">
          <SessionsTab />
        </TabsContent>
      </Tabs>
      <Separator className="mt-8" />
    </div>
  );
}
