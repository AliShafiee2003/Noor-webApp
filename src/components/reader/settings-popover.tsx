"use client";

/**
 * تنظیمات خواندن (READ-07 / READ-10):
 * اندازهٔ قلم ۱۲–۳۶، فاصلهٔ سطر ۱.۲–۲.۴، فونت نثر و مطالعه (مشترک با موبایل)، عرض متن،
 * حالت صفحه‌محور/پیوسته، پالت رنگ سایت و حالت روشن/تیره.
 * تغییرات فقط استایل را عوض می‌کنند و موضع مطالعه حفظ می‌شود (بدون پرش).
 * ذخیره: workspace store + PUT /workspace/prefs (debounce در store).
 */
import { useState } from "react";
import { useReaderFullscreen } from "@/lib/reader/use-reader-fullscreen";
import {
  BookText,
  Check,
  RotateCcw,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ReadingModeControl } from "@/components/design-system/reading-mode-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { useWorkspaceStore } from "@/store/workspace";
import {
  PROSE_FONT_OPTIONS,
  QURAN_FONT_OPTIONS,
  QURAN_FONT_SIZE_DEFAULT,
  QURAN_LINE_HEIGHT_DEFAULT,
  arabicStackFor,
  normalizeProseFont,
} from "@/lib/fonts";
import { useReaderTheme } from "@/lib/reader/use-reader-theme";
import type { ReaderTextWidth } from "@/lib/types";

const WIDTH_LABELS: Record<ReaderTextWidth, string> = {
  narrow: "باریک",
  medium: "متوسط",
  wide: "پهن",
};

const WIDTH_MAX_PX: Record<ReaderTextWidth, number> = {
  narrow: 760,
  medium: 920,
  wide: 1120,
};

export function readerTextWidthPx(
  width: ReaderTextWidth | undefined | null,
): number {
  return WIDTH_MAX_PX[width ?? "medium"] ?? 760;
}

