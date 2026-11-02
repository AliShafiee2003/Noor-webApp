"use client";

/**
 * میز مطالعه (کتاب‌خوان) — PRD §۱۱ (READ-01..17) + §۷-الف
 * دو حالت نمایش (بدون حدس از ترجیحات):
 * - صفحه‌محور (paged): یک صفحه در هر نما با ناوبری قبلی/بعدی.
 * - پیوسته (continuous): همهٔ صفحه‌های جلد پشت‌سرهم با اسکرول یک‌دست؛
 *   پرش فهرست/نشانک/شمارهٔ صفحه به موضع واقعی اسکرول می‌کند، موضع خواندن
 *   با اسکرول به‌روز می‌شود (READ-12) و نشانهٔ جست‌وجو در صفحهٔ خودش دیده می‌شود.
 * دسکتاپ ≥1440: فهرست راست / متن وسط / زمینه چپ (پنل‌های قابل تغییر اندازه)
 * 1024–1439: متن + زمینه (فهرست در Sheet)؛ <780: ریدر موبایل.
 * §۷-الف: هایلایت چندرنگ روی انتخاب، خروجی PDF، اشتراک لینک (banner «shared»).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Share2,
  SlidersHorizontal,
  StickyNote,
  TriangleAlert,
} from "lucide-react";
import type { Highlight as HighlightT, HighlightColor } from "@/lib/types";import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, errorMessage } from "@/lib/api";
import { faNum, normalizePersian } from "@/lib/format";
import { readHref, workHref } from "@/lib/href";
import { useRoute } from "@/lib/hash-router";
import { toast } from "@/hooks/use-toast";
import type {
  BlockLink,
  PageBlock,
  PagePayload,
} from "@/lib/types";
import { blockOffsets } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspace";
import { useIsCompact, useIsMobile } from "@/hooks/use-mobile";

/* نشانهٔ mount برای گیت موبایل — بدون setState در افکت */
const subscribeNoop = () => () => {};
import { cn } from "@/lib/utils";
import { PageRenderer, type ReaderSelection } from "@/components/reader/page-renderer";
import { selectionSegments } from "@/components/reader/selection-offset";
import { TocPanel } from "@/components/reader/toc-panel";
import { FootnotePanel, type FootnotePanelData } from "@/components/reader/footnote-panel";
import { FicheDialog } from "@/components/reader/fiche-dialog";
import { HadithLocationsDialog } from "@/components/search/hadith-locations-dialog";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { SettingsPopover } from "@/components/reader/settings-popover";
import { NotesPanel } from "@/components/reader/notes-panel";
import { DeleteMarkDialog } from "@/components/reader/delete-mark-dialog";
import { PageMappingNotice } from "@/components/reader/page-mapping-notice";
import { SiteHeader } from "@/components/site-header";
import { PdfExportDialog } from "@/components/reader/pdf-export-dialog";
import { BookSearchPanel } from "@/components/reader/book-search-panel";
import { normalizeOffsets } from "@/components/search/result-card";
import { readerTextWidthPx } from "@/components/reader/settings-popover";
import { SharedReaderStatus } from "@/components/reader/shared-status";
import { readerAddressText } from "@/lib/reader/address";
import { useReaderAnnotations } from "@/lib/reader/use-reader-annotations";
import { HighlightSheet } from "@/components/reader-mobile/highlight-sheet";
import { useReaderData } from "@/components/reader-mobile/use-reader-data";
import { ReaderMobileView } from "@/components/reader-mobile/reader-mobile-view";

/* نمایشگر PDF کتاب‌های اسکن‌شده — ssr:false چون pdf.js فقط در مرورگر بار می‌شود */
const PdfReader = dynamic(
  () => import("@/components/reader/pdf-reader").then((m) => m.PdfReader),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    ),
  },
);

