"use client";

/**
 * سطح دوم مشاهدهٔ نتایج — «کتاب‌های دارای تطبیق تأییدشده» (§۴۷)
 * POST /search/{sessionUID}/books → گروه‌بندی اثر/سند با شواهد.
 * عنوان دقیق: «منابع دارای این عبارت» + توضیح صریح: این فهرست به معنی
 * اثبات یکسانی حدیث یا اعتبار سند نیست (عدم جعل قطعیت).
 */
import { useQuery } from "@tanstack/react-query";
import { BookOpenText, FileText, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { api, ApiError, errorMessage } from "@/lib/api";
import { HashLink } from "@/lib/hash-router";
import { faNum } from "@/lib/format";
import type { SearchBooksGroup, SearchHighlight } from "@/lib/types";
import {
  HighlightedSnippet,
  normalizeOffsets,
} from "@/components/search/result-card";

interface BooksResponse {
  groups: SearchBooksGroup[];
}

/** شاهد سند — سرور همان ساختار Result را می‌فرستد؛ ساختار محلی با پوشش کامل */
interface EvidenceItem {
  passage_uid?: string;
  snippet?: string;
  highlight?: SearchHighlight[];
  page?: { uid: string; label: string } | null;
  document?: { uid: string; label: string } | null;
  source_offsets?: unknown;
  match_offsets?: [number, number] | null;
}

function EvidenceRow({
  evidence,
  workUid,
}: {
  evidence: EvidenceItem;
  workUid: string;
}) {
  const docUid = evidence.document?.uid ?? null;
  const offsets = evidence.source_offsets ? normalizeOffsets(evidence.source_offsets) : null;
  const hlOffsets = normalizeOffsets(evidence.match_offsets) ?? offsets;
  const readHref = docUid
    ? {
        to: `/read/${docUid}`,
        query: {
          ...(evidence.page?.uid ? { pg: evidence.page.uid } : {}),
          ...(hlOffsets ? { hl: `${hlOffsets.start}:${hlOffsets.end}` } : {}),
        },
      }
    : null;

  return (
    <li className="rounded-lg border border-border bg-reader p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        {[
          evidence.document?.label ? `سند: ${evidence.document.label}` : null,
          evidence.page?.label ? `صفحهٔ چاپی: ${evidence.page.label}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "جای‌گیری ثبت نشده"}
      </p>
      {evidence.snippet ? (
        <HighlightedSnippet snippet={evidence.snippet} highlight={evidence.highlight} />
      ) : (
        <p className="text-sm text-muted-foreground">شاهدی برای این سند ثبت نشده است.</p>
      )}
      {readHref ? (
        <HashLink
          to={readHref.to}
          query={readHref.query}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm text-link hover:underline md:min-h-0"
        >
          <FileText className="size-4" aria-hidden="true" />
          بازکردن در متن
        </HashLink>
      ) : workUid ? (
        <HashLink
          to={`/book/${workUid}`}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm text-link hover:underline md:min-h-0"
        >
          <BookOpenText className="size-4" aria-hidden="true" />
          بازکردن اثر
        </HashLink>
      ) : null}
    </li>
  );
}

export function BooksGroupedView({
  sessionUid,
  onSessionExpired,
}: {
  sessionUid: string | null;
  onSessionExpired: () => void;
}) {
  const query = useQuery({
    queryKey: ["search-books", sessionUid],
    queryFn: ({ signal }) =>
      api.post<BooksResponse>(`/search/${sessionUid}/books`, undefined, undefined),
    enabled: Boolean(sessionUid),
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!sessionUid) {
    return (
      <EmptyState
        title="هنوز جست‌وجویی اجرا نشده است"
        hint="برای مشاهدهٔ فهرست «منابع دارای این عبارت»، نخست جست‌وجو را اجرا کنید."
      />
    );
  }

  if (query.isPending) {
    return (
      <div className="space-y-2">
        <ListSkeleton rows={3} />
        <span className="sr-only">در حال بارگیری فهرست منابع…</span>
      </div>
    );
  }

  if (query.isError) {
    const expired = query.error instanceof ApiError && query.error.code === "gone_cursor";
    return (
      <EmptyState
        title={
          expired
            ? "مهلت این جست‌وجو پایان یافته است"
            : errorMessage(query.error, "بارگیری فهرست منابع ناموفق بود.")
        }
        hint={
          expired
            ? "برای مشاهدهٔ فهرست منابع دارای این عبارت، جست‌وجو را دوباره اجرا کنید."
            : undefined
        }
        action={
          expired ? (
            <Button variant="outline" className="min-h-11" onClick={onSessionExpired}>
              اجرای دوبارهٔ جست‌وجو
            </Button>
          ) : (
            <Button
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() => void query.refetch()}
            >
              <Loader2 className={query.isFetching ? "size-4 animate-spin" : "hidden size-4"} aria-hidden="true" />
              تلاش دوباره
            </Button>
          )
        }
      />
    );
  }

  const groups = query.data?.groups ?? [];
  if (groups.length === 0) {
    return (
      <EmptyState
        title="منبعی با این عبارت یافت نشد"
        hint="این فهرست فقط منابع دارای تطبیق تأییدشده را نشان می‌دهد."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="font-semibold text-foreground">منابع دارای این عبارت</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          این فهرست منابع دارای عبارت است؛ به معنی اثبات یکسانی حدیث یا اعتبار سند نیست.
        </p>
      </div>

      <ul className="space-y-3">
        {groups.map((group) => {
          const total = group.documents.reduce(
            (sum, d) => sum + (d.verified_occurrences ?? 0),
            0,
          );
          return (
            <li key={group.work.uid}>
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-semibold text-foreground">
                        {group.work.title ?? "منبع بدون عنوان"}
                      </h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {faNum(group.documents.length)} سند دارای تطبیق
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0 font-normal">
                      {faNum(total)} تطبیق تأییدشده
                    </Badge>
                  </div>
                  <ul className="space-y-2">
                    {group.documents.map((doc) => (
                      <li
                        key={doc.document.uid}
                        className="rounded-lg border border-border p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {doc.document.label || "سند بدون عنوان"}
                          </span>
                          {doc.verified_occurrences !== null &&
                          doc.verified_occurrences !== undefined ? (
                            <span className="text-xs text-muted-foreground">
                              {faNum(doc.verified_occurrences)} تطبیق
                            </span>
                          ) : null}
                        </div>
                        {(doc.evidence as unknown as EvidenceItem[]).length > 0 ? (
                          <ul className="mt-2 space-y-2">
                            {(doc.evidence as unknown as EvidenceItem[]).map((ev, i) => (
                              <EvidenceRow
                                key={`${doc.document.uid}-${i}`}
                                evidence={ev}
                                workUid={group.work.uid}
                              />
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">
                            شاهدی نمایش داده نمی‌شود؛ برای مشاهدهٔ مواضع، سند را باز کنید.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