function SegButton({
  pressed,
  onClick,
  children,
  label,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className={`min-h-11 flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors md:min-h-9 ${
        pressed
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-surface text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function SaveStateLine() {
  const state = useWorkspaceStore((s) => s.prefsSaveState);
  const updatePrefs = useWorkspaceStore((s) => s.updatePrefs);
  if (state === "idle") return null;
  if (state === "saving") {
    return (
      <p className="text-[11px] text-muted-foreground" aria-live="polite">
        در حال ذخیرهٔ ترجیحات…
      </p>
    );
  }
  if (state === "saved") {
    return (
      <p className="flex items-center gap-1 text-[11px] text-ayah" aria-live="polite">
        <Check className="size-3" aria-hidden="true" />
        ترجیحات ذخیره شد.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2" aria-live="assertive">
      <p className="text-[11px] text-destructive">ذخیرهٔ ترجیحات ناموفق بود.</p>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 md:min-h-7"
        onClick={() => updatePrefs({}, { persist: true })}
      >
        <RotateCcw className="size-3" aria-hidden="true" />
        تلاش دوباره
      </Button>
    </div>
  );
}

export function SettingsPopover({
  trigger,
}: {
  /** دکمهٔ مشتری برای بازکردن پاپ‌آور */
  trigger: React.ReactNode;
}) {
  const prefs = useWorkspaceStore((s) => s.prefs);
  const updatePrefs = useWorkspaceStore((s) => s.updatePrefs);
  const readerTheme = useReaderTheme();
  const fullscreen = useReaderFullscreen();
  const [fullscreenError, setFullscreenError] = useState(false);

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        style={{ boxShadow: "0 18px 50px -12px rgb(var(--shadow-color) / 0.28)" }}
        className="max-h-[80vh] w-80 max-w-[calc(100vw-2rem)] space-y-4 overflow-y-auto rounded-2xl border-border/70 p-4 data-[state=open]:animate-none data-[state=closed]:animate-none"
      >
        <div className="flex items-center gap-2">
          <Type className="size-4 text-primary" aria-hidden="true" />
          <p className="text-sm font-semibold">تنظیمات خواندن</p>
        </div>

        <div className="space-y-2">
          <Label>نحوهٔ نمایش</Label>
          <ReadingModeControl value={prefs.display} onValueChange={(display) => updatePrefs({ display })} />
        </div>

        {/* اندازهٔ قلم */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="reader-font-size">اندازهٔ قلم</Label>
            <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {prefs.font_size}px
            </span>
          </div>
          <Slider
            id="reader-font-size"
            value={[prefs.font_size]}
            min={12}
            max={36}
            step={1}
            aria-label="اندازهٔ قلم متن مطالعه"
            onValueChange={(v) => {
              const size = v[0];
              if (typeof size === "number") updatePrefs({ font_size: size });
            }}
          />
        </div>

        {/* فاصلهٔ سطر */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="reader-line-height">فاصلهٔ سطرها</Label>
            <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {prefs.line_height.toFixed(1)}
            </span>
          </div>
          <Slider
            id="reader-line-height"
            value={[prefs.line_height]}
            min={1.2}
            max={2.4}
            step={0.1}
            aria-label="فاصلهٔ سطرهای متن مطالعه"
            onValueChange={(v) => {
              const lh = v[0];
              if (typeof lh === "number") updatePrefs({ line_height: lh });
            }}
          />
        </div>

        {/* رنگ‌بندی نقش‌های معنایی — READ-13 (اختیاری) */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div className="min-w-0">
            <Label htmlFor="reader-semantic" className="cursor-pointer text-sm">
              نشانه‌گذاری نقش‌های معنایی
            </Label>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              رنگ و نشان برای سند، آیه، بیان مؤلف و راوی — فقط نمایش؛ متن تغییر نمی‌کند.
            </p>
          </div>
          <Switch
            id="reader-semantic"
            checked={prefs.semantic_colors === true}
            onCheckedChange={(checked) => updatePrefs({ semantic_colors: checked })}
          />
        </div>

        {/* فونت نثر عربی */}
        <div className="space-y-2">
          <Label>قلم نثر و مطالعه</Label>
          <Select value={normalizeProseFont(prefs.font_family)} onValueChange={(font_family) => updatePrefs({ font_family })}>
            <SelectTrigger className="w-full" aria-label="قلم نثر عربی"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROSE_FONT_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}><span style={{ fontFamily: arabicStackFor(o.id) }}>{o.label}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* قلم قرآنی + اندازهٔ متن قرآنی — تخصیص بر اساس نقش تگ آیه */}
        <div className="space-y-2">
          <Label>قلم متن قرآنی</Label>
          <Select
            value={prefs.font_quran ?? "amiri-quran"}
            onValueChange={(font_quran) => updatePrefs({ font_quran: font_quran as typeof prefs.font_quran })}
          >
            <SelectTrigger className="w-full" aria-label="قلم متن قرآنی">
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
          <div className="flex items-center justify-between pt-1">
            <Label htmlFor="reader-quran-size" className="text-xs text-muted-foreground">
              اندازهٔ متن قرآنی
            </Label>
            <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {prefs.quran_font_size ?? QURAN_FONT_SIZE_DEFAULT}px
            </span>
          </div>
          <Slider
            id="reader-quran-size"
            value={[prefs.quran_font_size ?? QURAN_FONT_SIZE_DEFAULT]}
            min={18}
            max={34}
            step={1}
            aria-label="اندازهٔ متن قرآنی"
            onValueChange={(v) => {
              const size = v[0];
              if (typeof size === "number") updatePrefs({ quran_font_size: size });
            }}
          />
          <div className="flex items-center justify-between">
            <Label htmlFor="reader-quran-lh" className="text-xs text-muted-foreground">
              فاصلهٔ سطر قرآنی
            </Label>
            <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {(prefs.quran_line_height ?? QURAN_LINE_HEIGHT_DEFAULT).toFixed(1)}
            </span>
          </div>
          <Slider
            id="reader-quran-lh"
            value={[prefs.quran_line_height ?? QURAN_LINE_HEIGHT_DEFAULT]}
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
          <div className="flex items-center justify-between">
            <Label htmlFor="reader-para-spacing">فاصلهٔ پاراگراف</Label>
            <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {(prefs.para_spacing ?? 0.6).toFixed(1)}
            </span>
          </div>
          <input
            id="reader-para-spacing"
            aria-label="فاصلهٔ پاراگراف"
            className="w-full accent-primary"
            type="range"
            min={0}
            max={1.6}
            step={0.1}
            value={prefs.para_spacing ?? 0.6}
            onChange={(e) => updatePrefs({ para_spacing: Number(e.target.value) })}
          />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="space-y-1">
              <Label htmlFor="reader-text-align">تراز متن</Label>
              <Select
                value={prefs.text_align ?? "auto"}
                onValueChange={(v) => updatePrefs({ text_align: v as typeof prefs.text_align })}
              >
                <SelectTrigger id="reader-text-align" className="w-full" aria-label="تراز متن">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">خودکار</SelectItem>
                  <SelectItem value="right">راست</SelectItem>
                  <SelectItem value="left">چپ</SelectItem>
                  <SelectItem value="center">وسط</SelectItem>
                  <SelectItem value="justify">هم‌تراز</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reader-text-dir">جهت متن</Label>
              <Select
                value={prefs.text_dir ?? "auto"}
                onValueChange={(v) => updatePrefs({ text_dir: v as typeof prefs.text_dir })}
              >
                <SelectTrigger id="reader-text-dir" className="w-full" aria-label="جهت متن">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">خودکار</SelectItem>
                  <SelectItem value="rtl">راست به چپ</SelectItem>
                  <SelectItem value="ltr">چپ به راست</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {fullscreen.supported ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setFullscreenError(false);
                void fullscreen.toggle().catch(() => setFullscreenError(true));
              }}
            >
              {fullscreen.active ? "خروج از تمام‌صفحه" : "نمایش تمام‌صفحه"}
            </Button>
          ) : null}
          {fullscreenError ? <p role="alert" className="text-xs text-destructive">نمایش تمام‌صفحه در این مرورگر ممکن نیست.</p> : null}
        </div>
        {/* عرض متن */}
        <div className="space-y-2">
          <Label>عرض متن</Label>
          <div className="flex gap-2">
            {(Object.keys(WIDTH_LABELS) as ReaderTextWidth[]).map((w) => (
              <SegButton
                key={w}
                label={`عرض ${WIDTH_LABELS[w]}`}
                pressed={(prefs.text_width ?? "medium") === w}
                onClick={() => updatePrefs({ text_width: w })}
              >
                {WIDTH_LABELS[w]}
              </SegButton>
            ))}
          </div>
        </div>

        <Separator />

        {/* پالت رنگ مطالعه — ۶ تم استاندارد پروتوتایپ (۲ ردیف ۳تایی دایره‌ای) */}
        <div className="space-y-2.5">
          <Label>تم</Label>
          {(
            [
              ["light", readerTheme.lightPalettes],
              ["dark", readerTheme.darkPalettes],
            ] as const
          ).map(([m, list]) => (
            <div key={m} className="flex justify-evenly" role="group" aria-label="تم مطالعه">
              {list.map((p) => {
                const selected = readerTheme.mode === m && readerTheme.palette === p.id;
                return (
                  <button
                    key={`${m}-${p.id}`}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`تم ${p.name}`}
                    title={p.name}
                    onClick={() => readerTheme.apply({ mode: m, palette: p.id })}
                    className="flex size-12 items-center justify-center rounded-full text-base font-bold transition-transform hover:scale-105"
                    style={{
                      background: p.bg,
                      color: p.text,
                      border: `${selected ? 3 : 1.5}px solid ${selected ? "var(--primary)" : p.sec + "59"}`,
                      boxShadow: selected
                        ? "0 2px 10px 2px color-mix(in srgb,var(--primary) 35%,transparent)"
                        : undefined,
                    }}
                  >
                    {selected ? <Check className="size-6 stroke-[2.5]" aria-hidden="true" /> : "أ"}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <BookText className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <p className="text-[11px] leading-4 text-muted-foreground">
            تغییر این تنظیمات موضع مطالعهٔ شما را جابه‌جا نمی‌کند.
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          برای گزینه‌های بیشتر، پنل را پیمایش کنید.
        </p>
        <SaveStateLine />
      </PopoverContent>
    </Popover>
  );
}
