"use client";

/**
 * تنظیمات — خواندن (ترجیحات مطالعه با PUT /workspace/prefs)،
 * ظاهر (روشن/تیره با next-themes)، اشتراک‌های فعال و خروجی‌های PDF (§۷-الف)،
 * نشست‌های فعال، خروج.
 */
import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Highlighter,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Moon,
  Share2,
  Sun,
  TriangleAlert,
} from "lucide-react";
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
import {
  LATIN_FONT_OPTIONS,
  PROSE_FONT_OPTIONS,
  QURAN_FONT_OPTIONS,
  QURAN_FONT_SIZE_DEFAULT,
  QURAN_LINE_HEIGHT_DEFAULT,
} from "@/lib/fonts";
import {
  palettesForMode,
  setPalette,
  usePalette,
  type PaletteMode,
} from "@/lib/palette";
import { useRoute } from "@/lib/hash-router";
import { faDateTime, faNum } from "@/lib/format";
import type { PdfJob, SessionInfo, ShareLinkInfo } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";
import { useToast } from "@/hooks/use-toast";

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

  const quranSize = prefs.quran_font_size ?? QURAN_FONT_SIZE_DEFAULT;
  const quranLh = prefs.quran_line_height ?? QURAN_LINE_HEIGHT_DEFAULT;

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
            <Label htmlFor="pref-font-prose">قلم نثر عربی (متن و پاورقی)</Label>
            <Select
              value={prefs.font_family}
              onValueChange={(v) => updatePrefs({ font_family: v })}
            >
              <SelectTrigger id="pref-font-prose" className="min-h-11 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROSE_FONT_OPTIONS.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {PROSE_FONT_OPTIONS.find((o) => o.id === prefs.font_family)?.note ??
                "نسخ کلاسیک، مناسب اعراب‌گذاری متن حدیث"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pref-font-quran">قلم متن قرآنی (تگ‌های آیه)</Label>
            <Select
              value={prefs.font_quran ?? "amiri-quran"}
              onValueChange={(v) => updatePrefs({ font_quran: v })}
            >
              <SelectTrigger id="pref-font-quran" className="min-h-11 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QURAN_FONT_OPTIONS.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {
                QURAN_FONT_OPTIONS.find((o) => o.id === (prefs.font_quran ?? "amiri-quran"))
                  ?.note
              }
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pref-font-latin">قلم متون انگلیسی/لاتین</Label>
            <Select
              value={prefs.font_latin ?? "source-serif"}
              onValueChange={(v) => updatePrefs({ font_latin: v })}
            >
              <SelectTrigger id="pref-font-latin" className="min-h-11 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LATIN_FONT_OPTIONS.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              بلوک‌های انگلیسی به‌طور خودکار شناسایی و با همین قلم چپ‌به‌راست نمایش داده می‌شوند؛
              در متن آمیختهٔ عربی/لاتین نیز ران‌های لاتین با همین قلم می‌آیند.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="pref-quran-size">اندازهٔ متن قرآنی</Label>
              <span className="text-sm tabular-nums text-muted-foreground" dir="ltr">
                {quranSize}px
              </span>
            </div>
            <Slider
              id="pref-quran-size"
              value={[quranSize]}
              min={18}
              max={34}
              step={1}
              aria-label="اندازهٔ متن قرآنی"
              onValueChange={(v) => {
                const size = v[0];
                if (typeof size === "number") updatePrefs({ quran_font_size: size });
              }}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="pref-quran-lh">فاصلهٔ سطر متن قرآنی</Label>
              <span className="text-sm tabular-nums text-muted-foreground" dir="ltr">
                {quranLh.toFixed(1)}
              </span>
            </div>
            <Slider
              id="pref-quran-lh"
              value={[quranLh]}
              min={1.6}
              max={2.8}
              step={0.1}
              aria-label="فاصلهٔ سطر متن قرآنی"
              onValueChange={(v) => {
                const lh = v[0];
                if (typeof lh === "number") updatePrefs({ quran_line_height: lh });
              }}
            />
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

          <div className="space-y-3 rounded-xl border border-border bg-reader p-5">
            <p
              lang="ar"
              dir="rtl"
              style={{
                fontSize: `${prefs.font_size}px`,
                lineHeight: prefs.line_height,
                fontFamily: "var(--font-arabic)",
              }}
              className="text-foreground"
            >
              إنّما الْعِلْمُ نُورٌ يَهْدِي بِهِ اللَّهُ مَنْ يَشَاءُ؛ وَالْعِلْمُ
              مِفْتَاحُ الْفَهْمِ.
            </p>
            <p className="text-xs text-muted-foreground">
              پیش‌نمایش نثر عربی — قلم: {PROSE_FONT_OPTIONS.find((o) => o.id === prefs.font_family)?.label ?? "امیری"}
            </p>
            <Separator />
            <blockquote
              lang="ar"
              dir="rtl"
              style={{
                fontSize: `${quranSize}px`,
                lineHeight: quranLh,
                fontFamily: "var(--font-quran)",
              }}
              className="text-foreground"
            >
              إِنَّمَا يَعْمُرُ مَسَاجِدَ اللّهِ مَنْ آمَنَ بِاللّهِ وَالْيَوْمِ الآخِرِ
              وَأَقَامَ الصَّلاةَ وَآتَى الزَّكَاةَ وَلَمْ يَخْشَ إِلاَّ اللّهَ
            </blockquote>
            <p className="text-xs text-muted-foreground">
              پیش‌نمایش متن قرآنی — قلم: {QURAN_FONT_OPTIONS.find((o) => o.id === (prefs.font_quran ?? "amiri-quran"))?.label ?? "امیری قرآن"} · {quranSize}px / {quranLh.toFixed(1)}
            </p>
            <Separator />
            <p
              lang="en"
              dir="ltr"
              style={{ fontFamily: "var(--font-latin)" }}
              className="text-start text-[15px] leading-7 text-foreground"
            >
              Knowledge is a light through which Allah guides whom He wills.
            </p>
            <p className="text-xs text-muted-foreground">
              پیش‌نمایش متن لاتین — قلم: {LATIN_FONT_OPTIONS.find((o) => o.id === (prefs.font_latin ?? "source-serif"))?.label ?? "Source Serif"}
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
        <PalettePicker />
      </CardContent>
    </Card>
  );
}

