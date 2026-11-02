"use client";

/**
 * پنل نمایش نتایج جست‌وجو در کتاب جاری (DESIGN §۵، SEARCH-09)
 * - نمایش نتایج جست‌وجو منحصراً در محدودهٔ همین اثر (یا جلد)
 * - بدون خروج از محیط کتاب‌خوان
 * - پرش مستقیم به صفحه و موضع همراه با هایلایت و اسکرول نرم
 */

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  RotateCcw,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { faNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SearchHighlight, SearchResultItem } from "@/lib/types";

/* ---------- هایلایت snippet برای پنل فشرده ---------- */

function mergeHighlightRanges(
  highlight: SearchHighlight[],
  length: number,
): Array<{ start: number; end: number }> {
  const sorted = [...highlight]
    .filter((h) => typeof h.start === "number" && typeof h.end === "number" && h.unit !== "char")
    .map((h) => ({ start: Math.max(0, h.start), end: h.end }))
    .filter((h) => h.start < length && h.end > h.start)
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function CompactSnippet({
  snippet,
  highlight,
}: {
  snippet: string;
  highlight: SearchHighlight[] | undefined;
}) {
  const segments = useMemo(() => {
    const cps = Array.from(snippet);
    const ranges = mergeHighlightRanges(highlight ?? [], cps.length);
    const out: Array<{ text: string; highlighted: boolean }> = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) {
        out.push({ text: cps.slice(cursor, range.start).join(""), highlighted: false });
      }
      out.push({ text: cps.slice(range.start, range.end).join(""), highlighted: true });
      cursor = range.end;
    }
    if (cursor < cps.length) {
      out.push({ text: cps.slice(cursor).join(""), highlighted: false });
    }
    return out;
  }, [snippet, highlight]);

  return (
    <span lang="ar" dir="rtl" className="font-reader text-[13px] leading-6 text-foreground/90">
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <mark
            key={i}
            className="rounded-xs bg-match px-0.5 font-medium text-match-foreground"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

/* ---------- کامپوننت اصلی پنل جست‌وجو در کتاب ---------- */

export interface BookSearchPanelProps {
  query: string;
  onExecuteSearch?: (q: string) => void;
  scope: "work" | "document";
  ignoreSpacing?: boolean;
  onIgnoreSpacingChange?: (value: boolean) => void;
  onScopeChange: (scope: "work" | "document") => void;
  hasMultipleDocs: boolean;
  currentDocLabel?: string;
  results: SearchResultItem[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onClose: () => void;
  activePassageUid: string | null;
  onSelectResult: (item: SearchResultItem) => void;
  currentDocUid: string;
  currentPageUid: string | null;
}

export function BookSearchPanel({
  query,
  onExecuteSearch,
  scope,
  ignoreSpacing = false,
  onIgnoreSpacingChange,
  onScopeChange,
  hasMultipleDocs,
  currentDocLabel,
  results,
  isLoading,
  error,
  onRetry,
  onClose,
  activePassageUid,
  onSelectResult,
  currentDocUid,
  currentPageUid,
}: BookSearchPanelProps) {
  /* draft: مشتق از پراپ با override محلی — همگام‌سازی در افکت جایز نیست */
  const [draftOverride, setDraftOverride] = useState<string | null>(null);
  const draftQuery = draftOverride ?? query;

  // یافتن ایندکس نتیجهٔ فعال برای ناوبری بعدی/قبلی
  const activeIndex = useMemo(() => {
    if (!activePassageUid) return -1;
    return results.findIndex((r) => r.passage_uid === activePassageUid);
  }, [results, activePassageUid]);

  const handlePrev = () => {
    if (results.length === 0) return;
    const nextIdx = activeIndex <= 0 ? results.length - 1 : activeIndex - 1;
    onSelectResult(results[nextIdx]);
  };

  const handleNext = () => {
    if (results.length === 0) return;
    const nextIdx = activeIndex < 0 || activeIndex >= results.length - 1 ? 0 : activeIndex + 1;
    onSelectResult(results[nextIdx]);
  };

  return (
    <div className="flex h-full flex-col bg-surface text-foreground" dir="rtl">
      {/* سربرگ پنل نتایج */}
      <div className="border-b border-border p-3 space-y-2 shrink-0 bg-surface/90 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Search className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="text-xs font-bold text-foreground truncate">
              نتایج در این کتاب
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* دکمه‌های پرش به موضع قبلی / بعدی */}
            {results.length > 1 ? (
              <div className="flex items-center gap-0.5 border border-border rounded-md px-1 py-0.5 bg-background/60">
                <button
                  type="button"
                  onClick={handlePrev}
                  className="size-6 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors"
                  title="موضع قبلی"
                  aria-label="موضع قبلی"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <span className="text-[11px] font-mono px-1 text-muted-foreground select-none">
                  {activeIndex >= 0 ? `${faNum(activeIndex + 1)}/${faNum(results.length)}` : faNum(results.length)}
                </span>
                <button
                  type="button"
                  onClick={handleNext}
                  className="size-6 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors"
                  title="موضع بعدی"
                  aria-label="موضع بعدی"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              </div>
            ) : null}

            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              title="بستن نتایج جست‌وجو"
              aria-label="بستن نتایج جست‌وجو"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {onExecuteSearch ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = draftQuery.trim();
              if (q) {
                onExecuteSearch(q);
                setDraftOverride(null);
              }
            }}
            className="relative flex items-center pt-0.5"
          >
            <Input
              value={draftQuery}
              onChange={(e) => setDraftOverride(e.target.value)}
              placeholder="جست‌وجو در این کتاب…"
              className="h-8 ps-7 pe-7 text-xs rounded-md border-input/80 bg-background/90"
            />
            <button
              type="submit"
              disabled={!draftQuery.trim() || isLoading}
              className="absolute start-2 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
              title="جست‌وجو"
            >
              {isLoading ? (
                <Loader2 className="size-3 animate-spin text-primary" />
              ) : (
                <Search className="size-3.5" />
              )}
            </button>
            {draftQuery ? (
              <button
                type="button"
                onClick={() => {
                  setDraftOverride(null);
                  onExecuteSearch("");
                }}
                className="absolute end-2 text-muted-foreground hover:text-foreground transition-colors"
                title="پاک‌کردن"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </form>
        ) : null}

        {/* برچسب عبارت جست‌وجو شده و شمارش */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-muted-foreground shrink-0">عبارت:</span>
            <span
              className="max-w-[10rem] truncate rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary text-[11px]"
              title={query}
            >
              «{query}»
            </span>
          </div>
          {!isLoading && (
            <span className="text-[11px] text-muted-foreground shrink-0">
              {results.length > 0 ? `${faNum(results.length)} یافته` : "بدون یافته"}
            </span>
          )}
        </div>

        {onIgnoreSpacingChange && <label className="flex items-center gap-2 py-2 text-xs"><input type="checkbox" checked={ignoreSpacing} onChange={(e) => onIgnoreSpacingChange(e.target.checked)} />نادیده گرفتن فاصله و نیم‌فاصله</label>}
        {/* فیلتر دامنه: کل کتاب / فقط این جلد (در صورت چندجلدی بودن) */}
        {hasMultipleDocs ? (
          <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onScopeChange("work")}
              className={cn(
                "flex-1 rounded-md py-1 px-2 text-center transition-colors text-[11px]",
                scope === "work"
                  ? "bg-background font-semibold text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              همهٔ جلدها
            </button>
            <button
              type="button"
              onClick={() => onScopeChange("document")}
              className={cn(
                "flex-1 rounded-md py-1 px-2 text-center transition-colors text-[11px]",
                scope === "document"
                  ? "bg-background font-semibold text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {currentDocLabel ? `فقط ${currentDocLabel}` : "فقط این جلد"}
            </button>
          </div>
        ) : null}
      </div>

      {/* فهرست نتایج یا وضعیت بارگیری/خطا */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 space-y-3" aria-busy="true">
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
              <span>در حال جست‌وجو در متن کتاب…</span>
            </div>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border border-border/70 p-3 space-y-2 bg-background/40">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center space-y-3">
            <p className="text-xs text-destructive">
              {error.message || "خطا در برقراری ارتباط با سرور."}
            </p>
            <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5 text-xs">
              <RotateCcw className="size-3.5" />
              تلاش دوباره
            </Button>
          </div>
        ) : results.length === 0 ? (
          <div className="p-6 text-center space-y-2">
            <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <SearchX className="size-5" aria-hidden="true" />
            </div>
            <p className="text-xs font-semibold text-foreground">
              موردی برای «{query}» در این کتاب یافت نشد.
            </p>
            <p className="text-[11px] leading-5 text-muted-foreground">
              املای واژه یا شکل بدون اعراب آن را بررسی کنید یا عبارت خلاصه‌تری بنویسید.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60" aria-label="فهرست مواضع یافت‌شده">
            {results.map((item, idx) => {
              const isSelected = activePassageUid === item.passage_uid;
              const isSameDoc = !item.document?.uid || item.document.uid === currentDocUid;
              const isSamePage = isSameDoc && item.page?.uid === currentPageUid;

              return (
                <li key={item.passage_uid || `res-${idx}`}>
                  <button
                    type="button"
                    onClick={() => onSelectResult(item)}
                    className={cn(
                      "w-full text-start p-3 transition-all flex flex-col gap-1.5 focus-visible:outline-2 focus-visible:outline-ring",
                      isSelected
                        ? "bg-primary/10 border-s-3 border-s-primary shadow-xs"
                        : "hover:bg-accent/60"
                    )}
                  >
                    {/* اطلاعات موضع: شماره صفحه + جلد + عنوان بخش */}
                    <div className="flex items-center justify-between text-xs w-full gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-primary text-xs">
                          صفحه {faNum(item.page?.label ?? "—")}
                        </span>
                        {item.document?.label && hasMultipleDocs ? (
                          <span className="text-muted-foreground text-[11px] truncate">
                            ({item.document.label})
                          </span>
                        ) : null}
                      </div>

                      {isSamePage ? (
                        <span className="shrink-0 text-[10px] rounded bg-primary/15 text-primary px-1.5 py-0.2 font-medium">
                          صفحهٔ فعلی
                        </span>
                      ) : null}
                    </div>

                    {item.section?.title ? (
                      <div className="text-[11px] text-muted-foreground truncate w-full flex items-center gap-1">
                        <FileText className="size-3 shrink-0 opacity-70" />
                        <span className="truncate">{item.section.title}</span>
                      </div>
                    ) : null}

                    {/* قطعه متن با هایلایت عبارت */}
                    <div className="line-clamp-3 text-start w-full">
                      <CompactSnippet snippet={item.snippet} highlight={item.highlight} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
