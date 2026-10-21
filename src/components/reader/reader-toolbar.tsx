"use client";

/**
 * نوار بالای کتاب‌خوان — بازطراحی مطابق قالب Figma «ReaderTools/Desktop» (نود 2270:10337):
 * - راست: بازگشت به کتابخانه + breadcrumb (اثر / جلد / ۱۲ ص) با نشانگر صفحهٔ متنی.
 * - وسط: گروه حالت نمایش فشرده (پیوسته/صفحه‌محور) + پرش به صفحهٔ چاپی + قبلی/بعدی ۴۴px.
 * - چپ: ابزارهای برچسب‌دار (آیکن + زیرنویس) در دو سطح: ردیف ابزارها + جست‌وجوی درون‌کتابی.
 * حفظ: کپی نشانی، نشانک، خروجی PDF، مطالعهٔ متمرکز، سنجاق نوار، پاک‌کردن نشانهٔ جست‌وجو و وضعیت ذخیره.
 */
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  BookOpenText,
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
  onCopyAddress: () => void;
  /** §۷-الف-۲: بازکردن دیالوگ خروجی PDF از این کتاب */
  onExportPdf: () => void;
  /** حالت مطالعهٔ مینیمال — درخواست کاربر: صفحهٔ شلوغ نباشد */
  studyMode: boolean;
  onToggleStudyMode: () => void;
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
}

