"use client";

/**
 * تنظیمات خواندن (READ-07 / READ-10):
 * اندازهٔ قلم ۱۶–۳۲، فاصلهٔ سطر ۱.۶–۲.۴، فونت (امیری/وزیرمتن)، عرض متن،
 * حالت صفحه‌محور/پیوسته و حالت روشن/تیره.
 * تغییرات فقط استایل را عوض می‌کنند و موضع مطالعه حفظ می‌شود (بدون پرش).
 * ذخیره: workspace store + PUT /workspace/prefs (debounce در store).
 */
import { useTheme } from "next-themes";
import {
  BookText,
  Check,
  MonitorSmartphone,
  Moon,
  RotateCcw,
  Sun,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { useWorkspaceStore } from "@/store/workspace";
import {
  QURAN_FONT_OPTIONS,
  QURAN_FONT_SIZE_DEFAULT,
  QURAN_LINE_HEIGHT_DEFAULT,
} from "@/lib/fonts";
import type { ReaderDisplay, ReaderTextWidth } from "@/lib/types";

const WIDTH_LABELS: Record<ReaderTextWidth, string> = {
  narrow: "باریک",
  medium: "متوسط",
  wide: "پهن",
};

const WIDTH_MAX_PX: Record<ReaderTextWidth, number> = {
  narrow: 620,
  medium: 760,
  wide: 900,
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
  const { theme, setTheme } = useTheme();

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[80vh] w-80 max-w-[calc(100vw-2rem)] space-y-4 overflow-y-auto"
      >
        <div className="flex items-center gap-2">
          <Type className="size-4 text-primary" aria-hidden="true" />
          <p className="text-sm font-semibold">تنظیمات خواندن</p>
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
            min={1.6}
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
          <Label>قلم نثر عربی</Label>
          <div className="flex gap-2">
            <SegButton
              label="قلم امیری"
              pressed={(prefs.font_family ?? "amiri") === "amiri"}
              onClick={() => updatePrefs({ font_family: "amiri" })}
            >
              <span style={{ fontFamily: '"Amiri", serif' }}>امیری</span>
            </SegButton>
            <SegButton
              label="قلم شهرزاد جدید"
              pressed={prefs.font_family === "scheherazade"}
              onClick={() => updatePrefs({ font_family: "scheherazade" })}
            >
              <span style={{ fontFamily: '"Scheherazade New", serif' }}>شهرزاد</span>
            </SegButton>
            <SegButton
              label="قلم وزیرمتن"
              pressed={prefs.font_family === "vazirmatn"}
              onClick={() => updatePrefs({ font_family: "vazirmatn" })}
            >
              <span style={{ fontFamily: "var(--font-ui)" }}>وزیرمتن</span>
            </SegButton>
          </div>
        </div>

        {/* قلم قرآنی + اندازهٔ متن قرآنی — تخصیص بر اساس نقش تگ آیه */}
        <div className="space-y-2">
          <Label>قلم متن قرآنی</Label>
          <div className="flex gap-2">
            {QURAN_FONT_OPTIONS.map((o) => (
              <SegButton
                key={o.id}
                label={`قلم قرآنی ${o.label}`}
                pressed={(prefs.font_quran ?? "amiri-quran") === o.id}
                onClick={() => updatePrefs({ font_quran: o.id })}
              >
                <span
                  style={{
                    fontFamily:
                      o.id === "amiri-quran"
                        ? '"Amiri Quran", "Amiri", serif'
                        : '"Scheherazade New", serif',
                  }}
                >
                  {o.label}
                </span>
              </SegButton>
            ))}
          </div>
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

        {/* حالت نمایش */}
        <div className="space-y-2">
          <Label>نحوهٔ نمایش</Label>
          <div className="flex gap-2">
            <SegButton
              label="نمایش صفحه‌محور"
              pressed={prefs.display === "paged"}
              onClick={() => updatePrefs({ display: "paged" as ReaderDisplay })}
            >
              صفحه‌محور
            </SegButton>
            <SegButton
              label="نمایش پیوسته"
              pressed={prefs.display === "continuous"}
              onClick={() => updatePrefs({ display: "continuous" as ReaderDisplay })}
            >
              پیوسته
            </SegButton>
          </div>
        </div>

        <Separator />

        {/* حالت روشن/تیره */}
        <div className="space-y-2">
          <Label>ظاهر</Label>
          <div className="flex gap-2">
            <SegButton
              label="حالت روشن"
              pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              <Sun className="size-3.5" aria-hidden="true" />
              روشن
            </SegButton>
            <SegButton
              label="حالت تیره"
              pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              <Moon className="size-3.5" aria-hidden="true" />
              تیره
            </SegButton>
            <SegButton
              label="هماهنگ با سامانه"
              pressed={theme === "system"}
              onClick={() => setTheme("system")}
            >
              <MonitorSmartphone className="size-3.5" aria-hidden="true" />
              سامانه
            </SegButton>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <BookText className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <p className="text-[11px] leading-4 text-muted-foreground">
            تغییر این تنظیمات موضع مطالعهٔ شما را جابه‌جا نمی‌کند.
          </p>
        </div>
        <SaveStateLine />
      </PopoverContent>
    </Popover>
  );
}
