"use client";

/**
 * صفحهٔ «موضوعات» — PRD §۱۵، TOP-05/06/07
 * - فهرست موضوعات با تعداد + نوار پوشش صریح («پوشش فهرست موضوعی» + coverage_note)
 * - کلیک موضوع → مواضع/آثار ثبت‌شده با دکمهٔ بازکردن
 * - هرگز «نبود موضوع = نبود محتوا» نیست (TOP-06) — پیام صریح
 * - «جست‌وجوی این موضوع در متن» → ترکیب با جست‌وجوی متنی (TOP-05)
 * - برچسب شخصی جدا از موضوع اصلی است (TOP-07) — اینجا فقط توضیحی
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpenText, ChevronLeft, Compass, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import { api } from "@/lib/api";
import { HashLink, useRoute } from "@/lib/hash-router";
import { faNum } from "@/lib/format";
import type { Topic } from "@/lib/types";

/* ---------- پوشش پاسخ‌های ممکن (قرارداد/پیاده‌سازی) ---------- */

interface TopicsPayload {
  items: Topic[];
  coverage_note?: string | null;
}

function normalizeTopics(data: unknown): TopicsPayload {
  if (Array.isArray(data)) return { items: data as Topic[] };
  if (data && typeof data === "object" && Array.isArray((data as TopicsPayload).items)) {
    return data as TopicsPayload;
  }
  return { items: [] };
}

interface OccurrenceItem {
  kind?: string | null;
  work_uid?: string | null;
  work_title?: string | null;
  note?: string | null;
  snippet?: string | null;
  work?: { uid?: string | null; title?: string | null } | null;
}

interface OccurrencesPayload {
  items: OccurrenceItem[];
  coverage_note?: string | null;
}

function normalizeOccurrences(data: unknown): OccurrencesPayload {
  if (Array.isArray(data)) return { items: data as OccurrenceItem[] };
  if (data && typeof data === "object" && Array.isArray((data as OccurrencesPayload).items)) {
    return data as OccurrencesPayload;
  }
  return { items: [] };
}

/* ---------- ردیف موضوع ---------- */

