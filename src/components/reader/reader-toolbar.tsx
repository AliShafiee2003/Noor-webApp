"use client";

/**
 * نوار بالای کتاب‌خوان — چیدمان تک‌ردیفی فشرده در همهٔ عرض‌ها (بازطراحی ۱۴۰۵/۰۸):
 * - دسکتاپ (md+): یک ردیف غیرشکستنی — بازگشت + عنوان (truncate) + حالت نمایش + پرش به صفحه + قبلی/بعدی
 *   + ابزارهای فقط‌آیکنی (tooltip) + جست‌وجوی درون‌کتابی پشت آیکن بازشو.
 * - موبایل (<md): ناوبری فشردهٔ تک‌ردیفی قبلی — دست‌نخورده.
 * حفظ: کپی نشانی، نشانک، خروجی PDF، مطالعهٔ متمرکز، سنجاق نوار، پاک‌کردن نشانهٔ جست‌وجو و وضعیت ذخیره.
 */
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  BookOpenText,
  BookMarked,
  BookmarkCheck,
  BookmarkPlus,
  Copy,
  ChevronDown,
  FileDown,
  Loader2,
  ScrollText,
  Pin,
  Search,
  X,
} from "lucide-react";
import { ReadingModeControl } from "@/components/design-system/reading-mode-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HashLink } from "@/lib/hash-router";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { faNum } from "@/lib/format";
import type { PageRef, ReaderDisplay } from "@/lib/types";

export interface ReaderToolbarProps {
  workTitle: string | null;
  documentLabel: string;
  pageLabel: string;
  display: ReaderDisplay;
  onDisplayChange: (d: ReaderDisplay) => void;
  pageRefs: PageRef[];
  currentPageUid: string | null;
  onJumpToPage: (ref: PageRef) => void;
  documentUid: string;
  /** جست‌وجو در همین کتاب/جلد */
  searchQuery?: string;
  onSearch?: (q: string) => void;
  onClearSearch?: () => void;
  isSearching?: boolean;
  totalSearchMatches?: number | null;
  /** سازگاری با قرارداد قبلی */
  onSearchInDocument?: (q: string) => void;
  bookmarked: boolean;
  bookmarkPending: boolean;
  onToggleBookmark: () => void;
  /** ورود به فهرست یکپارچهٔ نشانک‌ها و یادداشت‌ها (زیر xl که ستون کنار نیست) */
  onOpenMarks?: () => void;
  marksCount?: number;
  /** PDF: پنل فقط نشانک دارد (یادداشت متنی ندارد) */
  marksOnly?: boolean;
  onCopyAddress: () => void;
  /** §۷-الف-۲: بازکردن دیالوگ خروجی PDF از این کتاب */
  onExportPdf: () => void;
  settingsTrigger: React.ReactNode;
  highlightActive: boolean;
  onClearHighlight: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  /** متن وضعیت ذخیره (موضع/ترجیحات) */
  saveIndicator?: React.ReactNode;
  /** وضعیت سنجاق‌شدن نوار ابزار برای نمایش همیشگی */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** سند اسکن‌شده (PDF): جست‌وجوی درون‌کتابی/خروجی PDF/تنظیمات متن/کنترل حالت نمایش مخفی */
  textToolsHidden?: boolean;
  /** ورود به مطالعهٔ متمرکز — نمای کتاب‌خوان تمام‌صفحه در وب */
  onEnterFocusMode?: () => void;
}