export function ReaderView({ documentUid }: { documentUid: string }) {
  const queryClient = useQueryClient();
  const annotations = useReaderAnnotations(documentUid);
  const [openedHighlightUid, setOpenedHighlightUid] = useState<string | null>(null);
  const prefs = useWorkspaceStore((s) => s.prefs);
  const isCompact = useIsCompact();
  const isMobileViewport = useIsMobile();
  const display = prefs.display;

  /* گیت ریدر موبایل/متمرکز — زیر ۷۸۰px خودکار، روی دسکتاپ با انتخاب کاربر
     (ترجیح در localStorage می‌ماند؛ ?rm=1/0 برای تست و deep-link). سوییچ پس از mount
     انجام می‌شود تا هیدریشن سرویس‌دهنده/مرورگر یکی بماند. */
  const mobileGateMounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const rmOverride = useMemo<boolean | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const rm = new URLSearchParams(window.location.search).get("rm");
      if (rm === "1") {
        window.sessionStorage.setItem("noor:rm-test", "1");
        return true;
      }
      if (rm === "0") {
        window.sessionStorage.removeItem("noor:rm-test");
        return false;
      }
      return window.sessionStorage.getItem("noor:rm-test") === "1" ? true : null;
    } catch {
      return null;
    }
  }, []);
  /* کلید قبلیِ «مطالعهٔ متمرکز» عمداً حفظ شده تا ترجیح کاربر مهاجرت کند */
  const storedFocusPref = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("noor-study-mode") === "1";
    } catch {
      return false;
    }
  }, []);
  const [focusForced, setFocusForced] = useState<boolean | null>(null);
  const effectiveRm = focusForced !== null ? focusForced : rmOverride ?? storedFocusPref;
  const mobileGate = mobileGateMounted && (isMobileViewport || effectiveRm);

  /* ورود به «مطالعهٔ متمرکز» = نمای کتاب‌خوان تمام‌صفحه در وب */
  const enterFocusMode = useCallback(() => {
    setFocusForced(true);
    try {
      window.localStorage.setItem("noor-study-mode", "1");
      window.sessionStorage.setItem("noor:rm-test", "1");
    } catch {}
  }, []);

  /* دادهٔ مشترک دسکتاپ/موبایل — useReaderData (پس از تعریف وضعیت‌های محلی، پایین‌تر) */

  /* ---------- حالت‌های محلی ---------- */
  const [tocOpen, setTocOpen] = useState(false);
  const { collapsed: collapsedSanads, toggle: toggleSanad } = useCollapsedSanads();
  const [footnote, setFootnote] = useState<FootnotePanelData | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [ficheOpen, setFicheOpen] = useState(false);
  const [saveFlash, setSaveFlash] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  /** تب پنل کناری: پاورقی/آیه/روایت یا یادداشت‌ها یا نتایج جست‌وجو */
  const [ctxTab, setCtxTab] = useState<"context" | "notes" | "search">("context");
  /** شیت یادداشت‌ها در موبایل/تبلت */
  const [notesSheetOpen, setNotesSheetOpen] = useState(false);
  /* §۴۷: پرس‌وجوی میان‌کتابی روایت از پنل زمینه */
  const [hadithLookupUid, setHadithLookupUid] = useState<string | null>(null);
  /* RES: دامنهٔ روایت برای یادداشت روی روایت مشخص */
  const [hadithNoteScope, setHadithNoteScope] = useState<{
    localUid: string;
    revayatIndex?: string | null;
  } | null>(null);

  /* تغییر صفحهٔ مقصد → پنل/انتخاب/دامنهٔ روایت می‌بندد (پنل مالِ همان صفحه است).
     در محل رویدادهای گذار صدا زده می‌شود، نه در افکت (STAB-02). */
  const resetPageScoped = useCallback(() => {
    setFootnote(null);
    setSelection(null);
    setHadithNoteScope(null);
  }, []);

  /* بازشدن پاورقی/ارجاع → تب زمینه فعال می‌شود تا محتوا دیده شود (رویداد-محور) */
  const openFootnote = useCallback((f: FootnotePanelData | null) => {
    setFootnote(f);
    if (f) setCtxTab("context");
  }, []);

  /* فیلدهای اضافهٔ موضع از نمای موبایل (زیرصفحه) — در دسکتاپ تهی */
  const mobileExtraRef = useRef<Record<string, unknown> | undefined>(undefined);
  /* میزبان اسکرول پیوستهٔ موبایل — هوک ردیاب اسکرول همین ریف را می‌خواند */
  const mobileScrollRef = useRef<HTMLElement | null>(null);
  /* حالت نمایش موبایل از اسلایس prefs خودش — پیوستهٔ موبایل همان موتور پنجرهٔ دسکتاپ است */
  const mobileDisplay = prefs.display === "continuous" ? "continuous" : prefs.display === "paged" ? "paged" : prefs.mobile_reader?.mode === "scroll" ? "continuous" : "paged";

  /* ---------- دادهٔ مشترک (دسکتاپ و موبایل هر دو همین هوک را می‌خورند) ---------- */
  const rd = useReaderData({
    documentUid,
    display: mobileGate ? mobileDisplay : display,
    scrollHostRef: mobileScrollRef,
    isCompact,
    onNavigated: () => setFootnote(null),
    onDisplaySwitched: resetPageScoped,
    onAfterTocJump: () => setTocOpen(false),
    onSearchExecuted: () => setCtxTab("search"),
    onSearchCleared: () => {
      if (ctxTab === "search") setCtxTab("context");
    },
    getPositionExtra: () => mobileExtraRef.current,
  });
  const rememberLayout = rd.rememberLocation;
  useLayoutEffect(() => () => rememberLayout(), [rememberLayout, mobileGate, prefs.display, prefs.font_family, prefs.font_size, prefs.line_height, prefs.para_spacing, prefs.text_align, prefs.text_dir]);
  const {
    params,
    requestedPgRaw,
    sharedUid,
    hl,
    workQuery,
    docFormat,
    isPdfDoc,
    tocQuery,
    pagesQuery,
    pagesQueries,
    setPdfPageCount,
    pageRefs,
    positionQuery,
    fallbackPageUid,
    continuous,
    contCurrentUid,
    payloadByUid,
    pagesPendingCount,
    mainRef,
    currentPageUid,
    pageQuery,
    pdfPageNum,
    allPayloads,
    activePayload,
    blockPage,
    bookmarksQuery,
    isBookmarked,
    bookmarkPending,
    toggleBookmark,
    pageMarks,
    documentNotes,
    markedPagesCount,
    pendingMarkDelete,
    markDeletePending,
    confirmMarkDelete,
    cancelMarkDelete,
    requestDeletePageMark,
    jumpToMark,
    notesCountQuery,
    annotationsQuery,
    anchorStatus,
    userHlsByPage,
    sharedQuery,
    sharedHl,
    sharedHlPageUid,
    clearShared,
    sectionUidByBlockId,
    sectionLevelByBlockId,
    activeSectionUid,
    onJumpSection,
    flashBlockId,
    goToPage,
    prevRef,
    nextRef,
    gotoNeighbor,
    inBookSearch,
    inBookSearchQuery,
    inBookSearchScope,
    setInBookSearchScope,
    selectedSearchPassageUid,
    searchSheetOpen,
    setSearchSheetOpen,
    handleExecuteSearch,
    handleClearSearch,
    handleSelectSearchResult,
    highlightByPage,
    errMsg,
    pagesUnavailable,
  } = rd;
  const { navigate } = useRoute();

  /* خروج از «مطالعهٔ متمرکز» → نسخهٔ وب عادی. ترجیح را ذخیره می‌کند و rm را از
     نشانی برمی‌دارد تا رفرش دوباره وارد حالت متمرکز نشود. */
  const exitFocusMode = useCallback(() => {
    setFocusForced(false);
    try {
      window.localStorage.setItem("noor-study-mode", "0");
      window.sessionStorage.removeItem("noor:rm-test");
    } catch {
      /* بی‌اهمیت */
    }
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("rm")) {
        url.searchParams.delete("rm");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      }
    } catch {
      /* بی‌اهمیت */
    }
  }, []);

  /* Esc خروج از مطالعهٔ متمرکز روی دسکتاپ (در گوشی واقعی چیزی برای خروج نیست) */
  useEffect(() => {
    if (!mobileGate || isMobileViewport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFocusMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileGate, isMobileViewport, exitFocusMode]);

  const flash = useCallback((msg: string) => {
    setSaveFlash(msg);
    window.setTimeout(() => setSaveFlash(null), 1800);
  }, []);

  /* دور ۱۸-فیکس ۶ — «نوار خالی افقی پایین صفحه پس از بازکردن/رفرش»: مرورگر هنگام
     رفرش، موضع اسکرول همهٔ کانتینرهای اسکرول‌پذیر — حتی overflow-hidden — را
     بازیابی می‌کند؛ اگر روزی کانتینر ریشهٔ ریدر جابه‌جا شده باشد (مانداسکرول از
     scrollIntoView روی جدِ خارجی)، رفرش بعدی همان scrollTop را برمی‌گرداند و
     جمعِ نوارِ بالا (هذا ۲۳۴px) به‌صورت نوار خالی پایین ظاهر می‌شود و می‌ماند.
     کانتینر ریشه باید «هرگز» اسکرول‌ناخوان باشد؛ پس در مانت و تغییر سند صفرش می‌کنیم. */
  const readerRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = readerRootRef.current;
    if (!el) return;
    const clearStrayScroll = () => {
      // ریشهٔ ریدر + ردیف پنل‌ها: هر دو در طراحی فقط قاب برشی‌اند و اسکرول نباید داشته باشند
      if (el.scrollTop !== 0) el.scrollTop = 0;
      const rows = el.querySelectorAll<HTMLDivElement>(":scope > div.overflow-hidden");
      rows.forEach((r) => {
        if (r.scrollTop !== 0) r.scrollTop = 0;
      });
    };
    clearStrayScroll();
    // بازیابی اسکرول مرورگر ممکن است «بعد از» اثر مانت برسد؛ گارد دائمی روی رخداد اسکرول
    const onScroll = () => clearStrayScroll();
    el.addEventListener("scroll", onScroll, { passive: true, capture: true });
    const ro = new ResizeObserver(() => clearStrayScroll());
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll, { capture: true });
      ro.disconnect();
    };
  }, [documentUid, continuous]);

  /* پنهان‌سازی خودکار نوار بالای کتاب‌خوان با اسکرول به پایین (با قابلیت سنجاق‌کردن دائم) */
  const [headerVisible, setHeaderVisible] = useState(true);
  const [headerPinned, setHeaderPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = window.localStorage.getItem("noor:reader-header-pinned");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  const toggleHeaderPinned = useCallback(() => {
    setHeaderPinned((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("noor:reader-header-pinned", String(next));
      } catch {}
      if (next) setHeaderVisible(true);
      return next;
    });
  }, []);

  const siteHeaderRef = useRef<HTMLDivElement | null>(null);
  const [siteHeaderHeight, setSiteHeaderHeight] = useState(56);

  useEffect(() => {
    const el = siteHeaderRef.current;
    if (!el) return;
    const update = () => {
      const inner = el.firstElementChild as HTMLElement | null;
      const h = inner ? inner.offsetHeight : el.offsetHeight;
      if (h > 0) setSiteHeaderHeight(h);
    };
    update();
    const ro = new ResizeObserver(update);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onScroll = () => {
      if (headerPinned) {
        setHeaderVisible(true);
        return;
      }
      const top = main.scrollTop;
      const diff = top - lastScrollTopRef.current;

      if (diff > 8 && top > 30) {
        setHeaderVisible(false);
      } else if (diff < -6 || top <= 15) {
        setHeaderVisible(true);
      }

      lastScrollTopRef.current = top;
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, [headerPinned]);

  /* ---------- کپی نشانی (READ-17) ---------- */
  const copyAddress = useCallback(async () => {
    const text = readerAddressText(workQuery.data?.title ?? "", workQuery.data?.documents.find((d) => d.uid === documentUid)?.label ?? "", activePayload?.label, window.location.href);
    try {
      await navigator.clipboard.writeText(text);
      flash("نشانی کپی شد");
    } catch {
      flash("کپی ممکن نشد؛ دستی انتخاب کنید");
    }
  }, [workQuery.data, documentUid, activePayload?.label, flash]);

  /* ---------- انتخاب متن → فیش ---------- */
  const onSelection = useCallback((sel: ReaderSelection | null) => {
    setSelection(sel);
    if (sel) setFicheOpen(true);
  }, []);

  /* کلیک روی هر قطعهٔ یک هایلایت چندپاراگرافی، شیت گروه (متن کامل) را باز می‌کند. */
  const openHighlight = useCallback((uid: string | null) => {
    const resolved = uid ? (rd.highlightAnchorByUid[uid] ?? uid) : null;
    setOpenedHighlightUid(resolved);
    if (resolved) { setCtxTab("context"); setNotesSheetOpen(false); }
  }, [rd.highlightAnchorByUid]);
  const onHighlightSelection = useCallback(async (sel: ReaderSelection, color: HighlightColor, editNote = false) => {
    const segments = selectionSegments(sel);
    /* انتخاب چندپاراگرافی یک گروه است — حذف/ویرایش هر قطعه کل گروه را می‌گیرد. */
    const groupUid = segments.length > 1 ? crypto.randomUUID() : null;
    const inputs: Omit<HighlightT, "uid">[] = [];
    for (const segment of segments) {
      const pageUid = blockPage[segment.blockId];
      if (!pageUid) continue;
      inputs.push({
        document_uid: documentUid,
        page_uid: pageUid,
        block_id: segment.blockId,
        start: segment.start,
        end: segment.end,
        text: (inputs.length === 0 ? sel.text : segment.text).slice(0, 4000),
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
      if (editNote && anchor) openHighlight(anchor.uid);
      flash("هایلایت ثبت شد");
    } catch (err) { toast({ title: errorMessage(err, "ثبت هایلایت ناموفق بود"), variant: "destructive" }); }
  }, [annotations, blockPage, documentUid, openHighlight, flash]);

  const onHighlightUpdate = useCallback(async (uid: string, color: HighlightColor) => {
    try { await annotations.update(uid, { color }); }
    catch (err) { toast({ title: errorMessage(err, "تغییر رنگ ناموفق بود"), variant: "destructive" }); }
  }, [annotations]);
  const onHighlightDelete = useCallback((uid: string) => openHighlight(uid), [openHighlight]);

  /* ---------- پاورقی/ارجاع — در هر دو حالت از پود درست ---------- */
  const openFootnoteFromPayload = useCallback(
    (payload: PagePayload, refUid: string) => {
      const fn = payload.footnotes.find((f) => f.uid === refUid);
      if (fn) {
        openFootnote({ kind: "footnote", uid: fn.uid, label: fn.label, text: fn.text });
      } else {
        openFootnote({ kind: "link", originalAddress: "پاورقی " + refUid });
      }
    },
    [openFootnote],
  );

  const onFootnoteClick = useCallback(
    (refUid: string) => {
      if (!activePayload) return;
      openFootnoteFromPayload(activePayload, refUid);
    },
    [activePayload, openFootnoteFromPayload],
  );

  const onLinkClick = useCallback((link: BlockLink) => {
    // همهٔ ارجاع‌ها در این نسخه حل‌نشده‌اند — نشانی اصلی حفظ می‌شود (REL-10)
    openFootnote({ kind: "link", originalAddress: link.original_address || "ارجاع" });
  }, [openFootnote]);

  /* ---------- پنل آیه (QUR-01/02) و اطلاعات روایت (HAD-08) ---------- */
  const onVerseClick = useCallback((block: PageBlock) => {
    const cit = block.citations?.[0];
    if (!cit) return;
    openFootnote({
      kind: "verse",
      verse: {
        citation: cit,
        quotedText: block.text,
        inHadith: block.hadith_uid ?? cit.in_hadith ?? null,
        hasParent: cit.has_parent,
      },
    });
  }, [openFootnote]);

  const onHadithClick = useCallback((block: PageBlock) => {
    if (!block.hadith_uid) return;
    openFootnote({
      kind: "hadith",
      hadith: {
        localUid: block.hadith_uid,
        revayatIndex: block.revayat_index ?? null,
      },
    });
  }, [openFootnote]);

  /* ---------- RES: ثبت فیش این روایت — متن کامل روایت در پود درست ----------
     روایت ممکن است چند بلوک باشد؛ بازه = آغاز نخستین تا پایان آخرین بلوک. */
  const hadithFiche = useCallback(
    (localUid: string) => {
      for (const payload of allPayloads) {
        const parts = payload.blocks.filter((b) => b.hadith_uid === localUid);
        if (parts.length === 0) continue;
        const first = blockOffsets(parts[0]);
        const last = blockOffsets(parts[parts.length - 1]);
        if (!first || !last) return false;
        setSelection({
          blockId: parts[0].id,
          start: first.start,
          end: last.end,
          text: parts.map((b) => b.text).join("\n"),
          hadithUid: localUid,
        });
        setFicheOpen(true);
        return true;
      }
      return false;
    },
    [allPayloads],
  );

  const onHadithFiche = useCallback(
    (localUid: string) => {
      const ok = hadithFiche(localUid);
      if (ok && isCompact) {
        openFootnote(null);
      }
    },
    [hadithFiche, isCompact, openFootnote],
  );

  /* ---------- بارگذاری keyboard ---------- */
  useEffect(() => {
    /* در گیت موبایل، ناوبری کلیدها با ژست‌های ریدر موبایل است (ورق زیرصفحه) */
    if (mobileGate) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "ArrowLeft" && nextRef) gotoNeighbor(nextRef);
      if (e.key === "ArrowRight" && prevRef) gotoNeighbor(prevRef);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextRef, prevRef, gotoNeighbor, mobileGate]);

  /* ---------- حالت‌های بارگذاری/خطا ---------- */

  /* گیت موبایل: بعد از همهٔ هوک‌ها؛ کل نما جایگزین می‌شود (داده از همان useReaderData) */
  if (mobileGate) {
    return (
      <ReaderMobileView
        documentUid={documentUid}
        rd={rd}
        positionExtraRef={mobileExtraRef}
        scrollRef={mobileScrollRef}
        onExitMobile={!isMobileViewport ? exitFocusMode : undefined}
        openedHighlightUid={openedHighlightUid}
        onOpenHighlight={openHighlight}
      />
    );
  }

  if (workQuery.isPending || (!isPdfDoc && pagesQuery.isPending)) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-background" aria-busy="true" aria-live="polite">
        <div className="flex h-11 items-center justify-between border-b border-border bg-surface px-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
          </div>
        </div>
        <div className="flex flex-1 min-h-0">
          <aside className="hidden w-72 border-e border-border p-3 lg:block xl:w-80">
            <Skeleton className="h-5 w-32 mb-4" />
            <div className="space-y-2.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </aside>
          <div className="flex-1 overflow-hidden bg-reader p-6 md:p-8">
            <div className="mx-auto max-w-[760px] space-y-4">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
              <p className="flex items-center gap-2 text-xs text-muted-foreground pt-4">
                <Loader2 className="size-3.5 animate-spin" /> در حال بازکردن متن کتاب…
              </p>
            </div>
          </div>
        </div>
        <span className="sr-only">در حال بارگیری کتاب‌خوان…</span>
      </div>
    );
  }

  /* سندِ تصویری/فتو-اسکن (دور ۱۸): سند در کاتالوگ هست (work 200) ولی فهرست صفحه‌ها
     404 می‌دهد («این سند در دسترس نیست» = مدل صفحه ساخته نشده). به‌جای خطای سراسری،
     ریدر با پوسته و توضیح منصفانه باز می‌شود. */

  if (workQuery.isError) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-sm text-destructive">
          بازکردن این سند ممکن نشد{errMsg ? ": " + errMsg : ""}
        </p>
        <Button variant="outline" className="mt-3" onClick={() => { workQuery.refetch(); if (!isPdfDoc) void pagesQuery.refetch(); }}>
          تلاش دوباره
        </Button>
      </div>
    );
  }

  const work = workQuery.data!;
  const docLabel = work.documents.find((d) => d.uid === documentUid)?.label ?? "";

  /* پیام سندِ بدون متن استخراج‌شده — مشترک میان دو حالت نمایش */
  const pagesUnavailablePane = pagesUnavailable ? (
    <div className="mx-auto max-w-[640px] p-10 text-center" role="status">
      <TriangleAlert className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-foreground">
        متن قابل مطالعه‌ای برای این نسخه موجود نیست.
      </p>
      <p className="mx-auto mt-2 max-w-[480px] text-xs leading-6 text-muted-foreground">
        این کتاب در کتابخانه ثبت شده است، ولی نسخهٔ منبع آن تصویری (اسکن) است و
        شاخص متنی برای آن ساخته نشده است.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => { navigate(workHref(work.uid), undefined, { slug: workQuery.data?.title }); }}
      >
        صفحهٔ اثر
      </Button>
    </div>
  ) : null;

  const tocPanel = (
    <TocPanel
      sections={tocQuery.data?.sections ?? []}
      isLoading={docFormat === "pdf" ? false : tocQuery.isPending}
      error={docFormat === "pdf" ? null : tocQuery.isError ? "فهرست در دسترس نیست." : null}
      onRetry={() => tocQuery.refetch()}
      activeSectionUid={activeSectionUid}
      onJumpSection={onJumpSection}
    />
  );

  /* رندر یک صفحه — مشترک میان دو حالت */
  const renderPage = (payload: PagePayload, opts: { flashHere: boolean; frameless?: boolean }) => {
    const userHls = [
      ...(userHlsByPage[payload.page_uid] ?? []),
      ...(sharedHl && sharedHlPageUid === payload.page_uid ? [sharedHl] : []),
    ];
    return (
      <PageRenderer
        page={payload}
        prefs={prefs}
        frameless={opts.frameless}
        sectionUidByBlockId={sectionUidByBlockId}
        sectionLevelByBlockId={sectionLevelByBlockId}
        flashBlockId={opts.flashHere ? flashBlockId : null}
        highlight={highlightByPage[payload.page_uid] ?? null}
        userHighlights={userHls.length > 0 ? userHls : undefined}
        onHighlightSelection={onHighlightSelection}
        onHighlightOpen={openHighlight}
        onNoteSelection={(sel) => void onHighlightSelection(sel, "yellow", true)}
        onCopySelection={(ok) => flash(ok ? "کپی شد" : "کپی ممکن نشد؛ دستی انتخاب کنید")}
        onHighlightUpdate={onHighlightUpdate}
        onHighlightDelete={onHighlightDelete}
        collapsedSanads={collapsedSanads}
        onToggleSanad={toggleSanad}
        onFootnoteClick={(refUid) => openFootnoteFromPayload(payload, refUid)}
        onLinkClick={onLinkClick}
        onVerseClick={onVerseClick}
        onHadithClick={onHadithClick}
        onSelection={onSelection}
      />
    );
  };

  const currentVisiblePageUid = continuous ? (contCurrentUid || currentPageUid) : currentPageUid;
  const activePageLabel =
    activePayload?.label ??
    pageRefs.find((r) => r.page_uid === currentVisiblePageUid)?.label ??
    "…";
  const cleanWorkTitle = normalizePersian(work.title);

  return (
    <div ref={readerRootRef} className="relative flex h-full w-full min-h-0 flex-col overflow-hidden" dir="rtl">
      {/* حسگر بالای صفحه برای آشکارسازی فوری هدر اصلی با بردن ماوس به بالا */}
      <div
        className="absolute top-0 inset-x-0 h-2.5 z-50 pointer-events-auto"
        onMouseEnter={() => setHeaderVisible(true)}
        aria-hidden="true"
      />

      {/* هدر اصلی سایت — فقط این بخش با اسکرول رو به پایین به‌صورت نرم بالا می‌رود و پنهان می‌شود */}
      <div
        style={{
          height: headerPinned || headerVisible ? `${siteHeaderHeight}px` : "0px",
        }}
        className={cn(
          "overflow-hidden shrink-0 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] z-40",
          headerPinned || headerVisible
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        )}
        onMouseEnter={() => setHeaderVisible(true)}
      >
        <div
          ref={siteHeaderRef}
          className={cn(
            "transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
            headerPinned || headerVisible ? "translate-y-0" : "-translate-y-2"
          )}
        >
          <SiteHeader variant="reader" />
        </div>
      </div>

      {/* نوار ابزار کتاب‌خوان (همیشه در همه حالات دیده می‌شود) */}
      <div className="shrink-0 z-30 bg-chrome">
        <ReaderToolbar
          workTitle={cleanWorkTitle}
          documentLabel={docLabel}
          pageLabel={activePageLabel}
          display={display}
          onDisplayChange={(d) => useWorkspaceStore.getState().updatePrefs({ display: d })}
          pageRefs={pageRefs}
          currentPageUid={currentVisiblePageUid}
          onJumpToPage={(ref) => goToPage(ref.page_uid)}
          documentUid={documentUid}
          searchQuery={inBookSearchQuery}
          onSearch={handleExecuteSearch}
          onClearSearch={handleClearSearch}
          isSearching={inBookSearch.isFetching}
          totalSearchMatches={inBookSearch.data?.results?.length ?? null}
          bookmarked={isBookmarked}
          bookmarkPending={bookmarkPending}
          onToggleBookmark={() =>
            void toggleBookmark().catch((err) =>
              toast({ title: errorMessage(err, "به‌روزرسانی نشانک ناموفق بود"), variant: "destructive" }),
            )
          }
          onOpenMarks={() => setNotesSheetOpen(true)}
          marksCount={markedPagesCount}
          marksOnly={isPdfDoc}
          onCopyAddress={() => void copyAddress()}
          onExportPdf={() => setPdfOpen(true)}
          pinned={headerPinned}
          onTogglePin={toggleHeaderPinned}
          textToolsHidden={isPdfDoc}
          onEnterFocusMode={enterFocusMode}
          settingsTrigger={
            isPdfDoc ? null : (
              <SettingsPopover
                trigger={
                  <button
                    type="button"
                    className="group inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:transition-transform [&_svg]:duration-150 group-hover:[&_svg]:scale-110"
                    aria-label="تنظیمات خواندن"
                    title="تنظیمات خواندن"
                  >
                    <SlidersHorizontal className="size-4.5" aria-hidden="true" />
                  </button>
                }
              />
            )
          }
          highlightActive={!!hl}
          onClearHighlight={() => {
            // فاز ۲: پاک‌سازی query — hl/hlb از نشانی کنار می‌روند
            const kept: Record<string, string> = {};
            params.forEach((v, k) => {
              if (k !== "hl" && k !== "hlb") kept[k] = v;
            });
            navigate(readHref(documentUid), kept);
          }}
          onPrev={prevRef ? () => gotoNeighbor(prevRef) : null}
          onNext={nextRef ? () => gotoNeighbor(nextRef) : null}
          saveIndicator={saveFlash ? <span className="text-xs text-muted-foreground">{saveFlash}</span> : null}
        />
      </div>

      {/* banner اشتراک (§۷-الف-۳): مقصد دقیق با هایلایت/یادداشت اشتراکی */}
      <SharedReaderStatus rd={rd} />

      {/* دور ۱۸-فیکس ۶: overflow-hidden روی ردیف پنل‌ها — دامنهٔ نشت scrollable overflow
          پان متن به ریشه را می‌بندد؛ بدون این، scrollHeight ریشه ~۸۲هزار می‌شود و
          بازیابی اسکرول رفرش می‌تواند ریشه را جابه‌جا کند («نوار خالی پایین») */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* فهرست — دسکتاپ (در حالت مطالعهٔ متمرکز نمای موبایل جایگزین کل صفحه می‌شود) */}
        <aside className="hidden w-72 shrink-0 border-e border-border lg:block xl:w-80">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">فهرست</span>
          </div>
          <div className="h-[calc(100%-2.6rem)] overflow-y-auto">{tocPanel}</div>
        </aside>

        {/* فهرست — شیت (موبایل/تبلت) */}
        <Sheet open={tocOpen} onOpenChange={setTocOpen}>
          <SheetContent side="right" className="w-80 p-0">
            <SheetHeader className="border-b border-border py-3">
              <SheetTitle className="text-sm">فهرست</SheetTitle>
            </SheetHeader>
            <div className="h-[calc(100%-3.4rem)] overflow-y-auto">{tocPanel}</div>
          </SheetContent>
        </Sheet>

        {/* سطح اصلی متن — سند اسکن‌شده: PDF / متنی: دو حالت نمایش */}
        <main
          ref={mainRef}
          className={cn("reader-surface min-w-0 flex-1 bg-reader", isPdfDoc ? "overflow-hidden" : "overflow-y-auto")}
          aria-label="متن کتاب"
        >
          {isPdfDoc ? (
            /* ---------- سند اسکن‌شده: نمایشگر PDF (pdf.js) درون همان کروم ---------- */
            <PdfReader
              documentUid={documentUid}
              page={pdfPageNum}
              onPageCount={setPdfPageCount}
            />
          ) : continuous ? (
            /* ---------- پیوسته: همهٔ صفحه‌ها پشت‌سرهم در یک قاب واحد و بدون خط‌کشی
               mb-36 تا متن انتهایی پشت نوار ابزار شناور (فقط < xl) پنهان نشود ---------- */
            <div style={{ maxWidth: readerTextWidthPx(prefs.text_width) }} className="mx-auto mt-4 mb-36 w-full rounded-2xl border border-border bg-reader px-4 py-6 shadow-sm md:px-6 md:py-8 xl:mb-4">
              {pageRefs.map((ref, refIdx) => {
                const payload = payloadByUid[ref.page_uid];
                const q = pagesQueries[refIdx];
                return (
                  <section
                    key={ref.page_uid}
                    id={`pgsec-${ref.page_uid}`}
                    data-page-uid={ref.page_uid}
                    className="scroll-mt-4"
                  >
                    {payload ? (
                      payload.blocks.length > 0 ? (
                        renderPage(payload, { flashHere: true, frameless: true })
                      ) : null
                    ) : q?.isError ? (
                      <div className="my-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-center text-xs text-destructive">
                        بازکردن صفحهٔ {faNum(ref.label)} ممکن نشد.
                        <div>
                          <Button variant="outline" size="sm" className="mt-2" onClick={() => void q.refetch()}>
                            تلاش دوباره
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="my-4 space-y-3" aria-busy="true">
                        <Skeleton className="h-5 w-1/2" />
                        <Skeleton className="h-28 w-full" />
                        <span className="sr-only">در حال بارگیری صفحهٔ {ref.label}…</span>
                      </div>
                    )}
                  </section>
                );
              })}
              {pagesUnavailable ? (
                pagesUnavailablePane
              ) : (
                <p className="mt-8 border-t border-border/40 pt-6 text-center text-xs text-muted-foreground">
                  پایان این جلد — {faNum(pageRefs.length)} صفحه
                </p>
              )}
            </div>
          ) : (
            /* ---------- صفحه‌محور: یک صفحه در هر نما ---------- */
            <>
              {pagesUnavailable ? (
                pagesUnavailablePane
              ) : pageQuery.isPending ? (
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
                  {pageQuery.data.page_mapping === "approximate" && (
                    <PageMappingNotice documentUid={documentUid} />
                  )}
                  {renderPage(pageQuery.data, { flashHere: true })}
                  {/* ناوبری پایین صفحه — فقط در حالت صفحه‌محور: پرش به صفحهٔ بعد + شمار صفحه‌های جلد (قالب 2270:10348)
                      پادینگ پایینِ بیش در < xl تا متن انتهایی پشت نوار ابزار شناور پنهان نشود */}
                  <div className="mx-auto flex max-w-[760px] items-center justify-between px-4 pt-4 pb-40 xl:pb-10">
                    <span
                      className="select-none text-xs text-muted-foreground"
                      title={`مجموع صفحه‌های این جلد: ${faNum(pageRefs.length)}`}
                    >
                      {faNum(pageRefs.length)} صفحه
                    </span>
                    {nextRef ? (
                      <Button variant="outline" size="sm" onClick={() => gotoNeighbor(nextRef)}>
                        صفحهٔ بعد ({faNum(nextRef.label)})
                        <ChevronLeft className="size-4" aria-hidden="true" />
                      </Button>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </main>

        {/* پنل زمینه — دسکتاپ (در سند اسکن‌شده پنهان) */}
        {!isPdfDoc ? (
          <aside className="hidden w-80 shrink-0 border-s border-border xl:block">
            {/* تب‌های جست‌وجو / زمینه / یادداشت */}
            <div role="tablist" aria-label="پنل کناری متن" className="flex border-b border-border">
            {/* تب‌های جست‌وجو / زمینه / یادداشت — سبک تب پرِ حاضر (قالب 2270:10587) */}
              {inBookSearchQuery ? (
                <button
                  role="tab"
                  aria-selected={ctxTab === "search"}
                  onClick={() => setCtxTab("search")}
                  className={`min-h-11 flex-1 px-2 text-xs font-medium transition-colors md:min-h-9 ${
                    ctxTab === "search"
                      ? "bg-primary font-semibold text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  جست‌وجو
                  {inBookSearch.data?.results ? (
                    <span
                      className={`ms-1 inline-flex min-w-5 justify-center rounded-full px-1 text-[10px] font-semibold ${
                        ctxTab === "search"
                          ? "bg-primary-foreground/15 text-primary-foreground"
                          : "bg-primary/15 text-primary"
                      }`}
                    >
                      {faNum(inBookSearch.data.results.length)}
                    </span>
                  ) : inBookSearch.isFetching ? (
                    <Loader2 className="ms-1 inline-block size-3 animate-spin text-primary" />
                  ) : null}
                </button>
              ) : null}
              <button
                role="tab"
                aria-selected={ctxTab === "context"}
                onClick={() => setCtxTab("context")}
                className={`min-h-11 flex-1 px-2 text-xs font-medium transition-colors md:min-h-9 ${
                  ctxTab === "context"
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                زمینه
              </button>
              <button
                role="tab"
                aria-selected={ctxTab === "notes"}
                onClick={() => setCtxTab("notes")}
                className={`min-h-11 flex-1 px-2 text-xs font-medium transition-colors md:min-h-9 ${
                  ctxTab === "notes"
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                نشانه‌ها
                {markedPagesCount > 0 ? (
                  <span
                    className={`ms-1 inline-flex min-w-5 justify-center rounded-full px-1 text-[10px] font-semibold ${
                      ctxTab === "notes"
                        ? "bg-primary-foreground/15 text-primary-foreground"
                        : "bg-primary/15 text-primary"
                    }`}
                  >
                    {faNum(markedPagesCount)}
                  </span>
                ) : null}
              </button>
            </div>
            <div className="h-[calc(100%-2.75rem)] overflow-y-auto">
              {ctxTab === "search" ? (
                <BookSearchPanel
                  query={inBookSearchQuery}
                  onExecuteSearch={handleExecuteSearch}
                  scope={inBookSearchScope}
                  ignoreSpacing={rd.ignoreSpacing}
                  onIgnoreSpacingChange={rd.setIgnoreSpacing}
                  onScopeChange={setInBookSearchScope}
                  hasMultipleDocs={(work.documents?.length ?? 0) > 1}
                  currentDocLabel={docLabel}
                  results={inBookSearch.data?.results ?? []}
                  isLoading={inBookSearch.isPending}
                  error={inBookSearch.error instanceof Error ? inBookSearch.error : null}
                  onRetry={() => void inBookSearch.refetch()}
                  onClose={() => setCtxTab("context")}
                  activePassageUid={selectedSearchPassageUid}
                  onSelectResult={handleSelectSearchResult}
                  currentDocUid={documentUid}
                  currentPageUid={currentPageUid}
                />
              ) : ctxTab === "notes" ? (
                <NotesPanel
              onHighlightOpen={openHighlight}
                  documentUid={documentUid}
                  currentPageUid={currentPageUid}
                  pageLabel={activePayload?.label ?? null}
                  hadithScope={hadithNoteScope}
                  onClearHadithScope={() => setHadithNoteScope(null)}
                  onJumpToPage={(pg) => goToPage(pg)}
                  workTitle={work.title}
                  anchorStatus={anchorStatus}
                  marksOnly={isPdfDoc}
                  pageMarks={pageMarks}
                  documentNotes={documentNotes}
                  marksPending={bookmarksQuery.isPending || notesCountQuery.isPending || annotationsQuery.isPending}
                  onRequestDeletePageMark={requestDeletePageMark}
                  onJumpMark={jumpToMark}
                />
              ) : openedHighlightUid && !isCompact ? (
                <HighlightSheet key={openedHighlightUid} highlightUid={openedHighlightUid} documentUid={documentUid} inline onClose={() => openHighlight(null)} />
              ) : footnote ? (
                <FootnotePanel
                  data={footnote}
                  onBack={() => openFootnote(null)}
                  onHadithLookup={setHadithLookupUid}
                  documentUid={documentUid}
                  onHadithFiche={onHadithFiche}
                  onHadithNote={(localUid, revayatIndex) => {
                    setHadithNoteScope({ localUid, revayatIndex });
                    setCtxTab("notes");
                  }}
                />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  هاور روی شمارهٔ پاورقی، پیش‌نمایش متن را نشان می‌دهد؛ کلیک، همین پنل را باز می‌کند.
                </p>
              )}
            </div>
          </aside>
        ) : null}
      </div>

      {/* پاورقی — فقط زیر xl: sheet پایین.
          نکته: محتوای Sheet در body پرتال می‌شود؛ xl:hidden روی والدِ آن
          اثری ندارد — پس رندر شیت باید صریحاً به isCompact مقید باشد. */}
      {footnote && isCompact ? (
        <Sheet open={!!footnote} onOpenChange={(o) => !o && openFootnote(null)}>
          <SheetContent side="bottom" className="max-h-[60vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="text-sm">پاورقی / ارجاع</SheetTitle>
            </SheetHeader>
            <FootnotePanel
              data={footnote}
              onBack={() => openFootnote(null)}
              onHadithLookup={setHadithLookupUid}
              documentUid={documentUid}
              onHadithFiche={onHadithFiche}
              onHadithNote={(localUid, revayatIndex) => {
                setHadithNoteScope({ localUid, revayatIndex });
                openFootnote(null);
                setNotesSheetOpen(true);
              }}
            />
          </SheetContent>
        </Sheet>
      ) : null}

      {/* نتایج جست‌وجو در کتاب — در موبایل/تبلت: Sheet پایین */}
      {isCompact && searchSheetOpen ? (
        <Sheet open={searchSheetOpen} onOpenChange={setSearchSheetOpen}>
          <SheetContent side="bottom" className="max-h-[75vh] flex flex-col p-0">
            <div className="flex-1 overflow-hidden min-h-0">
              <BookSearchPanel
                query={inBookSearchQuery}
                onExecuteSearch={handleExecuteSearch}
                scope={inBookSearchScope}
                  ignoreSpacing={rd.ignoreSpacing}
                  onIgnoreSpacingChange={rd.setIgnoreSpacing}
                onScopeChange={setInBookSearchScope}
                hasMultipleDocs={(work.documents?.length ?? 0) > 1}
                currentDocLabel={docLabel}
                results={inBookSearch.data?.results ?? []}
                isLoading={inBookSearch.isPending}
                error={inBookSearch.error instanceof Error ? inBookSearch.error : null}
                onRetry={() => void inBookSearch.refetch()}
                onClose={() => setSearchSheetOpen(false)}
                activePassageUid={selectedSearchPassageUid}
                onSelectResult={handleSelectSearchResult}
                currentDocUid={documentUid}
                currentPageUid={currentPageUid}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {/* یادداشت‌ها — شیت: موبایل پایین / دسکتاپ از سمت چپ (سمت پنل زمینه) */}
      <Sheet open={notesSheetOpen} onOpenChange={setNotesSheetOpen}>
        <SheetContent
          side={isCompact ? "bottom" : "left"}
          className={
            isCompact
              ? "flex h-[75vh] flex-col overflow-hidden"
              : "flex h-full w-[26rem] flex-col overflow-hidden p-0 sm:max-w-none"
          }
        >
          <SheetHeader className="border-b border-border pb-2">
            <SheetTitle className="flex items-center gap-1.5 text-sm">
              <StickyNote className="size-4 text-primary" aria-hidden="true" />
              نشانک‌ها و یادداشت‌ها
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <NotesPanel
              onHighlightOpen={openHighlight}
              documentUid={documentUid}
              currentPageUid={currentPageUid}
              pageLabel={activePayload?.label ?? null}
              hadithScope={hadithNoteScope}
              onClearHadithScope={() => {
                setHadithNoteScope(null);
              }}
              onJumpToPage={(pg) => {
                setNotesSheetOpen(false);
                goToPage(pg);
              }}
              workTitle={work.title}
              anchorStatus={anchorStatus}
              marksOnly={isPdfDoc}
              pageMarks={pageMarks}
              documentNotes={documentNotes}
              marksPending={bookmarksQuery.isPending || notesCountQuery.isPending || annotationsQuery.isPending}
              onRequestDeletePageMark={requestDeletePageMark}
              onJumpMark={(mark) => {
                setNotesSheetOpen(false);
                return jumpToMark(mark);
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
        page={activePayload}
        sectionUid={activeSectionUid}
        work={work ? { uid: work.uid, title: work.title } : null}
      />

      {/* §۷-الف-۲: خروجی PDF از کتاب */}
      {openedHighlightUid && isCompact && <HighlightSheet key={openedHighlightUid} highlightUid={openedHighlightUid} documentUid={documentUid} onClose={() => openHighlight(null)} />}
      <PdfExportDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        documentUid={documentUid}
        documentLabel={docLabel}
        workTitle={work.title}
        pages={pageRefs}
        currentPageUid={currentPageUid}
      />

      {/* پرس‌وجوی میان‌کتابی روایت (§۴۷) — از پنل زمینه */}
      <HadithLocationsDialog
        documentUid={documentUid}
        localHadithUid={hadithLookupUid ?? ""}
        open={!!hadithLookupUid}
        onOpenChange={(o) => !o && setHadithLookupUid(null)}
        onNoteRequest={(localUid, revayatIndex) => {
          setHadithLookupUid(null);
          setHadithNoteScope({ localUid, revayatIndex });
          if (isCompact) {
            setNotesSheetOpen(true);
          } else {
            setCtxTab("notes");
          }
        }}
      />

      <DeleteMarkDialog
        mark={pendingMarkDelete}
        pending={markDeletePending}
        onConfirm={() => {
          void confirmMarkDelete().catch((err) =>
            toast({
              title: errorMessage(err, "حذف نشانک صفحه ناموفق بود"),
              variant: "destructive",
            }),
          );
        }}
        onCancel={cancelMarkDelete}
      />

          </div>
  );
}

/* ---------- سند روایت‌های جمع‌شده (HAD-10/HAD-14) — وضعیت در سطح نما ---------- */
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
