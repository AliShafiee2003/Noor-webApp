"use client";

/**
 * مقایسهٔ متن‌ها (REL-05/06) — دو ستون کاملاً مستقل در دسکتاپ (xl)
 * - هر ستون: انتخاب اثر → انتخاب جلد/سند → نمایش صفحه با پرش مستقل
 * - جست‌وجوی مستقل در هر ستون (پرش به صفحهٔ نتیجه با برجسته‌سازی)
 * - نوار بالای هر ستون: عنوان اثر/صفحه + کپی نشانی
 * - موبایل: تب سریع بین دو ستون (هرگز دو ستون باریک رندر نمی‌شود)
 * - خطای هر ستون مستقل است و هرگز ستون دیگر را خراب نمی‌کند.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState } from "@/components/feedback";
import { PageRenderer } from "@/components/reader/page-renderer";
import { api, errorMessage } from "@/lib/api";
import { faNum } from "@/lib/format";
import { documentKindLabel } from "@/lib/labels";
import { useWorkspaceStore } from "@/store/workspace";
import type {
  PagePayload,
  PageRef,
  SearchResultItem,
  SourceOffsets,
  Work,
  WorkDetail,
} from "@/lib/types";

/** پوشش هر دو شکل source_offsets (شیء یا آرایهٔ دوتایی) */
function normalizeOffsets(offsets: SourceOffsets | [number, number] | null | undefined) {
  if (!offsets) return null;
  if (Array.isArray(offsets)) return { start: offsets[0], end: offsets[1] };
  if (typeof offsets.start === "number" && typeof offsets.end === "number") {
    return { start: offsets.start, end: offsets.end };
  }
  return null;
}

/** نگاشت بازهٔ سطح سند به بازهٔ داخل بلوک (برای برجسته‌سازی) */
function locateHighlight(
  page: PagePayload,
  offsets: { start: number; end: number },
): { start: number; end: number; blockId: string } | null {
  for (const block of page.blocks) {
    const range = normalizeOffsets(block.source_offsets);
    if (!range) continue;
    if (offsets.start >= range.start && offsets.start < range.end) {
      return {
        start: offsets.start - range.start,
        end: Math.max(offsets.start - range.start + 1, Math.min(offsets.end, range.end) - range.start),
        blockId: block.id,
      };
    }
  }
  return null;
}

/** شاهد نتیجهٔ جست‌وجو با برجسته‌سازی بدون innerHTML */
function SnippetText({ result }: { result: SearchResultItem }) {
  const cps = Array.from(result.snippet ?? "");
  const h = result.highlight?.[0];
  if (!h || h.start < 0 || h.end <= h.start || h.end > cps.length) {
    return <>{result.snippet}</>;
  }
  return (
    <>
      {cps.slice(0, h.start).join("")}
      <mark className="rounded-sm bg-match px-0.5 text-match-foreground">
        {cps.slice(h.start, h.end).join("")}
      </mark>
      {cps.slice(h.end).join("")}
    </>
  );
}

/* ---------- یک ستون مقایسه ---------- */

