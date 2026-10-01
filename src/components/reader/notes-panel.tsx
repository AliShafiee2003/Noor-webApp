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
  Check,
  Loader2,
  Pencil,
  RotateCcw,
  ScrollText,
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
import type { Note } from "@/lib/types";

interface NotesPanelProps {
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
}

type Tab = "page" | "document" | "hadith";

export function NotesPanel({
  documentUid,
  currentPageUid,
  pageLabel,
  hadithScope = null,
  onClearHadithScope,
  onJumpToPage,
}: NotesPanelProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("page");
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  /** پیش‌نویس ناتمام هر صفحه — جابه‌جایی صفحه دست‌نوشته را گم نمی‌کند (§۴۱) */
  const draftsByPage = useRef<Map<string, string>>(new Map());

  /* با تعویض صفحه، پیش‌نویس همان صفحه بازیابی و بازخوردها پاک می‌شود */
  useEffect(() => {
    setDraft(draftsByPage.current.get(currentPageUid ?? "__doc") ?? "");
    setSaveState("idle");
    setActionError(null);
  }, [currentPageUid]);

  /* با ورود به دامنهٔ روایت، تب «این روایت» فعال می‌شود؛ با پایان آن به صفحه برمی‌گردیم */
  useEffect(() => {
    if (hadithScope) {
      setTab("hadith");
      setDraft("");
      setSaveState("idle");
      setActionError(null);
    } else {
      setTab((t) => (t === "hadith" ? "page" : t));
    }
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

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["notes", documentUid] });
  }, [queryClient, documentUid]);

  const notes = notesQuery.data?.items ?? [];
  const pageNotes = notes.filter((n) => n.page_uid === currentPageUid);
  const hadithNotes = hadithScope
    ? notes.filter((n) => n.local_hadith_uid === hadithScope.localUid)
    : [];
  const shown = tab === "page" ? pageNotes : tab === "hadith" ? hadithNotes : notes;
  const shownSorted = [...shown].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));

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
      setSaveState("saved");
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2200);
      refresh();
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

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="یادداشت‌های شخصی این سند">
      {/* سرفصل + تب‌ها */}
      <div className="border-b border-border px-3 pt-2.5 pb-0">
        <div className="flex items-center gap-2">
          <StickyNote className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">یادداشت‌ها</h2>
          <span className="ms-auto text-[11px] text-muted-foreground">فقط برای شما</span>
        </div>
        <div role="tablist" aria-label="دامنهٔ یادداشت‌ها" className="mt-2 flex gap-1">
          <button
            role="tab"
            aria-selected={tab === "page"}
            onClick={() => switchTab("page")}
            className={`min-h-11 flex-1 rounded-t-lg border-b-2 px-2 text-xs font-medium transition-colors md:min-h-8 ${
              tab === "page"
                ? "border-primary bg-primary/5 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/60"
            }`}
          >
            این صفحه {pageNotes.length > 0 ? `(${faNum(pageNotes.length)})` : ""}
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
            aria-selected={tab === "document"}
            onClick={() => switchTab("document")}
            className={`min-h-11 flex-1 rounded-t-lg border-b-2 px-2 text-xs font-medium transition-colors md:min-h-8 ${
              tab === "document"
                ? "border-primary bg-primary/5 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/60"
            }`}
          >
            کل سند {notes.length > 0 ? `(${faNum(notes.length)})` : ""}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* سرنوشت صفحهٔ فعلی */}
        {tab === "page" ? (
          <p className="mb-2 text-[11px] leading-5 text-muted-foreground">
            یادداشت تازه به{" "}
            {currentPageUid
              ? pageLabel && pageLabel !== "—"
                ? `صفحهٔ ${faNum(pageLabel)}`
                : "صفحهٔ فعلی"
              : "سند (بدون صفحه)"}{" "}
            ثبت می‌شود.
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

        {/* سرهم‌بندی یادداشت تازه */}
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
              ) : saveState === "saved" ? (
                <span className="flex items-center gap-1 text-primary">
                  <Check className="size-3" aria-hidden="true" /> ذخیره شد
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
              disabled={!draft.trim() || saveState === "saving" || (!currentPageUid && tab !== "document")}
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

        {/* فهرست */}
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
          ) : shownSorted.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-center">
              <StickyNote className="mx-auto size-5 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-1.5 text-xs font-medium">
                {tab === "page"
                  ? "برای این صفحه یادداشتی ندارید"
                  : tab === "hadith"
                    ? "برای این روایت یادداشتی ندارید"
                    : "برای این سند یادداشتی ندارید"}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {tab === "page"
                  ? "یادداشت شما فقط در همین مرورگرِ حساب شما دیده می‌شود؛ برای شروع، در کادر بالا بنویسید."
                  : tab === "hadith"
                    ? "در پنل زمینهٔ همین روایت، دکمهٔ «ثبت یادداشت روی این روایت» را بزنید."
                    : "به صفحه‌های دیگر بروید یا از تب «این صفحه» یادداشت تازه بسازید."}
              </p>
            </div>
          ) : (
            shownSorted.map((n) => (
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
      </div>

      {/* تعارض ویرایش (RES-14) */}
      <Dialog open={conflict !== null} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-600" aria-hidden="true" />
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
    </div>
  );
}
