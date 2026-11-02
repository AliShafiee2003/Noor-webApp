"use client";

/**
 * پنل «بازکردن کنار نتایج» (SEARCH-11) — متن نتیجهٔ جست‌وجو کنار فهرست نتایج
 * باز می‌شود بدون آن‌که مواضع، فیلترها یا عبارت جست‌وجو از دست برود (§۴۱/WORK-13).
 * - همان PageRenderer کتاب‌خوان با هایلایتِ نگاشت‌شده از مختصات سند به بلوک؛
 * - پاورقی/آیه/روایت/فیش کامل (FicheDialog) — برابری قابلیت با کتاب‌خوان؛
 * - ناوبری صفحهٔ قبل/بعد و پرش به کتاب‌خوان کامل؛
 * - موضع خواننده (PUT /workspace/position) اینجا ذخیره نمی‌شود تا کتاب‌خوان
 *   مرجعِ «ادامهٔ مطالعه» بماند.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpenText,
  BookMarked,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Loader2,
  StickyNote,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, errorMessage } from "@/lib/api";
import { HashLink } from "@/lib/hash-router";
import { faNum } from "@/lib/format";
import { readHref as readerHref, readShareHref } from "@/lib/href";
import type {
  BlockLink,
  Note,
  PageBlock,
  PagePayload,
  PageRef,
  WorkDetail,
} from "@/lib/types";
import { blockOffsets } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspace";
import { PageRenderer, type ReaderSelection } from "@/components/reader/page-renderer";
import { FootnotePanel, type FootnotePanelData } from "@/components/reader/footnote-panel";
import { FicheDialog } from "@/components/reader/fiche-dialog";
import { NotesPanel } from "@/components/reader/notes-panel";
import { HadithLocationsDialog } from "@/components/search/hadith-locations-dialog";

/** مختصات پنل کنار نتایج — از نتیجهٔ انتخاب‌شده ساخته می‌شود */
export interface SplitLocator {
  documentUid: string;
  documentLabel: string;
  workUid: string;
  workTitle: string;
  pageUid: string | null;
  /** بازهٔ هایلایت در مختصات سند (code point) */
  hl: [number, number] | null;
  /** کلید یکتا برای پایداری اسکرول/کلیدها هنگام تعویض نتیجه */
  key: string;
}

interface PanelProps {
  locator: SplitLocator;
  onClose: () => void;
  onNavigate: (next: SplitLocator) => void;
}