function ComparePane({ sideLabel }: { sideLabel: string }) {
  const prefs = useWorkspaceStore((s) => s.prefs);

  /* انتخاب‌های مستقل این ستون */
  const [workUid, setWorkUid] = useState<string | null>(null);
  const [docUid, setDocUid] = useState<string | null>(null);
  const [pageUid, setPageUid] = useState<string | null>(null);
  const [hl, setHl] = useState<{ pageUid: string; start: number; end: number } | null>(null);

  /* جست‌وجوی مستقل ستون */
  const [searchDraft, setSearchDraft] = useState("");
  const searchMutation = useMutation({
    mutationFn: (query: string) =>
      api.post<{
        results: SearchResultItem[];
        verified_occurrences: number | null;
        count_relation: string;
      }>("/search", {
        query,
        mode: "all_words",
        scope: { target: "document", document_uids: docUid ? [docUid] : [] },
        page_size: 20,
      }),
  });

  /** تغییر اثر → سند/صفحه/جست‌وجوی همان ستون باطل می‌شود. */
  const changeWork = (uid: string | null) => {
    setWorkUid(uid);
    setDocUid(null);
    setPageUid(null);
    setHl(null);
    setSearchDraft("");
    searchMutation.reset();
  };
  /** تغییر سند → صفحه و برجسته‌سازی باطل می‌شود. */
  const changeDoc = (uid: string | null) => {
    setDocUid(uid);
    setPageUid(null);
    setHl(null);
  };

  const worksQuery = useQuery({
    queryKey: ["compare-works"],
    queryFn: () => api.get<{ items: Work[] }>("/works", { page_size: 100 }),
    staleTime: 5 * 60_000,
  });
  const works = worksQuery.data?.items ?? [];

  const workDetailQuery = useQuery({
    queryKey: ["compare-work", workUid],
    enabled: !!workUid,
    queryFn: () => api.get<WorkDetail>(`/works/${workUid}`),
    staleTime: 5 * 60_000,
  });
  const documents = workDetailQuery.data?.documents ?? [];

  const pagesQuery = useQuery({
    queryKey: ["compare-pages", docUid],
    enabled: !!docUid,
    queryFn: () => api.get<{ items: PageRef[] }>(`/documents/${docUid}/pages`),
    retry: false,
  });
  const pages = pagesQuery.data?.items ?? [];

  /* صفحهٔ مؤثر: انتخاب کاربر یا نخستین صفحهٔ سند */
  const effectivePageUid =
    pageUid && pages.some((p) => p.page_uid === pageUid)
      ? pageUid
      : pages.length > 0
        ? pages[0].page_uid
        : null;

  const pageQuery = useQuery({
    queryKey: ["compare-page", docUid, effectivePageUid],
    enabled: !!docUid && !!effectivePageUid,
    queryFn: () => api.get<PagePayload>(`/documents/${docUid}/pages/${effectivePageUid}`),
    retry: false,
  });
  const page = pageQuery.data ?? null;

  const workTitle = works.find((w) => w.uid === workUid)?.title ?? workDetailQuery.data?.title ?? null;
  const docLabel = documents.find((d) => d.uid === docUid)?.label ?? null;

  const pageIdx = pages.findIndex((p) => p.page_uid === effectivePageUid);
  const prevRef = pageIdx > 0 ? pages[pageIdx - 1] : null;
  const nextRef = pageIdx >= 0 && pageIdx < pages.length - 1 ? pages[pageIdx + 1] : null;

  const highlight = useMemo(() => {
    if (!hl || !page || page.page_uid !== hl.pageUid) return null;
    return locateHighlight(page, hl);
  }, [hl, page]);

  const copyAddress = async () => {
    if (!docUid) return;
    const citation = [
      workTitle ?? "",
      docLabel ? `جلد ${docLabel}` : "",
      page ? `صفحهٔ ${page.label}` : "",
    ]
      .filter(Boolean)
      .join("، ");
    const address = `#/read/${docUid}${effectivePageUid ? `?pg=${effectivePageUid}` : ""}`;
    try {
      await navigator.clipboard.writeText(`${citation}\n${address}`);
    } catch {
      /* کپی در دسترس نیست — بی‌صدا */
    }
  };

  const jumpToResult = (result: SearchResultItem) => {
    if (!result.page?.uid) return;
    const offsets = normalizeOffsets(result.source_offsets);
    setHl(offsets ? { pageUid: result.page.uid, start: offsets.start, end: offsets.end } : null);
    setPageUid(result.page.uid);
  };

  return (
    <section
      aria-label={`مقایسهٔ ${sideLabel}`}
      className="flex min-w-0 flex-col rounded-xl border border-border bg-surface"
    >
      {/* نوار بالای ستون */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">{sideLabel}</p>
          <p className="truncate text-sm font-semibold text-foreground">
            {workTitle ?? "اثری انتخاب نشده"}
            {docLabel
              ? ` — ${documentKindLabel(documents.find((d) => d.uid === docUid)?.kind)} ${docLabel}`
              : ""}
            {page ? ` — صفحهٔ ${page.label}` : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 gap-2"
          disabled={!docUid}
          onClick={() => void copyAddress()}
        >
          <Copy className="size-4" aria-hidden="true" />
          کپی نشانی
        </Button>
      </div>

      {/* انتخاب منبع */}
      <div className="grid gap-2 border-b border-border px-3 py-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`pane-work-${sideLabel}`}>انتخاب اثر</Label>
          <Select
            value={workUid ?? ""}
            onValueChange={(v) => changeWork(v || null)}
          >
            <SelectTrigger id={`pane-work-${sideLabel}`} className="min-h-11 w-full">
              <SelectValue placeholder={worksQuery.isPending ? "در حال بارگیری…" : "یک اثر انتخاب کنید"} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {works.map((w) => (
                <SelectItem key={w.uid} value={w.uid}>
                  {w.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`pane-doc-${sideLabel}`}>انتخاب جلد / سند</Label>
          <Select
            value={docUid ?? ""}
            onValueChange={(v) => changeDoc(v || null)}
            disabled={!workUid || workDetailQuery.isPending}
          >
            <SelectTrigger id={`pane-doc-${sideLabel}`} className="min-h-11 w-full">
              <SelectValue
                placeholder={
                  !workUid
                    ? "نخست اثر را انتخاب کنید"
                    : workDetailQuery.isPending
                      ? "در حال بارگیری…"
                      : "سند را انتخاب کنید"
                }
              />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {documents.map((d) => (
                <SelectItem key={d.uid} value={d.uid}>
                  {`${documentKindLabel(d.kind)} ${d.label}`.trim()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* جست‌وجوی مستقل در همین سند */}
      <form
        role="search"
        className="flex items-start gap-2 border-b border-border px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          const query = searchDraft.trim();
          if (!query || !docUid) return;
          searchMutation.mutate(query);
        }}
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="جست‌وجو در همین سند…"
            aria-label={`جست‌وجو در سند ${sideLabel}`}
            disabled={!docUid}
            className="min-h-11 pe-9"
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          className="min-h-11"
          disabled={!docUid || searchMutation.isPending}
        >
          {searchMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            "جست‌وجو"
          )}
        </Button>
      </form>

      {/* نتایج جست‌وجوی ستون */}
      {searchMutation.isError ? (
        <div className="px-3 pt-3">
          <ErrorState
            message={errorMessage(searchMutation.error, "جست‌وجو در این سند ممکن نشد؛ دوباره تلاش کنید.")}
            onRetry={() => searchMutation.mutate(searchDraft.trim())}
          />
        </div>
      ) : searchMutation.data ? (
        <div className="border-b border-border px-3 py-3">
          {searchMutation.data.results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              در این سند تطبیقی برای این عبارت یافت نشد.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {searchMutation.data.verified_occurrences !== null
                  ? `${faNum(searchMutation.data.verified_occurrences)} نتیجه یافت شد`
                  : "در حال شمارش…"}
              </p>
              <ul className="max-h-56 space-y-2 overflow-y-auto pe-1">
                {searchMutation.data.results.map((r, ri) => (
                  <li key={r.passage_uid + "-" + ri}>
                    <button
                      type="button"
                      className="w-full rounded-lg border border-border px-3 py-2 text-start transition-colors hover:bg-accent"
                      onClick={() => jumpToResult(r)}
                    >
                      <span className="block text-xs text-muted-foreground">
                        صفحهٔ چاپی: {r.page?.label ?? "نامشخص"}
                      </span>
                      <span className="mt-1 block text-sm leading-6" lang="ar" dir="rtl">
                        <SnippetText result={r} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {/* متن صفحه — خطای این ستون مستقل است */}
      <div className="min-h-0 flex-1">
        {!workUid ? (
          <EmptyState
            title="برای آغاز مقایسه، یک اثر انتخاب کنید."
            hint="انتخاب هر موضع مستقل است. نشانی و ارجاع پس از انتخاب متن در دسترس قرار می‌گیرند."
          />
        ) : !docUid ? (
          <EmptyState
            title="هنوز موضعی انتخاب نشده است."
            hint="از فهرست «انتخاب جلد / سند» یکی را برگزینید."
          />
        ) : pagesQuery.isPending ? (
          <div className="space-y-3 p-4" aria-busy="true">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-40 w-full" />
            <span className="sr-only">در حال بارگیری فهرست صفحات…</span>
          </div>
        ) : pagesQuery.isError ? (
          <div className="p-4">
            <ErrorState
              message="فهرست صفحات این سند بارگیری نشد."
              onRetry={() => void pagesQuery.refetch()}
            />
          </div>
        ) : pages.length === 0 ? (
          <EmptyState
            title="این سند صفحه‌ای برای نمایش ندارد."
            hint="سند دیگری را انتخاب کنید."
          />
        ) : pageQuery.isPending ? (
          <div className="space-y-3 p-4" aria-busy="true">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-48 w-full" />
            <span className="sr-only">در حال بارگیری متن صفحه…</span>
          </div>
        ) : pageQuery.isError || !page ? (
          <div className="p-4">
            <ErrorState
              message="نمایش این صفحه ممکن نشد؛ ستون دیگر تحت تأثیر قرار نمی‌گیرد."
              onRetry={() => void pageQuery.refetch()}
            />
          </div>
        ) : (
          <div className="bg-reader" lang="ar" dir="rtl">
            <PageRenderer
              page={page}
              prefs={prefs}
              sectionUidByBlockId={{}}
              highlight={highlight}
              collapsedSanads={new Set<string>()}
              onToggleSanad={() => undefined}
              onFootnoteClick={() => undefined}
              onLinkClick={() => undefined}
              onSelection={() => undefined}
            />
          </div>
        )}
      </div>

      {/* پرش مستقل صفحات */}
      {pages.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 gap-1"
            disabled={!prevRef}
            onClick={() => prevRef && setPageUid(prevRef.page_uid)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
            صفحهٔ قبل
          </Button>
          <div className="flex items-center gap-2">
            <Label htmlFor={`pane-jump-${sideLabel}`} className="text-xs text-muted-foreground">
              پرش به صفحه
            </Label>
            <Select
              value={effectivePageUid ?? ""}
              onValueChange={(v) => {
                setPageUid(v);
                setHl(null);
              }}
            >
              <SelectTrigger id={`pane-jump-${sideLabel}`} className="min-h-11 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {pages.map((p) => (
                  <SelectItem key={p.page_uid} value={p.page_uid}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 gap-1"
            disabled={!nextRef}
            onClick={() => nextRef && setPageUid(nextRef.page_uid)}
          >
            صفحهٔ بعد
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- نمای اصلی ---------- */

export function CompareView() {
  const [activePane, setActivePane] = useState<"a" | "b">("a");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold">مقایسهٔ متن‌ها</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          دو موضع از یک اثر یا دو اثر متفاوت را کنار هم بررسی کنید.
        </p>
      </header>

      {/* تب سریع موبایل — در دسکتاپ هر دو ستون هم‌زمان دیده می‌شوند */}
      <Tabs
        value={activePane}
        onValueChange={(v) => setActivePane(v as "a" | "b")}
        className="mb-3 xl:hidden"
      >
        <TabsList className="h-11 w-full">
          <TabsTrigger value="a" className="min-h-9 flex-1">
            موضع اول
          </TabsTrigger>
          <TabsTrigger value="b" className="min-h-9 flex-1">
            موضع دوم
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className={activePane === "a" ? "min-w-0" : "hidden xl:block"}>
          <ComparePane sideLabel="موضع اول" />
        </div>
        <div className={activePane === "b" ? "min-w-0" : "hidden xl:block"}>
          <ComparePane sideLabel="موضع دوم" />
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-muted-foreground xl:hidden">
        هر دو موضع را در یک صفحه ببینید؛ متن‌ها به ترتیب زیر هم نمایش داده می‌شوند.
      </p>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        برای پیوند دادن دو موضع در یادداشت‌های خود، از دکمهٔ «کپی نشانی» هر موضع استفاده کنید.
      </p>
    </div>
  );
}