/** واحد ابزار برچسب‌دار: آیکن (دکمه) + زیرنویس — مطابق Noor/UX/Reader tool */
function LabelTool({
  label,
  icon,
  pressed,
  onClick,
  disabled,
  wide = false,
}: {
  label: string;
  icon: React.ReactNode;
  pressed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  /** تب تنظیمات ۳۶px است؛ بقیه ۴۲px */
  wide?: boolean;
}) {
  return (
    <div className="flex w-20 flex-col items-center gap-1" title={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={pressed}
        aria-label={label}
        className={cn(
          "inline-flex h-9 items-center justify-center rounded-lg transition-colors disabled:opacity-40",
          wide ? "size-9" : "w-[42px]",
          pressed
            ? "bg-accent text-primary hover:bg-accent/80"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {icon}
      </button>
      <span aria-hidden="true" className="text-center text-sm leading-5 text-foreground">
        {label}
      </span>
    </div>
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-11 flex-1 justify-center gap-2 rounded-lg px-3 text-sm font-medium md:w-[216px] md:flex-none"
          aria-label="رفتن به صفحه"
        >
          <ChevronDown className="size-5 text-primary transition-transform" aria-hidden="true" />
          <span className="whitespace-nowrap">{pageLabel ? `رفتن به صفحهٔ ${faNum(pageLabel)}` : "رفتن به صفحه"}</span>
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

/** باکس جست‌وجو در همین کتاب — ورودی همیشه نمایان با برچسب «جست‌وجو در این کتاب» (درخواست کاربر) */
function InBookSearchBox({
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
  const [value, setValue] = useState(searchQuery);

  const [previousQuery, setPreviousQuery] = useState(searchQuery);
  if (previousQuery !== searchQuery) {
    setPreviousQuery(searchQuery);
    setValue(searchQuery);
  }

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
    <form
      role="search"
      onSubmit={handleSubmit}
      className="relative flex w-full items-center md:w-auto"
    >
      <div className="relative flex w-full items-center">
        <Input
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
          className="h-11 w-full rounded-lg bg-input-surface ps-3 pe-9 text-sm font-sans md:w-[180px]"
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
        ) : null}
        <button
          type="submit"
          disabled={!value.trim() || isLoading}
          className="absolute end-2 size-5 flex items-center justify-center text-muted-foreground transition-colors hover:text-primary disabled:opacity-40"
          title="جست‌وجو در این کتاب (Enter)"
          aria-label="جست‌وجو در این کتاب"
          style={value ? { visibility: "hidden" } : undefined}
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
          ) : (
            <Search className="size-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
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
    onCopyAddress,
    onExportPdf,
    studyMode,
    onToggleStudyMode,
    settingsTrigger,
    highlightActive,
    onClearHighlight,
    onPrev,
    onNext,
    saveIndicator,
    pinned,
    onTogglePin,
  } = props;

  return (
    <div className="flex min-h-15 flex-wrap items-center justify-between gap-3 border-b border-border bg-chrome/95 py-2 px-3 md:px-4 backdrop-blur md:gap-3 shadow-xs">
      {/* بخش راست (RTL): بازگشت به کتابخانه + breadcrumb اثر/جلد/صفحه (متن ساده) */}
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <HashLink
          to="/library"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="بازگشت به کتابخانه"
          aria-label="بازگشت به کتابخانه"
        >
          <ArrowRight className="size-5" aria-hidden="true" />
        </HashLink>

        <div className="h-5 w-px bg-border shrink-0" aria-hidden="true" />

        <nav aria-label="مسیر مطالعه" className="min-w-0">
          <div className="flex items-center gap-2 text-xs leading-5 md:text-sm">
            <span
              className="truncate max-w-[8rem] sm:max-w-[13rem] md:max-w-[15rem] lg:max-w-[24rem] font-bold text-foreground text-[15px]"
              title={workTitle ?? ""}
            >
              {workTitle ?? "در حال بارگیری…"}
            </span>
            {documentLabel ? (
              <span className="hidden xl:inline text-muted-foreground truncate max-w-[9rem] text-[13px]" title={documentLabel}>
                {documentLabel} /
              </span>
            ) : null}
            <span className="shrink-0 text-[15px]">
              <span className="font-semibold text-foreground">{pageLabel ? faNum(pageLabel) : "—"}</span>{" "}
              <span className="text-xs text-muted-foreground">ص</span>
            </span>
          </div>
        </nav>
      </div>

      {/* بخش وسط: ناوبری + پرش به صفحه + حالت نمایش */}
      <div className="order-2 flex w-full shrink-0 items-center justify-between gap-2 md:order-none md:w-auto">
        {/* موبایل/تبلت: ناوبری فشردهٔ تک‌ردیفی */}
        <div className="flex w-full items-center gap-1 md:hidden">
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

          <ReadingModeControl value={display} onValueChange={onDisplayChange} compact className="min-w-0" />
        </div>

        {/* دسکتاپ: گروه حالت نمایش فشرده + پرش + قبلی/بعدی ۴۴px */}
        <div className="hidden min-w-0 items-center gap-2 md:flex">
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

          <PageJump pageRefs={pageRefs} pageLabel={pageLabel} onJump={onJumpToPage} />

          <button
            type="button"
            onClick={() => onPrev?.()}
            disabled={!onPrev}
            title="صفحهٔ قبل"
            aria-label="صفحهٔ قبل"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-primary transition-colors hover:bg-accent disabled:opacity-40"
          >
            <ArrowRight className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onNext?.()}
            disabled={!onNext}
            title="صفحهٔ بعد"
            aria-label="صفحهٔ بعد"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-primary transition-colors hover:bg-accent disabled:opacity-40"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* بخش چپ (RTL): ابزارهای برچسب‌دار در دو سطح — ردیف ابزارها + جست‌وجوی درون‌کتابی */}
      <div className="hidden min-w-0 shrink-0 flex-col items-end gap-2 md:flex">
        <div className="flex items-start gap-1">
          {highlightActive ? (
            <button
              type="button"
              onClick={onClearHighlight}
              className="inline-flex h-9 w-[42px] items-center justify-center self-start rounded-lg bg-match/30 text-foreground transition-colors hover:bg-match/50"
              title="پاک‌کردن نشانهٔ جست‌وجو"
              aria-label="پاک‌کردن نشانهٔ جست‌وجو"
            >
              <X className="size-4.5" aria-hidden="true" />
            </button>
          ) : null}

          <LabelTool
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

          <LabelTool
            label="کپی ارجاع"
            icon={<Copy className="size-4.5" aria-hidden="true" />}
            onClick={onCopyAddress}
          />

          <LabelTool
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

          <LabelTool
            label="دریافت PDF"
            icon={<FileDown className="size-4.5" aria-hidden="true" />}
            onClick={onExportPdf}
          />

          <LabelTool
            label="مطالعه متمرکز"
            icon={<BookOpenCheck className="size-4.5" aria-hidden="true" />}
            onClick={onToggleStudyMode}
          />

          {settingsTrigger}
        </div>

        <div className="flex items-center gap-2">
          <InBookSearchBox
            searchQuery={searchQuery}
            onSearch={onSearch ?? onSearchInDocument}
            onClear={onClearSearch}
            isLoading={isSearching}
            totalMatches={totalSearchMatches}
          />
          {saveIndicator}
        </div>
      </div>

      {/* موبایل: جست‌وجو و ابزارها */}
      <div className="order-1 w-full md:hidden">
        <InBookSearchBox searchQuery={searchQuery} onSearch={onSearch ?? onSearchInDocument} onClear={onClearSearch} isLoading={isSearching} totalMatches={totalSearchMatches} />
      </div>
      <div className="order-3 flex w-full items-center gap-2 md:hidden">
        <ReadingModeControl value={display} onValueChange={onDisplayChange} className="min-w-0 flex-1" />
        <Button variant="outline" size="icon" onClick={onToggleStudyMode} aria-label="مطالعهٔ متمرکز" aria-pressed={studyMode} title="مطالعهٔ متمرکز">
          <BookOpenCheck className="size-5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
