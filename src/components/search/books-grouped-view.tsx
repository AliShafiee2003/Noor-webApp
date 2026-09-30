"use client";

/**
 * سطح دوم مشاهدهٔ نتایج — «کتاب‌های دارای تطبیق تأییدشده» (§۴۷)
 * POST /search/{sessionUID}/books → گروه‌بندی اثر/سند با شواهد.
 * عنوان دقیق: «منابع دارای این عبارت» + توضیح صریح: این فهرست به معنی
 * اثبات یکسانی حدیث یا اعتبار سند نیست (عدم جعل قطعیت).
 *
 * شواهد هر سند با همان کارت نتیجهٔ مواضع (ResultCard) رندر می‌شود تا
 * همهٔ اقدام‌ها یکسان در دسترس باشد: نشان نوع تطبیق، چیپ روایت لینک‌پذیر
 * (HAD-08) با «در کدام کتاب‌ها؟» (§۴۷)، افزودن به فیش، کپی ارجاع و
 * «کنار نتایج» (SEARCH-11). پاسخ سرور برای شواهد همان ساختار Result است.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { api, ApiError, errorMessage } from "@/lib/api";
import { faNum } from "@/lib/format";
import { ResultCard } from "@/components/search/result-card";
import type { SearchResultItem } from "@/lib/types";

interface BooksResponse {
  groups: {
    work: { uid: string; title?: string | null };
    documents: Array<{
      document: { uid: string; label?: string | null };
      verified_occurrences?: number | null;
      /** شواهد — همان ساختار Result موتور؛ به ResultCard منتقل می‌شود */
      evidence: SearchResultItem[];
    }>;
  }[];
}

export function BooksGroupedView({
  sessionUid,
  onSessionExpired,
  releaseUid,
  onOpenSplit,
  splitActiveUid,
}: {
  sessionUid: string | null;
  onSessionExpired: () => void;
  /** نسخهٔ فعال نمایه برای ثبت فیش (TECH-08) */
  releaseUid?: string | null;
  /** SEARCH-11: بازکردن شاهد در پنل کنار نتایج */
  onOpenSplit?: (result: SearchResultItem) => void;
  /** گذرِ نتیجه‌ای که اکنون در پنل باز است (نشانی سند) */
  splitActiveUid?: string | null;
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
                        {doc.evidence?.length > 0 ? (
                          <ul className="mt-2 space-y-2">
                            {doc.evidence.map((ev, i) => (
                              /* کلید با ایندکس — ممکن است دو تطبیقِ یک passage
                                 (با بازهٔ متفاوت) در شواهد یک سند بیاید */
                              <li key={`${doc.document.uid}-${ev.passage_uid ?? "ev"}-${i}`}>
                                <ResultCard
                                  result={ev}
                                  releaseUid={releaseUid ?? null}
                                  onOpenSplit={onOpenSplit}
                                  splitActive={
                                    Boolean(splitActiveUid) &&
                                    ev.document?.uid === splitActiveUid
                                  }
                                />
                              </li>
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