function TopicRow({
  topic,
  selected,
  onSelect,
  depth = 0,
}: {
  topic: Topic;
  selected: boolean;
  onSelect: (topic: Topic) => void;
  depth?: number;
}) {
  return (
    <li style={{ marginInlineStart: depth > 0 ? `${depth * 16}px` : undefined }}>
      <button
        type="button"
        onClick={() => onSelect(topic)}
        aria-current={selected ? "true" : undefined}
        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
          selected
            ? "bg-primary/10 text-primary"
            : "hover:bg-accent focus-visible:bg-accent"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Compass
            className={`size-4 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`}
            aria-hidden="true"
          />
          <span className="truncate text-sm font-medium">{topic.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {typeof topic.count === "number" ? (
            <Badge variant="secondary" className="font-normal">
              {faNum(topic.count)} اثر
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">تعداد: ثبت نشده</span>
          )}
          <ChevronLeft className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
      </button>
      {topic.children?.length ? (
        <ul className="mt-1 space-y-1">
          {topic.children.map((child) => (
            <TopicRow
              key={child.uid}
              topic={child}
              selected={selected}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/* ---------- مواضع موضوع انتخاب‌شده ---------- */

function TopicOccurrences({ topic }: { topic: Topic }) {
  const query = useQuery({
    queryKey: ["topic-occurrences", topic.uid],
    queryFn: ({ signal }) =>
      api.get<unknown>(`/topics/${topic.uid}/occurrences`, undefined, signal),
    staleTime: 60_000,
  });

  if (query.isPending) {
    return (
      <div className="space-y-2">
        <ListSkeleton rows={3} />
        <span className="sr-only">در حال بارگیری مواضع موضوع…</span>
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        message="بارگیری مواضع این موضوع ناموفق بود."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const payload = normalizeOccurrences(query.data);
  const items = payload.items;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">موضوع: {topic.title}</h2>
        {payload.coverage_note ? (
          <p className="mt-1 text-xs text-muted-foreground">{payload.coverage_note}</p>
        ) : null}
      </div>

      {items.length === 0 ? (
        /* TOP-06 — نبود موضوع هرگز به معنی نبود محتوا نیست */
        <EmptyState
          title="منابع بدون نمایهٔ موضوعی در این فهرست نمی‌آیند"
          hint="نبود این موضوع در فهرست، به معنی نبود محتوای مرتبط در کتابخانه نیست؛ برای یافتن مطالب مرتبط، جست‌وجوی متنی را امتحان کنید."
          action={
            <HashLink
              to="/search"
              query={{ q: topic.title, mode: "normalized_phrase", scope: "library" }}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Search className="size-4" aria-hidden="true" />
              جست‌وجوی این موضوع در متن
            </HashLink>
          }
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => {
            const workUid = item.work_uid ?? item.work?.uid ?? null;
            const workTitle = item.work_title ?? item.work?.title ?? "منبع بدون عنوان";
            return (
              <li
                key={`${workUid ?? "item"}-${i}`}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{workTitle}</h3>
                    {item.note ? (
                      <p className="mt-1 text-sm text-muted-foreground">{item.note}</p>
                    ) : null}
                    {item.snippet ? (
                      <p
                        lang="ar"
                        dir="rtl"
                        className="font-reader mt-2 rounded-lg border-s-4 border-match/70 bg-reader p-2.5 text-[1.02rem] leading-8"
                      >
                        {item.snippet}
                      </p>
                    ) : null}
                  </div>
                  {item.kind ? (
                    <Badge variant="outline" className="shrink-0 font-normal">
                      {item.kind === "work" ? "اثر" : item.kind === "passage" ? "موضع" : item.kind}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {workUid ? (
                    <HashLink
                      to={`/book/${workUid}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <BookOpenText className="size-4" aria-hidden="true" />
                      بازکردن اثر
                    </HashLink>
                  ) : null}
                  <HashLink
                    to="/search"
                    query={{ q: topic.title, mode: "normalized_phrase", scope: "library" }}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    <Search className="size-4" aria-hidden="true" />
                    جست‌وجوی این موضوع در متن
                  </HashLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- نمای اصلی موضوعات ---------- */

export function TopicsView() {
  const { route, navigate } = useRoute();
  const selectedUid = route.query.t ?? "";

  const [filter, setFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilter(filter), 250);
    return () => clearTimeout(timer);
  }, [filter]);

  const topicsQuery = useQuery({
    queryKey: ["topics", { q: debouncedFilter }],
    queryFn: ({ signal }) =>
      api.get<unknown>(
        "/topics",
        { q: debouncedFilter || undefined },
        signal,
      ),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const topicsData = normalizeTopics(topicsQuery.data);
  const topics = topicsData.items;
  const selectedTopic = useMemo(() => {
    const find = (list: Topic[]): Topic | null => {
      for (const t of list) {
        if (t.uid === selectedUid) return t;
        const inChild = find(t.children ?? []);
        if (inChild) return inChild;
      }
      return null;
    };
    return selectedUid ? find(topics) : null;
  }, [topics, selectedUid]);

  const selectTopic = (topic: Topic) => {
    navigate("/topics", { t: topic.uid });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold">موضوعات</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          فهرست موضوعی منابع؛ موضوعی را برگزینید تا آثار و مواضع ثبت‌شدهٔ آن را ببینید.
        </p>
      </header>

      {/* نوار پوشش صریح (§۱۵) */}
      <Card className="mb-5 border-dashed">
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold">پوشش فهرست موضوعی</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {topicsData.coverage_note ??
              "این فهرست فقط منابع دارای نمایهٔ موضوعی را پوشش می‌دهد؛ نبود موضوع به معنی نبود محتوا نیست."}
          </p>
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        {/* فهرست موضوعات */}
        <section aria-label="فهرست موضوعات" className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="topics-filter" className="text-sm font-medium">
              جست‌وجو در موضوعات
            </label>
            <Input
              id="topics-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="نام موضوع…"
              className="min-h-11"
              autoComplete="off"
            />
          </div>

          {topicsQuery.isPending ? (
            <ListSkeleton rows={5} />
          ) : topicsQuery.isError ? (
            <ErrorState
              message="بارگیری فهرست موضوعات ناموفق بود."
              onRetry={() => void topicsQuery.refetch()}
            />
          ) : topics.length === 0 ? (
            <EmptyState
              title="موضوعی با این مشخصات یافت نشد"
              hint="عبارت دیگری را امتحان کنید؛ یادتان باشد فقط منابع دارای نمایهٔ موضوعی در این فهرست می‌آیند."
            />
          ) : (
            <ul className="max-h-[32rem] space-y-1 overflow-y-auto rounded-xl border border-border bg-surface p-2">
              {topics.map((topic) => (
                <TopicRow
                  key={topic.uid}
                  topic={topic}
                  selected={topic.uid === selectedUid}
                  onSelect={selectTopic}
                />
              ))}
            </ul>
          )}

          {/* TOP-07 — برچسب شخصی جدا از موضوع اصلی (فقط توضیحی) */}
          <p className="rounded-xl border border-border bg-surface p-3 text-xs leading-6 text-muted-foreground">
            برچسب‌های شخصی که به فیش‌های خود می‌دهید جدا از این فهرست موضوعی نگه داشته می‌شوند؛
            این صفحه تنها نمایهٔ رسمی موضوعات منابع را نشان می‌دهد.
          </p>
        </section>

        {/* مواضع موضوع انتخاب‌شده */}
        <section aria-label="مواضع موضوع" className="min-w-0">
          {selectedTopic ? (
            <TopicOccurrences topic={selectedTopic} />
          ) : (
            <EmptyState
              title="موضوعی برگزینید"
              hint="از فهرست کنار یک موضوع را انتخاب کنید تا آثار و مواضع ثبت‌شدهٔ آن نمایش داده شود."
            />
          )}
        </section>
      </div>
    </div>
  );
}
