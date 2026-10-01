"use client";

/**
 * نوار بالای کتاب‌خوان (DESIGN §۵):
 * عنوان اثر/جلد/صفحه + پرش به صفحهٔ چاپی (تفکیک هم‌نام — READ-03/04) +
 * جست‌وجو در همین کتاب/جلد (SEARCH-09) + کپی نشانی (READ-17) + نشانک (READ-12) +
 * حالت نمایش + تنظیمات + پاک‌کردن نشانهٔ جست‌وجو (READ-11) + وضعیت ذخیره.
 */
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  BookmarkCheck,
  BookmarkPlus,
  Copy,
  Hash,
  ScrollText,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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
  /** جست‌وجو در همین کتاب/جلد (SEARCH-09) → navigate به صفحهٔ نتایج */
  onSearchInDocument: (q: string) => void;
  bookmarked: boolean;
  bookmarkPending: boolean;
  onToggleBookmark: () => void;
  onCopyAddress: () => void;
  settingsTrigger: React.ReactNode;
  highlightActive: boolean;
  onClearHighlight: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  /** متن وضعیت ذخیره (موضع/ترجیحات) */
  saveIndicator?: React.ReactNode;
}

/** پرش ساده به شمارهٔ صفحهٔ چاپی: باکس کوتاه + Enter — در تکرار، هم‌نام‌ها به‌ترتیب گشوده می‌شوند */
function PageJump({
  pageRefs,
  onJump,
}: {
  pageRefs: PageRef[];
  onJump: (ref: PageRef) => void;
}) {
  const [value, setValue] = useState("");
  const lastQueryRef = useRef<string>("");
  const lastIndexRef = useRef<number>(-1);

  /* ارقام فارسی/عربی و فاصله‌ها را نرمال می‌کنیم تا «۱۱۵» و "115" یکی باشند */
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
    /* در تکرار همین جست‌وجو، موضع بعدیِ هم‌نام‌ها (تفکیک صفحات هم‌شمارهٔ جلدهای متفاوت) */
    const again = lastQueryRef.current === q && lastIndexRef.current >= 0;
    const index = again ? (lastIndexRef.current + 1) % matches.length : 0;
    lastQueryRef.current = q;
    lastIndexRef.current = index;
    onJump(matches[index]);
    setValue("");
  };

  return (
    <div className="relative flex items-center">
      <Hash
        className="pointer-events-none absolute start-2.5 size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            jump();
          }
        }}
        placeholder="صفحه…"
        inputMode="numeric"
        autoComplete="off"
        aria-label="پرش به شمارهٔ صفحهٔ چاپی"
        title="شمارهٔ صفحه را بنویسید و Enter بزنید"
        className="min-h-9 w-24 ps-8 text-sm md:w-20"
      />
    </div>
  );
}

/** جست‌وجو در همین کتاب/جلد (SEARCH-09) */
function SearchInDocument({
  documentUid,
  onSearch,
}: {
  documentUid: string;
  onSearch: (q: string) => void;
}) {
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      className="relative hidden items-center lg:flex"
      onSubmit={(e) => {
        e.preventDefault();
        const query = q.trim();
        if (query) {
          onSearch(query);
          setQ("");
        }
      }}
    >
      <Search
        className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="جست‌وجو در همین کتاب…"
        aria-label="جست‌وجو در همین کتاب/جلد"
        className="min-h-9 w-52 pe-8 text-xs"
      />
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
    onSearchInDocument,
    bookmarked,
    bookmarkPending,
    onToggleBookmark,
    onCopyAddress,
    settingsTrigger,
    highlightActive,
    onClearHighlight,
    onPrev,
    onNext,
    saveIndicator,
  } = props;

  return (
    <div className="space-y-2 border-b border-border bg-surface/95 px-3 py-2 backdrop-blur md:px-4">
      {/* ردیف اول: مسیر اثر/جلد/صفحه + کپی + نشانک + تنظیمات */}
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="مسیر مطالعه" className="min-w-0 flex-1">
          <ol className="flex items-center gap-1.5 text-[13px] leading-5">
            <li className="min-w-0">
              <span className="block max-w-[9rem] truncate font-semibold text-foreground md:max-w-[14rem]">
                {workTitle ?? "در حال بارگیری…"}
              </span>
            </li>
            <li aria-hidden="true" className="text-muted-foreground">
              /
            </li>
            <li className="max-w-[7rem] truncate text-muted-foreground md:max-w-[10rem]">
              {documentLabel}
            </li>
            <li aria-hidden="true" className="text-muted-foreground">
              /
            </li>
            <li className="shrink-0 font-medium text-primary">صفحهٔ {pageLabel}</li>
          </ol>
        </nav>

        <div className="flex items-center gap-1">
          {saveIndicator}
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={onCopyAddress}
            aria-label="کپی نشانی این موضع"
            title="کپی نشانی این موضع"
          >
            <Copy className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={onToggleBookmark}
            disabled={bookmarkPending}
            aria-label={bookmarked ? "حذف نشانک این صفحه" : "نشانک‌کردن این صفحه"}
            aria-pressed={bookmarked}
            title={bookmarked ? "حذف نشانک این صفحه" : "نشانک‌کردن این صفحه"}
          >
            {bookmarked ? (
              <BookmarkCheck className="size-4 text-primary" aria-hidden="true" />
            ) : (
              <BookmarkPlus className="size-4" aria-hidden="true" />
            )}
          </Button>
          {settingsTrigger}
        </div>
      </div>

      {/* ردیف دوم: ناوبری + پرش + حالت نمایش + جست‌وجو */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => onPrev?.()}
            disabled={!onPrev}
            aria-label="صفحهٔ قبلی"
            title="صفحهٔ قبلی"
          >
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => onNext?.()}
            disabled={!onNext}
            aria-label="صفحهٔ بعدی"
            title="صفحهٔ بعدی"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <PageJump pageRefs={pageRefs} onJump={onJumpToPage} />

        {/* حالت نمایش: صفحه‌محور/پیوسته */}
        <div
          className="flex items-center rounded-lg border border-border p-0.5"
          role="group"
          aria-label="حالت نمایش"
        >
          <button
            type="button"
            aria-pressed={display === "paged"}
            onClick={() => onDisplayChange("paged")}
            className={cn(
              "inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors",
              display === "paged"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <BookOpenText className="size-3.5" aria-hidden="true" />
            صفحه‌محور
          </button>
          <button
            type="button"
            aria-pressed={display === "continuous"}
            onClick={() => onDisplayChange("continuous")}
            className={cn(
              "inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors",
              display === "continuous"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <ScrollText className="size-3.5" aria-hidden="true" />
            پیوسته
          </button>
        </div>

        <div className="flex-1" />

        {highlightActive ? (
          <button
            type="button"
            onClick={onClearHighlight}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-match bg-match/30 px-3 text-xs font-medium text-foreground hover:bg-match/45 md:min-h-9"
            title="پاک‌کردن نشانهٔ جست‌وجو"
          >
            <X className="size-3.5" aria-hidden="true" />
            پاک‌کردن نشانهٔ جست‌وجو
          </button>
        ) : null}

        <SearchInDocument documentUid={documentUid} onSearch={onSearchInDocument} />
      </div>
    </div>
  );
}
