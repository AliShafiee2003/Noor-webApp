"use client";

/**
 * صفحهٔ «جست‌وجو در منابع» — PRD §۱۲، §۴۱ «نتایج»، §۴۴–۴۷
 * - فرم با mode/دامنه/حالت پیشرفته (search-form) + چیپ فیلترها (SEARCH-20)
 * - دو سطح مشاهده: «مواضع» و «کتاب‌های دارای تطبیق تأییدشده»
 * - شمارش صادقانهٔ §۴۷ («تطبیق‌های تأییدشده تا این لحظه» + ادامهٔ بررسی)
 * - سه وضعیت خالی متمایز (SEARCH-21): بدون نتیجه / نمایه آماده نیست / خطای موتور
 * - ذخیرهٔ جست‌وجو با نام (SEARCH-16) و اجرای دوباره با همان hash
 * - عبارت و فیلترها فقط در hash (WORK-07/13)؛ لغو queryهای قدیمی با
 *   AbortSignal (بین گام‌های زنجیرهٔ continue) و نادیده‌گرفتن پاسخ‌های کهنه.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookmarkPlus,
  ChevronDown,
  Loader2,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState } from "@/components/feedback";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useRoute } from "@/lib/hash-router";
import { faNum } from "@/lib/format";
import type {
  SavedSearch,
  SearchRequest,
  SearchResponse,
  SearchResultItem,
} from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import {
  buildSearchRequest,
  parseSearchParams,
  searchStateKey,
  SearchForm,
  ROLE_FILTERS,
  LAYERED_MODES,
  type SearchHashState,
} from "@/components/search/search-form";
import { FilterChips } from "@/components/search/filter-chips";
import { ExportMenu } from "@/components/search/export-menu";
import {
  LayerCountsLine,
  ResultCardSkeleton,
  VerifiedCountLine,
} from "@/components/search/result-card";
import { BooksGroupedView } from "@/components/search/books-grouped-view";
import { GroupedPositions } from "@/components/search/grouped-positions";
import { SplitReaderPanel, type SplitLocator } from "@/components/search/split-reader";

/* ---------- ابزار hash ---------- */

function clampPage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= 200 ? n : 1;
}

/** بازسازی hash از payload جست‌وجوی ذخیره‌شده (اجرای دوباره با همان نشانی) */
function hashFromPayload(payload: unknown): Record<string, string> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.query !== "string" || typeof p.mode !== "string") return null;
  const out: Record<string, string> = { q: p.query, mode: p.mode };
  if (typeof p.flex === "string" && p.flex) out.flex = p.flex;
  if (p.words && typeof p.words === "object") {
    const w = p.words as Record<string, unknown>;
    if (typeof w.match === "string") out.match = w.match;
    if (typeof w.distance === "number") out.dist = String(w.distance);
    if (w.ordered) out.ord = "1";
  }
  if (typeof p.sort === "string" && p.sort) out.sort = p.sort;
  const scope = (p.scope && typeof p.scope === "object" ? p.scope : {}) as Record<string, unknown>;
  const target = typeof scope.target === "string" ? scope.target : "library";
  if (target === "titles") {
    out.target = "titles";
  } else if (target === "authors") {
    out.target = "authors";
  }
  if (typeof scope.author === "string" && scope.author) {
    out.author = scope.author;
    out.scope = "author";
  } else if (target === "work" && typeof scope.work_uid === "string" && scope.work_uid) {
    out.scope = "work";
    out.work = scope.work_uid;
  } else if (
    target === "document" &&
    Array.isArray(scope.document_uids) &&
    typeof scope.document_uids[0] === "string"
  ) {
    out.scope = "document";
    out.doc = scope.document_uids[0];
    if (typeof scope.work_uid === "string") out.work = scope.work_uid;
  } else {
    out.scope = "library";
  }
  const roles = Array.isArray(scope.roles)
    ? scope.roles.filter((r): r is string => typeof r === "string")
    : [];
  const roleValues = ROLE_FILTERS.filter((f) => f.codes.some((c) => roles.includes(c))).map(
    (f) => f.value,
  );
  if (roleValues.length > 0) out.roles = roleValues.join(",");
  if (typeof scope.language === "string" && scope.language) out.lang = scope.language;
  const near = (p.near && typeof p.near === "object" ? p.near : null) as Record<string, unknown> | null;
  if (near) {
    out.dist = String(typeof near.slop === "number" ? near.slop : 3);
    if (near.ordered) out.ord = "1";
  }
  if (p.diacritics === "respect" || p.diacritics === "respect_strict") out.dia = p.diacritics;
  if (Array.isArray(p.layers)) {
    const ls = p.layers.filter((l): l is string => typeof l === "string");
    if (ls.length > 0) out.layers = ls.join(",");
  }
  if (typeof p.min_score === "number" && p.min_score > 0) out.ms = String(p.min_score);
  if (p.near_spelling === true) out.ns = "1";
  if (p.expand_morphology === true) out.mx = "1";
  return out;
}

