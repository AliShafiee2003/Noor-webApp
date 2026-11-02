"use client";

/**
 * دادهٔ مشترک کتاب‌خوان — استخراج خالص از reader-view.tsx (فاز ۱ ریدر موبایل).
 * دسکتاپ و موبایل هر دو از همین هوک می‌خورند تا رفتار سروری بیت‌به‌بیت یکی بماند.
 * فقط داده و ناوبری؛ وضعیت‌های صرفاً نمایشی (پنل‌ها/شیت‌ها) در نماها می‌مانند.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureReaderLocation, restoreReaderLocation, useReaderNavigation, type ReaderLocation } from "@/lib/reader/navigation";
import { api } from "@/lib/api";
import { decoratePathWithSlug, readHref } from "@/lib/href";
import { pgTerm, useRoute } from "@/lib/hash-router";
import type {
  Bookmark as BookmarkT,
  Highlight as HighlightT,
  Note as NoteT,
  PagePayload,
  PageRef,
  SearchScope,
  SearchResultItem,
  SharedItem,
  TocSection,
  WorkDetail,
} from "@/lib/types";
import { blockOffsets } from "@/lib/types";
import { normalizeOffsets } from "@/components/search/result-card";
import { buildPageMarks, groupHighlights, markNoteCount, type PageMark } from "@/lib/reader/marks";

export function parseHighlight(raw: string | null): [number, number] | null {
  if (!raw) return null;
  const parts = raw.split(":");
  const s = Number.parseInt(parts[0] ?? "", 10);
  const e = Number.parseInt(parts[1] ?? "", 10);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return [s, e];
}

export interface UseReaderDataOptions {
  documentUid: string;
  /** حالت نمایش مشترک از ترجیحات مطالعه */
  display: "paged" | "continuous";
  isCompact: boolean;
  /** پس از پرش goToPage — دسکتاپ: بستن پاورقی (openFootnote(null)) */
  onNavigated?: () => void;
  /** گذار نمایش صفحه‌محور↔پیوسته — دسکتاپ: resetPageScoped() */
  onDisplaySwitched?: () => void;
  /** پس از پرش فهرست — دسکتاپ: بستن شیت فهرست */
  onAfterTocJump?: () => void;
  /** پس از اجرای جست‌وجو — دسکتاپ: ctxTab="search" */
  onSearchExecuted?: () => void;
  /** پس از پاک‌کردن جست‌وجو — دسکتاپ: بازگرداندن ctxTab */
  onSearchCleared?: () => void;
  /** موبایل: دادهٔ اضافی موضع خواندن (مثلاً {sub}) — در PUT /workspace/position ادغام می‌شود */
  getPositionExtra?: () => Record<string, unknown> | undefined;
  /** میزبان اسکرول پیوسته — نمای موبایل ریف خودش را می‌دهد (پیش‌فرض: ریف داخلی برای دسکتاپ) */
  scrollHostRef?: RefObject<HTMLElement | null>;
}

export type ReaderData = ReturnType<typeof useReaderData>;

