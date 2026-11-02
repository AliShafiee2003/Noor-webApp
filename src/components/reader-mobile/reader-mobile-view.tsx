"use client";

/**
 * کتاب‌خوان موبایل — بازسازی عین پروتوتایپ epub_reader_prototype.html.
 * فاز ۲: موتور زیرصفحه‌بندی measurer + ورق‌زدن (تپ/کشیدن/کلید/چرخ) + pill + تاریخچهٔ undo/redo.
 * موقعیت = {page_uid, sub} — زیرصفحه در ذخیرهٔ موضع سروری با getPositionExtra می‌رود.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, StickyNote } from "lucide-react";
import { Mi } from "./mi";
import { useMobilePrefs } from "./use-mobile-prefs";
import { mobileFontStack } from "./reading-themes";
import { useReaderTheme, legacyReadingThemeTarget, hasChosenSiteTheme, type ReaderThemeTarget } from "@/lib/reader/use-reader-theme";
import { playThemeRipple } from "./theme-ripple";
import { SharedReaderStatus } from "@/components/reader/shared-status";
import { DeleteMarkDialog } from "@/components/reader/delete-mark-dialog";
import { readerAddressText } from "@/lib/reader/address";
import { restoreReaderLocation } from "@/lib/reader/navigation";
import { useReaderAnnotations } from "@/lib/reader/use-reader-annotations";
import { HighlightSheet } from "./highlight-sheet";
import { MobileToolbar } from "./mobile-toolbar";
import { BookmarkRibbon, StudyLockOverlay } from "./overlays";
import { usePagination } from "./use-pagination";
import { useGestures, computeTapRect } from "./use-gestures";
import { useSelection } from "./use-selection";
import { SelectionBubble, type BubbleAction } from "./selection-bubble";
import { ScrollScrubber } from "./scroll-scrubber";
import { MobileSettingsSheet } from "./mobile-settings-sheet";
import { MobileSearchPanel } from "./mobile-search-panel";
import { MobileTocPanel } from "./mobile-toc-panel";
import { MobileDialog, type MobileDialogState } from "./mobile-dialog";
import { MobileBottomBar, type PreviewCard } from "./mobile-bottom-bar";
import { MobileFootnoteSheet } from "./mobile-footnote-sheet";
import type { ReaderData } from "./use-reader-data";
import { PageRenderer, type ReaderSelection, type SearchHitRange } from "@/components/reader/page-renderer";
import { selectionSegments } from "@/components/reader/selection-offset";
import { FicheDialog } from "@/components/reader/fiche-dialog";
import { NotesPanel } from "@/components/reader/notes-panel";
import { PdfExportDialog } from "@/components/reader/pdf-export-dialog";
import { HadithLocationsDialog } from "@/components/search/hadith-locations-dialog";
import type { FootnotePanelData } from "@/components/reader/footnote-panel";
import { quranStackFor } from "@/lib/fonts";
import { PdfReaderDynamic } from "./pdf-shell";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, errorMessage } from "@/lib/api";
import type {
  Highlight as HighlightT,
  HighlightColor,
  PageBlock,
  PagePayload,
  TocSection,
} from "@/lib/types";
import { blockOffsets } from "@/lib/types";
import { normalizeOffsets } from "@/components/search/result-card";
import "./reader-mobile.css";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { faNum } from "@/lib/format";
import { workHref } from "@/lib/href";
import { useRoute } from "@/lib/hash-router";
import { useWorkspaceStore } from "@/store/workspace";
import type { ReaderPrefs } from "@/lib/types";

const StablePageRenderer = memo(PageRenderer);
const ignoreSelection = () => undefined;

const ALIGN_MAP: Record<string, string> = {
  auto: "start",
  right: "right",
  center: "center",
  left: "left",
  justify: "justify",
};

interface Pos {
  page_uid: string;
  sub: number;
}

/* برش پود به بازهٔ بلاک‌های یک زیرصفحه */
function slicePayload(p: PagePayload, range: [number, number]): PagePayload {
  const [a, b] = range;
  if (a <= 0 && b >= p.blocks.length - 1) return p;
  return { ...p, blocks: p.blocks.slice(a, b + 1) };
}

/* سند روایت‌های جمع‌شده — وضعیت مستقل موبایل */
function useCollapsedSanads() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((blockId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);
  return { collapsed, toggle };
}

