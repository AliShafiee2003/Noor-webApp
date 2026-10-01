"use client";

/**
 * میز مطالعه (کتاب‌خوان) — PRD §۱۱ (READ-01..17) + §۷-الف
 * دو حالت نمایش (بدون حدس از ترجیحات):
 * - صفحه‌محور (paged): یک صفحه در هر نما با ناوبری قبلی/بعدی.
 * - پیوسته (continuous): همهٔ صفحه‌های جلد پشت‌سرهم با اسکرول یک‌دست؛
 *   پرش فهرست/نشانک/شمارهٔ صفحه به موضع واقعی اسکرول می‌کند، موضع خواندن
 *   با اسکرول به‌روز می‌شود (READ-12) و نشانهٔ جست‌وجو در صفحهٔ خودش دیده می‌شود.
 * دسکتاپ ≥1440: فهرست راست / متن وسط / زمینه چپ (پنل‌های قابل تغییر اندازه)
 * 1024–1439: متن + زمینه (فهرست در Sheet)؛ <768: تک‌ستونی با drawer.
 * §۷-الف: هایلایت چندرنگ روی انتخاب، خروجی PDF، اشتراک لینک (banner «shared»).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenCheck,
  BookOpenText,
  Bookmark as BookmarkIcon,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileDown,
  List,
  Loader2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Share2,
  SlidersHorizontal,
  StickyNote,
  TriangleAlert,
} from "lucide-react";
import type { Bookmark as BookmarkT, Highlight as HighlightT, HighlightColor, Note as NoteT } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { faNum } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import type {
  BlockLink,
  PageBlock,
  PagePayload,
  PageRef,
  TocSection,
  WorkDetail,
} from "@/lib/types";
import { blockOffsets } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspace";
import { useIsCompact } from "@/hooks/use-mobile";
import { PageRenderer, type ReaderSelection } from "@/components/reader/page-renderer";
import { TocPanel } from "@/components/reader/toc-panel";
import { FootnotePanel, type FootnotePanelData } from "@/components/reader/footnote-panel";
import { FicheDialog } from "@/components/reader/fiche-dialog";
import { HadithLocationsDialog } from "@/components/search/hadith-locations-dialog";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { SettingsPopover } from "@/components/reader/settings-popover";
import { NotesPanel } from "@/components/reader/notes-panel";
import { PdfExportDialog } from "@/components/reader/pdf-export-dialog";

export function ReaderView({ documentUid }: { documentUid: string }) {
  const queryClient = useQueryClient();
  const prefs = useWorkspaceStore((s) => s.prefs);
  const isCompact = useIsCompact();
  const display = prefs.display;

  /* ---------- پارامترهای hash: صفحهٔ فعلی و highlight نتیجه ---------- */
  const [params, setParams] = useState(() => readHashParams());
  /* گارد اسکرول خودکار پیوسته — با هر hashchange واقعی ریست می‌شود */
  const lastAutoScrollRef = useRef<string | null>(null);
  useEffect(() => {
    const onHash = () => {
      /* ناوبری واقعی (نه replaceStateِ ردیابی اسکرول): اجازهٔ اسکرول مجدد به مقصد */
      lastAutoScrollRef.current = null;
      setParams(readHashParams());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const requestedPageUid = params.get("pg") || null;
  const sharedUid = params.get("shared");
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

  /* ---------- حالت پیوسته: همهٔ صفحه‌ها با موازی‌سازی محدود ---------- */
  const continuous = display === "continuous";
  const pagesQueries = useQueries({
    queries: (continuous ? pageRefs : []).map((ref) => ({
      queryKey: ["reader-page", documentUid, ref.page_uid],
      queryFn: () => api.get<PagePayload>(`/documents/${documentUid}/pages/${ref.page_uid}`),
      retry: false,
      enabled: continuous && !!ref.page_uid,
      staleTime: 5 * 60_000,
    })),
  });
  const payloadByUid = useMemo(() => {
    const map: Record<string, PagePayload> = {};
    if (!continuous) return map;
    pageRefs.forEach((ref, i) => {
      const q = pagesQueries[i];
      if (q?.data) map[ref.page_uid] = q.data;
    });
    return map;
  }, [continuous, pageRefs, pagesQueries]);
  const pagesPendingCount = continuous
    ? pagesQueries.filter((q) => q.isPending).length
    : 0;

  /* صفحهٔ فعلی در حالت پیوسته — با اسکرول به‌روز می‌شود */
  const [contCurrentUid, setContCurrentUid] = useState<string | null>(null);
  const contCurrentRef = useRef<string | null>(null);

  const currentPageUid =
    display === "continuous"
      ? contCurrentUid ?? requestedPageUid ?? fallbackPageUid
      : requestedPageUid ?? fallbackPageUid;

  /* حالت صفحه‌محور: پود صفحهٔ فعلی */
  const pageQuery = useQuery({
    queryKey: ["reader-page", documentUid, currentPageUid],
    enabled: !continuous && !!currentPageUid,
    queryFn: () =>
      api.get<PagePayload>(`/documents/${documentUid}/pages/${currentPageUid}`),
    retry: false,
  });

  /* همهٔ پودهای در دسترس — برای جست‌وجوی بلوک/پاورقی/لنگرها */
  const allPayloads: PagePayload[] = useMemo(() => {
    if (continuous) return pageRefs.map((r) => payloadByUid[r.page_uid]).filter(Boolean);
    return pageQuery.data ? [pageQuery.data] : [];
  }, [continuous, pageRefs, payloadByUid, pageQuery.data]);
  const activePayload: PagePayload | null = continuous
    ? (currentPageUid ? payloadByUid[currentPageUid] ?? null : null)
    : pageQuery.data ?? null;

  /* blockId → pageUid (هایلایت انتخابی و هایلایت اشتراکی باید بدانند کجای سندند) */
  const blockPage = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of allPayloads) for (const b of p.blocks) map[b.id] = p.page_uid;
    return map;
  }, [allPayloads]);

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

  /* ---------- §۷-الف-۳: هایلایت‌های شخصی ---------- */
  const annotationsQuery = useQuery({
    queryKey: ["annotations", documentUid],
    queryFn: () => api.get<{ items: HighlightT[] }>("/annotations", { document_uid: documentUid }),
    staleTime: 30_000,
    retry: false,
  });
  const annotations = annotationsQuery.data?.items ?? [];

  /* اعتبار لنگر هر هایلایت — فقط وقتی پود صفحه‌اش بارگذاری شده قضاوت می‌شود؛
     لنگرِ نامعتبر صریحاً «یافت نشد» گزارش می‌شود، هرگز بی‌صدا حذف نمی‌شود */
  const anchorStatus = useMemo(() => {
    const out: Record<string, "ok" | "missing"> = {};
    for (const h of annotations) {
      const p = payloadByUid[h.page_uid] ?? (h.page_uid === pageQuery.data?.page_uid ? pageQuery.data : null);
      if (!p) continue;
      const block = p.blocks.find((b) => b.id === h.block_id);
      if (!block || h.end > Array.from(block.text).length) out[h.uid] = "missing";
      else out[h.uid] = "ok";
    }
    return out;
  }, [annotations, payloadByUid, pageQuery.data]);

  /* هایلایت‌ها به تفکیک صفحه — برای نقاشی در رندرر */
  const userHlsByPage = useMemo(() => {
    const map: Record<string, HighlightT[]> = {};
    for (const h of annotations) {
      (map[h.page_uid] ??= []).push(h);
    }
    return map;
  }, [annotations]);

  /* ---------- §۷-الف-۳: اشتراک — banner + هایلایت اشتراکی ---------- */
  const sharedQuery = useQuery({
    queryKey: ["shared", sharedUid],
    queryFn: () => api.get<import("@/lib/types").SharedItem>(`/shares/${sharedUid}`),
    enabled: !!sharedUid,
    retry: false,
  });
  const sharedHl = useMemo(() => {
    const item = sharedQuery.data;
    if (!item || item.kind !== "highlight") return null;
    const m = item.meta;
    if (!m?.block_id || typeof m.start !== "number" || typeof m.end !== "number") return null;
    return {
      uid: `shared-${sharedUid}`,
      block_id: m.block_id,
      start: m.start,
      end: m.end,
      color: (m.color ?? "yellow") as HighlightColor,
    };
  }, [sharedQuery.data, sharedUid]);
  const sharedHlPageUid = sharedHl ? blockPage[sharedHl.block_id] ?? null : null;
  /* بازگشایی حل اشتراک با هر تغییر hash — لغو/انقضا بدون رفرش صفحه هم دیده می‌شود */
  const firstParamsRef = useRef(true);
  useEffect(() => {
    if (firstParamsRef.current) {
      firstParamsRef.current = false;
      return;
    }
    if (sharedUid) void queryClient.invalidateQueries({ queryKey: ["shared", sharedUid] });
  }, [params, sharedUid, queryClient]);
  const clearShared = useCallback(() => {
    const hash = window.location.hash;
    const qi = hash.indexOf("?");
    const base = qi >= 0 ? hash.slice(0, qi) : hash;
    const q = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : "");
    q.delete("shared");
    const qs = q.toString();
    window.location.hash = qs ? `${base}?${qs}` : base;
  }, []);

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
    if (!activePayload) return null;
    for (const b of activePayload.blocks) {
      const uid = sectionUidByBlockId[b.id];
      if (uid) return uid;
    }
    return null;
  }, [activePayload, sectionUidByBlockId]);

  /* ---------- حالت‌های محلی ---------- */
  const [tocOpen, setTocOpen] = useState(false);
  const { collapsed: collapsedSanads, toggle: toggleSanad } = useCollapsedSanads();
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null);
  const [footnote, setFootnote] = useState<FootnotePanelData | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [ficheOpen, setFicheOpen] = useState(false);
  const [saveFlash, setSaveFlash] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
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
  /* ---------- حالت مطالعهٔ مینیمال (درخواست کاربر) ----------
     صفحهٔ شلوغ نباشد؛ فهرست/یادداشت‌ها/تنظیمات فقط با آیکون در دسترس؛
     پاورقی با هاور پیش‌نمایش می‌شود و کلیک، پنل/شیت را باز می‌کند.
     انتخاب در حافظهٔ دستگاه می‌ماند (localStorage) نه سرور — ترجیح شخصیِ محیطی. */
  const [studyMode, setStudyMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("noor-study-mode") === "1";
    } catch {
      return false;
    }
  });
  const toggleStudyMode = useCallback((v: boolean) => {
    setStudyMode(v);
    try {
      window.localStorage.setItem("noor-study-mode", v ? "1" : "0");
    } catch {
      /* بی‌اهمیت */
    }
  }, []);
  /* شیت زمینه (پاورقی/آیه/روایت) در حالت مطالعه — پنل کناری وجود ندارد */
  const [studyCtxOpen, setStudyCtxOpen] = useState(false);
  useEffect(() => {
    if (footnote && studyMode) setStudyCtxOpen(true);
    if (!footnote) setStudyCtxOpen(false);
  }, [footnote, studyMode]);
  /* در حالت مطالعه، تغییر صفحه پاپ‌آپ زمینه را هم می‌بندد */
  useEffect(() => {
    if (!studyMode) return;
    setStudyCtxOpen(false);
  }, [currentPageUid, studyMode]);
  /* خروج با Escape — فقط وقتی Escape توسط شیت/پاپ‌اوری مصرف نشده باشد
     (اگر شیت فهرست/یادداشت/تنظیمات باز است، Escape فقط همان را می‌بندد) */
  useEffect(() => {
    if (!studyMode) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      const openOverlay = document.querySelector(
        '[data-state="open"][role="dialog"], [data-radix-popper-content-wrapper]',
      );
      if (openOverlay) return;
      toggleStudyMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [studyMode, toggleStudyMode]);

  const flash = useCallback((msg: string) => {
    setSaveFlash(msg);
    window.setTimeout(() => setSaveFlash(null), 1800);
  }, []);

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

  /* ---------- پرش به صفحه (هر دو حالت) ----------
     حالت پیوسته: اسکرول فوری به بخش همان صفحه + به‌روزرسانی hash؛
     اگر hash همان pg را داشته باشد رویداد hashchange نمی‌آید، پس
     اسکرول را مستقیم انجام می‌دهیم (پرش به صفحهٔ فعلی هم جابه‌جا می‌شود). */
  const goToPage = useCallback(
    (pageUid: string, extra: Record<string, string> = {}) => {
      if (continuous) {
        const el = document.getElementById(`pgsec-${pageUid}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          contCurrentRef.current = pageUid;
          setContCurrentUid(pageUid);
        }
      }
      const q = new URLSearchParams({ pg: pageUid, ...extra });
      window.location.hash = `#/read/${documentUid}?${q.toString()}`;
      setFootnote(null);
    },
    [continuous, documentUid],
  );

  /* اسکرول به صفحهٔ مقصد در حالت پیوسته — فقط یک بار برای هر مقصد.
     ریشهٔ باگ «برگشت به بالا»: payloadByUid با رسیدن هر صفحه هویت تازه می‌گیرد
     و بدون این گارد، افکت هر بار به صفحهٔ درخواستی اسکرول می‌کرد. */
  useEffect(() => {
    if (!continuous || !requestedPageUid) return;
    if (lastAutoScrollRef.current === requestedPageUid) return;
    if (!payloadByUid[requestedPageUid]) return; // هنوز بارگذاری نشده — با آماده‌شدن دوباره اجرا می‌شود
    const el = document.getElementById(`pgsec-${requestedPageUid}`);
    if (el) {
      lastAutoScrollRef.current = requestedPageUid;
      el.scrollIntoView({ behavior: "auto", block: "start" });
      contCurrentRef.current = requestedPageUid;
      setContCurrentUid(requestedPageUid);
    }
  }, [continuous, requestedPageUid, payloadByUid]);

  /* ورود به حالت پیوسته: از موضع فعلی شروع کن (نه از ابتدای جلد) */
  const prevDisplayRef = useRef(display);
  useEffect(() => {
    if (prevDisplayRef.current === display) return;
    prevDisplayRef.current = display;
    if (display === "paged") {
      /* بازگشت به صفحه‌محور: همان‌جا که در حالت پیوسته بودیم */
      if (contCurrentRef.current) setFallbackPageUid(contCurrentRef.current);
      return;
    }
    const target = requestedPageUid ?? fallbackPageUid;
    if (!target) return;
    const id = window.setTimeout(() => {
      const el = document.getElementById(`pgsec-${target}`);
      if (el) {
        lastAutoScrollRef.current = target;
        el.scrollIntoView({ behavior: "auto", block: "start" });
        contCurrentRef.current = target;
        setContCurrentUid(target);
      }
    }, 350);
    return () => window.clearTimeout(id);
  }, [display, requestedPageUid, fallbackPageUid]);

  /* ردیابی اسکرول در حالت پیوسته → صفحهٔ بالاییِ دید = موضع خواندن (READ-12) */
  const mainRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!continuous) return;
    const main = mainRef.current;
    if (!main) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const sections = main.querySelectorAll<HTMLElement>("[data-page-uid]");
        const mainTop = main.getBoundingClientRect().top;
        let current: string | null = null;
        for (const s of sections) {
          if (s.getBoundingClientRect().top <= mainTop + 96) {
            current = s.dataset.pageUid ?? current;
          } else break;
        }
        if (!current && sections.length > 0) current = sections[0].dataset.pageUid ?? null;
        if (current && current !== contCurrentRef.current) {
          contCurrentRef.current = current;
          setContCurrentUid(current);
          /* به‌روزرسانی خاموش pg در hash — بدون رویداد hashchange و بدون پرش اسکرول */
          const hash = window.location.hash;
          const qi = hash.indexOf("?");
          const base = qi >= 0 ? hash.slice(0, qi) : hash;
          const q = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : "");
          q.set("pg", current);
          window.history.replaceState(null, "", `${base}?${q.toString()}`);
        }
      });
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [continuous, pagesPendingCount === 0]);

  const onJumpSection = useCallback(
    (s: TocSection) => {
      setTocOpen(false);
      if (!s.block_id) return;
      const blockId: string = s.block_id;
      /* مقصد فهرست: بلوک در هر حالتی — در صفحه‌محور اگر در صفحهٔ فعلی است flash؛
         در پیوسته اسکرول به بلوک؛ در غیر این صورت پرش به صفحهٔ دارای بلوک */
      const pageUid = blockPage[blockId];
      if (pageUid && pageUid !== currentPageUid) {
        goToPage(pageUid);
        window.setTimeout(() => {
          const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
            setFlashBlockId(blockId);
            window.setTimeout(() => setFlashBlockId(null), 1800);
          }
        }, 450);
        return;
      }
      const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setFlashBlockId(blockId);
        window.setTimeout(() => setFlashBlockId(null), 1800);
      } else if (activePayload?.blocks.some((b) => b.id === blockId)) {
        setFlashBlockId(blockId);
        window.setTimeout(() => setFlashBlockId(null), 1800);
      }
    },
    [blockPage, currentPageUid, goToPage, activePayload],
  );

  /* ---------- ذخیرهٔ موضع (READ-12) — PUT /workspace/position با debounce ---------- */
  const putTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentPageUid || (continuous ? !payloadByUid[currentPageUid] : !pageQuery.isSuccess)) return;
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
  }, [currentPageUid, continuous, payloadByUid, pageQuery.isSuccess, documentUid]);

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
          label: activePayload?.label ?? "",
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["reader-bookmarks"] });
    } finally {
      setBookmarkPending(false);
    }
  }, [currentPageUid, bookmarkPending, isBookmarked, bookmarksQuery.data, documentUid, activePayload?.label, queryClient]);

  /* ---------- کپی نشانی (READ-17) ---------- */
  const copyAddress = useCallback(async () => {
    const parts = [
      workQuery.data?.title ?? "",
      "جلد " + (workQuery.data?.documents.find((d) => d.uid === documentUid)?.label ?? ""),
      "صفحهٔ " + (activePayload?.label ?? ""),
    ].filter(Boolean);
    const text = parts.join("، ") + "\n" + window.location.hash;
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

  /* §۷-الف-۳: انتخاب متن → هایلایت چندرنگ (لنگر: بلوک + بازهٔ cp)
     نقاشی خوش‌بینانه: هایلایت فوراً دیده می‌شود؛ اگر ثبت شکست خورد پس گرفته می‌شود */
  const onHighlightSelection = useCallback(
    async (sel: ReaderSelection, color: HighlightColor) => {
      const pageUid = blockPage[sel.blockId];
      if (!pageUid) return;
      const qk = ["annotations", documentUid] as const;
      const tempUid = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const optimistic: HighlightT = {
        uid: tempUid,
        document_uid: documentUid,
        page_uid: pageUid,
        block_id: sel.blockId,
        start: sel.start,
        end: sel.end,
        text: sel.text.slice(0, 4000),
        color,
        note: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<{ items: HighlightT[] }>(qk, (old) => ({
        items: [...(old?.items ?? []), optimistic],
      }));
      try {
        await api.post("/annotations", {
          document_uid: documentUid,
          page_uid: pageUid,
          block_id: sel.blockId,
          start: sel.start,
          end: sel.end,
          text: sel.text.slice(0, 4000),
          color,
        });
        flash("هایلایت ثبت شد");
      } catch (err) {
        queryClient.setQueryData<{ items: HighlightT[] }>(qk, (old) => ({
          items: (old?.items ?? []).filter((h) => h.uid !== tempUid),
        }));
        toast({
          title: "ثبت هایلایت ناموفق بود",
          description: errorMessage(err, "دوباره تلاش کنید."),
          variant: "destructive",
        });
      } finally {
        void queryClient.invalidateQueries({ queryKey: qk });
      }
    },
    [blockPage, documentUid, queryClient, flash],
  );

  /* تغییر رنگ هایلایت موجود — خوش‌بینانه؛ خطا با بازخوانی جبران می‌شود */
  const onHighlightUpdate = useCallback(
    async (uid: string, color: HighlightColor) => {
      const qk = ["annotations", documentUid] as const;
      const prev = queryClient.getQueryData<{ items: HighlightT[] }>(qk);
      queryClient.setQueryData<{ items: HighlightT[] }>(qk, (old) => ({
        items: (old?.items ?? []).map((h) =>
          h.uid === uid ? { ...h, color, updated_at: new Date().toISOString() } : h,
        ),
      }));
      try {
        await api.patch(`/annotations/${uid}`, { color });
        flash("رنگ هایلایت عوض شد");
      } catch (err) {
        if (prev) queryClient.setQueryData(qk, prev);
        toast({
          title: "تغییر رنگ ناموفق بود",
          description: errorMessage(err, "دوباره تلاش کنید."),
          variant: "destructive",
        });
      }
    },
    [documentUid, queryClient, flash],
  );

  /* حذف هایلایت — خوش‌بینانه */
  const onHighlightDelete = useCallback(
    async (uid: string) => {
      const qk = ["annotations", documentUid] as const;
      const prev = queryClient.getQueryData<{ items: HighlightT[] }>(qk);
      queryClient.setQueryData<{ items: HighlightT[] }>(qk, (old) => ({
        items: (old?.items ?? []).filter((h) => h.uid !== uid),
      }));
      try {
        await api.del(`/annotations/${uid}`);
        flash("هایلایت حذف شد");
      } catch (err) {
        if (prev) queryClient.setQueryData(qk, prev);
        toast({
          title: "حذف هایلایت ناموفق بود",
          description: errorMessage(err, "دوباره تلاش کنید."),
          variant: "destructive",
        });
      }
    },
    [documentUid, queryClient, flash],
  );

  /* ---------- پاورقی/ارجاع — در هر دو حالت از پود درست ---------- */
  const openFootnoteFromPayload = useCallback(
    (payload: PagePayload, refUid: string) => {
      const fn = payload.footnotes.find((f) => f.uid === refUid);
      if (fn) {
        setFootnote({ kind: "footnote", uid: fn.uid, label: fn.label, text: fn.text });
      } else {
        setFootnote({ kind: "link", originalAddress: "پاورقی " + refUid });
      }
    },
    [],
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
        setFootnote(null);
      }
    },
    [hadithFiche, isCompact],
  );

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

  /* در حالت پیوسته، قبلی/بعدی به بخش همان صفحه اسکرول می‌کند */
  const gotoNeighbor = useCallback(
    (ref: PageRef | null) => {
      if (!ref) return;
      if (continuous) {
        const el = document.getElementById(`pgsec-${ref.page_uid}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          contCurrentRef.current = ref.page_uid;
          setContCurrentUid(ref.page_uid);
        }
      } else {
        goToPage(ref.page_uid);
      }
    },
    [continuous, goToPage],
  );

  /* ---------- بارگذاری keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "ArrowLeft" && nextRef) gotoNeighbor(nextRef);
      if (e.key === "ArrowRight" && prevRef) gotoNeighbor(prevRef);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextRef, prevRef, gotoNeighbor]);

  /* ---------- هایلایت نتیجهٔ جست‌وجو — به تفکیک صفحه ----------
     آفست hl سطح سند است؛ با source_offsets بلوک‌ها به مختصات درون‌بلوکی
     همان صفحه‌ای نگاشت می‌شود که بازه در آن است (بدون hlb). */
  const highlightByPage = useMemo(() => {
    const out: Record<string, { start: number; end: number; blockId: string }> = {};
    if (hl) {
      for (const payload of allPayloads) {
        let done = false;
        for (const block of payload.blocks) {
          const range = blockOffsets(block);
          if (range && hl[0] >= range.start && hl[0] < range.end) {
            const relStart = hl[0] - range.start;
            const relEnd = Math.max(relStart + 1, Math.min(hl[1], range.end) - range.start);
            out[payload.page_uid] = { start: relStart, end: relEnd, blockId: block.id };
            done = true;
            break;
          }
        }
        if (done) break;
      }
    }
    /* hlb صریح: بلوک مقصد معلوم است — در پود صفحه‌ای که بلوک در آن است */
    const explicitBlock = params.get("hlb");
    if (!out[Object.keys(out)[0] ?? ""] && explicitBlock) {
      for (const payload of allPayloads) {
        if (payload.blocks.some((b) => b.id === explicitBlock)) {
          out[payload.page_uid] = { start: hl?.[0] ?? 0, end: hl?.[1] ?? 0, blockId: explicitBlock };
          break;
        }
      }
    }
    return out;
  }, [hl, allPayloads, params]);

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

  /* رندر یک صفحه — مشترک میان دو حالت */
  const renderPage = (payload: PagePayload, opts: { flashHere: boolean }) => {
    const userHls = [
      ...(userHlsByPage[payload.page_uid] ?? []),
      ...(sharedHl && sharedHlPageUid === payload.page_uid ? [sharedHl] : []),
    ];
    return (
      <PageRenderer
        page={payload}
        prefs={prefs}
        sectionUidByBlockId={sectionUidByBlockId}
        flashBlockId={opts.flashHere ? flashBlockId : null}
        highlight={highlightByPage[payload.page_uid] ?? null}
        userHighlights={userHls.length > 0 ? userHls : undefined}
        onHighlightSelection={onHighlightSelection}
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

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-0 flex-col" dir="rtl">
      {studyMode ? (
        /* ---------- حالت مطالعهٔ مینیمال: فقط یک نوار باریک ---------- */
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface/95 px-3 py-1.5 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2 text-[13px] leading-5">
            <BookOpenCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="max-w-[12rem] truncate font-semibold text-foreground md:max-w-[18rem]">
              {work.title}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">/</span>
            <span className="shrink-0 font-medium text-muted-foreground">
              صفحهٔ {activePayload?.label ?? "…"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {saveFlash ? <span className="text-xs text-muted-foreground">{saveFlash}</span> : null}
            <Button
              variant="outline"
              size="sm"
              className="min-h-9 gap-1.5"
              onClick={() => toggleStudyMode(false)}
              title="خروج از حالت مطالعه (Esc)"
            >
              <Minimize2 className="size-4" aria-hidden="true" />
              خروج از حالت مطالعه
            </Button>
          </div>
        </div>
      ) : (
        <ReaderToolbar
          workTitle={work.title}
          documentLabel={docLabel}
          pageLabel={activePayload?.label ?? "…"}
          display={display}
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
          onExportPdf={() => setPdfOpen(true)}
          studyMode={false}
          onToggleStudyMode={() => toggleStudyMode(true)}
          settingsTrigger={
            <SettingsPopover
              trigger={
                <Button variant="ghost" size="icon" aria-label="تنظیمات خواندن" className="size-11 md:size-9">
                  <SlidersHorizontal className="size-4" />
                </Button>
              }
            />
          }
          highlightActive={!!hl}
          onClearHighlight={() => {
            const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
            q.delete("hl");
            q.delete("hlb");
            window.location.hash = `#/read/${documentUid}?${q.toString()}`;
          }}
          onPrev={prevRef ? () => gotoNeighbor(prevRef) : null}
          onNext={nextRef ? () => gotoNeighbor(nextRef) : null}
          saveIndicator={saveFlash ? <span className="text-xs text-muted-foreground">{saveFlash}</span> : null}
        />
      )}

      {/* banner اشتراک (§۷-الف-۳): مقصد دقیق با هایلایت/یادداشت اشتراکی */}
      {sharedUid ? (
        <div className="border-b border-border bg-primary/5 px-4 py-2">
          {sharedQuery.isPending ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> در حال بازکردن اشتراک…
            </p>
          ) : sharedQuery.isError ? (
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                {errorMessage(sharedQuery.error, "این اشتراک در دسترس نیست.")}
              </p>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={clearShared}>
                بستن
              </Button>
            </div>
          ) : sharedQuery.data ? (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Share2 className="size-3.5 text-primary" aria-hidden="true" />
                  {sharedQuery.data.kind === "highlight" ? "هایلایت اشتراکی" : "یادداشت اشتراکی"} از{" "}
                  {sharedQuery.data.owner_name}
                  {sharedQuery.data.work_title ? ` — ${sharedQuery.data.work_title}` : ""}
                  {sharedQuery.data.page_label && sharedQuery.data.page_label !== "—"
                    ? `، صفحهٔ ${faNum(sharedQuery.data.page_label)}`
                    : ""}
                </p>
                {sharedQuery.data.kind === "note" ? (
                  <p className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2 text-[13px] leading-6">
                    {sharedQuery.data.payload}
                  </p>
                ) : null}
              </div>
              <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-[11px]" onClick={clearShared}>
                بستن
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* فهرست — دسکتاپ (در حالت مطالعه پنهان؛ از قرص شناور باز می‌شود) */}
        {!studyMode ? (
          <aside className="hidden w-72 shrink-0 border-e border-border lg:block xl:w-80">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-medium">فهرست و نشانک‌ها</span>
            </div>
            <div className="h-[calc(100%-2.6rem)] overflow-y-auto">{tocPanel}</div>
          </aside>
        ) : null}

        {/* فهرست — شیت (موبایل/تبلت + حالت مطالعه) */}
        <Sheet open={tocOpen} onOpenChange={setTocOpen}>
          <SheetContent side="right" className="w-80 p-0">
            <SheetHeader className="border-b border-border py-3">
              <SheetTitle className="text-sm">فهرست و نشانک‌ها</SheetTitle>
            </SheetHeader>
            <div className="h-[calc(100%-3.4rem)] overflow-y-auto">{tocPanel}</div>
          </SheetContent>
        </Sheet>

        {/* سطح اصلی متن — دو حالت نمایش */}
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto bg-reader" aria-label="متن کتاب">
          {continuous ? (
            /* ---------- پیوسته: همهٔ صفحه‌ها پشت‌سرهم ---------- */
            <div className="mx-auto max-w-[760px] py-4">
              {pageRefs.map((ref) => {
                const payload = payloadByUid[ref.page_uid];
                const q = pagesQueries[pageRefs.indexOf(ref)];
                return (
                  <section
                    key={ref.page_uid}
                    id={`pgsec-${ref.page_uid}`}
                    data-page-uid={ref.page_uid}
                    className="scroll-mt-2 border-b border-dashed border-border/70 pb-6 mb-6 last:border-b-0"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-4 md:px-8">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        صفحهٔ چاپی {faNum(ref.label)}
                      </span>
                      {payload?.overlay_applied ? (
                        <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-[10px] text-foreground">
                          شامل اصلاح سامانه
                        </span>
                      ) : null}
                    </div>
                    {payload ? (
                      renderPage(payload, { flashHere: true })
                    ) : q?.isError ? (
                      <div className="mx-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-center text-xs text-destructive md:mx-8">
                        بازکردن این صفحه ممکن نشد.
                        <div>
                          <Button variant="outline" size="sm" className="mt-2" onClick={() => void q.refetch()}>
                            تلاش دوباره
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mx-4 space-y-3 md:mx-8" aria-busy="true">
                        <Skeleton className="h-5 w-1/2" />
                        <Skeleton className="h-32 w-full" />
                        <span className="sr-only">در حال بارگیری صفحهٔ {ref.label}…</span>
                      </div>
                    )}
                  </section>
                );
              })}
              <p className="pb-8 text-center text-xs text-muted-foreground">
                پایان این جلد — {faNum(pageRefs.length)} صفحه
              </p>
            </div>
          ) : (
            /* ---------- صفحه‌محور: یک صفحه در هر نما ---------- */
            <>
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
                  {renderPage(pageQuery.data, { flashHere: true })}
                  {/* ناوبری پایین صفحه — فقط در حالت صفحه‌محور */}
                  <div className="mx-auto flex max-w-[760px] items-center justify-between px-4 pb-10 pt-2">
                    {prevRef ? (
                      <Button variant="outline" size="sm" onClick={() => gotoNeighbor(prevRef)}>
                        <ChevronRight className="size-4" /> صفحهٔ قبل ({prevRef.label})
                      </Button>
                    ) : <span />}
                    {nextRef ? (
                      <Button variant="outline" size="sm" onClick={() => gotoNeighbor(nextRef)}>
                        صفحهٔ بعد ({nextRef.label}) <ChevronLeft className="size-4" />
                      </Button>
                    ) : <span />}
                  </div>
                </>
              )}
            </>
          )}
        </main>

        {/* پنل زمینه — دسکتاپ (در حالت مطالعه پنهان) */}
        {!studyMode ? (
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
                  pageLabel={activePayload?.label ?? null}
                  hadithScope={hadithNoteScope}
                  onClearHadithScope={() => setHadithNoteScope(null)}
                  onJumpToPage={(pg) => goToPage(pg)}
                  workTitle={work.title}
                  anchorStatus={anchorStatus}
                />
              ) : footnote ? (
                <FootnotePanel
                  data={footnote}
                  onBack={() => setFootnote(null)}
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

      {/* پاورقی — فقط زیر xl و بیرون از حالت مطالعه: sheet پایین.
          نکته: محتوای Sheet در body پرتال می‌شود؛ xl:hidden روی والدِ آن
          اثری ندارد — پس رندر شیت باید صریحاً به isCompact مقید باشد. */}
      {footnote && isCompact && !studyMode ? (
        <Sheet open={!!footnote} onOpenChange={(o) => !o && setFootnote(null)}>
          <SheetContent side="bottom" className="max-h-[60vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="text-sm">پاورقی / ارجاع</SheetTitle>
            </SheetHeader>
            <FootnotePanel
              data={footnote}
              onBack={() => setFootnote(null)}
              onHadithLookup={setHadithLookupUid}
              documentUid={documentUid}
              onHadithFiche={onHadithFiche}
              onHadithNote={(localUid, revayatIndex) => {
                setHadithNoteScope({ localUid, revayatIndex });
                setFootnote(null);
                setNotesSheetOpen(true);
              }}
            />
          </SheetContent>
        </Sheet>
      ) : null}

      {/* پاورقی/زمینه در حالت مطالعه — شیتِ کناری (دسکتاپ) یا پایین (موبایل) */}
      {footnote && studyMode ? (
        <Sheet open={studyCtxOpen} onOpenChange={(o) => !o && setFootnote(null)}>
          <SheetContent
            side={isCompact ? "bottom" : "left"}
            className={
              isCompact
                ? "max-h-[60vh] overflow-y-auto"
                : "h-full w-[24rem] overflow-y-auto p-0 sm:max-w-none"
            }
          >
            <SheetHeader className="border-b border-border py-3">
              <SheetTitle className="text-sm">پاورقی / ارجاع</SheetTitle>
            </SheetHeader>
            <div className={isCompact ? "" : "h-[calc(100%-3.4rem)] overflow-y-auto"}>
              <FootnotePanel
                data={footnote}
                onBack={() => setFootnote(null)}
                onHadithLookup={setHadithLookupUid}
                documentUid={documentUid}
                onHadithFiche={onHadithFiche}
                onHadithNote={(localUid, revayatIndex) => {
                  setHadithNoteScope({ localUid, revayatIndex });
                  setFootnote(null);
                  setNotesSheetOpen(true);
                }}
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
              یادداشت‌های این سند
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <NotesPanel
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
          if (studyMode || isCompact) {
            setNotesSheetOpen(true);
          } else {
            setCtxTab("notes");
          }
        }}
      />

      {/* دکمه‌های شناور برای موبایل — در حالت مطالعه قرصِ مینیمال جایگزین می‌شود */}
      {!studyMode ? (
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
          aria-label="خروجی PDF"
          title="خروجی PDF از این کتاب"
          className="size-11 rounded-full bg-surface"
          onClick={() => setPdfOpen(true)}
        >
          <FileDown className="size-4" />
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
        <Button
          size="icon"
          variant="outline"
          aria-label="حالت مطالعهٔ مینیمال"
          title="حالت مطالعه: صفحهٔ مینیمال با آیکون‌های فهرست و یادداشت"
          className="size-11 rounded-full bg-surface"
          onClick={() => toggleStudyMode(true)}
        >
          <BookOpenCheck className="size-4" />
        </Button>
      </div>
      ) : null}

      {/* حالت مطالعهٔ مینیمال — قرص شناور: فهرست / یادداشت‌ها / تنظیمات / خروج */}
      {studyMode ? (
        <div
          className="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface/95 p-1.5 shadow-lg backdrop-blur md:bottom-6"
          role="toolbar"
          aria-label="ابزار حالت مطالعه"
        >
          <Button
            size="icon"
            variant="ghost"
            aria-label="فهرست و نشانک‌ها"
            title="فهرست و نشانک‌ها"
            className="size-10 rounded-full"
            onClick={() => setTocOpen(true)}
          >
            <List className="size-4.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`یادداشت‌ها${docNoteCount > 0 ? ` (${faNum(docNoteCount)})` : ""}`}
            title="یادداشت‌ها و هایلایت‌ها"
            className="size-10 rounded-full"
            onClick={() => setNotesSheetOpen(true)}
          >
            <span className="relative">
              <StickyNote className="size-4.5" />
              {docNoteCount > 0 ? (
                <span className="absolute -end-1.5 -top-1.5 min-w-3.5 rounded-full bg-primary px-0.5 text-center text-[9px] font-bold leading-3.5 text-primary-foreground">
                  {faNum(docNoteCount)}
                </span>
              ) : null}
            </span>
          </Button>
          <SettingsPopover
            trigger={
              <Button
                size="icon"
                variant="ghost"
                aria-label="تنظیمات خواندن"
                title="تنظیمات خواندن (قلم/اندازه/حالت نمایش)"
                className="size-10 rounded-full"
              >
                <SlidersHorizontal className="size-4.5" />
              </Button>
            }
          />
          <div aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
          <Button
            size="icon"
            variant="ghost"
            aria-label="خروج از حالت مطالعه"
            title="خروج از حالت مطالعه (Esc)"
            className="size-10 rounded-full text-primary hover:bg-primary/10"
            onClick={() => toggleStudyMode(false)}
          >
            <Minimize2 className="size-4.5" />
          </Button>
        </div>
      ) : null}
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