export function useReaderData(options: UseReaderDataOptions) {
  const { documentUid, display, isCompact } = options;
  const queryClient = useQueryClient();
  const navigation = useReaderNavigation();
  const [restoreTarget, setRestoreTarget] = useState<ReaderLocation | null>(null);
  /* پل‌های UI همیشه تازه — کال‌بک‌های رویدادی از optionsRef می‌خوانند؛
     همگام‌سازی پس از هر رندر (پیش از هر رویداد کاربر اجرا شده است). */
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  /* ---------- پارامترهای نشانی: صفحهٔ فعلی و highlight نتیجه ----------
     فاز ۲ (دور ۱۸-فیکس ۱۲): منبع پارامترها query روترِ مسیر واقعی است
     (بدون hash). replaceStateِ ردیاب اسکرول عمداً route را نو نمی‌کند، پس
     فقط ناوبری واقعی ویرایش مقصد را تازه می‌کند. */
  const { route, navigate } = useRoute();
  const params = useMemo(() => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(route.query)) sp.set(k, v);
    return sp;
  }, [route.query]);
  /* گارد اسکرول خودکار پیوسته — با هر ناوبری واقعی ریست می‌شود */
  const lastAutoScrollRef = useRef<string | null>(null);
  useEffect(() => {
    lastAutoScrollRef.current = null;
  }, [params]);
  const requestedPgRaw = params.get("pg") || null;
  const sharedUid = params.get("shared");
  const hl = parseHighlight(params.get("hl"));

  /* ---------- داده‌ها ---------- */
  const workQuery = useQuery({
    queryKey: ["reader-work", documentUid],
    queryFn: async () => {
      // ۱. استعلام مستقیم O(1) از اندپوینت سند
      try {
        return await api.get<WorkDetail>(`/documents/${encodeURIComponent(documentUid)}/work`);
      } catch {
        // ۲. استخراج شناسه اثر از شناسه سند: d-disc-series-doc -> w-disc-series
        const parts = documentUid.split("-");
        if (parts.length >= 3 && parts[0] === "d") {
          const derivedWorkUid = `w-${parts[1]}-${parts[2]}`;
          try {
            /* UIDهای این کتابخانه ممکن است «#» داشته باشند — قطعهٔ مسیر باید انکود شود.
               (دور ۱۸: سند d-00166-#17611_001_08-… بدون انکود، fetch در «#» قطع می‌شود
               و پیام نادرست «سند موجود نیست» برمی‌گردد.) */
            return await api.get<WorkDetail>(`/works/${encodeURIComponent(derivedWorkUid)}`);
          } catch {
            // ادامه
          }
        }
        throw new Error("این سند در کتابخانهٔ موجود نیست.");
      }
    },
    retry: false,
  });

  /* فاز رسانه: فرمت سند از کاتالوگ — text | pdf | image | audio (null تا رسیدن work) */
  const docFormat = workQuery.data?.documents.find((d) => d.uid === documentUid)?.format ?? null;
  const isPdfDoc = docFormat === "pdf";

  const tocQuery = useQuery({
    queryKey: ["reader-toc", documentUid],
    queryFn: () =>
      api.get<{ sections: TocSection[]; release_uid: string }>(
        `/documents/${encodeURIComponent(documentUid)}/toc`,
      ),
    retry: false,
    enabled: docFormat === "text",
  });

  const pagesQuery = useQuery({
    queryKey: ["reader-pages", documentUid],
    queryFn: () =>
      api.get<{ items: PageRef[] }>(`/documents/${encodeURIComponent(documentUid)}/pages`),
    retry: false,
    enabled: docFormat === "text",
  });

  /* سند اسکن‌شده: فهرست صفحه‌ها از خود pdf (numPages) ساخته می‌شود —
     PageRef مصنوعی p-001… تا PageJump/قبلی/بعدی/دیپ‌لینک ?pg=N بدون تغییر کار کنند */
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const pdfPageRefs = useMemo<PageRef[]>(() => {
    if (!isPdfDoc || pdfPageCount <= 0) return [];
    return Array.from({ length: pdfPageCount }, (_, i) => {
      const n = i + 1;
      const uid = `p-${String(n).padStart(3, "0")}`;
      return { page_uid: uid, label: String(n), serial: n, ambiguous: false, num: String(n) };
    });
  }, [isPdfDoc, pdfPageCount]);

  const pageRefs: PageRef[] = isPdfDoc ? pdfPageRefs : (pagesQuery.data?.items ?? []);

  /* فاز ۲: pg در نشانی عددی است (pg=16) — شمارهٔ صفحه به uid همان سند ترجمه
     می‌شود (p-016). uidهای غیرعددی (p-front و مانند آن) خام می‌گذرند. */
  const requestedPageUid = useMemo(() => {
    if (!requestedPgRaw) return null;
    if (/^p-(\d+)$/.test(requestedPgRaw)) return requestedPgRaw;
    const n = Number.parseInt(requestedPgRaw, 10);
    if (!Number.isFinite(n)) return requestedPgRaw;
    const match = pageRefs.find((r) => {
      const m = /^p-(\d+)$/.exec(r.page_uid);
      return m !== null && Number.parseInt(m[1], 10) === n;
    });
    return match?.page_uid ?? null;
  }, [requestedPgRaw, pageRefs]);

  /* موضع ذخیره‌شدهٔ مطالعه (READ-12) */
  const positionQuery = useQuery({
    queryKey: ["workspace-position", documentUid],
    queryFn: () => api.get<{ positions: Record<string, { page_uid?: string; sub?: number; block_id?: string; offset_cp?: number }> }>("/workspace"),
    staleTime: 10_000,
  });

  /* صفحهٔ هدف: از hash یا ادامهٔ مطالعه (بازیابی موضع — READ-12).
     مشتق در رندر؛ بدون setState در افکت (STAB-02). */
  const savedPosUid = positionQuery.data?.positions?.[documentUid]?.page_uid;
  const derivedFallback = useMemo(() => {
    if (savedPosUid && pageRefs.some((p) => p.page_uid === savedPosUid)) return savedPosUid;
    return pageRefs[0]?.page_uid ?? null;
  }, [savedPosUid, pageRefs]);

  /* صفحهٔ فعلی در حالت پیوسته — با اسکرول به‌روز می‌شود */
  const [contCurrentUid, setContCurrentUid] = useState<string | null>(null);
  const contCurrentRef = useRef<string | null>(null);

  /* بازگشت از پیوسته به صفحه‌محور: از جایی که بودیم ادامه بده.
     شناسایی گذار display در خودِ رندر (الگوی state-derive)، بدون افکت setState. */
  const [returnToUid, setReturnToUid] = useState<string | null>(null);
  const prevDisplayRef = useRef(display);
  /* eslint-disable react-hooks/refs -- الگوی مستند «تغییر state هنگام رندر» از reader-view اصلی */
  if (prevDisplayRef.current !== display) {
    prevDisplayRef.current = display;
    if (display === "paged" && contCurrentRef.current) {
      setReturnToUid(contCurrentRef.current);
    }
    options.onDisplaySwitched?.();
  }
  /* eslint-enable react-hooks/refs */
  const fallbackPageUid = returnToUid ?? derivedFallback;

  /* ---------- حالت پیوسته: پنجرهٔ اسکرول (STAB-01) ----------
     قبل: همهٔ صفحه‌های جلد همزمان استعلام می‌شدند (تا ~۴۷۰ درخواست موازی،
     مرورگر و API را قفل می‌کرد). حالا فقط صفحه‌های نزدیکِ موضع فعال
     می‌شوند: ۲ صفحه عقب + ۱۳ صفحه جلو. کش و staleTime ۵ دقیقه حفظ است،
     پس متنِ بارگذاری‌شده هنگام خارج‌شدن از پنجره محو نمی‌شود. */
  /* در سند اسکن‌شده همیشه صفحه‌محور است — pdf.js صفحه‌به‌صفحه رندر می‌کند */
  const continuous = display === "continuous" && !isPdfDoc;
  const CONT_WINDOW_BEFORE = 2;
  const CONT_WINDOW_AFTER = 12;
  const contFocusedUid = contCurrentUid ?? requestedPageUid ?? fallbackPageUid;
  const contWindow = useMemo(() => {
    if (!continuous) return new Set<string>();
    const idx = contFocusedUid
      ? pageRefs.findIndex((r) => r.page_uid === contFocusedUid)
      : -1;
    const at = idx >= 0 ? idx : 0;
    const from = Math.max(0, at - CONT_WINDOW_BEFORE);
    const to = Math.min(pageRefs.length, at + 1 + CONT_WINDOW_AFTER);
    return new Set(pageRefs.slice(from, to).map((r) => r.page_uid));
  }, [continuous, contFocusedUid, pageRefs]);

  const pagesQueries = useQueries({
    queries: (continuous ? pageRefs : []).map((ref) => ({
      queryKey: ["reader-page", documentUid, ref.page_uid],
      queryFn: () => api.get<PagePayload>(
        `/documents/${encodeURIComponent(documentUid)}/pages/${encodeURIComponent(ref.page_uid)}`,
      ),
      retry: false,
      enabled: continuous && contWindow.has(ref.page_uid),
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

  const currentPageUid =
    display === "continuous"
      ? contCurrentUid ?? requestedPageUid ?? fallbackPageUid
      : requestedPageUid ?? fallbackPageUid;

  /* حالت صفحه‌محور: پود صفحهٔ فعلی (فقط سند متنی — pdf صفحهٔ متنی ندارد) */
  const pageQuery = useQuery({
    queryKey: ["reader-page", documentUid, currentPageUid],
    enabled: !continuous && !!currentPageUid && docFormat === "text",
    queryFn: () =>
      api.get<PagePayload>(
        `/documents/${encodeURIComponent(documentUid)}/pages/${encodeURIComponent(currentPageUid)}`,
      ),
    retry: false,
  });

  /* شمارهٔ یک‌مبنای صفحهٔ فعلی برای نمایشگر PDF */
  const pdfPageNum = useMemo(() => {
    if (!isPdfDoc) return 1;
    const m = currentPageUid ? /^p-(\d+)$/.exec(currentPageUid) : null;
    const n = m ? Number.parseInt(m[1], 10) : 0;
    return n > 0 ? n : 1;
  }, [isPdfDoc, currentPageUid]);

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
  const notes = notesCountQuery.data?.items ?? [];

  /* ---------- §۷-الف-۳: هایلایت‌های شخصی ---------- */
  const annotationsQuery = useQuery({
    queryKey: ["annotations", documentUid],
    queryFn: () => api.get<{ items: HighlightT[] }>("/annotations", { document_uid: documentUid }),
    staleTime: 30_000,
    retry: false,
  });
  const annotations = annotationsQuery.data?.items ?? [];

  /* ---------- نشانه‌ها: نشانک صریح ∪ یادداشت صفحه ∪ هایلایتِ یادداشت‌دار ---------- */
  const { pageMarks, documentNotes } = useMemo(
    () =>
      buildPageMarks({
        bookmarks: (bookmarksQuery.data?.items ?? []).filter((b) => b.document_uid === documentUid),
        notes,
        annotations,
        pageRefs,
      }),
    [bookmarksQuery.data, documentUid, notes, annotations, pageRefs],
  );
  const markedPageUids = useMemo(() => new Set(pageMarks.map((m) => m.pageUid)), [pageMarks]);
  const markedPagesCount = pageMarks.length;

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

  /* کلیک روی هر قطعهٔ انتخاب چندپاراگرافی، ویرایشگر متن کامل (لنگر گروه) را باز می‌کند. */
  const highlightAnchorByUid = useMemo(() => {
    const map: Record<string, string> = {};
    for (const group of groupHighlights(annotations)) {
      for (const segment of group.segments) map[segment.uid] = group.uid;
    }
    return map;
  }, [annotations]);

  /* ---------- §۷-الف-۳: اشتراک — banner + هایلایت اشتراکی ---------- */
  const sharedQuery = useQuery({
    queryKey: ["shared", sharedUid],
    queryFn: () => api.get<SharedItem>(`/shares/${sharedUid}`),
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
      color: (m.color ?? "yellow") as import("@/lib/types").HighlightColor,
    };
  }, [sharedQuery.data, sharedUid]);
  const sharedHlPageUid = sharedHl ? blockPage[sharedHl.block_id] ?? null : null;
  const displayHlsByPage = useMemo(() => {
    if (!sharedHl || !sharedHlPageUid) return userHlsByPage;
    return { ...userHlsByPage, [sharedHlPageUid]: [...(userHlsByPage[sharedHlPageUid] ?? []), sharedHl] };
  }, [userHlsByPage, sharedHl, sharedHlPageUid]);
  const deleteBookmark = useCallback(async (uid: string) => {
    await api.del(`/bookmarks/${encodeURIComponent(uid)}`);
    queryClient.setQueryData<{ items: BookmarkT[] }>(["reader-bookmarks"], (old) => ({ items: (old?.items ?? []).filter((b) => b.uid !== uid) }));
  }, [queryClient]);

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
    /* فاز ۲: پاک‌سازی پارامتر shared — بازآری replace؛ بدون نویز رسانهٔ router */
    const kept: Record<string, string> = {};
    params.forEach((v, k) => {
      if (k !== "shared") kept[k] = v;
    });
    navigate(readHref(documentUid), kept, { replace: true });
  }, [documentUid, navigate, params]);

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

  /* نگاشت بلوک→سطح تیتر برای استایل‌دهی سلسله‌مراتبی */
  // فاز ۲: با رسیدن نام اثر، path نام‌دار می‌شود (کدگشا در نوار آدرس؛ بی‌رویداد)
  useEffect(() => {
    const title = workQuery.data?.title;
    if (!title) return;
    decoratePathWithSlug(title, "read");
  }, [workQuery.data, documentUid]);

  const sectionLevelByBlockId = useMemo(() => {
    const map: Record<string, number> = {};
    const walk = (secs: TocSection[]) => {
      for (const s of secs) {
        if (s.block_id && typeof s.level === "number") map[s.block_id] = s.level;
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

  /* برجسته‌سازی گذرای بلوک (پرش فهرست/جست‌وجو/نشانک) — مشترک دسکتاپ و موبایل */
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null);
  const captureLocation = useCallback(() => captureReaderLocation(documentUid, currentPageUid ?? ""), [documentUid, currentPageUid]);
  const captureRef = useRef(captureLocation);
  const lastLogicalRef = useRef<ReaderLocation | null>(null);
  useEffect(() => { captureRef.current = captureLocation; });
  const rememberLocation = useCallback(() => { const target = lastLogicalRef.current ?? captureRef.current(); if (target.page_uid) setRestoreTarget(target); }, []);
  const completeRestore = useCallback(() => setRestoreTarget(null), []);
  const recordHistory = navigation.record;


  /* ---------- پرش به صفحه (هر دو حالت) ----------
     حالت پیوسته: اسکرول فوری به بخش همان صفحه + به‌روزرسانی hash؛
     اگر hash همان pg را داشته باشد رویداد hashchange نمی‌آید، پس
     اسکرول را مستقیم انجام می‌دهیم (پرش به صفحهٔ فعلی هم جابه‌جا می‌شود). */
  const goToPage = useCallback(
    (pageUid: string, extra: Record<string, string> = {}, record = true) => {
      if (record) recordHistory(captureLocation());
      if (continuous) {
        const el = document.getElementById(`pgsec-${pageUid}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          contCurrentRef.current = pageUid;
          setContCurrentUid(pageUid);
        }
      }
      const q: Record<string, string> = { pg: pageUid, ...extra };
      // فاز ۲ (دور ۱۸-فیکس ۱۲): روتر pg را عددی می‌کند (p-016 → 16)؛ uid در query d
      navigate(readHref(documentUid), q);
      optionsRef.current.onNavigated?.();
    },
     
    [continuous, documentUid, navigate, captureLocation, recordHistory],
  );

  const stepHistory = useCallback((direction: "back" | "fwd") => {
    const target = navigation.step(direction, captureLocation());
    if (!target) return;
    if (target.document_uid !== documentUid) {
      try { sessionStorage.setItem("noor:reader-restore", JSON.stringify(target)); } catch { /* optional */ }
      navigate(readHref(target.document_uid), { pg: target.page_uid });
    } else {
      goToPage(target.page_uid, {}, false);
      setRestoreTarget(target);
    }
  }, [navigation, captureLocation, documentUid, navigate, goToPage]);
  const initialRestore = useRef(false);
  useEffect(() => {
    if (initialRestore.current || !positionQuery.isSuccess || !currentPageUid) return;
    initialRestore.current = true;
    let target: ReaderLocation | null = null;
    try {
      const stored = JSON.parse(sessionStorage.getItem("noor:reader-restore") ?? "null") as ReaderLocation | null;
      if (stored?.document_uid === documentUid) { target = stored; sessionStorage.removeItem("noor:reader-restore"); }
    } catch { /* optional */ }
    const saved = positionQuery.data.positions?.[documentUid];
    if (!target && saved?.block_id && saved.page_uid === currentPageUid) target = { document_uid: documentUid, page_uid: currentPageUid, block_id: saved.block_id, offset_cp: saved.offset_cp };
    if (target) { const timer = setTimeout(() => setRestoreTarget(target), 0); return () => clearTimeout(timer); }
  }, [positionQuery.isSuccess, positionQuery.data, currentPageUid, documentUid]);
  useEffect(() => {
    if (!restoreTarget || restoreTarget.document_uid !== documentUid) return;
    const timer = setTimeout(() => {
      if (document.querySelector(".rm-pages-view")) return; // mobile pagination restores after its measurements
      if (restoreReaderLocation(restoreTarget)) setRestoreTarget(null);
    }, 120);
    return () => clearTimeout(timer);
  }, [restoreTarget, documentUid, allPayloads, display]);

  /* اسکرول به صفحهٔ مقصد در حالت پیوسته — فقط یک بار برای هر مقصد.
     ریشهٔ باگ «برگشت به بالا»: payloadByUid با رسیدن هر صفحه هویت تازه می‌گیرد
     و بدون این گارد، افکت هر بار به صفحهٔ درخواستی اسکرول می‌کرد.
     موضعِ state با ردیاب اسکرول (رویداد scroll) به‌روز می‌شود. */
  useEffect(() => {
    if (!continuous || !requestedPageUid) return;
    if (lastAutoScrollRef.current === requestedPageUid) return;
    if (!payloadByUid[requestedPageUid]) return; // هنوز بارگذاری نشده — با آماده‌شدن دوباره اجرا می‌شود
    const el = document.getElementById(`pgsec-${requestedPageUid}`);
    if (el) {
      lastAutoScrollRef.current = requestedPageUid;
      el.scrollIntoView({ behavior: "auto", block: "start" });
      contCurrentRef.current = requestedPageUid;
    }
  }, [continuous, requestedPageUid, payloadByUid]);

  /* ورود به حالت پیوسته: از موضع فعلی شروع کن (نه از ابتدای جلد).
     فقط اسکرول؛ setState موضع با ردیاب اسکرول به‌روز می‌شود (STAB-02). */
  const prevDisplayForScrollRef = useRef(display);
  useEffect(() => {
    if (prevDisplayForScrollRef.current === display) return;
    prevDisplayForScrollRef.current = display;
    if (display !== "continuous") return;
    const target = requestedPageUid ?? fallbackPageUid;
    if (!target) return;
    const id = window.setTimeout(() => {
      const el = document.getElementById(`pgsec-${target}`);
      if (el) {
        lastAutoScrollRef.current = target;
        el.scrollIntoView({ behavior: "auto", block: "start" });
        contCurrentRef.current = target;
      }
    }, 350);
    return () => window.clearTimeout(id);
  }, [display, requestedPageUid, fallbackPageUid]);

  /* ردیابی اسکرول در حالت پیوسته → صفحهٔ بالاییِ دید = موضع خواندن (READ-12) */
  const ownMainRef = useRef<HTMLElement | null>(null);
  const mainRef = options.scrollHostRef ?? ownMainRef;
  useEffect(() => {
    if (!continuous || !workQuery.isSuccess) return;
    const main = mainRef.current;
    if (!main) return;
    // Observe only the reading line, rather than synchronously measuring every page on scroll.
    const sections = main.querySelectorAll<HTMLElement>("[data-page-uid]");
    let observer: IntersectionObserver | null = null;
    const observe = () => {
      observer?.disconnect();
      const line = Math.min(96, Math.max(0, main.clientHeight - 1));
      observer = new IntersectionObserver((entries) => {
        if (requestedPageUid && lastAutoScrollRef.current !== requestedPageUid) return;
        const visible = entries.filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.boundingClientRect.top - a.boundingClientRect.top);
        const current = (visible[0]?.target as HTMLElement | undefined)?.dataset.pageUid;
        if (!current || current === contCurrentRef.current) return;
        contCurrentRef.current = current;
        setContCurrentUid(current);
        const q = new URLSearchParams(window.location.search);
        q.set("pg", pgTerm(current));
        window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
      }, { root: main, rootMargin: `-${line}px 0px -${Math.max(0, main.clientHeight - line - 1)}px 0px`, threshold: 0 });
      sections.forEach((section) => observer!.observe(section));
    };
    observe();
    const resize = new ResizeObserver(observe);
    resize.observe(main);
    return () => { observer?.disconnect(); resize.disconnect(); };
  }, [continuous, workQuery.isSuccess, pagesPendingCount === 0, requestedPageUid]);

  /* ---------- ذخیرهٔ موضع (READ-12) — PUT /workspace/position با debounce ----------
     موبایل: تغییر زیرصفحه با bumpPosition() همین debounce را بیدار می‌کند. */
  const [positionEpoch, setPosEpoch] = useState(0);
  const bumpPosition = useCallback(() => setPosEpoch((e) => e + 1), []);
  const putTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentPageUid || (continuous ? !payloadByUid[currentPageUid] : !pageQuery.isSuccess)) return;
    if (putTimer.current) clearTimeout(putTimer.current);
    putTimer.current = setTimeout(() => {
      void api.put("/workspace/position", {
        document_uid: documentUid,
        position: { ...captureRef.current(), progress: pageRefs.length > 1 ? pageRefs.findIndex((p) => p.page_uid === currentPageUid) / (pageRefs.length - 1) : 0, ...optionsRef.current.getPositionExtra?.() },
      });
    }, 900);
    return () => {
      if (putTimer.current) clearTimeout(putTimer.current);
    };
     
  }, [currentPageUid, continuous, payloadByUid, pageQuery.isSuccess, documentUid, positionEpoch]);

  useEffect(() => {
    const host = mainRef.current;
    if (!host || !currentPageUid) return;
    let timer: ReturnType<typeof setTimeout>;
    let captureTimer: ReturnType<typeof setTimeout>;
    const save = () => {
      clearTimeout(captureTimer);
      captureTimer = setTimeout(() => { lastLogicalRef.current = captureRef.current(); }, 100);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const position = captureRef.current();
        lastLogicalRef.current = position;
        void api.put("/workspace/position", { document_uid: documentUid, position: { ...position, ...optionsRef.current.getPositionExtra?.() } }).catch(() => {});
      }, 900);
    };
    host.addEventListener("scroll", save, { passive: true });
    return () => { clearTimeout(timer); clearTimeout(captureTimer); host.removeEventListener("scroll", save); };
  }, [mainRef, currentPageUid, documentUid, display]);

  /* ---------- نشانک / نشانه ---------- */
  const isBookmarked = currentPageUid ? markedPageUids.has(currentPageUid) : false;
  const [bookmarkPending, setBookmarkPending] = useState(false);
  const [pendingMarkDelete, setPendingMarkDelete] = useState<PageMark | null>(null);
  const [markDeletePending, setMarkDeletePending] = useState(false);

  const invalidateMarks = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reader-bookmarks"] }),
      queryClient.invalidateQueries({ queryKey: ["notes", documentUid] }),
      queryClient.invalidateQueries({ queryKey: ["annotations", documentUid] }),
    ]);
  }, [queryClient, documentUid]);

  const runDeletePageMark = useCallback(
    async (mark: PageMark) => {
      setMarkDeletePending(true);
      try {
        /* اول نشانک صریح؛ اگر نیامد یادداشت‌ها نباید یتیم حذف شوند */
        if (mark.bookmark) {
          await api.del(`/bookmarks/${encodeURIComponent(mark.bookmark.uid)}`);
        }
        const results = await Promise.allSettled([
          ...mark.notes.map((n) => api.del(`/notes/${encodeURIComponent(n.uid)}`)),
          ...mark.highlightNotes.map((g) => api.del(`/annotations/${encodeURIComponent(g.uid)}`)),
        ]);
        await invalidateMarks();
        if (results.some((r) => r.status === "rejected")) {
          throw new Error("نشانک حذف شد، اما برخی یادداشت‌های این صفحه حذف نشدند.");
        }
      } finally {
        setMarkDeletePending(false);
        setPendingMarkDelete(null);
      }
    },
    [invalidateMarks],
  );

  const requestDeletePageMark = useCallback(
    (pageUid: string): Promise<void> => {
      const mark = pageMarks.find((m) => m.pageUid === pageUid);
      if (!mark || markDeletePending) return Promise.resolve();
      /* ۰ یا ۱ یادداشت: حذف همراه نشانک؛ ۲ و بیشتر: تأیید صریح */
      if (markNoteCount(mark) >= 2) {
        setPendingMarkDelete(mark);
        return Promise.resolve();
      }
      return runDeletePageMark(mark);
    },
    [pageMarks, markDeletePending, runDeletePageMark],
  );

  const confirmMarkDelete = useCallback(() => {
    const mark = pendingMarkDelete;
    if (!mark) return Promise.resolve();
    return runDeletePageMark(mark);
  }, [pendingMarkDelete, runDeletePageMark]);
  const cancelMarkDelete = useCallback(() => setPendingMarkDelete(null), []);

  const jumpToMark = useCallback(
    (mark: PageMark): boolean => {
      const anchor = mark.highlightNotes[0]?.anchor ?? null;
      const missing = !!anchor && anchorStatus[anchor.uid] === "missing";
      const blockId = missing ? null : anchor?.block_id ?? null;
      const flash = () => {
        if (!blockId) return;
        const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setFlashBlockId(blockId);
        window.setTimeout(() => setFlashBlockId(null), 1800);
      };
      if (mark.pageUid !== currentPageUid) {
        goToPage(mark.pageUid);
        if (blockId) window.setTimeout(flash, 450);
      } else {
        flash();
      }
      return !missing;
    },
    [anchorStatus, currentPageUid, goToPage],
  );

  const toggleBookmark = useCallback(async () => {
    if (!currentPageUid || bookmarkPending || markDeletePending) return;
    setBookmarkPending(true);
    try {
      if (isBookmarked) {
        await requestDeletePageMark(currentPageUid);
      } else {
        await api.post("/bookmarks", {
          document_uid: documentUid,
          page_uid: currentPageUid,
          label: activePayload?.label ?? "",
        });
        await invalidateMarks();
      }
    } finally {
      setBookmarkPending(false);
    }
  }, [currentPageUid, bookmarkPending, markDeletePending, isBookmarked, requestDeletePageMark, documentUid, activePayload?.label, invalidateMarks]);

  /* ---------- جست‌وجو در متن همین کتاب (SEARCH-09) ---------- */
  const workUid = workQuery.data?.uid;
  const [inBookSearchQuery, setInBookSearchQuery] = useState("");
  const [inBookSearchScope, setSearchScope] = useState<"work" | "document">("document");
  const [ignoreSpacing, setIgnoreSpacingState] = useState(false);
  const [selectedSearchPassageUid, setSelectedSearchPassageUid] = useState<string | null>(null);
  const setInBookSearchScope = useCallback((scope: "work" | "document") => { setSearchScope(scope); setSelectedSearchPassageUid(null); }, []);
  const setIgnoreSpacing = useCallback((value: boolean) => { setIgnoreSpacingState(value); setSelectedSearchPassageUid(null); }, []);
  /* شیت/پنل نتایج جست‌وجو — دسکتاپ: Sheet پایین؛ موبایل: پنل سراسری */
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  const inBookSearch = useQuery({
    queryKey: ["reader-inbook-search", workUid, inBookSearchScope, documentUid, inBookSearchQuery.trim(), ignoreSpacing],
    queryFn: async ({ signal }) => {
      const q = inBookSearchQuery.trim();
      if (!q || !workUid) return null;
      const scopeObj: SearchScope =
        inBookSearchScope === "document"
          ? { target: "document", document_uids: [documentUid], work_uid: workUid }
          : { target: "work", work_uid: workUid };

      return await api.post<import("@/lib/types").SearchResponse>("/search", {
        query: q,
        mode: "normalized_phrase",
        ignore_spacing: ignoreSpacing,
        scope: scopeObj,
        page_size: 100,
      }, undefined, signal);
    },
    enabled: Boolean(inBookSearchQuery.trim() && workUid),
    staleTime: 60_000,
  });

  const handleExecuteSearch = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setInBookSearchQuery(trimmed);
      setSelectedSearchPassageUid(null);
      setSearchSheetOpen(isCompact);
      optionsRef.current.onSearchExecuted?.();
    },
     
    [isCompact],
  );

  const handleClearSearch = useCallback(() => {
    setInBookSearchQuery("");
    setSelectedSearchPassageUid(null);
    setSearchSheetOpen(false);
    optionsRef.current.onSearchCleared?.();
     
  }, []);

  const handleSelectSearchResult = useCallback(
    (item: SearchResultItem) => {
      setSelectedSearchPassageUid(item.passage_uid);
      const offsets =
        normalizeOffsets(item.match_offsets) ??
        normalizeOffsets(item.source_offsets);
      const hlParam = offsets ? `${offsets.start}:${offsets.end}` : undefined;

      // اگر نتیجه در جلد/سند دیگری از همین اثر است:
      if (item.document?.uid && item.document.uid !== documentUid) {
        recordHistory(captureLocation());
        // فاز ۲: فرم روت؛ روتر pg را عددی و مسیر را با نام اثر می‌سازد
        navigate(
          readHref(item.document.uid),
          {
            ...(item.page?.uid ? { pg: item.page.uid } : {}),
            ...(hlParam ? { hl: hlParam } : {}),
          },
          { slug: workQuery.data?.title },
        );
        if (isCompact) setSearchSheetOpen(false);
        return;
      }

      // در همین سند:
      if (item.page?.uid) {
        goToPage(item.page.uid, {
          ...(hlParam ? { hl: hlParam } : {}),
        });

        // اسکرول و برجسته‌سازی بلوک
        if (offsets) {
          const payload =
            payloadByUid[item.page.uid] ??
            (pageQuery.data?.page_uid === item.page.uid ? pageQuery.data : null);
          if (payload) {
            const matchingBlock = payload.blocks.find((b) => {
              const range = blockOffsets(b);
              return range && offsets.start >= range.start && offsets.start < range.end;
            });
            if (matchingBlock) {
              setFlashBlockId(matchingBlock.id);
              window.setTimeout(() => setFlashBlockId(null), 2500);
              window.setTimeout(() => {
                const el = document.querySelector<HTMLElement>(`[data-block-id="${matchingBlock.id}"]`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              }, 300);
            }
          }
        }
      }
      if (isCompact) setSearchSheetOpen(false);
    },
     
    [documentUid, goToPage, isCompact, payloadByUid, pageQuery.data, navigate, workQuery.data?.title, recordHistory, captureLocation],
  );

  /* ---------- پرش فهرست مطالب (دسکتاپ + موبایل) ---------- */
  const onJumpSection = useCallback(
    (s: TocSection) => {
      optionsRef.current.onAfterTocJump?.();
      // ۱. تعیین صفحهٔ مقصد
      let targetPageUid: string | undefined = s.page_uid || undefined;
      const blockId: string | undefined = s.block_id || undefined;

      if (!targetPageUid && blockId && blockPage[blockId]) {
        targetPageUid = blockPage[blockId];
      }
      if (!targetPageUid && s.page_label) {
        const match = pageRefs.find((p) => p.label === s.page_label || p.num === s.page_label);
        if (match) targetPageUid = match.page_uid;
      }

      // ۲. در صورتی که صفحه نیاز به تغییر دارد:
      if (targetPageUid && targetPageUid !== currentPageUid) {
        goToPage(targetPageUid);
        if (blockId) {
          window.setTimeout(() => {
            const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "start" });
              setFlashBlockId(blockId);
              window.setTimeout(() => setFlashBlockId(null), 1800);
            }
          }, 450);
        }
        return;
      }

      // ۳. اگر در همین صفحه است، اسکرول و برجسته‌سازی
      if (blockId) {
        const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          setFlashBlockId(blockId);
          window.setTimeout(() => setFlashBlockId(null), 1800);
        } else if (activePayload?.blocks.some((b) => b.id === blockId)) {
          setFlashBlockId(blockId);
          window.setTimeout(() => setFlashBlockId(null), 1800);
        }
      }
    },
     
    [blockPage, currentPageUid, goToPage, activePayload, pageRefs],
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
          recordHistory(captureLocation());
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          contCurrentRef.current = ref.page_uid;
          setContCurrentUid(ref.page_uid);
        }
      } else {
        goToPage(ref.page_uid);
      }
    },
    [continuous, goToPage, recordHistory, captureLocation],
  );

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

  /* ---------- حالت‌های خطا ---------- */
  const errMsg =
    workQuery.error instanceof Error
      ? workQuery.error.message
      : pagesQuery.error instanceof Error
        ? pagesQuery.error.message
        : "";
  const pagesUnavailable = pagesQuery.isError && !workQuery.isError;

  return {
    /* مسیر و پارامترها */
    route,
    navigate,
    params,
    requestedPgRaw,
    sharedUid,
    hl,
    /* دادهٔ پایه */
    workQuery,
    work: workQuery.data ?? null,
    docFormat,
    isPdfDoc,
    tocQuery,
    pagesQuery,
    pdfPageCount,
    setPdfPageCount,
    pdfPageRefs,
    pageRefs,
    requestedPageUid,
    /* موضع */
    positionQuery,
    savedPosUid,
    savedSub: positionQuery.data?.positions?.[documentUid]?.sub ?? null,
    fallbackPageUid,
    bumpPosition,
    /* پیوسته */
    continuous,
    contCurrentUid,
    contCurrentRef,
    setContCurrentUid,
    pagesQueries,
    payloadByUid,
    pagesPendingCount,
    mainRef,
    /* صفحهٔ فعلی */
    currentPageUid,
    pageQuery,
    pdfPageNum,
    allPayloads,
    activePayload,
    blockPage,
    /* نشانک */
    bookmarksQuery,
    isBookmarked,
    bookmarkPending,
    toggleBookmark,
    /* نشانه‌ها */
    pageMarks,
    documentNotes,
    markedPageUids,
    markedPagesCount,
    pendingMarkDelete,
    markDeletePending,
    requestDeletePageMark,
    confirmMarkDelete,
    cancelMarkDelete,
    jumpToMark,
    /* یادداشت/هایلایت */
    notesCountQuery,
    notes,
    pageNoteCount,
    docNoteCount,
    annotationsQuery,
    annotations,
    anchorStatus,
    userHlsByPage,
    highlightAnchorByUid,
    /* اشتراک */
    sharedQuery,
    sharedHl,
    sharedHlPageUid,
    displayHlsByPage,
    deleteBookmark,
    clearShared,
    /* فهرست */
    sectionUidByBlockId,
    sectionLevelByBlockId,
    activeSectionUid,
    onJumpSection,
    flashBlockId,
    setFlashBlockId,
    captureLocation,
    rememberLocation,
    restoreTarget,
    completeRestore,
    recordHistory,
    historyCounts: navigation.counts,
    navigationBack: () => stepHistory("back"),
    navigationForward: () => stepHistory("fwd"),
    /* ناوبری */
    goToPage,
    pageIdx,
    prevRef,
    nextRef,
    gotoNeighbor,
    /* جست‌وجوی درون‌کتابی */
    inBookSearch,
    inBookSearchQuery,
    inBookSearchScope,
    setInBookSearchScope,
    ignoreSpacing,
    setIgnoreSpacing,
    setSelectedSearchPassageUid,
    selectedSearchPassageUid,
    searchSheetOpen,
    setSearchSheetOpen,
    handleExecuteSearch,
    handleClearSearch,
    handleSelectSearchResult,
    /* هایلایت نتیجهٔ جست‌وجو */
    highlightByPage,
    /* خطاها */
    errMsg,
    pagesUnavailable,
  };
}
