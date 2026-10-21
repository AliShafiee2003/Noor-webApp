"use client";

/**
 * کتابخانه — فهرست آثار با جست‌وجوی سریع (debounce 250ms)، فیلتر زبان/مؤلف،
 * ترتیب نمایش و بارگیری تدریجی («بیشتر»).
 * صفحه‌ها با useQueries جمع می‌شوند (بدون state انباشتی)؛ تغییر فیلترها
 * با remount کلیددار به صفحهٔ نخست برمی‌گردد.
 */
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQueries, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api";
import { HashLink } from "@/lib/hash-router";
import { faNum } from "@/lib/format";
import { featureLabels, languageLabel } from "@/lib/labels";
import type { Work, WorkFeatures, WorkListResponse } from "@/lib/types";

const PAGE_SIZE = 20;

const FEATURE_BADGES: Array<{ key: keyof WorkFeatures; label: string }> = [
  { key: "hadith", label: featureLabels.hadith },
  { key: "quran", label: featureLabels.quran },
  { key: "footnotes", label: featureLabels.footnotes },
  { key: "topics", label: featureLabels.topics },
  { key: "media", label: featureLabels.media },
];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function WorkRow({ work }: { work: Work }) {
  return (
    <HashLink
      to={`/book/${work.uid}`}
      className="block rounded-xl border border-border bg-surface transition-colors hover:bg-accent focus-visible:bg-accent"
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-foreground">{work.title}</h3>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {[work.author, work.publisher, work.year].filter(Boolean).join(" · ") ||
                "مشخصات نویسنده و ناشر ثبت نشده"}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {work.published === false ? (
              <Badge variant="destructive" className="font-normal text-xs">
                از دسترس خارج شده
              </Badge>
            ) : null}
            {work.language ? (
              <Badge variant="outline">{languageLabel(work.language)}</Badge>
            ) : null}
            {work.documents_count !== null && work.documents_count !== undefined ? (
              <span className="text-xs text-muted-foreground">
                {faNum(work.documents_count)} سند
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">تعداد اسناد: ثبت نشده</span>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {work.features?.searchable_text === false ? (
            <Badge variant="outline" className="border-match bg-match/30 text-foreground">
              متن جست‌وجوپذیر ندارد
            </Badge>
          ) : null}
          {FEATURE_BADGES.filter((f) => work.features?.[f.key]).map((f) => (
            <Badge key={f.key} variant="secondary" className="font-normal">
              {f.label}
            </Badge>
          ))}
        </div>
      </CardContent>
    </HashLink>
  );
}

interface ResultsProps {
  q: string;
  author: string;
  language: string;
  sort: "title" | "volumes";
  filtersActive: boolean;
  onClearFilters: () => void;
}

function LibraryResults({ q, author, language, sort, filtersActive, onClearFilters }: ResultsProps) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const pageQueries = useQueries({
    queries: useMemo(
      () =>
        Array.from({ length: page }, (_, i) => {
          const pageNumber = i + 1;
          return {
            queryKey: ["works", { q, author, language, sort, page: pageNumber }],
            queryFn: () =>
              api.get<WorkListResponse>("/works", {
                q: q || undefined,
                author: author || undefined,
                language: language || undefined,
                sort,
                page: pageNumber,
                page_size: PAGE_SIZE,
              }),
            placeholderData: keepPreviousData,
            staleTime: 30_000,
          };
        }),
      [q, author, language, sort, page],
    ),
  });

  const firstError = pageQueries.find((query) => query.isError)?.error;
  const initialLoading = pageQueries.some((query) => query.isLoading);
  const fetchingMore = pageQueries.some(
    (query, i) => i === pageQueries.length - 1 && query.isFetching && page > 1,
  );

  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: Work[] = [];
    for (const query of pageQueries) {
      for (const work of query.data?.items ?? []) {
        if (!seen.has(work.uid)) {
          seen.add(work.uid);
          merged.push(work);
        }
      }
    }
    return merged;
  }, [pageQueries]);

  const total = pageQueries[0]?.data?.total ?? null;
  const hasMore = total !== null && items.length < total;

  return (
    <div>
      {initialLoading ? (
        <ListSkeleton rows={6} />
      ) : firstError ? (
        <ErrorState
          message={errorMessage(firstError, "بارگیری فهرست آثار ناموفق بود.")}
          onRetry={() => {
            void queryClient.invalidateQueries({ queryKey: ["works"] });
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="اثری با این مشخصات یافت نشد."
          hint={filtersActive ? "عبارت جست‌وجو یا فیلترها را تغییر دهید." : "فعلاً اثری در کتابخانه ثبت نشده است."}
          action={
            filtersActive ? (
              <Button variant="outline" className="min-h-11" onClick={onClearFilters}>
                پاک‌کردن فیلترها
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {total !== null ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {faNum(total)} اثر
            </p>
          ) : null}
          <ul className="space-y-3" aria-live="polite">
            {items.map((work) => (
              <li key={work.uid}>
                <WorkRow work={work} />
              </li>
            ))}
          </ul>
          {hasMore ? (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                className="min-h-11 gap-2 px-6"
                disabled={fetchingMore}
                onClick={() => setPage((p) => p + 1)}
              >
                {fetchingMore ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-4" aria-hidden="true" />
                )}
                بیشتر
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function LibraryView() {
  const [q, setQ] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("");
  const [sort, setSort] = useState<"title" | "volumes">("title");

  const debouncedQ = useDebounced(q, 250);
  const debouncedAuthor = useDebounced(author, 250);

  // کلید فیلترها؛ تغییر آن باعث remount نتایج و بازگشت به صفحهٔ نخست می‌شود.
  const filterKey = `${debouncedQ}\u241f${debouncedAuthor}\u241f${language}\u241f${sort}`;
  const filtersActive = Boolean(debouncedQ || debouncedAuthor || language);

  const clearFilters = () => {
    setQ("");
    setAuthor("");
    setLanguage("");
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold">کتابخانه</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          مرور آثار موجود در میزکار؛ برای مطالعه، اثر را باز کنید.
        </p>
      </header>

      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="library-q">جست‌وجوی سریع در عنوان‌ها</Label>
          <Input
            id="library-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بخشی از عنوان کتاب…"
            className="min-h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="library-author">مؤلف</Label>
          <Input
            id="library-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="نام مؤلف…"
            className="min-h-11 md:w-44"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="library-language">زبان</Label>
          <Select value={language} onValueChange={(v) => setLanguage(v === "all" ? "" : v)}>
            <SelectTrigger id="library-language" className="min-h-11 w-full md:w-36">
              <SelectValue placeholder="همهٔ زبان‌ها" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همهٔ زبان‌ها</SelectItem>
              <SelectItem value="ar">عربی</SelectItem>
              <SelectItem value="fa">فارسی</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="library-sort">ترتیب</Label>
          <Select
            value={sort}
            onValueChange={(v) => setSort(v === "volumes" ? "volumes" : "title")}
          >
            <SelectTrigger id="library-sort" className="min-h-11 w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title">بر پایهٔ عنوان</SelectItem>
              <SelectItem value="volumes">بر پایهٔ شمار مجلدات</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        نشان‌ها نوع محتوای اثر را نشان می‌دهند؛ وضعیت پوشش هر جلد در صفحهٔ اثر آمده است.
      </p>

      <LibraryResults
        key={filterKey}
        q={debouncedQ}
        author={debouncedAuthor}
        language={language}
        sort={sort}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
      />
    </div>
  );
}