export function SplitReaderPanel({ locator, onClose, onNavigate }: PanelProps) {
  const prefs = useWorkspaceStore((s) => s.prefs);
  const { documentUid, pageUid, hl } = locator;

  /* ---------- اثر (عنوان/برچسب جلد) و فهرست صفحه‌ها ---------- */
  const workQuery = useQuery({
    queryKey: ["split-work", locator.workUid],
    queryFn: () => api.get<WorkDetail>(`/works/${encodeURIComponent(locator.workUid)}`),
    enabled: !!locator.workUid,
    staleTime: 60_000,
    retry: false,
  });

  const pagesQuery = useQuery({
    queryKey: ["reader-pages", documentUid],
    queryFn: () =>
      api.get<{ items: PageRef[] }>(`/documents/${encodeURIComponent(documentUid)}/pages`),
    retry: false,
  });
  const pageRefs: PageRef[] = pagesQuery.data?.items ?? [];

  /* صفحهٔ مقصد: صریح از نتیجه، وگرنه نخستین صفحه */
  const resolvedPageUid =
    pageUid &&
    (pageRefs.length === 0 ||
      pageRefs.some((p) => p.page_uid === pageUid) ||
      pageUid === "p-front")
      ? pageUid
      : (pageRefs[0]?.page_uid ?? pageUid);

  const pageQuery = useQuery({
    queryKey: ["reader-page", documentUid, resolvedPageUid],
    enabled: !!resolvedPageUid,
    queryFn: () =>
      api.get<PagePayload>(
        `/documents/${encodeURIComponent(documentUid)}/pages/${encodeURIComponent(resolvedPageUid)}`,
      ),
    retry: false,
  });

  /* ---------- نگاشت هایلایت سطح سند → بلوک (همان منطق کتاب‌خوان) ----------
     محاسبهٔ سبک است و در هر رندر انجام می‌شود (سازگار با کامپایلر React) */
  const highlight = (() => {
    if (!hl || !pageQuery.data) return null;
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
  })();

  /* اسکرول نرم به هایلایت، فقط درون خود پنل (کل صفحه جابه‌جا نمی‌شود) */
  const scrollRef = useRef<HTMLDivElement>(null);
  const hlKey = highlight ? `${locator.key}:${highlight.start}:${highlight.end}` : "";
  const lastScrolled = useRef<string>("");
  useEffect(() => {
    if (!hlKey || lastScrolled.current === hlKey) return;
    lastScrolled.current = hlKey;
    const t = window.setTimeout(() => {
      const wrap = scrollRef.current;
      const el = document.getElementById("reader-hl-anchor");
      if (wrap && el) {
        wrap.scrollTo({
          top: el.offsetTop - wrap.offsetTop - wrap.clientHeight / 3,
          behavior: "smooth",
        });
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [hlKey]);

  /* ---------- حالت‌های محلی: پاورقی/آیه/روایت + فیش ---------- */
  const [ctx, setCtx] = useState<FootnotePanelData | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [ficheOpen, setFicheOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  /* §۴۷: پرس‌وجوی میان‌کتابی روایت از پنل زمینهٔ پنل کنار نتایج */
  const [hadithLookupUid, setHadithLookupUid] = useState<string | null>(null);
  /* RES: یادداشت‌ها در همین پنل — شیت پایین با پشتیبانی دامنهٔ روایت */
  const [notesOpen, setNotesOpen] = useState(false);
  const [hadithNoteScope, setHadithNoteScope] = useState<{
    localUid: string;
    revayatIndex?: string | null;
  } | null>(null);

  /* شمار یادداشت‌های سند برای نشان دکمه (همان کلید کوئری کتاب‌خوان) */
  const notesCountQuery = useQuery({
    queryKey: ["notes", documentUid],
    queryFn: () => api.get<{ items: Note[] }>("/notes", { document_uid: documentUid }),
    staleTime: 15_000,
    retry: false,
  });
  const docNoteCount = notesCountQuery.data?.items.length ?? 0;

  /* با تعویض صفحه درون پنل، پنل زمینه و انتخاب پاک می‌شود
     (الگوی مجاز React: تنظیم state حین رندر هنگام تغییر prop) */
  const [lastPageUid, setLastPageUid] = useState(resolvedPageUid);
  if (lastPageUid !== resolvedPageUid) {
    setLastPageUid(resolvedPageUid);
    setCtx(null);
    setSelection(null);
  }

  const onFootnoteClick = useCallback(
    (refUid: string) => {
      const fn = pageQuery.data?.footnotes.find((f) => f.uid === refUid);
      if (fn) {
        setCtx({ kind: "footnote", uid: fn.uid, label: fn.label, text: fn.text });
      } else {
        setCtx({ kind: "link", originalAddress: "پاورقی " + refUid });
      }
    },
    [pageQuery.data],
  );

  const onLinkClick = useCallback((link: BlockLink) => {
    setCtx({ kind: "link", originalAddress: link.original_address || "ارجاع" });
  }, []);

  const onVerseClick = useCallback((block: PageBlock) => {
    const cit = block.citations?.[0];
    if (!cit) return;
    setCtx({
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
    setCtx({
      kind: "hadith",
      hadith: { localUid: block.hadith_uid, revayatIndex: block.revayat_index ?? null },
    });
  }, []);

  /* RES: ثبت فیش این روایت — متن کامل روایتِ همین صفحه (همان قاعدهٔ کتاب‌خوان) */
  const onHadithFiche = useCallback(
    (localUid: string) => {
      if (!pageQuery.data) return;
      const parts = pageQuery.data.blocks.filter((b) => b.hadith_uid === localUid);
      if (parts.length === 0) return;
      const first = blockOffsets(parts[0]);
      const last = blockOffsets(parts[parts.length - 1]);
      if (!first || !last) return;
      setSelection({
        blockId: parts[0].id,
        start: first.start,
        end: last.end,
        text: parts.map((b) => b.text).join("\n"),
        hadithUid: localUid,
      });
      setFicheOpen(true);
    },
    [pageQuery.data],
  );

  const onSelection = useCallback((sel: ReaderSelection | null) => {
    setSelection(sel);
    if (sel) setFicheOpen(true);
  }, []);

  const copyAddress = useCallback(async () => {
    const parts = [
      locator.workTitle,
      locator.documentLabel,
      "صفحهٔ " + (pageQuery.data?.label ?? ""),
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(parts.join("، "));
      setFlash("نشانی کپی شد");
    } catch {
      setFlash("کپی ممکن نشد");
    }
    window.setTimeout(() => setFlash(null), 1500);
  }, [locator, pageQuery.data?.label]);

  /* RES-08: ارجاع متنی + نشانی عمیق — همان قاعدهٔ کارت نتیجه (بدون تکرار «جلد») */
  const [citationCopied, setCitationCopied] = useState(false);
  const copyCitation = useCallback(async () => {
    const docLabel = locator.documentLabel;
    const docPart = docLabel
      ? /^ج\s|جلد/.test(docLabel)
        ? docLabel
        : `جلد ${docLabel}`
      : "";
    const citation = [
      locator.workTitle,
      docPart,
      /* صفحهٔ بدون شمارهٔ چاپی («—»، آغاز سند) در ارجاع نمی‌آید — بدون جعل شماره */
      pageQuery.data?.label && pageQuery.data.label !== "—"
        ? `صفحهٔ ${pageQuery.data.label}`
        : "",
    ]
      .filter(Boolean)
      .join("، ");
    // فاز ۲: نشانی معنایی کامل برای کپی (path نام‌دار + pg عددی)
    const address = readShareHref(locator.documentUid, {
      title: locator.workTitle,
      pgUid: resolvedPageUid,
      hl: locator.hl ? `${locator.hl[0]}:${locator.hl[1]}` : null,
    });
    try {
      await navigator.clipboard.writeText([citation, address].filter(Boolean).join("\n"));
      setCitationCopied(true);
      window.setTimeout(() => setCitationCopied(false), 1500);
    } catch {
      setFlash("کپی ممکن نشد");
      window.setTimeout(() => setFlash(null), 1500);
    }
  }, [locator, pageQuery.data, resolvedPageUid]);

  /* ---------- ناوبری صفحه‌ای درون پنل ---------- */
  const pageIdx = pageRefs.findIndex((p) => p.page_uid === resolvedPageUid);
  const jumpPage = useCallback(
    (ref: PageRef) => {
      onNavigate({
        ...locator,
        pageUid: ref.page_uid,
        hl: null,
        key: `${documentUid}:${ref.page_uid}`,
      });
    },
    [locator, onNavigate, documentUid],
  );

  const docLabel =
    workQuery.data?.documents.find((d) => d.uid === documentUid)?.label ??
    locator.documentLabel;

  return (
    <section
      aria-label="متن نتیجه در کنار نتایج"
      className="anim-rise flex max-h-[calc(100vh-8.5rem)] min-h-96 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_8px_32px_-16px_rgb(0_0_0/0.18)]"
    >
      {/* سربرگ پنل */}
      <header className="flex items-center justify-between gap-2 border-b border-border bg-gradient-to-l from-primary/10 via-primary/5 to-transparent px-3.5 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{locator.workTitle}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FileText className="size-3" aria-hidden="true" />
            {locator.documentLabel || docLabel}
            {pageQuery.data?.label ? (
              <>
                <span aria-hidden="true">·</span>
                صفحهٔ {pageQuery.data.label}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="یادداشت‌های این سند"
            title="یادداشت‌های شخصی (RES) — ساخت/ویرایش در همین پنل"
            className="relative size-8"
            onClick={() => setNotesOpen(true)}
          >
            <StickyNote className="size-3.5" />
            {docNoteCount > 0 ? (
              <span className="absolute -end-0.5 -top-0.5 inline-flex min-w-4 justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground">
                {faNum(docNoteCount)}
              </span>
            ) : null}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="کپی ارجاع متنی با نشانی عمیق"
            title="ارجاع متنی + نشانی عمیق برای یادداشت‌های شما (RES-08)"
            className="size-8"
            onClick={() => void copyCitation()}
          >
            {citationCopied ? <Check className="size-3.5 text-primary" /> : <BookMarked className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="کپی نشانی"
            className="size-8"
            onClick={() => void copyAddress()}
          >
            <Copy className="size-3.5" />
          </Button>
          <HashLink
            to={readerHref(locator.documentUid)}
            slug={locator.workTitle}
            query={{
              ...(resolvedPageUid ? { pg: resolvedPageUid } : {}),
              ...(hl ? { hl: `${hl[0]}:${hl[1]}` } : {}),
            }}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="بازکردن در کتاب‌خوان کامل"
            title="بازکردن در کتاب‌خوان کامل"
          >
            <BookOpenText className="size-4" aria-hidden="true" />
          </HashLink>
          <Button variant="ghost" size="icon" aria-label="بستن پنل متن" className="size-8" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      {/* متن صفحه */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-reader" dir="rtl">
        {pageQuery.isPending ? (
          <div className="mx-auto max-w-[640px] space-y-3 p-4" aria-busy="true">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-28 w-full" />
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> در حال بازکردن صفحهٔ نتیجه…
            </p>
          </div>
        ) : pageQuery.isError ? (
          <div className="mx-auto max-w-sm p-6 text-center text-sm">
            <p className="text-destructive">
              {errorMessage(pageQuery.error, "بازکردن این صفحه ممکن نشد.")}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void pageQuery.refetch()}>
              تلاش دوباره
            </Button>
          </div>
        ) : pageQuery.data ? (
          <>
            {pageQuery.data.overlay_applied ? (
              <p className="mx-auto max-w-[640px] px-4 pt-3 text-[11px] text-muted-foreground">
                این صفحه شامل اصلاح سامانه است.{" "}
                <span className="bidi-ltr">{pageQuery.data.overlay_revision_uid}</span>
              </p>
            ) : null}
            <PageRenderer
              page={pageQuery.data}
              prefs={prefs}
              sectionUidByBlockId={{}}
              flashBlockId={null}
              highlight={highlight}
              collapsedSanads={new Set()}
              onToggleSanad={() => undefined}
              onFootnoteClick={(refUid) => onFootnoteClick(refUid)}
              onLinkClick={onLinkClick}
              onVerseClick={onVerseClick}
              onHadithClick={onHadithClick}
              onSelection={onSelection}
            />
          </>
        ) : null}
      </div>

      {/* پنل زمینه (پاورقی/آیه/روایت) */}
      {ctx ? (
        <div className="max-h-56 overflow-y-auto border-t border-border">
          <FootnotePanel
            data={ctx}
            onBack={() => setCtx(null)}
            onHadithLookup={setHadithLookupUid}
            documentUid={documentUid}
            onHadithFiche={onHadithFiche}
            onHadithNote={(localUid, revayatIndex) => {
              setHadithNoteScope({ localUid, revayatIndex });
              setCtx(null);
              setNotesOpen(true);
            }}
          />
        </div>
      ) : null}

      {/* ناوبری پایین */}
      <footer className="flex items-center justify-between gap-2 border-t border-border bg-surface px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          className="min-h-9 gap-1"
          disabled={pageIdx <= 0}
          onClick={() => pageIdx > 0 && jumpPage(pageRefs[pageIdx - 1])}
        >
          <ChevronRight className="size-3.5" aria-hidden="true" />
          {pageIdx > 0 ? pageRefs[pageIdx - 1].label : "قبلی"}
        </Button>
        <span className="text-[11px] text-muted-foreground" aria-live="polite">
          {flash ?? (pageQuery.data ? `صفحهٔ ${pageQuery.data.label}` : "")}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="min-h-9 gap-1"
          disabled={pageIdx < 0 || pageIdx >= pageRefs.length - 1}
          onClick={() => pageIdx < pageRefs.length - 1 && jumpPage(pageRefs[pageIdx + 1])}
        >
          {pageIdx >= 0 && pageIdx < pageRefs.length - 1
            ? pageRefs[pageIdx + 1].label
            : "بعدی"}
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        </Button>
      </footer>

      {/* فیش — کامل مثل کتاب‌خوان */}
      <FicheDialog
        open={ficheOpen}
        onOpenChange={(o) => {
          setFicheOpen(o);
          if (!o) setSelection(null);
        }}
        selection={selection}
        documentUid={documentUid}
        documentLabel={locator.documentLabel || docLabel}
        page={pageQuery.data ?? null}
        sectionUid={null}
        work={{ uid: locator.workUid, title: locator.workTitle }}
      />

      {/* یادداشت‌های شخصی — شیت پایین با همان NotesPanel کتاب‌خوان (RES) */}
      <Sheet open={notesOpen} onOpenChange={setNotesOpen}>
        <SheetContent side="bottom" className="flex h-[75vh] flex-col overflow-hidden">
          <SheetHeader className="border-b border-border pb-2">
            <SheetTitle className="flex items-center gap-1.5 text-sm">
              <StickyNote className="size-4 text-primary" aria-hidden="true" />
              یادداشت‌های این سند — کنار نتایج
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <NotesPanel
              documentUid={documentUid}
              currentPageUid={resolvedPageUid || null}
              pageLabel={pageQuery.data?.label ?? null}
              hadithScope={hadithNoteScope}
              onClearHadithScope={() => setHadithNoteScope(null)}
              onJumpToPage={(pg) => {
                /* پرش عمیق یادداشت: تعویض صفحهٔ درون پنلی + بستن شیت */
                setNotesOpen(false);
                const ref = pageRefs.find((p) => p.page_uid === pg);
                if (ref) {
                  jumpPage(ref);
                } else {
                  onNavigate({
                    ...locator,
                    pageUid: pg,
                    hl: null,
                    key: `${documentUid}:${pg}`,
                  });
                }
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* پرس‌وجوی میان‌کتابی روایت (§۴۷) — از پنل زمینهٔ پنل */}
      <HadithLocationsDialog
        documentUid={documentUid}
        localHadithUid={hadithLookupUid ?? ""}
        open={!!hadithLookupUid}
        onOpenChange={(o) => !o && setHadithLookupUid(null)}
        onNoteRequest={(localUid, revayatIndex) => {
          setHadithLookupUid(null);
          setHadithNoteScope({ localUid, revayatIndex });
          setNotesOpen(true);
        }}
      />
    </section>
  );
}