/* ---------- وضعیت صفحه‌های اضافه (ادامهٔ بررسی) ---------- */

interface ExtrasState {
  /** uid نشست این صفحه‌ها */
  uid: string;
  /** شمار صفحه‌های بارگیری‌شدهٔ پس از صفحهٔ اول */
  count: number;
  items: SearchResultItem[];
  meta: SearchResponse | null;
  loading: boolean;
  expired: boolean;
  error: string | null;
}

const EMPTY_EXTRAS: ExtrasState = {
  uid: "",
  count: 0,
  items: [],
  meta: null,
  loading: false,
  expired: false,
  error: null,
};

/* ---------- پنل جست‌وجوهای ذخیره‌شده ---------- */

function SavedSearchesPanel({
  currentPayload,
  saveEnabled,
  saveOpen,
  onSaveOpenChange,
}: {
  currentPayload: SearchRequest | null;
  saveEnabled: boolean;
  /** دیالوگ ذخیره از دو جا باز می‌شود: نوار نتایج و پنل کناری */
  saveOpen: boolean;
  onSaveOpenChange: (open: boolean) => void;
}) {
  const { navigate } = useRoute();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");

  const listQuery = useQuery({
    queryKey: ["saved-searches"],
    queryFn: ({ signal }) =>
      api.get<{ items: SavedSearch[] }>("/saved-searches", undefined, signal),
    staleTime: 30_000,
  });
  const items = listQuery.data?.items ?? [];

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post<SavedSearch>("/saved-searches", { name: name.trim(), payload: currentPayload }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saved-searches"] });
      onSaveOpenChange(false);
      setName("");
      toast({
        title: "جست‌وجو ذخیره شد",
        description: "از فهرست کنار صفحه هر زمان خواستید دوباره اجرا می‌شود.",
      });
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "ذخیرهٔ جست‌وجو ناموفق بود",
        description: errorMessage(err),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (uid: string) => api.del(`/saved-searches/${uid}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saved-searches"] });
      toast({ title: "جست‌وجوی ذخیره‌شده حذف شد" });
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "حذف ناموفق بود",
        description: errorMessage(err),
      });
    },
  });

  const runSaved = (saved: SavedSearch) => {
    const params = hashFromPayload(saved.payload);
    if (!params) {
      toast({
        variant: "destructive",
        title: "اجرای این جست‌وجو ممکن نیست",
        description: "دادهٔ ذخیره‌شده معتبر نیست؛ آن را حذف و جست‌وجوی تازه‌ای ذخیره کنید.",
      });
      return;
    }
    navigate("/search", params);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">جست‌وجوهای ذخیره‌شده</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-9 gap-1.5"
          disabled={!saveEnabled || !currentPayload}
          onClick={() => onSaveOpenChange(true)}
          aria-label="ذخیرهٔ این جست‌وجو با نام"
        >
          <BookmarkPlus className="size-4" aria-hidden="true" />
          ذخیرهٔ این جست‌وجو
        </Button>
      </div>

      {listQuery.isLoading ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">در حال بارگیری…</CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-[167px] items-center px-6 py-6 text-justify text-sm leading-6 text-muted-foreground">
            جست‌وجوی ذخیره‌شده‌ای ندارید. پس از اجرای جست‌وجو می‌توانید آن را با نام ذخیره کنید تا
            دوباره با همان تنظیمات اجرا شود.
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {items.map((saved) => (
            <li key={saved.uid} className="flex items-center gap-1 p-1">
              <button
                type="button"
                className="flex min-h-11 flex-1 flex-col items-start justify-center rounded-lg px-3 py-1.5 text-start transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => runSaved(saved)}
                aria-label={`اجرای جست‌وجوی ذخیره‌شده: ${saved.name}`}
              >
                <span className="w-full truncate text-sm font-medium">{saved.name}</span>
                <span className="w-full truncate text-xs text-muted-foreground">
                  {typeof saved.payload === "object" && saved.payload !== null
                    ? String((saved.payload as Record<string, unknown>).query ?? "")
                    : ""}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => deleteMutation.mutate(saved.uid)}
                disabled={deleteMutation.isPending && deleteMutation.variables === saved.uid}
                aria-label={`حذف جست‌وجوی ذخیره‌شده: ${saved.name}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={saveOpen} onOpenChange={onSaveOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ذخیرهٔ این جست‌وجو</DialogTitle>
            <DialogDescription>
              عبارت، حالت و فیلترهای کنونی با نام دلخواه ذخیره می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="saved-search-name">نام جست‌وجو</Label>
            <Input
              id="saved-search-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثلاً: باب ولایت در کافی"
              className="min-h-11"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => onSaveOpenChange(false)}>
              انصراف
            </Button>
            <Button
              className="min-h-11"
              disabled={!name.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- نمای اصلی ---------- */

export function SearchView() {
  const { route, navigate } = useRoute();

  /* وضعیت اجراشدهٔ جست‌وجو (از hash) */
  const params = parseSearchParams(route.query);
  const searchKey = useMemo(() => searchStateKey(params), [params]);
  const hashPage = clampPage(route.query.page);
  const [saveOpen, setSaveOpen] = useState(false);
  const view: "results" | "books" = route.query.view === "books" ? "books" : "results";
  // عبارت یا استناد قرآنی (QUR-03) هر دو شروع‌کنندهٔ جست‌وجو هستند
  const hasQuery = params.q.trim().length > 0 || params.sure.trim().length > 0;

  /* پیش‌نویس فرم — هم‌گام‌سازی با hash در زمان رندر (الگوی مجاز React) */
  const [draft, setDraft] = useState<SearchHashState>(() => parseSearchParams(route.query));
  const [draftHash, setDraftHash] = useState(route.fullHash);
  if (draftHash !== route.fullHash) {
    setDraftHash(route.fullHash);
    setDraft(parseSearchParams(route.query));
  }

  /** ساخت پارامترهای hash از وضعیت فرم — مشترک میان setQuery و submit */
  const searchQueryParams = useCallback(
    (state: SearchHashState): Record<string, string | undefined> => {
      const qp: Record<string, string | undefined> = {
        q: state.q.trim() || undefined,
        target: state.target !== "text" ? state.target : undefined,
        mode: state.mode,
        scope: state.scope !== "library" ? state.scope : undefined,
        author: state.author.trim() || undefined,
        work: state.work || undefined,
        doc: state.doc || undefined,
        roles: state.roles.length > 0 ? state.roles.join(",") : undefined,
        lang: state.lang || undefined,
        dia: state.diacritics !== "" ? state.diacritics : undefined,
      };

      if (state.mode === "words") {
        if (state.wordsMatch === "any") qp.match = "any";
        if (state.wordsDistance > 0) {
          qp.dist = String(state.wordsDistance);
          if (state.wordsOrdered) qp.ord = "1";
        }
      } else {
        // حالت text
        if (state.flex !== "similar") qp.flex = state.flex;
        if (state.sort === "similarity") qp.sort = "similarity";
        if (state.nearSpelling) qp.ns = "1";
        if (state.expandMorphology) qp.mx = "1";
        if (state.minScore > 0) qp.ms = String(state.minScore);
        if (state.layers.length > 0) qp.layers = state.layers.join(",");
      }

      if (state.sure.trim()) {
        qp.sure = state.sure.trim();
        if (state.aya.trim()) qp.aya = state.aya.trim();
      }

      return qp;
    },
    [],
  );

  /** نوشتن وضعیت در hash — هر بار کل پارامترها داده می‌شود */
  const setQuery = useCallback(
    (state: SearchHashState, extra: Record<string, string | undefined> = {}, replace = false) => {
      navigate(
        "/search",
        {
          ...searchQueryParams(state),
          page: undefined,
          view: undefined,
          ...extra,
        },
        { replace },
      );
    },
    [navigate, searchQueryParams],
  );

  const queryClient = useQueryClient();
  const submit = useCallback(() => {
    /* اگر پارامترهای جست‌وجو تغییر نکرده باشد، navigate بی‌اثر است و کشِ
       نشست دوباره استفاده می‌شد — برای «اجرای دوبارهٔ همان جست‌وجو» (پس از
       انقضای نشست سرور یا بازسازی نمایه) کش باطل و بازاجرایی می‌شود
       (SEARCH-20/WORK-02). در غیر این صورت hash با پارامترهای تازه نوشته
       می‌شود و کلید تازه، نشست تازه می‌سازد. */
    if (searchStateKey(draft) === searchKey) {
      queryClient.invalidateQueries({ queryKey: ["search-session", searchKey] });
      return;
    }
    setQuery(draft);
  }, [draft, queryClient, searchKey, setQuery]);

  const patchCommitted = useCallback(
    (patch: Partial<SearchHashState>) => {
      setQuery({ ...params, ...patch });
    },
    [params, setQuery],
  );

  /* لایهٔ ۱ — نشست جست‌وجو: صفحهٔ نخست + شمارش صادقانه */
  const request = buildSearchRequest(params);

  const sessionQuery = useQuery({
    queryKey: ["search-session", searchKey],
    queryFn: async ({ signal }) => {
      const existing = queryClient.getQueryData<SearchResponse>(["search-session", searchKey]);
      if (existing?.completion_state === "in_progress" && existing.session_uid) {
        const polled = await api.get<SearchResponse>(`/search/${existing.session_uid}`);
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        return polled;
      }
      const resp = await api.post<SearchResponse>("/search", request);
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      return resp;
    },
    refetchInterval: (query) => {
      if (query.state.data?.completion_state === "in_progress") {
        return 1500;
      }
      return false;
    },
    enabled: hasQuery,
    staleTime: 4 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const session = hasQuery ? sessionQuery.data ?? null : null;
  const sessionUid = session?.session_uid ?? null;
  const sessionUidRef = useRef<string | null>(null);
  useEffect(() => {
    sessionUidRef.current = sessionUid;
  }, [sessionUid]);

  /* لایهٔ ۲ — صفحه‌های بیشتر با «ادامهٔ بررسی» (cursor امضاشده، §۴۷) */
  const [extras, setExtras] = useState<ExtrasState>(EMPTY_EXTRAS);
  const currentExtras = sessionUid && extras.uid === sessionUid ? extras : EMPTY_EXTRAS;
  const extrasRef = useRef(currentExtras);
  useEffect(() => {
    extrasRef.current = currentExtras;
  }, [currentExtras]);

  const meta = currentExtras.meta ?? session;
  const items = useMemo(
    () => [...(session?.results ?? []), ...currentExtras.items],
    [session, currentExtras.items],
  );

  const restoreStampRef = useRef<string>("");

  const runContinue = useCallback(
    async (targetSessionUid: string, count: number, updateHash: boolean) => {
      let acc: ExtrasState =
        extrasRef.current.uid === targetSessionUid
          ? extrasRef.current
          : { ...EMPTY_EXTRAS, uid: targetSessionUid };
      if (acc.loading) return;
      acc = { ...acc, loading: true, error: null };
      extrasRef.current = acc;
      setExtras(acc);

      for (let i = 0; i < count; i += 1) {
        if (sessionUidRef.current !== targetSessionUid) return; // جست‌وجوی تازه‌تری اجرا شده است
        const cursorMeta = acc.meta ?? session ?? null;
        if (!cursorMeta?.continuation_available || !cursorMeta.next_cursor) break;
        try {
          const resp = await api.post<SearchResponse>(
            `/search/${targetSessionUid}/continue`,
            { cursor: cursorMeta.next_cursor },
          );
          if (sessionUidRef.current !== targetSessionUid) return;
          acc = {
            ...acc,
            count: acc.count + 1,
            items: [...acc.items, ...(resp.results ?? [])],
            meta: resp,
            loading: i < count - 1,
          };
        } catch (err) {
          if (err instanceof ApiError && err.code === "gone_cursor") {
            acc = { ...acc, expired: true, loading: false };
          } else {
            acc = {
              ...acc,
              error: errorMessage(err, "ادامهٔ بررسی ناموفق بود؛ دوباره تلاش کنید."),
              loading: false,
            };
          }
          break;
        }
        extrasRef.current = acc;
        setExtras(acc);
      }
      acc = { ...acc, loading: false };
      extrasRef.current = acc;
      setExtras(acc);

      // هم‌گام‌سازی موضع در hash (WORK-07): شمارهٔ صفحه = شمار صفحه‌های اضافه + ۱
      if (updateHash || acc.expired || acc.error) {
        navigate(
          "/search",
          { ...route.query, page: acc.count > 0 ? String(acc.count + 1) : undefined },
          { replace: true },
        );
      }
    },
    [navigate, route.query, session],  
  );

  /* بازسازی موضع پس از بازگشت به نتایج (WORK-07): زنجیرهٔ continue تا صفحهٔ hash */
  useEffect(() => {
    const targetExtras = hashPage - 1;
    if (!sessionUid || targetExtras <= 0 || currentExtras.loading) return;
    if (currentExtras.count >= targetExtras) return;
    if (meta && !meta.continuation_available) return;
    const stamp = `${searchKey}|${sessionUid}|${targetExtras}`;
    if (restoreStampRef.current === stamp) return;
    restoreStampRef.current = stamp;
    const t = window.setTimeout(() => {
      void runContinue(sessionUid, targetExtras - currentExtras.count, false);
    }, 0);
    return () => window.clearTimeout(t);
  }, [sessionUid, hashPage, currentExtras.count, currentExtras.loading, meta, searchKey, runContinue]);

  /* وضعیت نمایه — تفکیک «بدون نتیجه» از «نمایه آماده نیست» (SEARCH-21) */
  const isEmpty = sessionQuery.isSuccess && items.length === 0 && !currentExtras.loading;
  const statusQuery = useQuery({
    queryKey: ["library-status"],
    queryFn: ({ signal }) =>
      api.get<{ index_ready?: boolean | null }>("/status", undefined, signal),
    enabled: isEmpty,
    staleTime: 60_000,
  });

  const loadingMore = currentExtras.loading;
  const switchView = (next: string) => {
    navigate(
      "/search",
      { ...route.query, view: next === "books" ? "books" : undefined },
      { replace: true },
    );
  };

  /* ---------- پنل «کنار نتایج» (SEARCH-11) — مختصات در hash (WORK-13) ---------- */
  const splitLocator: SplitLocator | null = useMemo(() => {
    const doc = route.query.spd;
    if (!doc) return null;
    const hlRaw = route.query.sph ?? "";
    const [hs, he] = hlRaw.split(":").map((v) => Number.parseInt(v, 10));
    const hl: [number, number] | null =
      Number.isFinite(hs) && Number.isFinite(he) && he > hs ? [hs, he] : null;
    return {
      documentUid: doc,
      documentLabel: route.query.spdl ?? "",
      workUid: route.query.spw ?? "",
      workTitle: route.query.spwt ?? "",
      pageUid: route.query.spp || null,
      hl,
      key: route.query.spk ?? `${doc}:${route.query.spp ?? ""}`,
    };
  }, [route.query]);

  const openSplit = useCallback(
    (result: SearchResultItem) => {
      if (!result.document?.uid) return;
      const offsets =
        (result.match_offsets?.[0] !== undefined ? { start: result.match_offsets[0], end: result.match_offsets[1] } : null) ??
        (result.source_offsets && typeof result.source_offsets === "object"
          ? Array.isArray(result.source_offsets)
            ? { start: result.source_offsets[0], end: result.source_offsets[1] }
            : { start: result.source_offsets.start, end: result.source_offsets.end }
          : null);
      const pageUid = result.page?.uid ?? "";
      navigate(
        "/search",
        {
          ...route.query,
          view: undefined,
          spd: result.document.uid,
          spdl: result.document.label ?? "",
          spw: result.work?.uid ?? "",
          spwt: result.work?.title ?? "",
          spp: pageUid,
          sph: offsets ? `${offsets.start}:${offsets.end}` : undefined,
          spk: `${result.passage_uid}:${pageUid}`,
        },
        { replace: false },
      );
    },
    [navigate, route.query],
  );

  const closeSplit = useCallback(() => {
    navigate(
      "/search",
      {
        ...route.query,
        spd: undefined,
        spdl: undefined,
        spw: undefined,
        spwt: undefined,
        spp: undefined,
        sph: undefined,
        spk: undefined,
      },
      { replace: true },
    );
  }, [navigate, route.query]);

  /** ناوبری درون پنل (صفحهٔ قبل/بعد) — نوشتن صفحهٔ تازه در hash */
  const navigateSplit = useCallback(
    (next: SplitLocator) => {
      navigate(
        "/search",
        {
          ...route.query,
          spp: next.pageUid ?? undefined,
          sph: next.hl ? `${next.hl[0]}:${next.hl[1]}` : undefined,
          spk: next.key,
        },
        { replace: true },
      );
    },
    [navigate, route.query],
  );

  return (
    <div className="mx-auto w-full max-w-[110rem] px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold">جست‌وجو در منابع</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          جست‌وجوی عبارت در متن منابع با انتخاب حالت و دامنه؛ فقط مواضع تأییدشده نمایش داده می‌شود.
        </p>
      </header>

      <div
        className={`grid items-start gap-6 ${
          splitLocator
            ? "xl:grid-cols-[minmax(0,1fr)_minmax(380px,44%)]"
            : "lg:grid-cols-[minmax(0,1fr)_290px]"
        }`}
      >
        <div className="min-w-0 space-y-5">
          {/* فرم جست‌وجو بازطراحی‌شده */}
          <SearchForm
            value={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onSubmit={submit}
            busy={hasQuery && sessionQuery.isPending}
            showTitle={false}
          />

          {/* چیپ فیلترها (SEARCH-20) */}
          {hasQuery ? <FilterChips state={params} onChange={patchCommitted} /> : null}

          {/* نتایج */}
          {!hasQuery ? (
            <EmptyState
              title="عبارتی برای جست‌وجو وارد نشده است"
              hint="عبارت مورد نظر را در کادر بالا بنویسید و «جست‌وجو» را بزنید."
            />
          ) : sessionQuery.isPending ? (
            <div className="space-y-3" aria-busy="true">
              <ResultCardSkeleton />
              <ResultCardSkeleton />
              <ResultCardSkeleton />
              <span className="sr-only">در حال جست‌وجو در منابع…</span>
            </div>
          ) : sessionQuery.isError ? (
            /* وضعیت خالی ۳ — خطای موتور جست‌وجو */
            (() => {
              const errStr = errorMessage(
                sessionQuery.error,
                "جست‌وجو با خطا روبه‌رو شد؛ دوباره تلاش کنید.",
              );
              const isLongTextError =
                errStr.includes("بیش از حد مجاز") ||
                errStr.includes("نقل‌قول بلند") ||
                errStr.includes("ظرفیت");
              if (isLongTextError) {
                return (
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-950 dark:text-amber-200">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-semibold">
                        <TriangleAlert className="size-5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>این متن از ظرفیت جست‌وجوی چندلایه بلندتر است. برای ادامه، «جست‌وجوی متن بلند» را انتخاب کنید.</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        برای جست‌وجوی احادیث طولانی، بندهای کپی‌شده یا متن‌های بلند از حالت «جست‌وجوی متن بلند» استفاده نمایید.
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="gap-1.5 shrink-0"
                      onClick={() => {
                        setDraft((d) => ({ ...d, mode: "text", flex: "similar" }));
                        setQuery({ ...params, mode: "text", flex: "similar" });
                      }}
                    >
                      تنظیم بر روی حالت عبارت (مشابه)
                    </Button>
                  </div>
                );
              }
              return (
                <ErrorState
                  message={errStr}
                  onRetry={() => void sessionQuery.refetch()}
                />
              );
            })()
          ) : (
            <div className="space-y-4">
              {/* هشدار پایان مهلت نشست (۴۱۰ در ادامهٔ بررسی) */}
              {currentExtras.expired ? (
                <Alert>
                  <TriangleAlert className="size-4" aria-hidden="true" />
                  <AlertTitle>مهلت این جست‌وجو پایان یافته است</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center gap-3">
                    <span>
                      مواضع بیشتری از این نشست قابل دریافت نیست؛ جست‌وجو را دوباره اجرا کنید.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-9 gap-1.5"
                      onClick={() => void sessionQuery.refetch()}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      اجرای دوباره
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              {currentExtras.error ? (
                <Alert variant="destructive">
                  <TriangleAlert className="size-4" aria-hidden="true" />
                  <AlertTitle>ادامهٔ بررسی ناموفق بود</AlertTitle>
                  <AlertDescription>{currentExtras.error}</AlertDescription>
                </Alert>
              ) : null}

              {/* شمارش صادقانهٔ §۴۷ + دکمهٔ ذخیره (SEARCH-16) */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <VerifiedCountLine
                    occurrences={meta?.verified_occurrences ?? null}
                    countRelation={meta?.count_relation ?? ""}
                    passages={meta?.verified_passages ?? null}
                    hadiths={meta?.verified_hadiths ?? null}
                  />
                  <LayerCountsLine meta={meta} />
                  {meta && meta.completion_state !== "complete" ? (
                    <p className="text-xs text-muted-foreground">
                      {meta.completion_state === "failed"
                        ? "بررسی این جست‌وجو ناتمام ماند؛ مواضع نمایش‌داده‌شده تأییدشده‌اند."
                        : "بررسی همچنان ادامه دارد؛ شمارش تا این لحظه کامل نیست."}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* خروجی نتایج تأییدشدهٔ همین جست‌وجو (§۷-الف-۱) — فقط با وجود نتیجه */}
                  {items.length > 0 ? (
                    <ExportMenu
                      request={request}
                      totalVerified={meta?.verified_occurrences ?? null}
                    />
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-9 gap-1.5"
                    onClick={() => setSaveOpen(true)}
                  >
                    <BookmarkPlus className="size-4" aria-hidden="true" />
                    ذخیرهٔ این جست‌وجو
                  </Button>
                </div>
              </div>

              {items.length === 0 ? (
                session?.completion_state === "in_progress" ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed border-primary/40 bg-primary/5">
                    <Loader2 className="size-8 animate-spin text-primary mb-3" />
                    <h3 className="text-base font-semibold">پردازش پرس‌وجوی بلند در صف پس‌زمینه…</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {session.notice || "این پرس‌وجو به دلیل طول زیاد به صورت ناهمگام در حال استخراج و تطبیق است."}
                    </p>
                  </div>
                ) : statusQuery.data?.index_ready === false ? (
                  /* وضعیت خالی ۲ — نمایه آماده نیست */
                  <EmptyState
                    title="نمایهٔ کتابخانه در حال آماده‌سازی است؛ به‌زودی در دسترس خواهد بود"
                    hint="پس از آماده‌شدن نمایه، نتایج همین جست‌وجو نمایش داده می‌شود."
                  />
                ) : (
                  /* وضعیت خالی ۱ — بدون نتیجه */
                  <EmptyState
                    title="موردی یافت نشد"
                    hint="حالت «عبارت نرمال‌شده» را امتحان کنید یا فیلترها را بردارید؛ درست‌نویسی عبارت را هم بررسی کنید."
                    action={
                      params.mode !== "normalized_phrase" ? (
                        <Button
                          variant="outline"
                          className="min-h-11"
                          onClick={() => patchCommitted({ mode: "normalized_phrase" })}
                        >
                          جست‌وجو با حالت نرمال‌شده
                        </Button>
                      ) : undefined
                    }
                  />
                )
              ) : (
                <Tabs value={view} onValueChange={switchView}>
                  <TabsList aria-label="سطح مشاهدهٔ نتایج" className="w-full sm:w-auto">
                    <TabsTrigger value="results" className="min-h-9">
                      مواضع
                    </TabsTrigger>
                    <TabsTrigger value="books" className="min-h-9">
                      کتاب‌های دارای تطبیق تأییدشده
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="results" className="space-y-3">
                    <GroupedPositions
                      items={items}
                      releaseUid={meta?.release_uid ?? null}
                      onOpenSplit={openSplit}
                      splitActiveUid={splitLocator ? splitLocator.key.split(":")[0] : null}
                    />
                    {/* صفحه‌بندی مواضع: ادامهٔ بررسی */}
                    {meta?.continuation_available ? (
                      <div className="flex flex-col items-center gap-1 pt-2">
                        <Button
                          variant="outline"
                          className="min-h-11 gap-2 px-6"
                          disabled={loadingMore}
                          onClick={() => {
                            if (sessionUid) void runContinue(sessionUid, 1, true);
                          }}
                        >
                          {loadingMore ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="size-4" aria-hidden="true" />
                          )}
                          مواضع بیشتر
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          ادامهٔ بررسی برای نمایش مواضع تأییدشدهٔ بیشتر از همین جست‌وجو.
                        </p>
                      </div>
                    ) : null}
                  </TabsContent>
                  <TabsContent value="books">
                    <BooksGroupedView
                      sessionUid={sessionUid}
                      onSessionExpired={() => void sessionQuery.refetch()}
                      releaseUid={meta?.release_uid ?? null}
                      onOpenSplit={openSplit}
                      splitActiveUid={
                        splitLocator ? splitLocator.key.split(":")[0] : null
                      }
                    />
                  </TabsContent>
                </Tabs>
              )}
            </div>
          )}
        </div>

        {/* ستون کناری: پنل متن کنار نتایج (SEARCH-11) یا جست‌وجوهای ذخیره‌شده */}
        {splitLocator ? (
          <div className="min-w-0 xl:sticky xl:top-[76px]">
            <SplitReaderPanel locator={splitLocator} onClose={closeSplit} onNavigate={navigateSplit} />
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              متن نتیجه در کنار نتایج باز است؛ مواضع، فیلترها و عبارت جست‌وجو حفظ شده‌اند (§۴۱).
            </p>
          </div>
        ) : (
          <aside aria-label="جست‌وجوهای ذخیره‌شده" className="min-w-0">
            <SavedSearchesPanel
              currentPayload={request}
              saveEnabled={hasQuery}
              saveOpen={saveOpen}
              onSaveOpenChange={setSaveOpen}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