export function ReaderMobileView({
  documentUid,
  rd,
  positionExtraRef,
  scrollRef,
  onExitMobile,
  openedHighlightUid,
  onOpenHighlight,
}: {
  documentUid: string;
  rd: ReaderData;
  positionExtraRef: RefObject<Record<string, unknown> | undefined>;
  scrollRef: RefObject<HTMLElement | null>;
  onExitMobile?: () => void;
  openedHighlightUid: string | null;
  onOpenHighlight: (uid: string | null) => void;
}) {
  const { navigate } = useRoute();
  const { prefs, update, legacyReadingTheme, prefsLoaded, effectiveDir, bookDir, setBookDirection, clearBookDir } = useMobilePrefs(documentUid);
  const desktopPrefs = useWorkspaceStore((s) => s.prefs);
  const queryClient = useQueryClient();
  const { collapsed: collapsedSanads, toggle: toggleSanad } = useCollapsedSanads();
  const [locked, setLocked] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [ficheOpen, setFicheOpen] = useState(false);
  const [ficheSel, setFicheSel] = useState<ReaderSelection | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [hadithLookupUid, setHadithLookupUid] = useState<string | null>(null);
  const [hadithNoteScope, setHadithNoteScope] = useState<{ localUid: string; revayatIndex?: string | null } | null>(null);
  const [colorPick, setColorPick] = useState(false);
  /* فاز ۷ — جست‌وجوی سروری: پنل + شمارهٔ نتیجهٔ جاری (capsule) */
  const [searchOpen, setSearchOpen] = useState(false);
  const curHit = (rd.inBookSearch.data?.results ?? []).findIndex((item) => item.passage_uid === rd.selectedSearchPassageUid);
  const setCurHit = (ord: number) => rd.setSelectedSearchPassageUid(rd.inBookSearch.data?.results[ord]?.passage_uid ?? null);
  /* فاز ۸ — فهرست، پانویس، دیالوگ پرش، پیش‌نمایش کاروسل */
  const [tocOpen, setTocOpen] = useState(false);
  const [footnote, setFootnote] = useState<FootnotePanelData | null>(null);
  const [dialog, setDialog] = useState<MobileDialogState | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewCache, setPreviewCache] = useState<Record<string, PagePayload>>({});
  const annotations = useReaderAnnotations(documentUid);
  const openHighlight = useCallback((uid: string) => {
    /* کلیک روی هر قطعه، ویرایشگر متن کامل (لنگر گروه) را باز می‌کند. */
    const resolved = rd.highlightAnchorByUid[uid] ?? uid;
    setNotesOpen(false);
    onOpenHighlight(resolved);
  }, [onOpenHighlight, rd.highlightAnchorByUid]);
  const scrollFracRef = useRef(0);

  /* ---------- موضع ورق‌زدن: {page_uid, sub} ---------- */
  const [sub, setSub] = useState(0);
  const [dragDx, setDragDx] = useState<number | null>(null);
  const [barsOn, setBarsOn] = useState(true);
  const histLen = rd.historyCounts;
  const restoredRef = useRef(false);
  const pendingEnterRef = useRef<"last" | null>(null);
  const pendingSubRef = useRef<number | null>(null);

  const currentPageUid = rd.currentPageUid ?? "";
  const payload = rd.activePayload;
  const mode = prefs.mode === "scroll" ? "scroll" : "pages";

  /* ---------- سیستم نمایش موقت ۳ ثانیه‌ای کپسول شماره صفحه (#rm-pill) ---------- */
  const [pillVisible, setPillVisible] = useState(false);
  const pillTimerRef = useRef<number | null>(null);

  const triggerPill = useCallback(() => {
    if (!prefs.show_pill) return;
    setPillVisible(true);
    if (pillTimerRef.current) window.clearTimeout(pillTimerRef.current);
    pillTimerRef.current = window.setTimeout(() => {
      setPillVisible(false);
    }, 2000);
  }, [prefs.show_pill]);

  // ۱. موقعیت باز شدن کتاب / لود اولیه
  useEffect(() => {
    const t = window.setTimeout(() => {
      triggerPill();
    }, 150);
    return () => window.clearTimeout(t);
  }, [documentUid, triggerPill]);

  // ۲. موقعیت پس از بستن فوتر و نوارها (barsOn: true -> false)
  const prevBarsOnRef = useRef(barsOn);
  useEffect(() => {
    if (prevBarsOnRef.current && !barsOn) {
      const t = window.setTimeout(() => {
        triggerPill();
      }, 50);
      prevBarsOnRef.current = barsOn;
      return () => window.clearTimeout(t);
    }
    prevBarsOnRef.current = barsOn;
  }, [barsOn, triggerPill]);

  // ۳. موقعیت ورق‌زدن / اسکرول و ورود به صفحه جدید حین مطالعه (barsOn === false)
  const prevPageKeyRef = useRef<string>("");
  useEffect(() => {
    const key = `${currentPageUid}-${sub}`;
    if (prevPageKeyRef.current && prevPageKeyRef.current !== key && !barsOn) {
      const t = window.setTimeout(() => {
        triggerPill();
      }, 50);
      prevPageKeyRef.current = key;
      return () => window.clearTimeout(t);
    }
    prevPageKeyRef.current = key;
  }, [currentPageUid, sub, barsOn, triggerPill]);

  // پاک‌سازی تایمر در خروج
  useEffect(() => {
    return () => {
      if (pillTimerRef.current) window.clearTimeout(pillTimerRef.current);
    };
  }, []);

  /* ---------- صحنه + measurer ---------- */
  const [stageEl, setStageEl] = useState<HTMLElement | null>(null);
  const stageRefCb = useCallback((el: HTMLDivElement | null) => setStageEl(el), []);

  const theme = useReaderTheme();
  const dark = theme.dark;
  const fontStack = mobileFontStack(prefs.font);
  const prog = prefs.progression === "auto" ? (effectiveDir === "ltr" ? "ltr" : "rtl") : prefs.progression;

  /* ---------- انتخاب متن موبایل (فاز ۶) ---------- */
  const blockByIdRef = useRef(new Map<string, PageBlock>());
  useEffect(() => {
    const m = new Map<string, PageBlock>();
    for (const p of rd.allPayloads) for (const b of p.blocks) m.set(b.id, b);
    blockByIdRef.current = m;
  }, [rd.allPayloads]);
  const getBlock = useCallback((id: string) => blockByIdRef.current.get(id), []);
  const viewEl = useCallback((): HTMLElement | null => {
    if (!stageEl) return null;
    if (mode === "scroll") {
      /* .rm-sec خودش .rm-book است؛ محتوای همان بخش مقصد «انتخاب همه» */
      return stageEl.querySelector<HTMLElement>(`[id="pgsec-${currentPageUid}"]`);
    }
    const fr = stageEl.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestArea = 0;
    stageEl.querySelectorAll<HTMLElement>(".rm-page").forEach((el) => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, fr.right) - Math.max(r.left, fr.left));
      const h = Math.max(0, Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top));
      const area = w * h;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    });
    return best;
  }, [stageEl, mode, currentPageUid]);
  const selectionApi = useSelection({
    stageEl,
    enabled: !rd.isPdfDoc && !rd.pagesUnavailable && !locked && !settingsOpen && !notesOpen && !ficheOpen && !searchOpen && !openedHighlightUid,
    getBlock,
    viewEl,
    resetKey: `${currentPageUid}|${sub}|${mode}|${settingsOpen ? 1 : 0}${locked ? 1 : 0}${notesOpen ? 1 : 0}${ficheOpen ? 1 : 0}`,
  });
  const { sel: activeSel, ui: selUi, clear: clearSel, selectWordAt, handleDown } = selectionApi;

  /* ---------- فاز ۷: جست‌وجوی سروری در همین جلد ---------- */
  const searchResults = rd.inBookSearch.data?.results ?? [];
  const searchActive = !!rd.inBookSearchQuery;
  const searchLoading = rd.inBookSearch.isFetching && searchActive;
  const searchError = rd.inBookSearch.error instanceof Error ? rd.inBookSearch.error : null;

  const runServerSearch = useCallback(
    (q: string) => {
      const t = q.trim();
      setCurHit(-1);
      if (!t) {
        rd.handleClearSearch();
        return;
      }
      rd.handleExecuteSearch(t);
    },
    [rd],
  );

  const exitSearch = useCallback(() => {
    rd.handleClearSearch();
    setCurHit(-1);
    setSearchOpen(false);
  }, [rd]);

  /* نتایج → بازه‌های درون‌بلوکی هر صفحه (آفست سروری سطح سند است).
     صفحه از خودِ بازهٔ بلاک پیدا می‌شود، نه از page.uid نتیجه — در برخی
     اسناد pilot نگاشت سروری page_uid با پودهای ریدر یکی نیست.
     چیپ «فاصله» بازه‌های اضافیِ نرم‌شده را فقط برای رنگ‌آمیزی محلی می‌افزاید
     (ord=-1) و در شمارش کپسول شمرده نمی‌شود. */
  const searchHitsByPage = useMemo<Record<string, Record<string, SearchHitRange[]>>>(() => {
    const out: Record<string, Record<string, SearchHitRange[]>> = {};
    if (!searchActive) return out;
    const pages = rd.allPayloads;
    if (!pages.length) return out;

    for (let ord = 0; ord < searchResults.length; ord += 1) {
      const item = searchResults[ord];
      if (item.document?.uid && item.document.uid !== documentUid) continue;
      const offs = normalizeOffsets(item.match_offsets) ?? normalizeOffsets(item.source_offsets);
      if (!offs) continue;
      for (const p of pages) {
        const b = p.blocks.find((x) => {
          const r = blockOffsets(x);
          return r && offs.start >= r.start && offs.start < r.end;
        });
        if (!b) continue;
        const range = blockOffsets(b)!;
        const relStart = offs.start - range.start;
        const relEnd = Math.max(relStart + 1, Math.min(offs.end, range.end) - range.start);
        ((out[p.page_uid] ??= {})[b.id] ??= []).push({ start: relStart, end: relEnd, ord });
        break;
      }
    }

    return out;
  }, [searchActive, searchResults, rd.allPayloads, rd.inBookSearchQuery, documentUid]);

  const pagePercent = useCallback(
    (uid: string | null | undefined): number | null => {
      if (!uid) return null;
      const idx = rd.pageRefs.findIndex((r) => r.page_uid === uid);
      if (idx < 0) return null;
      if (rd.pageRefs.length < 2) return 0;
      return Math.round((idx / (rd.pageRefs.length - 1)) * 100);
    },
    [rd.pageRefs],
  );

  /* ---------- پاورقی/ارجاع (فاز ۸): پود دربردارندهٔ ارجاع → شیت پایین ---------- */
  const openFootnoteFrom = useCallback(
    (refUid: string) => {
      clearSel();
      setColorPick(false);
      const holders = [
        ...rd.allPayloads,
        ...Object.values(rd.payloadByUid),
        ...(rd.activePayload ? [rd.activePayload] : []),
      ];
      for (const p of holders) {
        const fn = p.footnotes.find((f) => f.uid === refUid);
        if (fn) {
          setFootnote({ kind: "footnote", uid: fn.uid, label: fn.label, text: fn.text });
          return;
        }
      }
      setFootnote({ kind: "link", originalAddress: "پاورقی " + refUid });
    },
    [rd.allPayloads, rd.payloadByUid, rd.activePayload, clearSel],
  );
  const openLink = useCallback(
    (link: { original_address?: string | null }) => {
      clearSel();
      setColorPick(false);
      setFootnote({ kind: "link", originalAddress: link.original_address || "ارجاع" });
    },
    [clearSel],
  );
  const openVerse = useCallback(
    (block: PageBlock) => {
      const cit = block.citations?.[0];
      if (!cit) return;
      clearSel();
      setColorPick(false);
      setFootnote({
        kind: "verse",
        verse: {
          citation: cit,
          quotedText: block.text,
          inHadith: block.hadith_uid ?? cit.in_hadith ?? null,
          hasParent: cit.has_parent,
        },
      });
    },
    [clearSel],
  );
  const openHadith = useCallback(
    (block: PageBlock) => {
      if (!block.hadith_uid) return;
      clearSel();
      setColorPick(false);
      setFootnote({
        kind: "hadith",
        hadith: {
          localUid: block.hadith_uid,
          revayatIndex: block.revayat_index ?? null,
        },
      });
    },
    [clearSel],
  );
  const onHadithFiche = useCallback(
    (localUid: string) => {
      for (const p of rd.allPayloads) {
        const parts = p.blocks.filter((b) => b.hadith_uid === localUid);
        if (!parts.length) continue;
        const first = blockOffsets(parts[0]);
        const last = blockOffsets(parts[parts.length - 1]);
        if (!first || !last) return;
        setFootnote(null);
        setFicheSel({
          blockId: parts[0].id,
          start: first.start,
          end: last.end,
          text: parts.map((b) => b.text).join("\n"),
          hadithUid: localUid,
        });
        setFicheOpen(true);
        return;
      }
    },
    [rd.allPayloads],
  );

  const rendererPrefs = useMemo<ReaderPrefs>(
    () => ({
      ...desktopPrefs,
      font_size: prefs.font_size,
      line_height: prefs.line_height,
    }),
    [desktopPrefs, prefs.font_size, prefs.line_height],
  );

  const renderPage = useCallback(
    (p: PagePayload) => (
      <div className="rm-book" dir={effectiveDir}>
        <StablePageRenderer
          page={p}
          prefs={rendererPrefs}
          sectionUidByBlockId={rd.sectionUidByBlockId}
          sectionLevelByBlockId={rd.sectionLevelByBlockId}
          flashBlockId={rd.flashBlockId}
          highlight={rd.highlightByPage[p.page_uid] ?? null}
          userHighlights={rd.displayHlsByPage[p.page_uid]}
          searchHits={searchHitsByPage[p.page_uid]}
          currentSearchHitOrd={curHit}
          collapsedSanads={collapsedSanads}
          onToggleSanad={toggleSanad}
          onFootnoteClick={openFootnoteFrom}
          onLinkClick={openLink}
          onVerseClick={openVerse}
          onHadithClick={openHadith}
          onSelection={ignoreSelection}
          onHighlightOpen={openHighlight}
          hideSelectionToolbar
          frameless
        />
      </div>
    ),
    [effectiveDir, rendererPrefs, rd.sectionUidByBlockId, rd.sectionLevelByBlockId, rd.flashBlockId, rd.highlightByPage, rd.displayHlsByPage, searchHitsByPage, curHit, collapsedSanads, toggleSanad, openFootnoteFrom, openLink, openVerse, openHadith, openHighlight],
  );

  const typoKey = [
    prefs.font,
    prefs.font_size,
    prefs.line_height,
    prefs.para,
    prefs.margin,
    prefs.align,
    effectiveDir,
    desktopPrefs.semantic_colors ? "sem" : "",
    desktopPrefs.font_quran ?? "amiri-quran",
    desktopPrefs.quran_font_size ?? 24,
    desktopPrefs.quran_line_height ?? 2.0,
  ].join("|");

  const paginationPayloads = useMemo(
    () => (mode === "pages" && !rd.isPdfDoc && payload ? [payload] : []),
    [mode, rd.isPdfDoc, payload],
  );

  const { measures, stage } = usePagination({
    hostEl: stageEl,
    stageEl,
    payloads: paginationPayloads,
    typoKey,
    volumeFirstPageUid: rd.pageRefs[0]?.page_uid ?? null,
    renderPage,
  });

  /* ---------- پرش به نتیجهٔ جست‌وجو: صفحه + زیرصفحهٔ دربردارندهٔ بلوک ---------- */
  const hitTargetRef = useRef<{ uid: string; ord: number } | null>(null);
  const hitNavSeqRef = useRef(0);

  /* page.uid سرور در برخی اسناد با پودهای ریدر هم‌نگاشت نیست؛ بازهٔ سند را
     با جست‌وجوی دودویی روی آفست بلاک صفحات به صفحهٔ واقعی تبدیل می‌کنیم. */
  const loadPagePayload = useCallback(
    (uid: string) =>
      queryClient.fetchQuery<PagePayload>({
        queryKey: ["reader-page", documentUid, uid],
        queryFn: () =>
          api.get<PagePayload>(
            `/documents/${encodeURIComponent(documentUid)}/pages/${encodeURIComponent(uid)}`,
          ),
        staleTime: 5 * 60_000,
      }),
    [queryClient, documentUid],
  );

  const blockIdAtOffset = useCallback((p: PagePayload, offset: number) => {
    for (const b of p.blocks) {
      const r = blockOffsets(b);
      if (r && offset >= r.start && offset < r.end) return b.id;
    }
    return null;
  }, []);

  const resolveHitPage = useCallback(
    async (offset: number): Promise<string | null> => {
      const refs = rd.pageRefs;
      if (!refs.length) return null;
      let lo = 0;
      let hi = refs.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const uid = refs[mid].page_uid;
        let p: PagePayload;
        try {
          p = await loadPagePayload(uid);
        } catch {
          return null;
        }
        const ranges = p.blocks
          .map(blockOffsets)
          .filter((r): r is { start: number; end: number } => r !== null);
        if (!ranges.length) return uid;
        const a = Math.min(...ranges.map((r) => r.start));
        const z = Math.max(...ranges.map((r) => r.end));
        if (offset < a) hi = mid - 1;
        else if (offset >= z) lo = mid + 1;
        else return uid;
      }
      return null;
    },
    [rd.pageRefs, loadPagePayload],
  );

  const applyHitTarget = useCallback(
    (t: { uid: string; ord: number }) => {
      const p = rd.payloadByUid[t.uid] ?? (rd.activePayload?.page_uid === t.uid ? rd.activePayload : null);
      if (!p) return false;
      const m = measures[t.uid];
      if (!m) return false;
      const item = searchResults[t.ord];
      const offs = item
        ? normalizeOffsets(item.match_offsets) ?? normalizeOffsets(item.source_offsets)
        : null;
      const blockId = offs ? blockIdAtOffset(p, offs.start) : null;
      const blockIdx = blockId ? p.blocks.findIndex((b) => b.id === blockId) : -1;
      const k =
        blockIdx >= 0 ? m.ranges.findIndex(([a, b]) => blockIdx >= a && blockIdx <= b) : -1;
      if (mode === "pages" && k >= 0 && k !== sub) setSub(k);
      if (blockId) {
        rd.setFlashBlockId(blockId);
        window.setTimeout(() => rd.setFlashBlockId(null), 1800);
        if (mode === "scroll") {
          window.setTimeout(() => {
            document
              .querySelector<HTMLElement>(`#pgsec-${t.uid} [data-block-id="${blockId}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 80);
        }
      }
      return blockId != null || !offs;
    },
    [rd, measures, searchResults, mode, sub, blockIdAtOffset],
  );

  /* ---------- پرش به بلوک (فهرست): صفحه درست، سپس زیرصفحهٔ دربردارنده ---------- */
  const blockTargetRef = useRef<{ uid: string; blockId: string } | null>(null);

  const applyBlockTarget = useCallback(
    (t: { uid: string; blockId: string }) => {
      const p = rd.payloadByUid[t.uid] ?? (rd.activePayload?.page_uid === t.uid ? rd.activePayload : null);
      if (!p) return false;
      const m = measures[t.uid];
      if (!m) return false;
      const idx = p.blocks.findIndex((b) => b.id === t.blockId);
      if (idx < 0) return true;
      const k = m.ranges.findIndex(([a, b]) => idx >= a && idx <= b);
      if (mode === "pages" && k >= 0 && k !== sub) setSub(k);
      rd.setFlashBlockId(t.blockId);
      window.setTimeout(() => rd.setFlashBlockId(null), 3100);
      if (mode === "scroll") {
        window.setTimeout(() => {
          document
            .querySelector<HTMLElement>(`#pgsec-${t.uid} [data-block-id="${t.blockId}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
      }
      return true;
    },
    [rd, measures, mode, sub],
  );

  useEffect(() => {
    const t = blockTargetRef.current;
    if (!t) return;
    if (applyBlockTarget(t)) blockTargetRef.current = null;
  }, [applyBlockTarget]);

  const goToHit = useCallback(
    async (ord: number) => {
      const item = searchResults[ord];
      if (!item) return;
      setCurHit(ord);
      setSearchOpen(false);
      if (item.document?.uid && item.document.uid !== documentUid) {
        rd.handleSelectSearchResult(item);
        return;
      }
      const seq = ++hitNavSeqRef.current;
      const offs = normalizeOffsets(item.match_offsets) ?? normalizeOffsets(item.source_offsets);
      let uid = item.page?.uid ?? null;
      if (offs) {
        /* پیشنهاد سرور فقط وقتی پذیرفته می‌شود که بازه واقعاً در بلاک‌های آن صفحه باشد */
        const hinted = uid ? await loadPagePayload(uid).catch(() => null) : null;
        if (seq !== hitNavSeqRef.current) return;
        if (!hinted || !blockIdAtOffset(hinted, offs.start)) {
          const resolved = await resolveHitPage(offs.start);
          if (seq !== hitNavSeqRef.current) return;
          uid = resolved ?? uid;
        }
      }
      if (!uid) return;
      hitTargetRef.current = { uid, ord };
      if (uid !== currentPageUid) {
        rd.goToPage(uid);
      } else if (applyHitTarget({ uid, ord })) {
        hitTargetRef.current = null;
      }
    },
    [
      searchResults,
      documentUid,
      rd,
      currentPageUid,
      applyHitTarget,
      loadPagePayload,
      blockIdAtOffset,
      resolveHitPage,
    ],
  );

  const stepHit = useCallback(
    (d: 1 | -1) => {
      const totalHits = searchResults.length;
      if (!totalHits) return;
      const base = curHit >= 0 ? curHit : d > 0 ? -1 : 0;
      goToHit((base + d + totalHits) % totalHits);
    },
    [searchResults.length, curHit, goToHit],
  );

  /* ---------- تاریخچهٔ undo/redo ---------- */
  const pushHist = (position: Pos) => rd.recordHistory({ ...rd.captureLocation(), page_uid: position.page_uid, sub: position.sub });
  const navBack = rd.navigationBack;
  const navFwd = rd.navigationForward;

  /* ---------- پیام کوتاه (toast) ---------- */
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 2400);
  }, []);
  useEffect(
    () => () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  /* ---------- فاز ۸: پیش‌نمایش کاروسل (prototype: showPreview/hidePreview) ---------- */
  const totalPages = rd.pageRefs.length;
  const hidePreview = useCallback(() => setPreviewing(false), []);
  const togglePreview = useCallback(() => {
    setPreviewing((prev) => {
      if (!prev) setPreviewIdx(Math.max(0, rd.pageIdx));
      return !prev;
    });
  }, [rd.pageIdx]);
  const previewInput = useCallback(
    (f: number) => {
      if (!totalPages) return;
      setPreviewing(true);
      setPreviewIdx(Math.max(0, Math.min(totalPages - 1, Math.round(f * (totalPages - 1)))));
    },
    [totalPages],
  );

  /* پرش به صفحهٔ شماره‌ای (۰-مبنا) + ثبت تاریخچه */
  const jumpToPageIndex = useCallback(
    (i: number) => {
      const refs = rd.pageRefs;
      if (!refs.length) return;
      const ref = refs[Math.max(0, Math.min(refs.length - 1, i))];
      if (!ref) return;
      hidePreview();
      pushHist({ page_uid: currentPageUid, sub });
      if (ref.page_uid !== currentPageUid || mode === "scroll") {
        pendingSubRef.current = 0;
        rd.goToPage(ref.page_uid);
      } else if (mode === "pages") {
        setSub(0);
      }
    },
    [rd.pageRefs, rd.goToPage, currentPageUid, sub, mode, hidePreview, pushHist],
  );

  const jumpToBlockAt = useCallback(
    (uid: string, blockId: string | null) => {
      hidePreview();
      pushHist({ page_uid: currentPageUid, sub });
      if (!blockId) {
        pendingSubRef.current = 0;
        rd.goToPage(uid);
        return;
      }
      blockTargetRef.current = { uid, blockId };
      if (uid !== currentPageUid) {
        pendingSubRef.current = 0;
        rd.goToPage(uid);
      } else if (applyBlockTarget({ uid, blockId })) {
        blockTargetRef.current = null;
      }
    },
    [currentPageUid, sub, hidePreview, pushHist, rd.goToPage, applyBlockTarget],
  );

  const jumpToSection = useCallback(
    (s: TocSection) => {
      let uid: string | null = s.page_uid || null;
      if (!uid && s.block_id) uid = rd.blockPage[s.block_id] ?? null;
      if (!uid && s.page_label) {
        const m = rd.pageRefs.find((p) => p.label === s.page_label || p.num === s.page_label);
        uid = m?.page_uid ?? null;
      }
      setTocOpen(false);
      if (!uid) {
        showToast("جای این بخش پیدا نشد");
        return;
      }
      jumpToBlockAt(uid, s.block_id ?? null);
    },
    [rd.blockPage, rd.pageRefs, jumpToBlockAt, showToast],
  );

  /* ---------- دیالوگ‌های پرش (proto: jumpDialog/percentDialog) ---------- */
  const openPageDialog = useCallback(() => {
    const n = totalPages;
    if (n < 1) return;
    setDialog({
      kind: "number",
      title: "رفتن به صفحه",
      hint: `۱ تا ${faNum(n)}`,
      max: n,
      init: Math.max(1, Math.min(n, Math.max(0, rd.pageIdx) + 1)),
      onOk: (v) => jumpToPageIndex(v - 1),
    });
  }, [totalPages, rd.pageIdx, jumpToPageIndex]);

  const openPercentDialog = useCallback(() => {
    if (!totalPages) return;
    const f =
      mode === "scroll"
        ? scrollFracRef.current
        : totalPages > 1
          ? Math.max(0, rd.pageIdx) / (totalPages - 1)
          : 0;
    setDialog({
      kind: "number",
      title: "رفتن به درصد",
      hint: "۱ تا ۱۰۰",
      max: 100,
      init: Math.round(f * 100) || 1,
      onOk: (v) => jumpToPageIndex(Math.round((v / 100) * (totalPages - 1))),
    });
  }, [totalPages, mode, rd.pageIdx, jumpToPageIndex]);

  /* ---------- کارت‌های پیش‌نمایش: متن غنی سرفصل و پاراگراف‌ها با مقیاس مینیاتوری ---------- */
  const bmPages = rd.markedPageUids;

  const cardFor = useCallback(
    (i: number): PreviewCard | null => {
      const ref = rd.pageRefs[i];
      if (!ref) return null;
      if (rd.isPdfDoc) return { lines: [], bookmarked: bmPages.has(ref.page_uid), thumbPage: i + 1 };
      const cached = queryClient.getQueryData<PagePayload>(["reader-page", documentUid, ref.page_uid]);
      const p = previewCache[ref.page_uid] ?? rd.payloadByUid[ref.page_uid] ?? (rd.activePayload?.page_uid === ref.page_uid ? rd.activePayload : null) ?? cached;
      if (!p) return null;
      const lines = p.blocks
        .filter((b) => !!b.text?.trim())
        .slice(0, 8)
        .map((b) => ({
          text: b.text.trim(),
          isHeading: b.type === "heading",
        }));
      return {
        lines,
        label: ref.label || ref.num || String(i + 1),
        bookmarked: bmPages.has(ref.page_uid),
      };
    },
    [rd.pageRefs, rd.isPdfDoc, previewCache, rd.payloadByUid, rd.activePayload, queryClient, documentUid, bmPages],
  );

  const previewReqRef = useRef(new Set<string>());
  useEffect(() => {
    if (!previewing || rd.isPdfDoc) return;
    const n = rd.pageRefs.length;
    if (n === 0) return;

    // بارگذاری فوری صفحهٔ زیر انگشت کاربر (previewIdx)
    const curRef = rd.pageRefs[previewIdx];
    if (curRef) {
      const uid = curRef.page_uid;
      const cached = queryClient.getQueryData<PagePayload>(["reader-page", documentUid, uid]);
      if (!cached && !previewReqRef.current.has(uid)) {
        previewReqRef.current.add(uid);
        void loadPagePayload(uid)
          .then((p) => {
            if (p) setPreviewCache((prev) => (prev[uid] ? prev : { ...prev, [uid]: p }));
          })
          .catch(() => {});
      }
    }

    // پیش‌واکشی صفحات همسایه (شعاع ±۸) با تاخیر هوشمند برای جلوگیری از فلود شدن شبکه هنگام کشیدن سریع اسلایدر
    const timer = window.setTimeout(() => {
      const offsets: number[] = [];
      for (let d = 1; d <= 8; d += 1) {
        offsets.push(d, -d);
      }
      for (const d of offsets) {
        const idx = previewIdx + d;
        if (idx < 0 || idx >= n) continue;
        const ref = rd.pageRefs[idx];
        if (!ref) continue;
        const uid = ref.page_uid;
        const cached = queryClient.getQueryData<PagePayload>(["reader-page", documentUid, uid]);
        if (cached) continue;
        if (previewReqRef.current.has(uid)) continue;
        previewReqRef.current.add(uid);
        void loadPagePayload(uid)
          .then((p) => {
            if (p) setPreviewCache((prev) => (prev[uid] ? prev : { ...prev, [uid]: p }));
          })
          .catch(() => {});
      }
    }, 90);

    return () => {
      window.clearTimeout(timer);
    };
  }, [previewing, previewIdx, rd.pageRefs, loadPagePayload, queryClient, documentUid]);

  /* کسر پیشرفت در حالت اسکرول — اسلایدر پایین با آن هم‌گام می‌شود */
  useEffect(() => {
    if (mode !== "scroll") return;
    const sv = document.getElementById("rm-scroll");
    if (!sv) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const max = Math.max(1, sv.scrollHeight - sv.clientHeight);
      const frac = Math.min(1, Math.max(0, sv.scrollTop / max));
      scrollFracRef.current = frac;

    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    sv.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      sv.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mode, currentPageUid, payload, barsOn]);

  /* ---------- ورق‌زدن ---------- */
  const turn = useCallback(
    (d: 1 | -1) => {
      if (!rd.isPdfDoc && mode === "scroll") {
        const sv = document.getElementById("rm-scroll");
        if (sv) sv.scrollBy({ top: d * sv.clientHeight * 0.82, behavior: "smooth" });
        return;
      }
      const count = measures[currentPageUid]?.subs ?? 1;
      if (d > 0) {
        if (sub < count - 1) {
          pushHist({ page_uid: currentPageUid, sub });
          restoredRef.current = true;
          setSub(sub + 1);
        } else if (rd.nextRef) {
          pushHist({ page_uid: currentPageUid, sub });
          restoredRef.current = true;
          rd.goToPage(rd.nextRef.page_uid);
        }
      } else {
        if (sub > 0) {
          pushHist({ page_uid: currentPageUid, sub });
          restoredRef.current = true;
          setSub(sub - 1);
        } else if (rd.prevRef) {
          pushHist({ page_uid: currentPageUid, sub });
          restoredRef.current = true;
          pendingEnterRef.current = "last";
          rd.goToPage(rd.prevRef.page_uid);
        }
      }
    },
    [rd.isPdfDoc, rd.nextRef, rd.prevRef, rd.goToPage, mode, measures, currentPageUid, sub, pushHist],
  );

  /* تغییر صفحهٔ سروری → ورود در زیرصفحهٔ مقصد (صفر، آخر، یا برنامه‌ریزی‌شده) */
  useEffect(() => {
    if (!currentPageUid) return;
    if (pendingSubRef.current != null) {
      setSub(Math.max(0, pendingSubRef.current));
      pendingSubRef.current = null;
      return;
    }
    setSub(0);
  }, [currentPageUid]);

  /* مقصد جست‌وجو پس از رسیدن پود/اندازه‌گیری — بعد از ریست بالا اجرا می‌شود */
  useEffect(() => {
    const t = hitTargetRef.current;
    if (!t) return;
    if (applyHitTarget(t)) hitTargetRef.current = null;
  }, [applyHitTarget]);

  /* بازیابی زیرصفحهٔ ذخیره‌شده — فقط تا نخستین حرکت کاربر */
  const savedSub = rd.savedSub;
  useEffect(() => {
    if (restoredRef.current || savedSub == null) return;
    restoredRef.current = true;
    setSub(Math.max(0, savedSub));
  }, [savedSub]);

  /* رسیدن اندازه‌گیری → جاگیری زیرصفحه (درخواست «آخر» از مرز قبلی یا clamp) —
     واکنش به رویداد ناهمگام اندازه‌گیری است، نه مشتق از state */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const m = measures[currentPageUid];
    if (!m) return;
    if (pendingEnterRef.current === "last") {
      pendingEnterRef.current = null;
      setSub(Math.max(0, m.subs - 1));
    } else if (sub > m.subs - 1) {
      setSub(Math.max(0, m.subs - 1));
    }
  }, [measures, currentPageUid, sub]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ورود مستقیم به حالت اسکرول (بازکردن نشانی/رفرش): پرش به موضع ذخیره‌شده.
     افکت ورود-به-پیوستهٔ هوک فقط روی «تغییر» display کار می‌کند؛ اینجا بار اول */
  const scrolledOnceRef = useRef(false);
  useEffect(() => {
    if (mode !== "scroll" || scrolledOnceRef.current) return;
    const target = rd.contCurrentUid ?? rd.savedPosUid ?? rd.fallbackPageUid;
    if (!target) return;
    if (!rd.payloadByUid[target]) return;
    const sec = document.getElementById(`pgsec-${target}`);
    if (!sec) return;
    scrolledOnceRef.current = true;
    sec.scrollIntoView({ behavior: "auto", block: "start" });
  }, [mode, rd.contCurrentUid, rd.savedPosUid, rd.fallbackPageUid, rd.payloadByUid]);

  useEffect(() => {
    const target = rd.restoreTarget;
    if (!target || target.page_uid !== currentPageUid) return;
    const payload = rd.payloadByUid[target.page_uid] ?? rd.activePayload;
    const measured = measures[target.page_uid];
    if (mode === "pages" && (!payload || !measured)) return;
    const blockIndex = payload?.blocks.findIndex((b) => b.id === target.block_id) ?? -1;
    const desiredSub = measured && blockIndex >= 0 ? measured.ranges.findIndex(([a, b]) => blockIndex >= a && blockIndex <= b) : 0;
    if (mode === "pages" && desiredSub >= 0 && desiredSub !== sub) { const timer = setTimeout(() => setSub(desiredSub), 0); return () => clearTimeout(timer); }
    const timer = setTimeout(() => { if (restoreReaderLocation(target)) rd.completeRestore(); }, 160);
    return () => clearTimeout(timer);
  }, [rd.restoreTarget, rd.activePayload, rd.payloadByUid, rd.completeRestore, currentPageUid, measures, mode, sub]);

  /* ---------- حفظ موقعیت هنگام سوییچ حالت نمایش (پروتوتایپ: setMode) ---------- */
  /* eslint-disable react-hooks/set-state-in-effect -- تخمین زیرصفحه از موقعیت اسکرول در لحظهٔ سوییچ */
  const modeSwitchRef = useRef(mode);
  useEffect(() => {
    if (modeSwitchRef.current === mode) return;
    const from = modeSwitchRef.current;
    modeSwitchRef.current = mode;
    if (from === "pages" && mode === "scroll") {
      const t = window.setTimeout(() => {
        const sec = document.getElementById(`pgsec-${currentPageUid}`);
        if (!sec) return;
        sec.scrollIntoView({ behavior: "auto", block: "start" });
        const m = measures[currentPageUid];
        if (m && sub > 0) {
          const sv = document.getElementById("rm-scroll");
          sv?.scrollBy({ top: (sub / Math.max(1, m.subs)) * sec.offsetHeight });
        }
      }, 420);
      return () => window.clearTimeout(t);
    }
    if (from === "scroll" && mode === "pages") {
      const uid = rd.contCurrentUid ?? currentPageUid;
      const sv = document.getElementById("rm-scroll");
      const sec = sv?.querySelector<HTMLElement>(`[data-page-uid="${uid}"]`);
      if (sec && sv) {
        const frac = Math.min(1, Math.max(0, (sv.scrollTop + 60 - sec.offsetTop) / Math.max(1, sec.offsetHeight)));
        const m = measures[uid];
        const est = m ? Math.min(m.subs - 1, Math.floor(frac * m.subs)) : 0;
        if (uid !== currentPageUid) {
          pendingSubRef.current = est;
          rd.goToPage(uid);
        } else {
          setSub(est);
        }
      }
    }
  }, [mode, currentPageUid, sub, measures, rd.contCurrentUid, rd.goToPage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ---------- ذخیرهٔ موضع با زیرصفحه ---------- */
  const bumpRef = useRef(rd.bumpPosition);
  useEffect(() => {
    bumpRef.current = rd.bumpPosition;
  });
  useEffect(() => {
    positionExtraRef.current = { sub };
  }, [positionExtraRef, sub]);
  useEffect(
    () => () => {
      positionExtraRef.current = undefined;
    },
    [positionExtraRef],
  );
  useEffect(() => {
    if (!currentPageUid) return;
    bumpRef.current();
  }, [sub, currentPageUid]);

  /* ---------- Theme: the SITE theme (next-themes + palette); reveal via View Transition ---------- */
  const rootElRef = useRef<HTMLDivElement | null>(null);
  const rippleRef = useRef<{ cancel: () => void } | null>(null);
  const applyTheme = useCallback(
    (target: ReaderThemeTarget, origin?: { x: number; y: number }) => {
      if (target.mode === theme.mode && (target.palette ?? theme.palette) === theme.palette) return;
      if (rd.isPdfDoc || !rootElRef.current || !origin) {
        theme.apply(target);
        return;
      }
      const cancel = playThemeRipple({ root: rootElRef.current, origin, onCommit: () => theme.apply(target) });
      rippleRef.current = { cancel };
    },
    [theme, rd.isPdfDoc],
  );
  const toggleTheme = useCallback(
    (origin: { x: number; y: number }) => applyTheme({ mode: theme.mode === "dark" ? "light" : "dark" }, origin),
    [theme.mode, applyTheme],
  );
  /* One-time: map the removed per-reader theme onto a site palette, then persist the cleaned prefs. */
  const legacyDoneRef = useRef(false);
  useEffect(() => {
    if (legacyDoneRef.current || !prefsLoaded || legacyReadingTheme === undefined) return;
    legacyDoneRef.current = true;
    const t = legacyReadingThemeTarget(legacyReadingTheme);
    if (t && !hasChosenSiteTheme()) theme.apply(t);
    update({});
  }, [prefsLoaded, legacyReadingTheme, theme, update]);
  useEffect(
    () => () => {
      rippleRef.current?.cancel();
      rippleRef.current = null;
    },
    [],
  );

  /* ---------- پیش‌نمایش زندهٔ تایپوگرافی در شیت (prototype: applyCssVars + layoutSoon) ---------- */
  const previewVars = useCallback((p: { font_size?: number; line_height?: number; para?: number; margin?: number }) => {
    const el = rootElRef.current;
    if (!el) return;
    if (p.font_size != null) el.style.setProperty("--fs", `${p.font_size}px`);
    if (p.line_height != null) el.style.setProperty("--lh", String(p.line_height));
    if (p.para != null) el.style.setProperty("--para", String(p.para));
    if (p.margin != null) el.style.setProperty("--hm", `${p.margin}px`);
  }, []);
  const openSettings = useCallback(() => {
    clearSel();
    setColorPick(false);
    setPreviewing(false);
    setSettingsOpen(true);
  }, [clearSel]);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    /* برگرداندن متغیرهای زنده به مقادیر ذخیره‌شده (اگر درگی با commit تمام نشد) */
    const el = rootElRef.current;
    if (!el) return;
    el.style.setProperty("--fs", `${prefs.font_size}px`);
    el.style.setProperty("--lh", String(prefs.line_height));
    el.style.setProperty("--para", String(prefs.para));
    el.style.setProperty("--hm", `${prefs.margin}px`);
  }, [prefs.font_size, prefs.line_height, prefs.para, prefs.margin]);

  /* ---------- عملیات انتخاب متن ---------- */
  const copyText = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }, []);

  const highlightPendingRef = useRef(false);
  const highlightSelection = useCallback(
    async (s: ReaderSelection, color: HighlightColor, editNote = false) => {
      if (highlightPendingRef.current) return;
      const segments = selectionSegments(s);
      if (!segments.some((seg) => rd.blockPage[seg.blockId])) {
        showToast("جای این بلوک پیدا نشد");
        return;
      }
      highlightPendingRef.current = true;
      /* انتخاب چندپاراگرافی یک گروه است — حذف/ویرایش هر قطعه کل گروه را می‌گیرد. */
      const groupUid = segments.length > 1 ? crypto.randomUUID() : null;
      const inputs: Omit<HighlightT, "uid">[] = [];
      for (const segment of segments) {
        const pageUid = rd.blockPage[segment.blockId];
        if (!pageUid) continue;
        inputs.push({
          document_uid: documentUid,
          page_uid: pageUid,
          block_id: segment.blockId,
          start: segment.start,
          end: segment.end,
          text: (inputs.length === 0 ? s.text : segment.text).slice(0, 4000),
          color,
          note: null,
          group_uid: groupUid,
        });
      }
      if (!inputs.length) return;
      try {
        /* همهٔ قطعه‌ها با هم ثبت می‌شوند تا هایلایت یک‌باره ظاهر شود. */
        const saved = await annotations.createMany(inputs);
        const anchor = saved.reduce(
          (best, h) => ((h.text ?? "").length > (best.text ?? "").length ? h : best),
          saved[0],
        );
        if (editNote && anchor) onOpenHighlight(anchor.uid);
        clearSel();
        setColorPick(false);
        showToast("هایلایت ثبت شد");
      } catch (err) {
        showToast(`ثبت هایلایت ناموفق بود: ${errorMessage(err, "دوباره تلاش کنید.")}`);
      } finally {
        highlightPendingRef.current = false;
      }
    },
    [rd.blockPage, documentUid, annotations, onOpenHighlight, showToast, clearSel],
  );

  const onBubbleAction = useCallback(
    (act: BubbleAction) => {
      const s = activeSel;
      if (!s) return;
      if (act === "highlight") {
        setColorPick(true);
        return;
      }
      if (act === "copy") {
        /* متن کامل انتخاب بومی — «انتخاب همه» ممکن است چند بلوک باشد */
        const full = window.getSelection()?.toString() || s.text;
        void copyText(full).then((ok) => showToast(ok ? "کپی شد" : "کپی ممکن نشد"));
      } else if (act === "bm") {
        if (rd.isBookmarked) showToast("این صفحه از قبل نشانک دارد");
        else
          void rd
            .toggleBookmark()
            .then(() => showToast("نشانک صفحه ثبت شد"))
            .catch(() => showToast("ثبت نشانک ناموفق بود"));
      } else if (act === "note") {
        void highlightSelection(s, "yellow", true);
        return;
      }
      clearSel();
      setColorPick(false);
    },
    [activeSel, highlightSelection, copyText, showToast, rd.isBookmarked, rd.toggleBookmark, clearSel],
  );

  /* ---------- روشنایی: فیلتر بدون رندر مجدد هنگام درگ ---------- */
  /* ---------- قفل مطالعه ---------- */
  const lockReader = useCallback(() => {
    clearSel();
    setColorPick(false);
    setPreviewing(false);
    setLocked(true);
  }, [clearSel]);
  const unlockReader = useCallback(() => setLocked(false), []);

  /* ---------- پیش‌نمایش بصری ناحیهٔ لمسی باز کردن پنل‌ها ---------- */
  const [tapPreview, setTapPreview] = useState<{ mode: "center" | "bottom"; area: number } | null>(null);
  const tapPreviewTimerRef = useRef<number | null>(null);
  const previewTapZone = useCallback((tapMode: "center" | "bottom", tapArea: number, hold = false) => {
    setTapPreview({ mode: tapMode, area: tapArea });
    if (tapPreviewTimerRef.current) window.clearTimeout(tapPreviewTimerRef.current);
    if (!hold) tapPreviewTimerRef.current = window.setTimeout(() => {
      setTapPreview(null);
    }, 1300);
  }, []);
  useEffect(
    () => () => {
      if (tapPreviewTimerRef.current) window.clearTimeout(tapPreviewTimerRef.current);
    },
    [],
  );

  /* ---------- ژست‌ها ---------- */
  useGestures({
    stageEl,
    W: () => stageEl?.clientWidth || stage?.w || 412,
    H: () => stageEl?.clientHeight || stage?.h || 860,
    prog,
    mode,
    tapArea: prefs.tap_area,
    tapMode: prefs.tap_mode,
    canPrev: () => sub > 0 || !!rd.prevRef,
    canNext: () => sub < (measures[currentPageUid]?.subs ?? 1) - 1 || !!rd.nextRef,
    onTurn: turn,
    onDrag: setDragDx,
    onTapCenter: () => {
      if (!locked) {
        setBarsOn((v) => {
          const next = !v;
          if (!next) {
            setPreviewing(false);
          }
          return next;
        });
      }
    },
    onTapOther: () => {
      if (!locked && barsOn) {
        setBarsOn(false);
        setPreviewing(false);
      }
    },
    onBeforeTap: () => {
      /* انتخاب بومی ماوس هنوز در state نرسیده؛ نباید ضربه آن را نوار-toggle کند. */
      const native = window.getSelection();
      if (native && !native.isCollapsed && native.anchorNode && stageEl?.contains(native.anchorNode)) {
        return true;
      }
      if (activeSel) {
        clearSel();
        setColorPick(false);
        return true;
      }
      return false;
    },
    onLongPress: (x, y) => {
      if (rd.isPdfDoc) return;
      setColorPick(false);
      selectWordAt(x, y);
    },
    onDoubleTap: (x, y) => {
      if (rd.isPdfDoc) return;
      setColorPick(false);
      selectWordAt(x, y);
    },
    enabled:
      !rd.pagesUnavailable &&
      !searchOpen &&
      !settingsOpen &&
      !tocOpen &&
      !footnote &&
      !dialog &&
      !locked &&
      !ficheOpen &&
      !pdfOpen &&
      !notesOpen &&
      !openedHighlightUid &&
      !hadithLookupUid,
  });

  /* فهرست مسطح سرفصل‌ها برای شناسایی سریع نام فصل متناظر با صفحه/کسر اسکرول */
  const flatSections = useMemo(() => {
    const list: Array<{ title: string; page_uid?: string | null }> = [];
    const walk = (secs: TocSection[]) => {
      for (const s of secs) {
        list.push({ title: s.title, page_uid: s.page_uid });
        if (s.children && s.children.length) walk(s.children);
      }
    };
    walk(rd.tocQuery.data?.sections ?? []);
    return list;
  }, [rd.tocQuery.data]);

  const pageIdxByUid = useMemo(() => {
    const map: Record<string, number> = {};
    rd.pageRefs.forEach((r, i) => {
      map[r.page_uid] = i;
    });
    return map;
  }, [rd.pageRefs]);

  /* اطلاعات اسکرولر: نام فصل + شمارهٔ صفحه و کل + درصد پیشرفت */
  const scrubberInfoAt = useCallback(
    (f: number) => {
      const refs = rd.pageRefs;
      const total = refs.length;
      if (!total) {
        return {
          title: rd.work?.title ?? "",
          pageLabel: "۱",
          total: 1,
          pct: Math.round(f * 100),
        };
      }
      const idx = Math.min(total - 1, Math.max(0, Math.floor(f * total)));
      const ref = refs[idx];
      const pageLabel = ref.label || String(idx + 1);

      // یافتن عنوان آخرین فصلی که در فهرست مطالب پیش از این صفحه یا روی این صفحه آمده
      let chapterTitle = "";
      if (flatSections.length > 0) {
        for (const s of flatSections) {
          if (s.page_uid && pageIdxByUid[s.page_uid] !== undefined) {
            if (pageIdxByUid[s.page_uid] <= idx) {
              chapterTitle = s.title;
            } else {
              break;
            }
          }
        }
      }

      // در صورت نبود در فهرست، استفاده از اولین سرفصل/عنوان صفحهٔ جاری
      if (!chapterTitle) {
        const p = rd.payloadByUid[ref.page_uid];
        const heading = p?.blocks?.find((b) => b.type === "heading");
        if (heading?.text) {
          chapterTitle = heading.text.trim();
        }
      }

      return {
        title: chapterTitle || rd.work?.title || "کتاب‌خوان",
        pageLabel,
        total,
        pct: Math.round(f * 100),
      };
    },
    [rd.pageRefs, flatSections, pageIdxByUid, rd.payloadByUid, rd.work?.title],
  );

  /* ---------- متغیرهای تایپوگرافی پروتوتایپ — روی روت اسکوپ می‌شوند (نه <html>) ---------- */
  const rootStyle = {
    "--fs": `${prefs.font_size}px`,
    "--lh": prefs.line_height,
    "--para": prefs.para,
    "--hm": `${prefs.margin}px`,
    "--font": fontStack,
    "--talign": ALIGN_MAP[prefs.align] ?? "start",
    "--cdir": effectiveDir,
    "--prog": prog,
    "--rm-w": `${stage?.w ?? 412}px`,
    "--rm-h": `${stage?.h ?? 860}px`,
    /* PageRenderer فونت بلاک‌ها را از همین توکن‌های سراسری می‌خواند — در روت موبایل بازنویسی */
    "--font-arabic": fontStack,
    "--font-ui": fontStack,
    "--font-quran": quranStackFor(desktopPrefs.font_quran),
  } as CSSProperties;

  const work = rd.work;
  const docLabel = work?.documents.find((d) => d.uid === documentUid)?.label ?? "";

  /* ---------- حالت‌های بارگذاری/خطا ---------- */
  const pagesLoading = rd.workQuery.isPending || (!rd.isPdfDoc && mode === "pages" && rd.pagesQuery.isPending);
  if (pagesLoading) {
    return (
      <div
        className="rm-root"
        style={rootStyle}
        aria-busy="true"
      >
        <div className="rm-loading">
          <Loader2 className="size-5 animate-spin" style={{ color: "var(--sec)" }} aria-hidden="true" />
          <p>در حال بازکردن کتاب…</p>
        </div>
      </div>
    );
  }

  if (rd.workQuery.isError || !work) {
    return (
      <div
        className="rm-root"
        style={rootStyle}
      >
        <div className="rm-loading">
          <p>بازکردن این سند ممکن نشد{rd.errMsg ? ": " + rd.errMsg : ""}</p>
          <Button variant="outline" size="sm" onClick={() => void rd.workQuery.refetch()}>
            تلاش دوباره
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- واحدهای ردیاب: پنجرهٔ ±۲ زیرصفحهٔ فعلی + همسایهٔ مرز در جهت حرکت ---------- */
  const W = stage?.w ?? 0;
  const sign = prog === "ltr" ? -1 : 1;
  const prevUnits: Array<{ key: string; page: PagePayload }> = [];
  const mainUnits: Array<{ key: string; page: PagePayload }> = [];
  const nextUnits: Array<{ key: string; page: PagePayload }> = [];

  if (payload) {
    const m = measures[payload.page_uid];
    const count = m?.subs ?? 1;
    const full: [number, number] = [0, payload.blocks.length - 1];
    const rangeFor = (s: number): [number, number] => (m ? (m.ranges[Math.min(s, m.ranges.length - 1)] ?? full) : full);
    for (let k = sub - 2; k <= sub + 2; k += 1) {
      if (k < 0 || k > count - 1) continue;
      mainUnits.push({
        key: `${payload.page_uid}:${k}`,
        page: slicePayload(payload, rangeFor(k)),
      });
    }
    if (sub >= count - 1 && rd.nextRef) {
      const np = rd.payloadByUid[rd.nextRef.page_uid];
      if (np) nextUnits.push({ key: `${np.page_uid}:first`, page: np });
    }
    if (sub <= 0 && rd.prevRef) {
      const pp = rd.payloadByUid[rd.prevRef.page_uid];
      if (pp) prevUnits.push({ key: `${pp.page_uid}:last`, page: pp });
    }
  }
  const unitDefs = [...prevUnits, ...mainUnits, ...nextUnits];
  /* ردیاب فقط پنجرهٔ ±۲ را رندر می‌کند؛ جابه‌جایی باید نسبت به نخستین
     واحدِ رندرشده باشد، نه شاخص مطلق زیرصفحه (وگرنه زیرصفحه‌های دور از لبه بیرون کادر می‌افتند) */
  const curUnitIndex = prevUnits.length + (sub - Math.max(0, sub - 2));

  /* پیش‌روی پروتوتایپ: «صفحه X از N» — X شاخص صفحهٔ سروری (پایدار، مستقل از زیرصفحه) */
  const curPageNo = Math.max(0, rd.pageIdx);
  const pillText = previewing
    ? `صفحه ${faNum(Math.min(previewIdx + 1, totalPages || 1))} از ${faNum(totalPages)}`
    : `صفحه ${faNum(curPageNo + 1)}${sub > 0 ? `-${faNum(sub + 1)}` : ""} از ${faNum(totalPages)}`;
  const progressFrac =
    mode === "scroll"
      ? 0 // Continuous progress is owned by MobileBottomBar.
      : totalPages > 1
        ? curPageNo / (totalPages - 1)
        : 0;

  const hitLabel = searchResults.length
    ? curHit >= 0
      ? `نتایج ${faNum(curHit + 1)} از ${faNum(searchResults.length)}`
      : `${faNum(searchResults.length)} نتیجه`
    : "";
  const hasMultipleDocs = (work.documents?.length ?? 0) > 1;

  const unitRenderer = (u: { key: string; page: PagePayload }) => (
    <div key={u.key} className="rm-page rm-book" dir={effectiveDir}>
      <StablePageRenderer
        page={u.page}
        prefs={rendererPrefs}
        sectionUidByBlockId={rd.sectionUidByBlockId}
        sectionLevelByBlockId={rd.sectionLevelByBlockId}
        flashBlockId={rd.flashBlockId}
        highlight={rd.highlightByPage[u.page.page_uid] ?? null}
        userHighlights={rd.displayHlsByPage[u.page.page_uid]}
        searchHits={searchHitsByPage[u.page.page_uid]}
        currentSearchHitOrd={curHit}
        collapsedSanads={collapsedSanads}
        onToggleSanad={toggleSanad}
        onFootnoteClick={openFootnoteFrom}
        onLinkClick={openLink}
        onVerseClick={openVerse}
        onHadithClick={openHadith}
        onSelection={ignoreSelection}
          onHighlightOpen={openHighlight}
        hideSelectionToolbar
        frameless
      />
    </div>
  );

  return (
    <div
      ref={rootElRef}
      className={`rm-root${barsOn ? " bars-on" : " bars-off"}${prefs.show_pill ? "" : " no-pill"}${locked ? " locked" : ""}${searchActive ? " searching" : ""}${previewing ? " previewing" : ""}`}
      data-mode={mode}
      style={rootStyle}
    >
      {rd.sharedUid && <div className="rm-shared-status"><SharedReaderStatus rd={rd} /></div>}
      {/* صحنه — ردیاب ورق‌زدن با translateX / جریان پیوسته در اسکرول */}
      <main className="rm-stage" aria-label="متن کتاب" ref={stageRefCb}>
        {rd.isPdfDoc ? (
          <div className="rm-pdf-wrap">
            <PdfReaderDynamic documentUid={documentUid} page={rd.pdfPageNum} onPageCount={rd.setPdfPageCount} />
          </div>
        ) : mode === "scroll" ? (
          <>
            <div className="rm-scroll-view" id="rm-scroll" ref={scrollRef as RefObject<HTMLDivElement | null>}>
              {rd.pageRefs.map((ref, refIdx) => {
                const p = rd.payloadByUid[ref.page_uid];
                const q = rd.pagesQueries[refIdx];
                return (
                  <section
                    key={ref.page_uid}
                    id={`pgsec-${ref.page_uid}`}
                    data-page-uid={ref.page_uid}
                    className="rm-sec rm-book"
                    dir={effectiveDir}
                  >
                    {p ? (
                      <StablePageRenderer
                        page={p}
                        prefs={rendererPrefs}
                        sectionUidByBlockId={rd.sectionUidByBlockId}
                        sectionLevelByBlockId={rd.sectionLevelByBlockId}
                        flashBlockId={rd.flashBlockId}
                        highlight={rd.highlightByPage[p.page_uid] ?? null}
                        userHighlights={rd.displayHlsByPage[p.page_uid]}
                        searchHits={searchHitsByPage[p.page_uid]}
                        currentSearchHitOrd={curHit}
                        collapsedSanads={collapsedSanads}
                        onToggleSanad={toggleSanad}
                        onFootnoteClick={openFootnoteFrom}
                        onLinkClick={openLink}
                        onVerseClick={openVerse}
                        onHadithClick={openHadith}
                        onSelection={ignoreSelection}
          onHighlightOpen={openHighlight}
                        hideSelectionToolbar
                        frameless
                      />
                    ) : q?.isError ? (
                      <div className="rm-sec-msg">
                        بازکردن صفحهٔ {faNum(ref.label)} ممکن نشد.
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => void q.refetch()}>
                          تلاش دوباره
                        </Button>
                      </div>
                    ) : q?.isFetching ? (
                      <div aria-busy="true">
                        <Skeleton className="h-5 w-1/2" />
                        <Skeleton className="mt-3 h-28 w-full" />
                        <span className="sr-only">در حال بارگیری صفحهٔ {faNum(ref.label)}…</span>
                      </div>
                    ) : (
                      <div className="rm-sec-placeholder" aria-hidden="true" />
                    )}
                  </section>
                );
              })}
            </div>
            <ScrollScrubber active={mode === "scroll"} infoAt={scrubberInfoAt} />
          </>
        ) : rd.pagesUnavailable ? (
          <div className="rm-loading">
            <p>فهرست صفحه‌های این سند در دسترس نیست.</p>
          </div>
        ) : (
          <>
            <div className="rm-pages-view">
              <div
                id="rm-track"
                className={"rm-pages-track" + (dragDx !== null ? " dragging" : "")}
                style={{ transform: `translateX(${sign * curUnitIndex * W + (dragDx ?? 0)}px)` }}
              >
                {unitDefs.map(unitRenderer)}
              </div>
            </div>
            {!payload ? (
              <div className="rm-loading" aria-busy="true">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-28 w-full" />
                <span className="sr-only">در حال بازکردن صفحه…</span>
              </div>
            ) : null}
          </>
        )}

        {/* pill — پشت نوار پایین پنهان می‌شود؛ با بستن نوارها نمایان می‌آید (پروتوتایپ) */}
        <div
          id="rm-pill"
          className={pillVisible ? "visible" : ""}
          role="button"
          tabIndex={0}
          title="مشاهده پیش‌نمایش صفحات"
          onClick={() => {
            setBarsOn(true);
            setPreviewing(false);
            setPreviewIdx(Math.max(0, rd.pageIdx));
          }}
        >
          {pillText}
        </div>
      </main>

      {/* لایه ۲: روبان نشانک + لایه ۳: تاریک‌کنندهٔ روشنایی */}
      <BookmarkRibbon on={rd.isBookmarked} />

      {/* کپسول ناوبری نتایج جست‌وجو — proto:492-497 */}
      <div id="rm-searchNav">
        <button className="ib" aria-label="نتیجهٔ قبلی" onClick={() => stepHit(-1)}>
          <Mi name="keyboard_arrow_up" />
        </button>
        <span className="cnt">{hitLabel}</span>
        <button className="ib" aria-label="نتیجهٔ بعدی" onClick={() => stepHit(1)}>
          <Mi name="keyboard_arrow_down" />
        </button>
        <button className="ib" aria-label="خروج از جست‌وجو" onClick={exitSearch}>
          <Mi name="search_off" />
        </button>
      </div>

      {/* انتخاب متن: حباب شش‌گانه + دستگیره‌های کشیدنی */}
      <SelectionBubble
        ui={selUi}
        selVisible={!!activeSel}
        colorPick={colorPick}
        onAction={onBubbleAction}
        onPickColor={(color) => {
          if (!activeSel) return;
          void highlightSelection(activeSel, color);
        }}
        onBack={() => setColorPick(false)}
        onHandleDown={handleDown}
      />

      {/* نوار ابزار بالایی — لایهٔ شناور */}
      <MobileToolbar
        workTitle={work.title}
        docLabel={docLabel}
        dark={dark}
        hitBadge={searchActive && curHit >= 0 ? hitLabel : null}
        isPdf={rd.isPdfDoc}
        onBack={() => navigate(workHref(work.uid), undefined, { slug: work.title })}
        onToc={() => {
          clearSel();
          setColorPick(false);
          setPreviewing(false);
          setTocOpen(true);
        }}
        onSearch={() => {
          clearSel();
          setColorPick(false);
          setSearchOpen(true);
        }}
        onToggleTheme={toggleTheme}
        isBookmarked={rd.isBookmarked}
        bookmarkPending={rd.bookmarkPending}
        marksCount={rd.markedPagesCount}
        onToggleBookmark={() =>
          void rd.toggleBookmark().catch((err) =>
            showToast(errorMessage(err, "به‌روزرسانی نشانک ناموفق بود")),
          )
        }
        onNotes={() => {
          clearSel();
          setColorPick(false);
          setNotesOpen(true);
        }}
        onExportPdf={() => {
          clearSel();
          setColorPick(false);
          setPdfOpen(true);
        }}
        onCopyAddress={() => {
          const address = readerAddressText(work.title, docLabel, rd.activePayload?.label, window.location.href);
          void copyText(address).then((ok) => showToast(ok ? "نشانی صفحه کپی شد" : "کپی ممکن نشد"));
        }}
        onLock={lockReader}
        onSettings={openSettings}
        onExitMobile={onExitMobile}
      />

      {/* نوار پایین — اسلایدر پیش‌روی + کاروسل پیش‌نمایش (پروتوتایپ) */}
      <MobileBottomBar
        previewing={previewing}
        previewIdx={previewIdx}
        pageIdx={curPageNo}
        total={totalPages}
        progress={progressFrac}
        scrollMode={mode === "scroll" && !rd.isPdfDoc}
        scrollHostRef={scrollRef}
        active={barsOn}
        canUndo={histLen.back > 0}
        onUndo={navBack}
        canForward={histLen.fwd > 0}
        onForward={navFwd}
        onPctClick={openPercentDialog}
        onPageClick={openPageDialog}
        onTogglePreview={togglePreview}
        onProgressInput={previewInput}
        onProgressCommit={previewInput}
        onHidePreview={hidePreview}
        onPreviewIdx={setPreviewIdx}
        onJumpIndex={jumpToPageIndex}
        cardFor={cardFor}
        pdfDocumentUid={rd.isPdfDoc ? documentUid : null}
        para={prefs.para}
      />

      {openedHighlightUid && <HighlightSheet key={openedHighlightUid}
        highlightUid={openedHighlightUid} documentUid={documentUid}
        onClose={() => onOpenHighlight(null)} />}

      {/* قفل مطالعه — حلقهٔ نگه‌داشتن ۲ ثانیه‌ای */}
      <StudyLockOverlay
        locked={locked}
        onUnlock={unlockReader}
        onDblClick={() =>
          setDialog({
            kind: "confirm",
            title: "قفل مطالعه",
            text: "برای باز کردن قفل نگه دارید",
            onOk: unlockReader,
          })
        }
      />

      {/* پیش‌نمایش بصری ناحیهٔ لمسی هنگام تنظیم در تب مطالعه */}
      {(() => {
        const stageW = stageEl?.clientWidth || stage?.w || 412;
        const stageH = stageEl?.clientHeight || stage?.h || 860;
        const m = tapPreview?.mode ?? prefs.tap_mode;
        const a = tapPreview?.area ?? prefs.tap_area;
        const rc = computeTapRect(stageW, stageH, m, a);
        return (
          <div
            id="rm-tapZonePreview"
            className={tapPreview ? "show" : ""}
            style={{
              left: `${rc.l}px`,
              top: `${rc.t}px`,
              width: `${rc.w}px`,
              height: `${rc.h}px`,
            }}
            aria-hidden="true"
          >
            <span>
              ناحیهٔ لمسی پنل‌ها ({m === "center" ? "مرکز" : "پایین"} — {faNum(Math.round(a * 100))}٪)
            </span>
          </div>
        );
      })()}

      {/* بریر + شیت تنظیمات + پنل‌ها + شیت پانویس + دیالوگ + پیام کوتاه */}
      <div
        id="rm-barrier"
        className={settingsOpen || searchOpen || tocOpen || !!footnote || !!dialog ? "on" : ""}
        aria-hidden={!(settingsOpen || searchOpen || tocOpen || !!footnote || !!dialog)}
        onClick={() => {
          if (searchOpen) setSearchOpen(false);
          if (settingsOpen) closeSettings();
          setTocOpen(false);
          setFootnote(null);
          setDialog(null);
        }}
      />
      <MobileSettingsSheet
        open={settingsOpen}
        onClose={closeSettings}
        prefs={prefs}
        update={update}
        themeMode={theme.mode}
        palette={theme.palette}
        onSelectTheme={applyTheme}
        isPdf={rd.isPdfDoc}
        bookDir={bookDir}
        setBookDirection={setBookDirection}
        clearBookDir={clearBookDir}
        onPreviewVars={previewVars}
        onPreviewTapZone={previewTapZone}
        onToast={showToast}
      />
      <MobileSearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        query={rd.inBookSearchQuery}
        onSearch={runServerSearch}
        results={searchResults}
        isLoading={searchLoading}
        error={searchError}
        onRetry={() => void rd.inBookSearch.refetch()}
        tolerant={rd.ignoreSpacing}
        onToggleTolerant={() => rd.setIgnoreSpacing(!rd.ignoreSpacing)}
        scope={rd.inBookSearchScope}
        onScopeChange={rd.setInBookSearchScope}
        activeOrd={curHit}
        onSelect={goToHit}
        hasMultipleDocs={hasMultipleDocs}
        currentDocUid={documentUid}
        pagePercent={pagePercent}
      />
      <MobileTocPanel
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        sections={rd.tocQuery.data?.sections ?? []}
        loading={rd.tocQuery.isLoading && rd.tocQuery.fetchStatus === "fetching"}
        error={rd.tocQuery.isError}
        activeSectionUid={rd.activeSectionUid}
        onGoSection={jumpToSection}
      />
      <MobileFootnoteSheet
        data={footnote}
        onClose={() => setFootnote(null)}
        documentUid={documentUid}
        onHadithLookup={(localUid) => {
          setFootnote(null);
          setHadithLookupUid(localUid);
        }}
        onHadithFiche={onHadithFiche}
        onHadithNote={(localUid, revayatIndex) => {
          setHadithNoteScope({ localUid, revayatIndex });
          setFootnote(null);
          setNotesOpen(true);
        }}
      />
      <MobileDialog state={dialog} onClose={() => setDialog(null)} />
      <div id="rm-toast" className={toastMsg ? "show" : ""} role="status">
        {toastMsg ?? ""}
      </div>

      {/* فیش از متن انتخاب‌شده — همان دیالوگ دسکتاپ */}
      <FicheDialog
        open={ficheOpen}
        onOpenChange={(o) => {
          setFicheOpen(o);
          if (!o) setFicheSel(null);
        }}
        selection={ficheSel}
        documentUid={documentUid}
        documentLabel={docLabel}
        page={rd.activePayload}
        sectionUid={rd.activeSectionUid}
        work={work ? { uid: work.uid, title: work.title } : null}
      />

      {/* خروجی PDF از کتاب — همان دیالوگ دسکتاپ */}
      <PdfExportDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        documentUid={documentUid}
        documentLabel={docLabel}
        workTitle={work.title}
        pages={rd.pageRefs}
        currentPageUid={currentPageUid}
      />

      {/* پرس‌وجوی میان‌کتابی روایت — همان دیالوگ دسکتاپ */}
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

      {/* یادداشت صفحه — همان پنل دسکتاپ */}
      <Sheet open={notesOpen} onOpenChange={setNotesOpen}>
        <SheetContent side="bottom" className="flex h-[75vh] flex-col overflow-hidden">
          <SheetHeader className="border-b border-border pb-2">
            <SheetTitle className="flex items-center gap-1.5 text-sm">
              <StickyNote className="size-4 text-primary" aria-hidden="true" />
              {rd.isPdfDoc ? "نشانک‌ها" : "نشانک‌ها و یادداشت‌ها"}
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <NotesPanel
              onHighlightOpen={openHighlight}
              documentUid={documentUid}
              currentPageUid={currentPageUid}
              pageLabel={rd.activePayload?.label ?? null}
              hadithScope={hadithNoteScope}
              onClearHadithScope={() => setHadithNoteScope(null)}
              onJumpToPage={(pg) => {
                setNotesOpen(false);
                rd.goToPage(pg);
              }}
              workTitle={work.title}
              anchorStatus={rd.anchorStatus}
              marksOnly={rd.isPdfDoc}
              pageMarks={rd.pageMarks}
              documentNotes={rd.documentNotes}
              marksPending={
                rd.bookmarksQuery.isPending ||
                rd.notesCountQuery.isPending ||
                rd.annotationsQuery.isPending
              }
              onRequestDeletePageMark={rd.requestDeletePageMark}
              onJumpMark={(mark) => {
                setNotesOpen(false);
                return rd.jumpToMark(mark);
              }}
              onNoteCreated={() => setNotesOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <DeleteMarkDialog
        mark={rd.pendingMarkDelete}
        pending={rd.markDeletePending}
        onConfirm={() => {
          void rd.confirmMarkDelete().catch((err) =>
            showToast(errorMessage(err, "حذف نشانک صفحه ناموفق بود")),
          );
        }}
        onCancel={rd.cancelMarkDelete}
      />
    </div>
  );
}