/** انتخاب قالب رنگی (لایهٔ سوم تم) — به‌تفکیک حالت روشن/تیره */
function PalettePicker() {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const active = usePalette();

  if (!mounted) {
    return <Skeleton className="mt-6 h-32 w-full rounded-lg" />;
  }

  const mode: PaletteMode = resolvedTheme === "dark" ? "dark" : "light";
  const palettes = palettesForMode(resolvedTheme);

  return (
    <div className="mt-6 space-y-3 border-t border-border pt-6">
      <div>
        <p className="text-sm font-medium leading-none">قالب رنگی میزکار</p>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          پوستهٔ کامل حالت {mode === "dark" ? "تیره" : "روشن"}؛ هر قالب همهٔ رنگ‌های
          رابط را هماهنگ تنظیم می‌کند و انتخاب برای هر حالت جداگانه نگه داشته می‌شود.
        </p>
      </div>
      <RadioGroup
        dir="rtl"
        value={palettes.some((p) => p.id === active) ? active : "default"}
        onValueChange={(id) => setPalette(id, mode)}
        className="grid gap-3 sm:grid-cols-2"
      >
        {palettes.map((palette) => (
          <Label
            key={palette.id}
            htmlFor={`palette-${palette.id}`}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border p-4 font-normal transition-colors hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
          >
            <RadioGroupItem value={palette.id} id={`palette-${palette.id}`} />
            <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
              {palette.swatch.map((color) => (
                <span
                  key={color}
                  className="inline-block size-5 rounded-full border border-border/60 shadow-sm"
                  style={{ backgroundColor: color }}
                />
              ))}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{palette.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {palette.note}
              </span>
            </span>
          </Label>
        ))}
      </RadioGroup>
    </div>
  );
}

/* ---------- بخش نشست‌ها ---------- */

function SessionsTab() {
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const { navigate } = useRoute();

  const sessionsQuery = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: async (): Promise<SessionInfo[]> => {
      const raw = await api.get<unknown>("/auth/sessions");
      /* API فهرست را داخل {items:[…]} می‌پیچد؛ هر دو شکل (آرایه/پوشش) پذیرفته می‌شود */
      if (Array.isArray(raw)) return raw as SessionInfo[];
      if (raw && typeof raw === "object") {
        const items = (raw as { items?: unknown }).items;
        if (Array.isArray(items)) return items as SessionInfo[];
      }
      return [];
    },
  });

  const sessions = Array.isArray(sessionsQuery.data) ? sessionsQuery.data : [];
  /* بک‌اند فعلاً پرچم current نمی‌فرستد (بازسازی Go در سندباکس ممکن نیست):
     آخرین نشست از نظر last_seen به‌عنوان نشست فعلی نشان داده می‌شود — تا زمانی که
     بک‌اند بر اساس کوکی نشست، current را علامت بزند. */
  const newestLastSeen = sessions.reduce<string | null>(
    (acc, s) => (!acc || (s.last_seen ?? "") > acc ? (s.last_seen ?? "") : acc),
    null,
  );
  const isCurrentSession = (s: SessionInfo): boolean =>
    s.current === true || (!!s.last_seen && s.last_seen === newestLastSeen);

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
          ) : sessions.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              نشستی یافت نشد.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {sessions.map((session) => (
                <li key={session.uid} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {isCurrentSession(session) ? "این دستگاه" : "دستگاه دیگر"}
                      </span>
                      {isCurrentSession(session) ? (
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
                  {!isCurrentSession(session) ? (
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

/* ---------- §۷-الف: اشتراک‌های فعال + خروجی‌های PDF من ---------- */

const ACTIVE_JOB_STATES = new Set(["queued", "running"]);

function PdfJobStatusChip({ job }: { job: PdfJob }) {
  const map: Record<PdfJob["status"], { label: string; className: string }> = {
    queued: { label: "در صف", className: "border-border bg-muted text-muted-foreground" },
    running: { label: "در حال ساخت", className: "border-primary/40 bg-primary/10 text-primary" },
    done: { label: "آمادهٔ دانلود", className: "border-ayah/40 bg-ayah-soft text-ayah" },
    failed: { label: "ناموفق", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  };
  const s = map[job.status] ?? map.queued;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}

function PdfJobsCard() {
  const { toast } = useToast();
  const jobsQuery = useQuery({
    queryKey: ["pdf-jobs"],
    queryFn: () => api.get<{ items: PdfJob[] }>("/pdf-jobs"),
    refetchInterval: (q) =>
      (q.state.data?.items ?? []).some((j) => ACTIVE_JOB_STATES.has(j.status)) ? 2000 : false,
    retry: false,
  });
  const jobs = jobsQuery.data?.items ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileDown className="size-4 text-primary" aria-hidden="true" />
          خروجی‌های PDF من
        </CardTitle>
        <CardDescription>
          PDFها از متن واقعی همان نسخه ساخته می‌شوند؛ فایل فقط مال شماست و لینک دانلود پس از ۲۴ ساعت منقضی می‌شود.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobsQuery.isPending ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <span className="sr-only">در حال بارگیری خروجی‌ها…</span>
          </div>
        ) : jobsQuery.isError ? (
          <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {errorMessage(jobsQuery.error, "فهرست خروجی‌ها در دسترس نیست.")}
            </p>
            <Button variant="outline" size="sm" className="min-h-9 gap-1.5" onClick={() => void jobsQuery.refetch()}>
              تلاش دوباره
            </Button>
          </div>
        ) : jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs leading-6 text-muted-foreground">
            هنوز خروجی‌ای نگرفته‌اید. در کتاب‌خوان، دکمهٔ «خروجی PDF» را بزنید تا از کل جلد یا بازه‌ای از صفحه‌ها PDF بسازید.
          </p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto pe-0.5">
            {jobs.map((job) => (
              <li
                key={job.uid}
                className="rounded-xl border border-border bg-surface p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {job.work_title ? `${job.work_title} — ` : ""}{job.document_label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {job.params?.whole
                        ? "کل جلد"
                        : job.params?.from || job.params?.to
                          ? `صفحه‌های ${faNum(job.params.from ?? "؟")} تا ${faNum(job.params.to ?? "؟")}`
                          : "کل جلد"}
                      {job.params?.include_notes ? " · با یادداشت‌ها و هایلایت‌های من" : ""}
                      {job.created_at ? ` · ${faDateTime(job.created_at)}` : ""}
                    </p>
                  </div>
                  <PdfJobStatusChip job={job} />
                </div>
                {job.status === "running" || job.status === "queued" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(4, job.progress))}%` }}
                      />
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{faNum(job.progress)}٪</span>
                  </div>
                ) : null}
                {job.status === "failed" && job.status_note ? (
                  <p role="alert" className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                    {job.status_note}
                  </p>
                ) : null}
                {job.status === "done" && job.download_url ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {job.file_bytes ? `${faNum((job.file_bytes / 1024 / 1024).toFixed(1))} مگابایت · ` : ""}
                      {job.token_expires_at ? `اعتبار لینک تا ${faDateTime(job.token_expires_at)}` : ""}
                    </span>
                    <a
                      href={job.download_url}
                      download
                      onClick={() =>
                        toast({ title: "دانلود آغاز شد", description: "فایل فقط برای حساب شماست؛ آن را با همکاران خود به اشتراک نگذارید." })
                      }
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                      دانلود PDF
                    </a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SharesCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sharesQuery = useQuery({
    queryKey: ["shares"],
    queryFn: () => api.get<{ items: ShareLinkInfo[] }>("/shares"),
    retry: false,
  });
  const revokeMutation = useMutation({
    mutationFn: (uid: string) => api.del(`/shares/${uid}`),
    onSuccess: () => {
      toast({ title: "اشتراک لغو شد", description: "لینک قبلی از این لحظه برای همکاران کار نمی‌کند." });
      void queryClient.invalidateQueries({ queryKey: ["shares"] });
    },
    onError: (err) => {
      toast({ title: "لغو اشتراک ناموفق بود", description: errorMessage(err), variant: "destructive" });
    },
  });
  const shares = sharesQuery.data?.items ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Share2 className="size-4 text-primary" aria-hidden="true" />
          اشتراک‌های فعال
        </CardTitle>
        <CardDescription>
          لینک‌های اشتراکی فقط برای کاربران واردشدهٔ همین سامانه کار می‌کنند و پیش‌فرض خصوصی می‌مانند؛ هر لینک را می‌توانید لغو کنید.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sharesQuery.isPending ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <span className="sr-only">در حال بارگیری اشتراک‌ها…</span>
          </div>
        ) : sharesQuery.isError ? (
          <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {errorMessage(sharesQuery.error, "فهرست اشتراک‌ها در دسترس نیست.")}
            </p>
            <Button variant="outline" size="sm" className="min-h-9 gap-1.5" onClick={() => void sharesQuery.refetch()}>
              تلاش دوباره
            </Button>
          </div>
        ) : shares.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs leading-6 text-muted-foreground">
            اشتراک فعالی ندارید. در کتاب‌خوان، از پنل یادداشت‌ها می‌توانید یادداشت یا هایلایت خود را با لینک مستقیم به اشتراک بگذارید.
          </p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto pe-0.5">
            {shares.map((s) => (
              <li key={s.uid} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {s.kind === "note" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                          <FileText className="size-3" aria-hidden="true" />
                          یادداشت
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ayah-soft px-2 py-0.5 text-[10px] text-ayah">
                          <Highlighter className="size-3" aria-hidden="true" />
                          هایلایت
                        </span>
                      )}
                      {s.work_title ? s.work_title : ""}
                      {s.page_label && s.page_label !== "—" ? `، صفحهٔ ${faNum(s.page_label)}` : ""}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{s.excerpt}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      ساخته‌شده: {s.created_at ? faDateTime(s.created_at) : "—"}
                      {s.expires_at ? ` · اعتبار تا ${faDateTime(s.expires_at)}` : " · بدون انقضا"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-9 gap-1"
                      onClick={() => {
                        window.location.hash = s.url_path.startsWith("#") ? s.url_path.slice(1) : s.url_path;
                      }}
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      بازکردن
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-9 gap-1 text-destructive hover:text-destructive"
                      disabled={revokeMutation.isPending}
                      onClick={() => revokeMutation.mutate(s.uid)}
                    >
                      {revokeMutation.isPending && revokeMutation.variables === s.uid ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : null}
                      لغو
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ExportsSharesTab() {
  return (
    <div className="space-y-4">
      <SharesCard />
      <PdfJobsCard />
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
          ترجیحات مطالعه، ظاهر میزکار، اشتراک‌ها و خروجی‌های شما.
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
          <TabsTrigger value="exports" className="min-h-11 flex-1 md:min-h-9">
            اشتراک و خروجی
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
        <TabsContent value="exports">
          <ExportsSharesTab />
        </TabsContent>
        <TabsContent value="sessions">
          <SessionsTab />
        </TabsContent>
      </Tabs>
      <Separator className="mt-8" />
    </div>
  );
}
