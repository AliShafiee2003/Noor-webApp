"use client";

/**
 * میز مطالعه (کتاب‌خوان) — PRD §۱۱ (READ-01..17)
 * دسکتاپ ≥1440: فهرست راست / متن وسط / زمینه چپ (پنل‌های قابل تغییر اندازه)
 * 1024–1439: متن + زمینه (فهرست در Sheet)؛ <768: تک‌ستونی با drawer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  Bookmark as BookmarkIcon,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Copy,
  List,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SlidersHorizontal,
  StickyNote,
} from "lucide-react";
import type { Bookmark as BookmarkT, Note as NoteT } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { faNum } from "@/lib/format";
import type {
  BlockLink,
  PageBlock,
  PagePayload,
  PageRef,
  TocSection,
  WorkDetail,
} from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspace";
import { PageRenderer, type ReaderSelection } from "@/components/reader/page-renderer";
import { TocPanel } from "@/components/reader/toc-panel";
import { FootnotePanel, type FootnotePanelData } from "@/components/reader/footnote-panel";
import { FicheDialog } from "@/components/reader/fiche-dialog";
import { HadithLocationsDialog } from "@/components/search/hadith-locations-dialog";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { SettingsPopover } from "@/components/reader/settings-popover";
import { NotesPanel } from "@/components/reader/notes-panel";

export function ReaderView({ documentUid }: { documentUid: string }) {
  const queryClient = useQueryClient();
  const prefs = useWorkspaceStore((s) => s.prefs);

  /* ---------- پارامترهای hash: صفحهٔ فعلی و highlight نتیجه ---------- */
  const [params, setParams] = useState(() => readHashParams());
  useEffect(() => {
    const onHash = () => setParams(readHashParams());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const requestedPageUid = params.get("pg") || null;
  const hl = parseHighlight(params.get("hl"));

  /* ---------- داده‌ها ---------- */
  const workQuery = useQuery({
    queryKey: ["reader-work", documentUid],
    queryFn: async () => {
      const works = await api.get<{ items: WorkDetail[] }>("/works");
      for (const w of works.items) {
        const full = await api.get<WorkDetail>(`/works/${w.uid}`);
        if (full.documents.some((d) => d.uid === documentUid)) return full;
      }
      throw new Error("این سند در کتابخانهٔ موجود نیست.");
    },
    retry: false,
  });

  const tocQuery = useQuery({
    queryKey: ["reader-toc", documentUid],
    queryFn: () =>
      api.get<{ sections: TocSection[]; release_uid: string }>(
        `/documents/${documentUid}/toc`,
      ),
    retry: false,
  });

  const pagesQuery = useQuery({
    queryKey: ["reader-pages", documentUid],
    queryFn: () =>
      api.get<{ items: PageRef[] }>(`/documents/${documentUid}/pages`),
    retry: false,
  });

  const pageRefs: PageRef[] = pagesQuery.data?.items ?? [];

  /* صفحهٔ هدف: از hash یا ادامهٔ مطالعه (بازیابی موضع — READ-12) */
  const [fallbackPageUid, setFallbackPageUid] = useState<string | null>(null);
  const positionQuery = useQuery({
    queryKey: ["workspace-position", documentUid],
    queryFn: () => api.get<{ positions: Record<string, { page_uid?: string }> }>("/workspace"),
    staleTime: 10_000,
  });
  useEffect(() => {
    if (requestedPageUid || fallbackPageUid || !pagesQuery.isSuccess) return;
    const saved = positionQuery.data?.positions?.[documentUid]?.page_uid;
    if (saved && pageRefs.some((p) => p.page_uid === saved)) {
      setFallbackPageUid(saved);
    } else if (pageRefs.length > 0) {
      setFallbackPageUid(pageRefs[0].page_uid);
    }
  }, [requestedPageUid, fallbackPageUid, pagesQuery.isSuccess, pageRefs, positionQuery.data, documentUid]);

  const currentPageUid = requestedPageUid ?? fallbackPageUid;

  const pageQuery = useQuery({
    queryKey: ["reader-page", documentUid, currentPageUid],
    enabled: !!currentPageUid,
    queryFn: () =>
      api.get<PagePayload>(`/documents/${documentUid}/pages/${currentPageUid}`),
    retry: false,
  });

  const bookmarksQuery = useQuery({
    queryKey: ["reader-bookmarks"],
    queryFn: () => api.get<{ items: BookmarkT[] }>("/bookmarks"),
  });

  /* یادداشت‌های شخصی (RES) — شمار برای نشان؛ دادهٔ کامل در NotesPanel با همان کلید */
  const notesCountQuery = useQuery({
    queryKey: ["notes", documentUid],
    queryFn: () => api.get<{ items: NoteT[] }>("/notes", { document_uid: documentUid }),
    staleTime: 15_000,
    retry: false,
  });
  const pageNoteCount =
    notesCountQuery.data?.items.filter((n) => n.page_uid === currentPageUid).length ?? 0;
  const docNoteCount = notesCountQuery.data?.items.length ?? 0;

  /* ---------- نگاشت بلوک→بخش برای لنگر فهرست ---------- */
  const sectionUidByBlockId = useMemo(() => {
    const map: Record<string, string> = {};
    const walk = (secs: TocSection[]) => {
      for (const s of secs) {
        if (s.block_id) map[s.block_id] = s.uid;
        walk(s.children ?? []);
      }
    };
    walk(tocQuery.data?.sections ?? []);
    return map;
  }, [tocQuery.data]);

  const activeSectionUid = useMemo(() => {
    if (!pageQuery.data) return null;
    for (const b of pageQuery.data.blocks) {
      const uid = sectionUidByBlockId[b.id];
      if (uid) return uid;
    }
    return null;
  }, [pageQuery.data, sectionUidByBlockId]);

  /* ---------- حالت‌های محلی ---------- */
  const [tocOpen, setTocOpen] = useState(false);
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null);
  const [footnote, setFootnote] = useState<FootnotePanelData | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [ficheOpen, setFicheOpen] = useState(false);
  const [saveFlash, setSaveFlash] = useState<string | null>(null);
  /** تب پنل زمینه: پاورقی/آیه/روایت یا یادداشت‌ها */
  const [ctxTab, setCtxTab] = useState<"context" | "notes">("context");
  /** شیت یادداشت‌ها در موبایل/تبلت */
  const [notesSheetOpen, setNotesSheetOpen] = useState(false);
  /* §۴۷: پرس‌وجوی میان‌کتابی روایت از پنل زمینه */
  const [hadithLookupUid, setHadithLookupUid] = useState<string | null>(null);
  /* RES: دامنهٔ روایت برای یادداشت روی روایت مشخص */
  const [hadithNoteScope, setHadithNoteScope] = useState<{
    localUid: string;
    revayatIndex?: string | null;
  } | null>(null);

  /* تغییر صفحهٔ مقصد → پنل زمینه بسته می‌شود (پنل مالِ همان صفحه است) */
  useEffect(() => {
    setFootnote(null);
    setSelection(null);
    setHadithNoteScope(null);
  }, [currentPageUid]);

  /* بازشدن پاورقی/ارجاع → تب زمینه فعال می‌شود تا محتوا دیده شود */
  useEffect(() => {
    if (footnote) setCtxTab("context");
  }, [footnote]);

  /* highlight نتیجهٔ جست‌وجو → بلوک مقصد */
  /* آفست hl سطح سند است؛ با source_offsets بلوک‌ها به مختصات درون‌بلوکی نگاشت می‌شود (بدون hlb) */
  const highlight = useMemo(() => {
    if (!hl || !pageQuery.data) return null;
    const explicitBlock = params.get("hlb");
    if (explicitBlock) return { start: hl[0], end: hl[1], blockId: explicitBlock };
    for (const block of pageQuery.data.blocks) {
      const raw = block.source_offsets;
      const range = Array.isArray(raw)
        ? { start: raw[0], end: raw[1] }
        : raw && typeof raw.start === "number" && typeof raw.end === "number"
          ? { start: raw.start, end: raw.end }
          : null;
      if (range && hl[0] >= range.start && hl[0] < range.end) {
        const relStart = hl[0] - range.start;
        const relEnd = Math.max(relStart + 1, Math.min(hl[1], range.end) - range.start);
        return { start: relStart, end: relEnd, blockId: block.id };
      }
    }
    return null;
  }, [hl, pageQuery.data, params]);

  /* ---------- پرش فهرست / صفحه ---------- */
  const goToPage = useCallback(
    (pageUid: string, extra: Record<string, string> = {}) => {
      const q = new URLSearchParams({ pg: pageUid, ...extra });
      window.location.hash = `#/read/${documentUid}?${q.toString()}`;
      setFootnote(null);
    },
    [documentUid],
  );

  const onJumpSection = useCallback(
    (s: TocSection) => {
      // مقصد فهرست: صفحهٔ دارای آن بلوک (از سمت کاربر: بخش فعلیِ همان صفحه)
      // block_id به صفحه نگاشت نمی‌شود در قرارداد؛ برای سادگی، اگر در صفحهٔ فعلی هست flash می‌کنیم
      setTocOpen(false);
      if (pageQuery.data?.blocks.some((b) => b.id === s.block_id)) {
        setFlashBlockId(s.block_id ?? null);
        window.setTimeout(() => setFlashBlockId(null), 1800);
      } else if (s.block_id) {
        // اسکرول در حالت پیوسته روی همان صفحهٔ فعلی
        const el = document.getElementById(`blk-${s.block_id}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          setFlashBlockId(s.block_id);
          window.setTimeout(() => setFlashBlockId(null), 1800);
        }
      }
    },
    [pageQuery.data],
  );

  /* ---------- ذخیرهٔ موضع (READ-12) — PUT /workspace/position با debounce ---------- */
  const putTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentPageUid || !pageQuery.isSuccess) return;
    if (putTimer.current) clearTimeout(putTimer.current);
    putTimer.current = setTimeout(() => {
      void api.put("/workspace/position", {
        document_uid: documentUid,
        position: { page_uid: currentPageUid, progress: 0 },
      });
    }, 900);
    return () => {
      if (putTimer.current) clearTimeout(putTimer.current);
    };
  }, [currentPageUid, pageQuery.isSuccess, documentUid]);

  /* ---------- نشانک ---------- */
  const isBookmarked = bookmarksQuery.data?.items.some(
    (b) => b.document_uid === documentUid && b.page_uid === currentPageUid,
  ) ?? false;
  const [bookmarkPending, setBookmarkPending] = useState(false);
  const toggleBookmark = useCallback(async () => {
    if (!currentPageUid || bookmarkPending) return;
    setBookmarkPending(true);
    try {
      if (isBookmarked) {
        const existing = bookmarksQuery.data?.items.find(
          (b) => b.document_uid === documentUid && b.page_uid === currentPageUid,
        );
        if (existing) await api.del(`/bookmarks/${existing.uid}`);
      } else {
        await api.post("/bookmarks", {
          document_uid: documentUid,
          page_uid: currentPageUid,
          label: pageQuery.data?.label ?? "",
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["reader-bookmarks"] });
    } finally {
      setBookmarkPending(false);
    }
  }, [currentPageUid, bookmarkPending, isBookmarked, bookmarksQuery.data, documentUid, pageQuery.data?.label, queryClient]);

  /* ---------- کپی نشانی (READ-17) ---------- */
  const copyAddress = useCallback(async () => {
    const parts = [
      workQuery.data?.title ?? "",
      "جلد " + (workQuery.data?.documents.find((d) => d.uid === documentUid)?.label ?? ""),
      "صفحهٔ " + (pageQuery.data?.label ?? ""),
    ].filter(Boolean);
    const text = parts.join("، ") + "\n" + window.location.hash;
    try {
      await navigator.clipboard.writeText(text);
      setSaveFlash("نشانی کپی شد");
    } catch {
      setSaveFlash("کپی ممکن نشد؛ دستی انتخاب کنید");
    }
    window.setTimeout(() => setSaveFlash(null), 1600);
  }, [workQuery.data, documentUid, pageQuery.data?.label]);

  /* ---------- انتخاب متن → فیش ---------- */
  const onSelection = useCallback((sel: ReaderSelection | null) => {
    setSelection(sel);
    if (sel) setFicheOpen(true);
  }, []);

  const onFootnoteClick = useCallback(
    (refUid: string) => {
      const fn = pageQuery.data?.footnotes.find((f) => f.uid === refUid);
      if (fn) {
        setFootnote({ kind: "footnote", uid: fn.uid, label: fn.label, text: fn.text });
      } else {
        setFootnote({ kind: "link", originalAddress: "پاورقی " + refUid });
      }
    },
    [pageQuery.data],
  );

  const onLinkClick = useCallback((link: BlockLink) => {
    // همهٔ ارجاع‌ها در این نسخه حل‌نشده‌اند — نشانی اصلی حفظ می‌شود (REL-10)
    setFootnote({ kind: "link", originalAddress: link.original_address || "ارجاع" });
  }, []);

  /* ---------- پنل آیه (QUR-01/02) و اطلاعات روایت (HAD-08) ---------- */
  const onVerseClick = useCallback((block: PageBlock) => {
    const cit = block.citations?.[0];
    if (!cit) return;
    setFootnote({
      kind: "verse",
      verse: {
        citation: cit,
        quotedText: block.text,
        inHadith: block.hadith_uid ?? cit.in_hadith ?? null,
        hasParent: cit.has_parent,
      },
    });
  }, []);

  const onHadithClick = useCallback((block: PageBlock) => {
    if (!block.hadith_uid) return;
    setFootnote({
      kind: "hadith",
      hadith: {
        localUid: block.hadith_uid,
        revayatIndex: block.revayat_index ?? null,
      },
    });
  }, []);

  const onSearchInDocument = useCallback(
    (q: string) => {
      window.location.hash = `#/search?q=${encodeURIComponent(q)}&mode=normalized_phrase&scope=document&doc=${documentUid}`;
    },
    [documentUid],
  );

  /* ---------- ناوبری صفحه‌ای ---------- */
  const pageIdx = pageRefs.findIndex((p) => p.page_uid === currentPageUid);
  const prevRef = pageIdx > 0 ? pageRefs[pageIdx - 1] : null;
  const nextRef = pageIdx >= 0 && pageIdx < pageRefs.length - 1 ? pageRefs[pageIdx + 1] : null;

  /* ---------- بارگذاری keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "ArrowLeft" && nextRef) goToPage(nextRef.page_uid);
      if (e.key === "ArrowRight" && prevRef) goToPage(prevRef.page_uid);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextRef, prevRef, goToPage]);

  /* ---------- حالت‌های بارگذاری/خطا ---------- */
  const errMsg =
    workQuery.error instanceof Error
      ? workQuery.error.message
      : pagesQuery.error instanceof Error
        ? pagesQuery.error.message
        : "";

  if (workQuery.isPending || pagesQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> در حال بازکردن متن…
        </p>
      </div>
    );
  }

  if (workQuery.isError || pagesQuery.isError) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-sm text-destructive">
          بازکردن این سند ممکن نشد{errMsg ? ": " + errMsg : ""}
        </p>
        <Button variant="outline" className="mt-3" onClick={() => { workQuery.refetch(); pagesQuery.refetch(); }}>
          تلاش دوباره
        </Button>
      </div>
    );
  }

  const work = workQuery.data!;
  const docLabel = work.documents.find((d) => d.uid === documentUid)?.label ?? "";

  const tocPanel = (
    <TocPanel
      sections={tocQuery.data?.sections ?? []}
      isLoading={tocQuery.isPending}
      error={tocQuery.isError ? "فهرست در دسترس نیست." : null}
      onRetry={() => tocQuery.refetch()}
      activeSectionUid={activeSectionUid}
      onJumpSection={onJumpSection}
      bookmarks={bookmarksQuery.data?.items.filter((b) => b.document_uid === documentUid) ?? []}
      bookmarksLoading={bookmarksQuery.isPending}
      onJumpBookmark={(b) => goToPage(b.page_uid)}
      onDeleteBookmark={async (b) => {
        await api.del(`/bookmarks/${b.uid}`);
        await queryClient.invalidateQueries({ queryKey: ["reader-bookmarks"] });
      }}
    />
  );

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-0 flex-col" dir="rtl">
      <ReaderToolbar
        workTitle={work.title}
        documentLabel={docLabel}
        pageLabel={pageQuery.data?.label ?? "…"}
        display={prefs.display}
        onDisplayChange={(d) => useWorkspaceStore.getState().updatePrefs({ display: d })}
        pageRefs={pageRefs}
        currentPageUid={currentPageUid}
        onJumpToPage={(ref) => goToPage(ref.page_uid)}
        documentUid={documentUid}
        onSearchInDocument={onSearchInDocument}
        bookmarked={isBookmarked}
        bookmarkPending={bookmarkPending}
        onToggleBookmark={() => void toggleBookmark()}
        onCopyAddress={() => void copyAddress()}
        settingsTrigger={
          <Button variant="ghost" size="icon" aria-label="تنظیمات خواندن" className="size-11">
            <SlidersHorizontal className="size-4" />
          </Button>
        }
        highlightActive={!!hl}
        onClearHighlight={() => {
          const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
          q.delete("hl");
          q.delete("hlb");
          window.location.hash = `#/read/${documentUid}?${q.toString()}`;
        }}
        onPrev={prevRef ? () => goToPage(prevRef.page_uid) : null}
        onNext={nextRef ? () => goToPage(nextRef.page_uid) : null}
        saveIndicator={saveFlash ? <span className="text-xs text-muted-foreground">{saveFlash}</span> : null}
      />

      <div className="flex min-h-0 flex-1">
        {/* فهرست — دسکتاپ */}
        <aside className="hidden w-72 shrink-0 border-e border-border lg:block xl:w-80">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">فهرست و نشانک‌ها</span>
          </div>
          <div className="h-[calc(100%-2.6rem)] overflow-y-auto">{tocPanel}</div>
        </aside>

        {/* فهرست — موبایل/تبلت */}
        <Sheet open={tocOpen} onOpenChange={setTocOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="فهرست" className="size-11 self-start m-2 lg:hidden">
              <List className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 p-0">
            <SheetHeader className="border-b border-border py-3">
              <SheetTitle className="text-sm">فهرست و نشانک‌ها</SheetTitle>
            </SheetHeader>
            <div className="h-[calc(100%-3.4rem)] overflow-y-auto">{tocPanel}</div>
          </SheetContent>
        </Sheet>

        {/* سطح اصلی متن */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-reader" aria-label="متن کتاب">
          {pageQuery.isPending ? (
            <div className="mx-auto max-w-[760px] space-y-4 p-6">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : pageQuery.isError || !pageQuery.data ? (
            <div className="mx-auto max-w-md p-10 text-center text-sm">
              این صفحه در سند موجود نیست.
              <div>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => pageQuery.refetch()}>
                  تلاش دوباره
                </Button>
              </div>
            </div>
          ) : (
            <>
              {pageQuery.data.overlay_applied && (
                <div className="mx-auto max-w-[760px] px-4 pt-3">
                  <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                    این صفحه شامل اصلاح سامانه است. <span className="bidi-ltr">{pageQuery.data.overlay_revision_uid}</span>
                  </p>
                </div>
              )}
              <PageRenderer
                page={pageQuery.data}
                prefs={prefs}
                sectionUidByBlockId={sectionUidByBlockId}
                flashBlockId={flashBlockId}
                highlight={highlight}
                collapsedSanads={new Set()}
                onToggleSanad={() => undefined}
                onFootnoteClick={onFootnoteClick}
                onLinkClick={onLinkClick}
                onVerseClick={onVerseClick}
                onHadithClick={onHadithClick}
                onSelection={onSelection}
              />
              {/* ناوبری پایین صفحه */}
              <div className="mx-auto flex max-w-[760px] items-center justify-between px-4 pb-10 pt-2">
                {prevRef ? (
                  <Button variant="outline" size="sm" onClick={() => goToPage(prevRef.page_uid)}>
                    <ChevronRight className="size-4" /> صفحهٔ قبل ({prevRef.label})
                  </Button>
                ) : <span />}
                {nextRef ? (
                  <Button variant="outline" size="sm" onClick={() => goToPage(nextRef.page_uid)}>
                    صفحهٔ بعد ({nextRef.label}) <ChevronLeft className="size-4" />
                  </Button>
                ) : <span />}
              </div>
            </>
          )}
        </main>

        {/* پنل زمینه — دسکتاپ */}
        <aside className="hidden w-80 shrink-0 border-s border-border xl:block">
          {/* تب‌های زمینه / یادداشت */}
          <div role="tablist" aria-label="پنل کناری متن" className="flex border-b border-border">
            <button
              role="tab"
              aria-selected={ctxTab === "context"}
              onClick={() => setCtxTab("context")}
              className={`min-h-11 flex-1 border-b-2 px-2 text-xs font-medium transition-colors md:min-h-9 ${
                ctxTab === "context"
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/60"
              }`}
            >
              زمینه
            </button>
            <button
              role="tab"
              aria-selected={ctxTab === "notes"}
              onClick={() => setCtxTab("notes")}
              className={`min-h-11 flex-1 border-b-2 px-2 text-xs font-medium transition-colors md:min-h-9 ${
                ctxTab === "notes"
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/60"
              }`}
            >
              یادداشت‌ها
              {docNoteCount > 0 ? (
                <span className="ms-1 inline-flex min-w-5 justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                  {faNum(docNoteCount)}
                </span>
              ) : null}
            </button>
          </div>
          <div className="h-[calc(100%-2.75rem)] overflow-y-auto">
            {ctxTab === "notes" ? (
              <NotesPanel
                documentUid={documentUid}
                currentPageUid={currentPageUid}
                pageLabel={pageQuery.data?.label ?? null}
                hadithScope={hadithNoteScope}
                onClearHadithScope={() => setHadithNoteScope(null)}
              />
            ) : footnote ? (
              <FootnotePanel
                data={footnote}
                onBack={() => setFootnote(null)}
                onHadithLookup={setHadithLookupUid}
                onHadithNote={(localUid, revayatIndex) => {
                  setHadithNoteScope({ localUid, revayatIndex });
                  setCtxTab("notes");
                }}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                برای دیدن پاورقی یا ارجاع، روی نشان آن در متن کلیک کنید.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* پاورقی — موبایل: sheet پایین */}
      {footnote && (
        <div className="border-t border-border bg-surface p-0 xl:hidden">
          <Sheet open={!!footnote} onOpenChange={(o) => !o && setFootnote(null)}>
            <SheetContent side="bottom" className="max-h-[60vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="text-sm">پاورقی / ارجاع</SheetTitle>
              </SheetHeader>
              <FootnotePanel
                data={footnote}
                onBack={() => setFootnote(null)}
                onHadithLookup={setHadithLookupUid}
                onHadithNote={(localUid, revayatIndex) => {
                  setHadithNoteScope({ localUid, revayatIndex });
                  setFootnote(null);
                  setNotesSheetOpen(true);
                }}
              />
            </SheetContent>
          </Sheet>
        </div>
      )}

      {/* یادداشت‌ها — موبایل/تبلت: شیت پایین */}
      <Sheet open={notesSheetOpen} onOpenChange={setNotesSheetOpen}>
        <SheetContent side="bottom" className="flex h-[75vh] flex-col overflow-hidden">
          <SheetHeader className="border-b border-border pb-2">
            <SheetTitle className="flex items-center gap-1.5 text-sm">
              <StickyNote className="size-4 text-primary" aria-hidden="true" />
              یادداشت‌های این سند
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <NotesPanel
              documentUid={documentUid}
              currentPageUid={currentPageUid}
              pageLabel={pageQuery.data?.label ?? null}
              hadithScope={hadithNoteScope}
              onClearHadithScope={() => {
                setHadithNoteScope(null);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <FicheDialog
        open={ficheOpen}
        onOpenChange={(o) => {
          setFicheOpen(o);
          if (!o) setSelection(null);
        }}
        selection={selection}
        documentUid={documentUid}
        documentLabel={docLabel}
        page={pageQuery.data ?? null}
        sectionUid={activeSectionUid}
        work={work ? { uid: work.uid, title: work.title } : null}
      />

      {/* پرس‌وجوی میان‌کتابی روایت (§۴۷) — از پنل زمینه */}
      <HadithLocationsDialog
        documentUid={documentUid}
        localHadithUid={hadithLookupUid ?? ""}
        open={!!hadithLookupUid}
        onOpenChange={(o) => !o && setHadithLookupUid(null)}
      />

      {/* دکمه‌های شناور برای موبایل */}
      <div className="fixed bottom-20 left-3 z-30 flex gap-2 xl:hidden">
        <Button
          size="icon"
          variant={pageNoteCount > 0 ? "default" : "outline"}
          aria-label={`یادداشت‌ها${pageNoteCount > 0 ? ` (${pageNoteCount} در این صفحه)` : ""}`}
          title={pageNoteCount > 0 ? `${pageNoteCount} یادداشت در این صفحه` : "یادداشت‌ها"}
          className="size-11 rounded-full bg-surface"
          onClick={() => setNotesSheetOpen(true)}
        >
          <span className="relative">
            <StickyNote className="size-4" />
            {pageNoteCount > 0 ? (
              <span className="absolute -end-1.5 -top-2 min-w-3.5 rounded-full bg-primary px-0.5 text-center text-[9px] font-bold leading-3.5 text-primary-foreground">
                {faNum(pageNoteCount)}
              </span>
            ) : null}
          </span>
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label="کپی نشانی"
          className="size-11 rounded-full bg-surface"
          onClick={() => void copyAddress()}
        >
          <Copy className="size-4" />
        </Button>
        <Button
          size="icon"
          variant={isBookmarked ? "default" : "outline"}
          aria-label="نشانک"
          className="size-11 rounded-full bg-surface"
          onClick={() => void toggleBookmark()}
          disabled={bookmarkPending}
        >
          {isBookmarked ? <BookmarkCheck className="size-4" /> : <BookmarkIcon className="size-4" />}
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label="فهرست"
          className="size-11 rounded-full bg-surface"
          onClick={() => setTocOpen(true)}
        >
          <BookOpenText className="size-4" />
        </Button>
        <SettingsPopover
          trigger={
            <Button
              size="icon"
              variant="outline"
              aria-label="تنظیمات خواندن"
              className="size-11 rounded-full bg-surface"
            >
              <SlidersHorizontal className="size-4" />
            </Button>
          }
        />
      </div>
    </div>
  );
}

/* ---------- کمکی‌های hash ---------- */

function readHashParams(): URLSearchParams {
  const hash = window.location.hash;
  const qi = hash.indexOf("?");
  return new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : "");
}

function parseHighlight(raw: string | null): [number, number] | null {
  if (!raw) return null;
  const parts = raw.split(":");
  const s = Number.parseInt(parts[0] ?? "", 10);
  const e = Number.parseInt(parts[1] ?? "", 10);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return [s, e];
}
