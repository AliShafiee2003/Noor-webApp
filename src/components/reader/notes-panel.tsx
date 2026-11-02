"use client";

/**
 * یادداشت‌های شخصی روی متن (RES) — اتصال به API کامل سرور:
 * GET /notes?document_uid= · POST /notes · PATCH /notes/{uid} · DELETE /notes/{uid}
 *
 * اصول:
 * - یادداشت‌ها خصوصی‌اند و فقط برای همین کاربر می‌آیند (ADMIN-10/SEC).
 * - ویرایش با کنترل همزمانی version؛ تعارض 409 → انتخاب آگاهانهٔ
 *   «حفظ نسخهٔ من» یا «حفظ نسخهٔ سامانه» (RES-14) — هیچ‌کدام بدون اطلاع کاربر.
 * - پیش‌نویس ناتمام هر صفحه در حافظهٔ نشست حفظ می‌شود تا جابه‌جایی صفحه
 *   دست‌نوشته را نپاکاند (§۴۱/WORK-13).
 * - همهٔ حالت‌ها: loading/empty/error + بازخورد ذخیره (DESIGN.md).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookMarked,
  Check,
  Highlighter,
  Loader2,
  Pencil,
  RotateCcw,
  ScrollText,
  Share2,
  StickyNote,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, errorMessage } from "@/lib/api";
import { faDateTime, faNum } from "@/lib/format";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-color";
import { useToast } from "@/hooks/use-toast";
import type { Highlight, HighlightColor, Note, ShareCreateResponse } from "@/lib/types";
import { groupHighlights, type PageMark } from "@/lib/reader/marks";

import { useReaderAnnotations, highlightDeleteMessage } from "@/lib/reader/use-reader-annotations";
import { HighlightSheet } from "@/components/reader-mobile/highlight-sheet";
import { MarksList } from "@/components/reader/marks-list";

interface NotesPanelProps {
  onHighlightOpen?: (uid: string) => void;
  documentUid: string;
  /** صفحهٔ فعلی — برای فیلتر «این صفحه» و مقصد یادداشت تازه */
  currentPageUid: string | null;
  /** برچسب چاپی صفحهٔ فعلی برای نمایش (مثل «۴۲» یا «—») */
  pageLabel?: string | null;
  /** دامنهٔ روایت (RES): یادداشت روی روایت مشخص — از پنل زمینهٔ روایت */
  hadithScope?: { localUid: string; revayatIndex?: string | null } | null;
  /** پایان دامنهٔ روایت — بازگشت به دامنهٔ صفحه/سند */
  onClearHadithScope?: () => void;
  /** نشانی عمیق یادداشت‌ها: پرش به صفحهٔ مقصد یادداشت‌های صفحهٔ دیگر */
  onJumpToPage?: (pageUid: string) => void;
  /** عنوان اثر برای فرادادهٔ لینک اشتراک (§۷-الف-۳) */
  workTitle?: string | null;
  /** اعتبار لنگر هر هایلایت روی صفحهٔ خودش — ناموجود در نقشه = نامعلوم (نمایش هشدار نمی‌دهیم) */
  anchorStatus?: Record<string, "ok" | "missing">;
  /** نشانه‌های یکپارچه: نشانک صریح ∪ یادداشت صفحه ∪ هایلایتِ یادداشت‌دار */
  pageMarks?: PageMark[];
  documentNotes?: Note[];
  marksPending?: boolean;
  onRequestDeletePageMark?: (pageUid: string) => void | Promise<void>;
  /** پرش با برجسته‌سازی لنگر متن؛ false یعنی لنگر پیدا نشد */
  onJumpMark?: (mark: PageMark) => boolean;
  /** PDF: فقط نشانک صفحه — بدون یادداشت متنی */
  marksOnly?: boolean;
  /** پس از ساخت موفق یادداشت — والد می‌تواند شیت موبایل/مطالعهٔ متمرکز را ببندد */
  onNoteCreated?: () => void;
}

type Tab = "marks" | "hadith" | "highlights";

/** کپی مطمئن متن در کلیپ‌بورد (حتی در بسترهای غیر امن) */
async function copyToClipboard(text: string): Promise<boolean> {
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
}