/** واحد ابزار آیکنی: فقط آیکن + tooltip — نوار تک‌ردیفی فشرده */
function IconTool({
  label,
  icon,
  pressed,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  pressed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={cn(
        "group inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors [&_svg]:transition-transform [&_svg]:duration-150 group-hover:[&_svg]:scale-110 disabled:opacity-40",
        pressed
          ? "bg-accent text-primary hover:bg-accent/80"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
}

/** پرش ساده به شمارهٔ صفحهٔ چاپی: باکس کوتاه + Enter — مطابق Noor/Control/ReaderPageControl */
function PageJump({
  pageRefs,
  pageLabel,
  onJump,
}: {
  pageRefs: PageRef[];
  pageLabel?: string;
  onJump: (ref: PageRef) => void;
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const lastQueryRef = useRef<string>("");
  const lastIndexRef = useRef<number>(-1);

  const normalize = useMemo(() => {
    const fa = "۰۱۲۳۴۵۶۷۸۹";
    const ar = "٠١٢٣٤٥٦٧٨٩";
    return (s: string) =>
      s
        .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
        .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
        .replace(/[\s\u200c]/g, "");
  }, []);

  const jump = () => {
    const q = normalize(value);
    if (!q) return;
    const matches = pageRefs.filter(
      (p) => normalize(p.label) === q || (p.num ? normalize(p.num) === q : false),
    );
    if (matches.length === 0) {
      toast({
        title: "صفحه‌ای با این شماره یافت نشد.",
        description: `«${value.trim()}» در صفحه‌های این جلد ثبت نشده است.`,
        variant: "destructive",
      });
      return;
    }
    const again = lastQueryRef.current === q && lastIndexRef.current >= 0;
    const index = again ? (lastIndexRef.current + 1) % matches.length : 0;
    lastQueryRef.current = q;
    lastIndexRef.current = index;
    onJump(matches[index]);
    setValue("");
    setOpen(false);
  };

  const currentPlaceholder = pageLabel ? `صفحه ${faNum(pageLabel)}` : "صفحه";
  const fullLabel = pageLabel ? `رفتن به صفحهٔ ${faNum(pageLabel)}` : "رفتن به صفحه";
  const shortLabel = pageLabel ? `صفحه ${faNum(pageLabel)}` : "صفحه";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-11 min-w-0 flex-1 justify-center gap-2 rounded-lg px-3 text-sm font-medium md:h-9 md:w-[116px] md:flex-none md:px-2 lg:w-[152px] xl:w-[188px]"
          aria-label="رفتن به صفحه"
        >
          <ChevronDown className="size-5 shrink-0 text-primary transition-transform md:size-4" aria-hidden="true" />
          <span className="min-w-0 truncate whitespace-nowrap">
            <span className="md:hidden">{fullLabel}</span>
            <span className="hidden md:inline xl:hidden">{shortLabel}</span>
            <span className="hidden xl:inline">{fullLabel}</span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 space-y-3">
        <p className="text-sm font-medium">شمارهٔ صفحهٔ چاپی</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); jump(); }}>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                jump();
              }
            }}
            placeholder={currentPlaceholder}
            inputMode="numeric"
            autoComplete="off"
            aria-label="پرش به شمارهٔ صفحهٔ چاپی"
            title="شمارهٔ صفحه را بنویسید و Enter بزنید"
            className="min-w-0 flex-1 text-sm font-sans"
          />
          <Button type="submit" variant="outline">رفتن</Button>
        </form>
        <div className="max-h-56 space-y-1 overflow-y-auto" aria-label="صفحه‌های این جلد">
          {pageRefs.filter(ref => !value || normalize(ref.label).includes(normalize(value))).slice(0, 30).map(ref => (
            <Button key={ref.page_uid} variant="ghost" className="w-full justify-start" onClick={() => { onJump(ref); setOpen(false); setValue(""); }}>
              صفحهٔ {faNum(ref.label)}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** جست‌وجو در همین کتاب — پشت آیکن بازشو (نوار تک‌ردیفی فشرده) */
function InBookSearchPopover({
  searchQuery = "",
  onSearch,
  onClear,
  isLoading = false,
  totalMatches,
}: {
  searchQuery?: string;
  onSearch?: (q: string) => void;
  onClear?: () => void;
  isLoading?: boolean;
  totalMatches?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(searchQuery);

  const [previousQuery, setPreviousQuery] = useState(searchQuery);
  if (previousQuery !== searchQuery) {
    setPreviousQuery(searchQuery);
    setValue(searchQuery);
  }

  const active = searchQuery.trim().length > 0;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = value.trim();
    if (q && onSearch) {
      onSearch(q);
    }
  };

  const handleClear = () => {
    setValue("");
    onClear?.();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="جست‌وجو در این کتاب"
          title="جست‌وجو در این کتاب"
          aria-expanded={open}
          className={cn(
            "relative inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
            active
              ? "bg-accent text-primary hover:bg-accent/80"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {isLoading ? (
            <Loader2 className="size-4.5 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-4.5" aria-hidden="true" />
          )}
          {active && totalMatches != null && !isLoading ? (
            <span
              aria-hidden="true"
              className="absolute -top-1 -end-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground"
            >
              {faNum(totalMatches)}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2">
        {active ? (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              «{searchQuery}»{" — "}
              {totalMatches != null ? `${faNum(totalMatches)} نتیجه` : "در حال جست‌وجو…"}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-[11px]"
              onClick={handleClear}
            >
              <X className="size-3.5" aria-hidden="true" />
              پاک‌کردن
            </Button>
          </div>
        ) : null}
        <form role="search" onSubmit={handleSubmit} className="relative flex items-center">
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              } else if (e.key === "Escape") {
                handleClear();
              }
            }}
            placeholder="جست‌وجو در این کتاب"
            aria-label="جست‌وجو در این کتاب"
            title="عبارت را بنویسید و Enter بزنید"
            className="h-10 w-full rounded-lg bg-input-surface ps-3 pe-9 text-sm font-sans"
          />
          {value ? (
            <button
              type="button"
              onClick={handleClear}
              className="absolute end-1.5 size-6 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="پاک‌کردن متن جست‌وجو"
              aria-label="پاک‌کردن متن جست‌وجو"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!value.trim() || isLoading}
              className="absolute end-2 size-5 flex items-center justify-center text-muted-foreground transition-colors hover:text-primary disabled:opacity-40"
              title="جست‌وجو در این کتاب (Enter)"
              aria-label="جست‌وجو در این کتاب"
            >
              <Search className="size-4" aria-hidden="true" />
            </button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function ReaderToolbar(props: ReaderToolbarProps) {
  const {
    workTitle,
    documentLabel,
    pageLabel,
    display,
    onDisplayChange,
    pageRefs,
    onJumpToPage,
    documentUid,
    searchQuery,
    onSearch,
    onClearSearch,
    isSearching,
    totalSearchMatches,
    onSearchInDocument,
    bookmarked,
    bookmarkPending,
    onToggleBookmark,
    onOpenMarks,
    marksCount,
    marksOnly,
    onCopyAddress,
    onExportPdf,
    settingsTrigger,
    highlightActive,
    onClearHighlight,
    onPrev,
    onNext,
    saveIndicator,
    pinned,
    onTogglePin,
    textToolsHidden,
    onEnterFocusMode,
  } = props;

  return (
    <div className="flex min-h-15 flex-wrap items-center justify-between gap-3 border-b border-border bg-chrome/95 py-2 px-3 backdrop-blur shadow-xs md:h-15 md:flex-nowrap md:gap-1.5 md:py-0 md:px-4">
      {/* دسکتاپ: تک‌ردیفی فشرده — بازگشت + عنوان (truncate) */}
      <div className="hidden min-w-0 flex-1 items-center gap-1.5 md:flex">
        <HashLink
          to="/library"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="بازگشت به کتابخانه"
          aria-label="بازگشت به کتابخانه"
        >
          <ArrowRight className="size-5" aria-hidden="true" />
        </HashLink>

        <div className="h-5 w-px bg-border shrink-0" aria-hidden="true" />

        <nav aria-label="مسیر مطالعه" className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs leading-5 md:text-sm">
            <span
              className="min-w-0 truncate font-bold text-foreground text-[15px]"
              title={workTitle ?? ""}
            >
              {workTitle ?? "در حال بارگیری…"}
            </span>
            {documentLabel ? (
              <span className="hidden min-w-0 truncate max-w-36 xl:inline text-[13px] text-muted-foreground" title={documentLabel}>
                {documentLabel} /
              </span>
            ) : null}
          </div>
        </nav>
      </div>

      {/* موبایل/تبلت: ناوبری فشردهٔ تک‌ردیفی — (دور ۱۸-فیکس ۵: نوار ۳ردیفهٔ <md جمع شد؛
          جست‌وجو از قرص شناور (Sheet) می‌آید) */}
      <div className="flex w-full items-center gap-1 md:hidden">
          <HashLink
            to="/library"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="بازگشت به کتابخانه"
            aria-label="بازگشت به کتابخانه"
          >
            <ArrowRight className="size-4.5" aria-hidden="true" />
          </HashLink>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => onPrev?.()}
            disabled={!onPrev}
            title="صفحهٔ قبل"
            aria-label="صفحهٔ قبل"
          >
            <ArrowRight className="size-4.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => onNext?.()}
            disabled={!onNext}
            title="صفحهٔ بعد"
            aria-label="صفحهٔ بعد"
          >
            <ArrowLeft className="size-4.5" aria-hidden="true" />
          </Button>

          <PageJump pageRefs={pageRefs} pageLabel={pageLabel} onJump={onJumpToPage} />

          {!textToolsHidden ? (
            <ReadingModeControl value={display} onValueChange={onDisplayChange} compact className="min-w-0" />
          ) : null}
        </div>

      {/* دسکتاپ: حالت نمایش + پرش به صفحه + قبلی/بعدی */}
      <div className="hidden shrink-0 items-center gap-1.5 md:flex">
          {!textToolsHidden ? (
            <div
              role="group"
              aria-label="حالت نمایش متن"
              className="flex shrink-0 items-center rounded-[10px] border border-border p-[3px]"
            >
              <button
                type="button"
                aria-pressed={display === "continuous"}
                onClick={() => onDisplayChange("continuous")}
                title="نمایش پیوسته: همهٔ صفحه‌های جلد پشت‌سرهم"
                aria-label="حالت نمایش پیوسته"
                className={cn(
                  "inline-flex h-8 w-[42px] items-center justify-center rounded-lg transition-colors",
                  display === "continuous"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                <ScrollText className="size-4.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-pressed={display === "paged"}
                onClick={() => onDisplayChange("paged")}
                title="نمایش صفحه‌محور: یک صفحه در هر نما"
                aria-label="حالت نمایش صفحه‌محور"
                className={cn(
                  "inline-flex h-8 w-[42px] items-center justify-center rounded-lg transition-colors",
                  display === "paged"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                <BookOpenText className="size-4.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <PageJump pageRefs={pageRefs} pageLabel={pageLabel} onJump={onJumpToPage} />

          <button
            type="button"
            onClick={() => onPrev?.()}
            disabled={!onPrev}
            title="صفحهٔ قبل"
            aria-label="صفحهٔ قبل"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 text-primary transition-colors hover:bg-accent disabled:opacity-40"
          >
            <ArrowRight className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onNext?.()}
            disabled={!onNext}
            title="صفحهٔ بعد"
            aria-label="صفحهٔ بعد"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 text-primary transition-colors hover:bg-accent disabled:opacity-40"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
      </div>

      {/* دسکتاپ: ابزارها به ترتیب اهمیت — جست‌وجو، نشانه‌ها، نشانک صفحه، تنظیمات،
          مطالعهٔ متمرکز، کپی، خروجی PDF، سنجاق */}
      <div className="hidden shrink-0 items-center gap-1 md:flex">
          {highlightActive ? (
            <button
              type="button"
              onClick={onClearHighlight}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-match/30 text-foreground transition-colors hover:bg-match/50"
              title="پاک‌کردن نشانهٔ جست‌وجو"
              aria-label="پاک‌کردن نشانهٔ جست‌وجو"
            >
              <X className="size-4.5" aria-hidden="true" />
            </button>
          ) : null}

          {!textToolsHidden ? (
            <InBookSearchPopover
              searchQuery={searchQuery}
              onSearch={onSearch ?? onSearchInDocument}
              onClear={onClearSearch}
              isLoading={isSearching}
              totalMatches={totalSearchMatches}
            />
          ) : null}

          {onOpenMarks ? (
            <span className="relative inline-flex xl:hidden">
              <IconTool
                label={marksOnly ? "نشانک‌ها" : "نشانک‌ها و یادداشت‌ها"}
                icon={<BookMarked className="size-4.5" aria-hidden="true" />}
                onClick={onOpenMarks}
              />
              {marksCount ? (
                <span
                  className="pointer-events-none absolute -top-0.5 -end-0.5 inline-flex min-w-4 justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground"
                  aria-hidden="true"
                >
                  {faNum(marksCount)}
                </span>
              ) : null}
            </span>
          ) : null}

          <IconTool
            label="نشانک‌ها"
            pressed={bookmarked}
            disabled={bookmarkPending}
            icon={
              bookmarked ? (
                <BookmarkCheck className="size-4.5 text-primary" aria-hidden="true" />
              ) : (
                <BookmarkPlus className="size-4.5" aria-hidden="true" />
              )
            }
            onClick={onToggleBookmark}
          />

          {settingsTrigger}

          {onEnterFocusMode ? (
            <IconTool
              label="مطالعهٔ متمرکز"
              icon={<BookOpenCheck className="size-4.5" aria-hidden="true" />}
              onClick={onEnterFocusMode}
            />
          ) : null}

          <IconTool
            label="کپی ارجاع"
            icon={<Copy className="size-4.5" aria-hidden="true" />}
            onClick={onCopyAddress}
          />

          {!textToolsHidden ? (
            <IconTool
              label="دریافت PDF"
              icon={<FileDown className="size-4.5" aria-hidden="true" />}
              onClick={onExportPdf}
            />
          ) : null}

          <IconTool
            label="ثابت‌کردن نوار"
            icon={
              <Pin
                className={cn(
                  "size-4.5 transition-transform",
                  pinned ? "rotate-0 text-primary" : "rotate-45",
                )}
                aria-hidden="true"
              />
            }
            pressed={pinned}
            onClick={onTogglePin}
          />

          {saveIndicator}
      </div>
    </div>
  );
}