export function NotesPanel({
  documentUid,
  currentPageUid,
  pageLabel,
  hadithScope = null,
  onClearHadithScope,
  onJumpToPage,
  workTitle = null,
  anchorStatus,
  onHighlightOpen,
  pageMarks = [],
  documentNotes = [],
  marksPending = false,
  onRequestDeletePageMark,
  onJumpMark,
  marksOnly = false,
  onNoteCreated,
}: NotesPanelProps) {
  const queryClient = useQueryClient();
  const annotations = useReaderAnnotations(documentUid);
  const [editingHighlight, setEditingHighlight] = useState<string | null>(null);
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("marks");
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  /** با ذخیرهٔ موفق بسته می‌شود تا کاربر بداند کار تمام شده (بازگشایی با دکمه). */
  const [composerOpen, setComposerOpen] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  /** پیش‌نویس ناتمام هر صفحه — جابه‌جایی صفحه دست‌نوشته را گم نمی‌کند (§۴۱) */
  const draftsByPage = useRef<Map<string, string>>(new Map());

  /* با تعویض صفحه، پیش‌نویس همان صفحه بازیابی و بازخوردها پاک می‌شود */
  useEffect(() => {
    setDraft(draftsByPage.current.get(currentPageUid ?? "__doc") ?? "");
    setSaveState("idle");
    setActionError(null);
  }, [currentPageUid]);

  /* با ورود به دامنهٔ روایت، تب «روایت» فعال می‌شود؛ با پایان آن به نشانه‌ها برمی‌گردیم */
  useEffect(() => {
    const timer = setTimeout(() => {
    if (hadithScope) {
      setTab("hadith");
      setComposerOpen(true);
      setDraft("");
      setSaveState("idle");
      setActionError(null);
    } else {
      setTab((t) => (t === "hadith" ? "marks" : t));
    }
    }, 0);
    return () => clearTimeout(timer);
  }, [hadithScope]);
  const [editing, setEditing] = useState<{ uid: string; body: string; version: number } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  /** تعارض RES-14 */
  const [conflict, setConflict] = useState<{ draft: string; server: Note } | null>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);
  const [pendingUid, setPendingUid] = useState<string | null>(null);

  const notesQuery = useQuery({
    queryKey: ["notes", documentUid],
    queryFn: ({ signal }) =>
      api.get<{ items: Note[] }>("/notes", { document_uid: documentUid }, signal),
    staleTime: 15_000,
    retry: false,
  });

  /* هایلایت‌های شخصی (§۷-الف-۳) — مسیر BFF با نگاشت Prisma */
  const highlightsQuery = useQuery({
    queryKey: ["annotations", documentUid],
    queryFn: ({ signal }) =>
      api.get<{ items: Highlight[] }>("/annotations", { document_uid: documentUid }, signal),
    staleTime: 15_000,
    retry: false,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["notes", documentUid] });
  }, [queryClient, documentUid]);

  const refreshAnnotations = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["annotations", documentUid] });
  }, [queryClient, documentUid]);

  const notes = notesQuery.data?.items ?? [];
  const hadithNotes = hadithScope
    ? notes.filter((n) => n.local_hadith_uid === hadithScope.localUid)
    : [];
  const hadithNotesSorted = [...hadithNotes].sort((a, b) =>
    (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
  );
  /* PDF فقط نشانک صریح دارد؛ یادداشت متنی در PDF ساخته نمی‌شود */
  const visibleMarks = marksOnly ? pageMarks.filter((m) => m.bookmark) : pageMarks;
  const marksCount = visibleMarks.length;

  /* ---------- پیش‌نویس صفحه ---------- */
  const switchTab = (t: Tab) => {
    setTab(t);
  };

  const saveNew = async () => {
    const body = draft.trim();
    if (!body || saveState === "saving") return;
    const hadithTarget = tab === "hadith" ? hadithScope : null;
    if (hadithTarget && !hadithTarget.localUid) return;
    setSaveState("saving");
    setActionError(null);
    try {
      await api.post<Note>("/notes", {
        document_uid: documentUid,
        page_uid: currentPageUid ?? undefined,
        local_hadith_uid: hadithTarget ? hadithTarget.localUid : undefined,
        body,
      });
      setDraft("");
      draftsByPage.current.delete(hadithTarget ? `h:${hadithTarget.localUid}` : (currentPageUid ?? "__doc"));
      /* ذخیره شد → کادر بسته می‌شود؛ شیت موبایل/مطالعهٔ متمرکز هم به والد اطلاع می‌دهد. */
      setSaveState("saved");
      setComposerOpen(false);
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2200);
      refresh();
      onNoteCreated?.();
    } catch (err) {
      setSaveState("error");
      setActionError(errorMessage(err, "ذخیرهٔ یادداشت ناموفق بود؛ دوباره تلاش کنید."));
    }
  };

  /* ---------- ویرایش با version ---------- */
  const beginEdit = (n: Note) => {
    setEditing({ uid: n.uid, body: n.body, version: n.version });
    setEditError(null);
  };

  const saveEdit = useCallback(
    async (uid: string, version: number, body: string) => {
      setEditError(null);
      try {
        await api.patch<Note>(`/notes/${uid}`, { version, body });
        setEditing(null);
        setConflict(null);
        refresh();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          /* سرور مسیر GET /notes/{uid} ندارد؛ نسخهٔ فعلی از فهرست خوانده می‌شود */
          try {
            const fresh = await api.get<{ items: Note[] }>("/notes", { document_uid: documentUid });
            const server = fresh.items.find((n) => n.uid === uid);
            if (server) {
              setConflict({ draft: body, server });
              return;
            }
            setEditError(
              "این یادداشت حذف شده است؛ فهرست به‌روزرسانی می‌شود.",
            );
            setEditing(null);
            refresh();
            return;
          } catch {
            setEditError(
              "این یادداشت در جای دیگری ویرایش شده است؛ فهرست را به‌روزرسانی و دوباره تلاش کنید.",
            );
            refresh();
            return;
          }
        }
        setEditError(errorMessage(err, "ذخیرهٔ ویرایش ناموفق بود؛ دوباره تلاش کنید."));
      }
    },
    [refresh, documentUid],
  );

  const removeNote = async (n: Note) => {
    setPendingUid(n.uid);
    try {
      await api.del(`/notes/${n.uid}`);
      if (editing?.uid === n.uid) setEditing(null);
      setDeleting(null);
      refresh();
    } catch (err) {
      setEditError(errorMessage(err, "حذف یادداشت ممکن نشد."));
    } finally {
      setPendingUid(null);
    }
  };

  /* ---------- هایلایت‌ها (§۷-الف-۳) ---------- */
  const highlights = highlightsQuery.data?.items ?? [];
  /* هایلایتِ دارای یادداشت در «نشانه‌ها» می‌آید؛ این تب فقط هایلایت خالی را نشان می‌دهد.
     انتخاب چندپاراگرافی یک گروه است، نه چند ردیف جدا. */
  const plainHighlights = groupHighlights(highlights).filter((g) => !g.note);
  const [deletingHl, setDeletingHl] = useState<Highlight | null>(null);
  const [hlPendingUid, setHlPendingUid] = useState<string | null>(null);
  /** هایلایتی که همین حالا در حال ساخت لینک اشتراکش هستیم */
  const [sharingUid, setSharingUid] = useState<string | null>(null);

  const changeColor = async (h: Highlight, color: HighlightColor) => {
    if (h.color === color) return;
    setHlPendingUid(h.uid);
    try {
      await annotations.update(h.uid, { color });
      refreshAnnotations();
    } catch (err) {
      toast({
        title: errorMessage(err, "تغییر رنگ هایلایت ناموفق بود؛ دوباره تلاش کنید."),
        variant: "destructive",
      });
    } finally {
      setHlPendingUid(null);
    }
  };

  const removeHighlight = async (h: Highlight) => {
    setHlPendingUid(h.uid);
    try {
      await annotations.remove(h.uid);
      setDeletingHl(null);
      refreshAnnotations();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setDeletingHl(null);
        refreshAnnotations();
      } else {
        toast({ title: errorMessage(err, "حذف هایلایت ممکن نشد."), variant: "destructive" });
      }
    } finally {
      setHlPendingUid(null);
    }
  };

  /** ساخت لینک اشتراک + کپی نشانی مطلق (§۷-الف-۳) — خطای سرور با پیام فارسی */
  const shareItem = async (args: {
    kind: "note" | "highlight";
    itemId: string;
    pageUid?: string | null;
    pageLabel?: string | null;
    payload: string;
    meta: Record<string, unknown>;
  }) => {
    setSharingUid(args.itemId);
    try {
      const resp = await api.post<ShareCreateResponse>("/shares", {
        kind: args.kind,
        item_id: args.itemId,
        document_uid: documentUid,
        page_uid: args.pageUid ?? undefined,
        page_label: args.pageLabel ?? undefined,
        work_title: workTitle ?? undefined,
        payload: args.payload,
        meta: args.meta,
      });
      // فاز ۲: قالب جدید با «/» آغاز می‌شود (path)؛ قالب‌های قدیمی (#/…) هم
      // در ورود توسط روتر ترجمه می‌شوند — هر دو به نشانی کامل می‌سازند.
      const path = resp.url_path.startsWith("/") ? resp.url_path : `/${resp.url_path}`;
      const url = `${window.location.origin}${path}`;
      const copied = await copyToClipboard(url);
      toast({
        title: copied
          ? "لینک اشتراک کپی شد؛ فقط برای کاربران واردشدهٔ همین سامانه کار می‌کند."
          : "لینک اشتراک ساخته شد؛ کپی خودکار ممکن نشد و نشانی زیر در دسترس است.",
        description: copied ? undefined : url,
        variant: copied ? "default" : "destructive",
      });
    } catch (err) {
      toast({
        title: errorMessage(err, "ساخت لینک اشتراک ناموفق بود؛ دوباره تلاش کنید."),
        variant: "destructive",
      });
    } finally {
      setSharingUid(null);
    }
  };

  const shareHighlight = (h: Highlight) =>
    shareItem({
      kind: "highlight",
      itemId: h.uid,
      pageUid: h.page_uid,
      pageLabel: h.page_uid === currentPageUid ? pageLabel ?? null : null,
      payload: h.text,
      meta: { color: h.color, start: h.start, end: h.end, block_id: h.block_id },
    });

  const shareNote = (n: Note) =>
    shareItem({
      kind: "note",
      itemId: n.uid,
      pageUid: n.page_uid ?? null,
      pageLabel: n.page_label && n.page_label !== "—" ? n.page_label : null,
      payload: n.body,
      meta: { revayat_index: n.local_hadith_uid ?? null },
    });

  const handleDeletePageMark = (pageUid: string) => {
    if (!onRequestDeletePageMark) return;
    void Promise.resolve(onRequestDeletePageMark(pageUid)).catch((err) => {
      toast({
        title: errorMessage(err, "حذف نشانک صفحه ناموفق بود؛ دوباره تلاش کنید."),
        variant: "destructive",
      });
    });
  };

  const handleJumpMark = (mark: PageMark) => {
    const anchored = onJumpMark ? onJumpMark(mark) : (onJumpToPage?.(mark.pageUid), true);
    if (!anchored) {
      toast({
        title: "متن اصلی این یادداشت روی صفحه پیدا نشد؛ صفحه باز شد.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="یادداشت‌های شخصی این سند">
      {/* سرفصل + تب‌ها */}
      <div className="border-b border-border px-3 pt-2.5 pb-0">
        <div className="flex items-center gap-2">
          <BookMarked className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">{marksOnly ? "نشانک‌ها" : "نشانه‌ها"}</h2>
          <span className="ms-auto text-[11px] text-muted-foreground">فقط برای شما</span>
        </div>
        {!marksOnly ? (
        <div role="tablist" aria-label="نشانک‌ها و یادداشت‌ها" className="mt-2 flex gap-1">
          <button
            role="tab"
            aria-selected={tab === "marks"}
            onClick={() => switchTab("marks")}
            className={`min-h-11 flex-1 rounded-t-lg border-b-2 px-2 text-xs font-medium transition-colors md:min-h-8 ${
              tab === "marks"
                ? "border-primary bg-primary/5 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/60"
            }`}
          >
            نشانه‌ها {marksCount > 0 ? `(${faNum(marksCount)})` : ""}
          </button>
          {hadithScope ? (
            <button
              role="tab"
              aria-selected={tab === "hadith"}
              onClick={() => switchTab("hadith")}
              className={`min-h-11 flex-1 rounded-t-lg border-b-2 px-2 text-xs font-medium transition-colors md:min-h-8 ${
                tab === "hadith"
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/60"
              }`}
            >
              این روایت {hadithNotes.length > 0 ? `(${faNum(hadithNotes.length)})` : ""}
            </button>
          ) : null}
          <button
            role="tab"
            aria-selected={tab === "highlights"}
            onClick={() => switchTab("highlights")}
            className={`min-h-11 flex-1 rounded-t-lg border-b-2 px-2 text-xs font-medium transition-colors md:min-h-8 ${
              tab === "highlights"
                ? "border-primary bg-primary/5 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/60"
            }`}
          >
            هایلایت‌ها {plainHighlights.length > 0 ? `(${faNum(plainHighlights.length)})` : ""}
          </button>
        </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* مقصد یادداشت تازه */}
        {tab === "marks" && !marksOnly ? (
          <p className="mb-2 text-[11px] leading-5 text-muted-foreground">
            یادداشت تازه به{" "}
            {currentPageUid
              ? pageLabel && pageLabel !== "—"
                ? `صفحهٔ ${faNum(pageLabel)}`
                : "صفحهٔ فعلی"
              : "سند (بدون صفحه)"}{" "}
            ثبت می‌شود و صفحه را نشانک می‌کند.
          </p>
        ) : null}
        {tab === "hadith" && hadithScope ? (
          <div className="mb-2 flex items-start justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2">
            <p className="text-[11px] leading-5 text-foreground">
              <ScrollText className="me-1 inline size-3.5 text-primary" aria-hidden="true" />
              یادداشت به{" "}
              {hadithScope.revayatIndex ? `روایت ${faNum(hadithScope.revayatIndex)}` : "این روایت"} از{" "}
              {pageLabel && pageLabel !== "—" ? `صفحهٔ ${faNum(pageLabel)}` : "صفحهٔ فعلی"} ثبت می‌شود؛
              در فهرست کل سند با نشان «روایت» دیده می‌شود.
            </p>
            {onClearHadithScope ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                onClick={onClearHadithScope}
              >
                <X className="size-3" aria-hidden="true" />
                پایان دامنهٔ روایت
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* سرهم‌بندی یادداشت تازه — در تب هایلایت‌ها نمایش داده نمی‌شود */}
        {tab !== "highlights" && !marksOnly ? (
          composerOpen ? (
        <div className="rounded-xl border border-border bg-surface p-2.5">
          <Textarea
            aria-label="متن یادداشت تازه"
            placeholder="یادداشت خود را بنویسید…"
            className="min-h-20 resize-y border-0 bg-transparent p-1 text-sm focus-visible:ring-0"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              draftsByPage.current.set(
                tab === "hadith" && hadithScope ? `h:${hadithScope.localUid}` : (currentPageUid ?? "__doc"),
                e.target.value,
              );
              setSaveState("idle");
              setActionError(null);
            }}
          />
          <div className="flex items-center justify-between gap-2 pt-1.5">
            <span aria-live="polite" className="text-[11px] text-muted-foreground">
              {saveState === "saving" ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" /> در حال ذخیره…
                </span>
              ) : saveState === "error" ? (
                <span className="flex items-center gap-1 text-destructive">
                  <TriangleAlert className="size-3" aria-hidden="true" /> ذخیرهٔ ناموفق
                </span>
              ) : (
                "با Enter ساده خط جدید؛ ذخیره با دکمه"
              )}
            </span>
            <Button
              size="sm"
              className="min-h-9 gap-1.5"
              disabled={!draft.trim() || saveState === "saving" || (tab === "marks" && !currentPageUid)}
              onClick={() => void saveNew()}
            >
              <Check className="size-3.5" aria-hidden="true" />
              {tab === "hadith" ? "ذخیرهٔ یادداشت روایت" : "ذخیرهٔ یادداشت"}
            </Button>
          </div>
          {actionError ? (
            <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[11px] text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {actionError}
            </p>
          ) : null}
        </div>
          ) : (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 flex-1 justify-center gap-1.5 md:min-h-9"
            onClick={() => setComposerOpen(true)}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {tab === "hadith" ? "یادداشت تازه برای این روایت" : "یادداشت تازه"}
          </Button>
          <span aria-live="polite" className="text-[11px] text-primary">
            {saveState === "saved" ? (
              <span className="flex items-center gap-1">
                <Check className="size-3" aria-hidden="true" /> ذخیره شد
              </span>
            ) : null}
          </span>
        </div>
          )
        ) : null}

        {/* فهرست هایلایت‌ها (تب هایلایت‌ها) */}
        {tab === "highlights" && !marksOnly ? (
          <div className="mt-3 space-y-2.5">
            {highlightsQuery.isPending ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <span className="sr-only">در حال بارگیری هایلایت‌ها…</span>
              </div>
            ) : highlightsQuery.isError ? (
              <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {errorMessage(highlightsQuery.error, "فهرست هایلایت‌ها در دسترس نیست.")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-9 gap-1.5"
                  onClick={() => void highlightsQuery.refetch()}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" /> تلاش دوباره
                </Button>
              </div>
            ) : plainHighlights.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center">
                <Highlighter className="mx-auto size-5 text-muted-foreground/60" aria-hidden="true" />
                <p className="mt-1.5 text-xs font-medium">هایلایت بدون یادداشتی ندارید</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  در متن کتاب‌خوان بخشی را انتخاب کنید و یکی از رنگ‌ها را بزنید. هایلایت‌های دارای
                  یادداشت در تب «نشانه‌ها» دیده می‌شوند.
                </p>
              </div>
            ) : (
              plainHighlights.map((group) => {
                const dot = HIGHLIGHT_COLORS.find((c) => c.value === group.color);
                return (
                  <article
                    key={group.uid}
                    className="anim-rise quiet-card rounded-xl border border-border bg-surface p-3"
                  >
                    {anchorStatus?.[group.uid] === "missing" ? (
                      <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-5 text-amber-700 dark:text-amber-400">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        لنگر یافت نشد — متن نسخه تغییر کرده است
                      </p>
                    ) : null}
                    <p
                      title={group.text}
                      data-hl-quote={group.uid}
                      className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 px-2 py-1.5 text-[12px] leading-6 text-muted-foreground"
                    >
                      {group.text}
                    </p>
                    {group.segments.length > 1 ? (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                        {faNum(group.segments.length)} پاراگراف
                      </span>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => onHighlightOpen ? onHighlightOpen(group.uid) : setEditingHighlight(group.uid)}>ویرایش هایلایت و یادداشت</Button>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                          className={`inline-block size-3 rounded-full ${dot?.dotClass ?? "bg-yellow-500"}`}
                          aria-hidden="true"
                        />
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                          <Highlighter className="size-3" aria-hidden="true" />
                          {group.pageUid === currentPageUid ? "همین صفحه" : "صفحهٔ دیگر"}
                        </span>
                        {group.anchor.created_at ? <span>{faDateTime(group.anchor.created_at)}</span> : null}
                        {/* نشانی عمیق: پرش به صفحهٔ مقصد هایلایت */}
                        {group.pageUid && group.pageUid !== currentPageUid && onJumpToPage ? (
                          <button
                            type="button"
                            className="inline-flex min-h-6 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                            onClick={() => onJumpToPage(group.pageUid)}
                            title="رفتن به صفحهٔ این هایلایت"
                          >
                            پرش به این صفحه
                            <ArrowLeft className="size-3" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        {/* تغییر رنگ: پنج لکهٔ کوچک — رنگ فعلی حلقه دارد */}
                        <div role="group" aria-label="تغییر رنگ هایلایت" className="flex items-center gap-1">
                          {HIGHLIGHT_COLORS.map((c) => (
                            <button
                              key={c.value}
                              type="button"
                              title={`رنگ ${c.label}`}
                              aria-label={`تغییر رنگ این هایلایت به ${c.label}`}
                              aria-pressed={group.color === c.value}
                              disabled={hlPendingUid === group.uid}
                              className={`size-4 min-h-0 w-4 rounded-full p-0 transition-transform hover:scale-110 disabled:opacity-50 ${c.dotClass} ${
                                group.color === c.value
                                  ? "ring-2 ring-primary ring-offset-1 ring-offset-surface"
                                  : ""
                              }`}
                              onClick={() => void changeColor(group.anchor, c.value)}
                            />
                          ))}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="اشتراک‌گذاری هایلایت"
                          title="اشتراک‌گذاری هایلایت (کپی لینک)"
                          className="size-8"
                          disabled={sharingUid === group.uid}
                          onClick={() => void shareHighlight(group.anchor)}
                        >
                          {sharingUid === group.uid ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Share2 className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="حذف هایلایت"
                          title="حذف هایلایت"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => setDeletingHl(group.anchor)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        ) : tab === "marks" || marksOnly ? (
          marksPending ? (
            <div className="mt-3 space-y-2" aria-busy="true">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <span className="sr-only">در حال بارگیری نشانه‌ها…</span>
            </div>
          ) : (
            <div className="mt-3">
              <MarksList
                marks={visibleMarks}
                documentNotes={marksOnly ? [] : documentNotes}
                currentPageUid={currentPageUid}
                anchorStatus={anchorStatus}
                editing={editing}
                editError={editError}
                onBeginEdit={beginEdit}
                onEditChange={(body) => setEditing((e) => (e ? { ...e, body } : e))}
                onCancelEdit={() => {
                  setEditing(null);
                  setEditError(null);
                }}
                onSaveEdit={(uid, version, body) => void saveEdit(uid, version, body)}
                onDeleteNote={setDeleting}
                onShareNote={(note) => void shareNote(note)}
                sharingUid={sharingUid}
                onDeleteHighlight={setDeletingHl}
                onOpenHighlight={(uid) => (onHighlightOpen ? onHighlightOpen(uid) : setEditingHighlight(uid))}
                onDeletePageMark={handleDeletePageMark}
                onJumpMark={handleJumpMark}
              />
            </div>
          )
        ) : (
        <div className="mt-3 space-y-2.5">
          {notesQuery.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <span className="sr-only">در حال بارگیری یادداشت‌ها…</span>
            </div>
          ) : notesQuery.isError ? (
            <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {errorMessage(notesQuery.error, "فهرست یادداشت‌ها در دسترس نیست.")}
              </p>
              <Button variant="outline" size="sm" className="min-h-9 gap-1.5" onClick={() => void notesQuery.refetch()}>
                <RotateCcw className="size-3.5" aria-hidden="true" /> تلاش دوباره
              </Button>
            </div>
          ) : hadithNotesSorted.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-center">
              <StickyNote className="mx-auto size-5 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-1.5 text-xs font-medium">برای این روایت یادداشتی ندارید</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                در پنل زمینهٔ همین روایت، دکمهٔ «ثبت یادداشت روی این روایت» را بزنید.
              </p>
            </div>
          ) : (
            hadithNotesSorted.map((n) => (
              <article
                key={n.uid}
                className={`anim-rise quiet-card rounded-xl border bg-surface p-3 ${
                  n.local_hadith_uid
                    ? "border-s-[3px] border-s-primary/60 border-border"
                    : "border-border"
                }`}
              >
                {editing?.uid === n.uid ? (
                  <div className="space-y-2">
                    <Textarea
                      aria-label="ویرایش یادداشت"
                      value={editing.body}
                      onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                      className="min-h-24 resize-y text-sm"
                    />
                    {editError ? (
                      <p role="alert" className="flex items-start gap-1.5 text-[11px] text-destructive">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        {editError}
                      </p>
                    ) : null}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        نسخهٔ مبنا: {faNum(editing.version)}
                      </span>
                      <div className="flex gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-9 gap-1"
                          onClick={() => {
                            setEditing(null);
                            setEditError(null);
                          }}
                        >
                          <X className="size-3.5" aria-hidden="true" /> انصراف
                        </Button>
                        <Button
                          size="sm"
                          className="min-h-9 gap-1"
                          disabled={!editing.body.trim()}
                          onClick={() => void saveEdit(n.uid, editing.version, editing.body.trim())}
                        >
                          <Check className="size-3.5" aria-hidden="true" /> ذخیره
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-[13px] leading-7 text-foreground">
                      {n.body}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {n.local_hadith_uid ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                            <ScrollText className="size-3" aria-hidden="true" />
                            روایت
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                          <StickyNote className="size-3" aria-hidden="true" />
                          {n.page_uid
                            ? n.page_uid === currentPageUid
                              ? "همین صفحه"
                              : n.page_label && n.page_label !== "—"
                                ? `صفحهٔ ${faNum(n.page_label)}`
                                : "صفحهٔ دیگر"
                            : "کل سند"}
                        </span>
                        {n.updated_at ? <span>{faDateTime(n.updated_at)}</span> : null}
                        {/* نشانی عمیق: پرش به صفحهٔ مقصد یادداشت — با برچسب چاپی صفحه */}
                        {n.page_uid && n.page_uid !== currentPageUid && onJumpToPage ? (
                          <button
                            type="button"
                            className="inline-flex min-h-6 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                            onClick={() => onJumpToPage(n.page_uid as string)}
                            title="رفتن به صفحهٔ این یادداشت"
                          >
                            {n.page_label && n.page_label !== "—"
                              ? `پرش به صفحهٔ ${faNum(n.page_label)}`
                              : "پرش به این صفحه"}
                            <ArrowLeft className="size-3" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="اشتراک‌گذاری یادداشت"
                          title="اشتراک‌گذاری یادداشت (کپی لینک)"
                          className="size-8"
                          disabled={sharingUid === n.uid}
                          onClick={() => void shareNote(n)}
                        >
                          {sharingUid === n.uid ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Share2 className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="ویرایش یادداشت"
                          title="ویرایش یادداشت"
                          className="size-8"
                          onClick={() => beginEdit(n)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="حذف یادداشت"
                          title="حذف یادداشت"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleting(n)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </article>
            ))
          )}
        </div>
        )}
      </div>

      {editingHighlight && <HighlightSheet key={editingHighlight} highlightUid={editingHighlight} documentUid={documentUid} onClose={() => setEditingHighlight(null)} />}
      {/* تعارض ویرایش (RES-14) */}
      <Dialog open={conflict !== null} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-warning" aria-hidden="true" />
              این یادداشت هم‌زمان در جای دیگری ویرایش شده است
            </DialogTitle>
            <DialogDescription>
              دو نسخه را ببینید و انتخاب کنید؛ هیچ‌کدام بی‌اجازهٔ شما بازنویسی نمی‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-2.5">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">نسخهٔ شما</p>
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[13px] leading-6">
                {conflict?.draft || "—"}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/60 p-2.5">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">نسخهٔ موجود در سامانه</p>
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[13px] leading-6">
                {conflict?.server.body || "—"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                if (conflict) void saveEdit(conflict.server.uid, conflict.server.version, conflict.draft);
              }}
            >
              حفظ نسخهٔ من
            </Button>
            <Button
              className="min-h-11"
              onClick={() => {
                setEditing(null);
                setConflict(null);
                refresh();
              }}
            >
              حفظ نسخهٔ سامانه
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* تأیید حذف */}
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف این یادداشت؟</AlertDialogTitle>
            <AlertDialogDescription>
              حذف یادداشت بازگشت‌پذیر نیست. متن آن پس از حذف در دسترس نخواهد بود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-white hover:bg-destructive/90"
              disabled={pendingUid === deleting?.uid}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) void removeNote(deleting);
              }}
            >
              {pendingUid === deleting?.uid ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> در حال حذف…
                </>
              ) : (
                "حذف یادداشت"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* تأیید حذف هایلایت (§۷-الف-۳) */}
      <AlertDialog open={deletingHl !== null} onOpenChange={(o) => !o && setDeletingHl(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deletingHl ? highlightDeleteMessage(deletingHl) : "حذف هایلایت"}</AlertDialogTitle>
            <AlertDialogDescription>
              حذف هایلایت بازگشت‌پذیر نیست و متن برجسته‌شده از کتاب‌خوان پاک می‌شود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-white hover:bg-destructive/90"
              disabled={hlPendingUid === deletingHl?.uid}
              onClick={(e) => {
                e.preventDefault();
                if (deletingHl) void removeHighlight(deletingHl);
              }}
            >
              {hlPendingUid === deletingHl?.uid ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> در حال حذف…
                </>
              ) : (
                "حذف هایلایت"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
