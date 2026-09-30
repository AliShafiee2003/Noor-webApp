"use client";

/**
 * پروندهٔ پژوهش — فیش‌ها، سطل بازیافت، تاریخچه و خروجی (RES-08..RES-14)
 * - فهرست فیش‌ها با جست‌وجو و فیلتر برچسب (GET /projects/{uid}/clips?state&q&tag)
 * - ویرایش یادداشت (PATCH با version) — تعارض 409: نمایش دو نسخه و انتخاب کاربر (RES-14)
 * - حذف → سطل بازیافت + بازیابی (RES-09) و تاریخچهٔ فیش در گفت‌وگو
 * - خروجی Markdown/CSV/چاپ (POST /exports + polling تا آماده شدن بارگیری) (RES-10/11)
 * - «بازگشت به منبع» → #/read/{documentUid}?pg={page_uid} (RES-08)
 */
import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpenText,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  Pencil,
  Printer,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import { api, ApiError, apiUrl, errorMessage } from "@/lib/api";
import { HashLink } from "@/lib/hash-router";
import { faDate, faNum } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import type { Clip, ClipKind, Work } from "@/lib/types";

const KIND_LABELS: Record<ClipKind, string> = {
  original: "نقل‌قول اصل",
  as_read: "متن خوانده‌شده",
  note: "یادداشت",
};

type ClipTab = "active" | "trashed";
type ExportFormat = "md" | "csv" | "print";

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** پاسخ قرارداد می‌تواند آرایهٔ خام یا {items} باشد — هر دو پذیرفته می‌شود. */
function normalizeItems<T>(data: T[] | { items?: T[] } | undefined | null): T[] {
  if (Array.isArray(data)) return data;
  return data?.items ?? [];
}

/* ---------- کارت فیش ---------- */

function ClipCard({
  clip,
  workTitle,
  trashed,
  onEditNote,
  onShowHistory,
  onTrash,
  onRestore,
  pendingAction,
}: {
  clip: Clip;
  workTitle: string | null;
  trashed?: boolean;
  onEditNote: (clip: Clip) => void;
  onShowHistory: (clip: Clip) => void;
  onTrash: (clip: Clip) => void;
  onRestore: (clip: Clip) => void;
  pendingAction: string | null;
}) {
  const source = clip.source;
  const busy = pendingAction === clip.uid;

  return (
    <Card className="transition-colors hover:border-control-border/60">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant="secondary" className="font-normal">
            {KIND_LABELS[clip.kind] ?? "فیش"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {clip.updated_at ? `آخرین تغییر: ${faDate(clip.updated_at)}` : null}
          </span>
        </div>

        <blockquote className="rounded-lg bg-accent/50 px-3 py-2 text-sm leading-7 text-foreground">
          {clip.quote_original}
        </blockquote>

        {clip.quote_as_read ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">متن خوانده‌شده</p>
            <p className="text-sm leading-7 text-foreground">{clip.quote_as_read}</p>
          </div>
        ) : null}

        {clip.note ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">یادداشت</p>
            <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{clip.note}</p>
          </div>
        ) : null}

        {clip.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {clip.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            منبع: {workTitle ?? "منبع ثبت‌شده در سامانه"}
            {source?.page_label ? ` · صفحهٔ ${source.page_label}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {!trashed && source?.document_uid ? (
              <Button variant="outline" size="sm" className="min-h-11 gap-2" asChild>
                <HashLink
                  to={`/read/${source.document_uid}`}
                  query={source.page_uid ? { pg: source.page_uid } : undefined}
                >
                  <BookOpenText className="size-4" aria-hidden="true" />
                  بازگشت به منبع
                </HashLink>
              </Button>
            ) : null}
            {!trashed ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 gap-2"
                  onClick={() => onEditNote(clip)}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  ویرایش یادداشت
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 gap-2"
                  onClick={() => onShowHistory(clip)}
                >
                  <History className="size-4" aria-hidden="true" />
                  تاریخچه
                </Button>
              </>
            ) : null}
            {trashed ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 gap-2"
                disabled={busy}
                onClick={() => onRestore(clip)}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="size-4" aria-hidden="true" />
                )}
                بازیابی
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 gap-2 text-destructive hover:text-destructive"
                aria-label="حذف فیش و انتقال به سطل بازیافت"
                disabled={busy}
                onClick={() => onTrash(clip)}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-4" aria-hidden="true" />
                )}
                حذف
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- نمای اصلی ---------- */

export function ProjectView({ uid }: { uid: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /* ---------- تب و جست‌وجو ---------- */
  const [tab, setTab] = useState<ClipTab>("active");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 250);
  const [tag, setTag] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const clipsQuery = useQuery({
    queryKey: ["project-clips", uid, tab, debouncedQ, tag],
    queryFn: () =>
      api
        .get<Clip[] | { items: Clip[] }>(`/projects/${uid}/clips`, {
          state: tab,
          q: debouncedQ || undefined,
          tag: tag ?? undefined,
        })
        .then((d) => normalizeItems<Clip>(d)),
    placeholderData: (prev) => prev,
  });
  const clips = useMemo(() => clipsQuery.data ?? [], [clipsQuery.data]);

  /* ---------- نام پرونده (از فهرست پرونده‌ها) ---------- */
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () =>
      normalizeItems<ProjectRow>(await api.get<ProjectRow[] | { items: ProjectRow[] }>("/projects")),
    staleTime: 30_000,
  });
  const projectName = projectsQuery.data?.find((p) => p.uid === uid)?.name ?? "پروندهٔ پژوهش";

  /* ---------- نقشهٔ عنوان آثار برای نمایش منبع (بدون شناسهٔ فنی) ---------- */
  const worksMapQuery = useQuery({
    queryKey: ["works-map"],
    queryFn: async () => {
      const resp = await api.get<Work[] | { items: Work[] }>("/works", { page_size: 200 });
      const map: Record<string, string> = {};
      for (const w of normalizeItems<Work>(resp)) map[w.uid] = w.title;
      return map;
    },
    staleTime: 5 * 60_000,
  });

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of clips) for (const t of c.tags) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fa"));
  }, [clips]);

  const refreshClips = () => {
    void queryClient.invalidateQueries({ queryKey: ["project-clips", uid] });
  };

  /* ---------- ویرایش یادداشت ---------- */
  const [editClip, setEditClip] = useState<Clip | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  /** تعارض RES-14: نسخهٔ کاربر در برابر نسخهٔ موجود در سامانه */
  const [conflict, setConflict] = useState<{ draft: string; serverClip: Clip } | null>(null);

  const openEdit = (clip: Clip) => {
    setEditClip(clip);
    setEditNote(clip.note ?? "");
    setEditError(null);
    setConflict(null);
  };

  const saveNote = async (clip: Clip, note: string) => {
    setEditError(null);
    try {
      await api.patch<Clip>(`/clips/${clip.uid}`, { version: clip.version, note });
      setEditClip(null);
      setConflict(null);
      refreshClips();
      toast({ title: "یادداشت فیش ذخیره شد." });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        try {
          const serverClip = await api.get<Clip>(`/clips/${clip.uid}`);
          setConflict({ draft: note, serverClip });
          return;
        } catch {
          setEditError(
            "یادداشت این فیش در جای دیگری تغییر کرده است؛ فهرست را به‌روزرسانی و دوباره تلاش کنید.",
          );
          refreshClips();
          return;
        }
      }
      setEditError(errorMessage(err, "ذخیرهٔ یادداشت ناموفق بود؛ دوباره تلاش کنید."));
    }
  };

  /* ---------- حذف / بازیابی ---------- */
  const trashClip = async (clip: Clip) => {
    setPendingAction(clip.uid);
    try {
      await api.del(`/clips/${clip.uid}`);
      toast({ title: "فیش به سطل بازیافت رفت." });
      refreshClips();
    } catch (err) {
      toast({
        title: "حذف فیش ممکن نشد.",
        description: errorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const restoreClip = async (clip: Clip) => {
    setPendingAction(clip.uid);
    try {
      await api.post(`/clips/${clip.uid}/restore`);
      toast({ title: "فیش بازیابی شد و به پرونده بازگشت." });
      refreshClips();
    } catch (err) {
      toast({
        title: "بازیابی فیش ممکن نشد.",
        description: errorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  };

  /* ---------- تاریخچهٔ فیش ---------- */
  const [historyClip, setHistoryClip] = useState<Clip | null>(null);
  const historyQuery = useQuery({
    queryKey: ["clip-revisions", historyClip?.uid],
    enabled: !!historyClip,
    queryFn: () =>
      api
        .get<Record<string, unknown>[] | { items: Record<string, unknown>[] }>(
          `/clips/${historyClip?.uid}/revisions`,
        )
        .then((d) => normalizeItems<Record<string, unknown>>(d)),
  });
  const openHistory = (clip: Clip) => setHistoryClip(clip);

  /* ---------- خروجی (RES-10/11) ---------- */
  const [exportJob, setExportJob] = useState<{ uid: string; format: ExportFormat } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const createExport = useMutation({
    mutationFn: (format: ExportFormat) =>
      api
        .post<{ export_uid: string }>("/exports", { project_uid: uid, format })
        .then((r) => ({ uid: r.export_uid, format })),
    onSuccess: (job) => {
      setExportError(null);
      setExportJob(job);
      toast({ title: "درخواست خروجی ثبت شد؛ در حال آماده‌سازی فایل…" });
    },
    onError: (err) => {
      setExportError(errorMessage(err, "ثبت درخواست خروجی ناموفق بود؛ دوباره تلاش کنید."));
    },
  });

  const exportStatusQuery = useQuery({
    queryKey: ["export-status", exportJob?.uid],
    enabled: !!exportJob,
    queryFn: () =>
      api.get<{ export_uid: string; status: string; download_ready: boolean }>(
        `/exports/${exportJob?.uid ?? ""}`,
      ),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "failed" ? false : 1500;
    },
  });

  const exportStatus = exportStatusQuery.data?.status;
  const EXPORT_LABELS: Record<ExportFormat, string> = {
    md: "خروجی Markdown",
    csv: "خروجی CSV",
    print: "نسخهٔ چاپی",
  };

  const downloadExport = (exportUid: string) => {
    // بارگیری با نشانی همان کلاینت API (شامل پارامتر gateway)
    window.open(apiUrl(`/exports/${exportUid}/download`), "_blank", "noopener");
  };

  const exportBusy =
    createExport.isPending ||
    (exportStatusQuery.isLoading && !!exportJob) ||
    exportStatus === "queued" ||
    exportStatus === "running";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6 space-y-3">
        <Button variant="ghost" size="sm" className="min-h-11 gap-2 -ms-2" asChild>
          <HashLink to="/research">
            <ArrowLeft className="size-4" aria-hidden="true" />
            بازگشت به پژوهش‌های من
          </HashLink>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{projectName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              فیش‌های گردآوری‌شده از میز مطالعه؛ با انتخاب متن در منابع، فیش تازه ثبت کنید.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-2"
              disabled={exportBusy}
              onClick={() => createExport.mutate("md")}
            >
              <FileText className="size-4" aria-hidden="true" />
              خروجی Markdown
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-2"
              disabled={exportBusy}
              onClick={() => createExport.mutate("csv")}
            >
              <FileSpreadsheet className="size-4" aria-hidden="true" />
              خروجی CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-2"
              disabled={exportBusy}
              onClick={() => createExport.mutate("print")}
            >
              <Printer className="size-4" aria-hidden="true" />
              چاپ
            </Button>
          </div>
        </div>

        {exportBusy ? (
          <p
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            در حال آماده‌سازی فایل خروجی…
          </p>
        ) : exportStatusQuery.isError && exportJob ? (
          <ErrorState
            message="پیگیری وضعیت خروجی ممکن نشد."
            onRetry={() => void exportStatusQuery.refetch()}
          />
        ) : exportStatus === "failed" ? (
          <ErrorState
            message="تولید فایل خروجی ناموفق بود؛ دوباره تلاش کنید."
            onRetry={() => exportJob && createExport.mutate(exportJob.format)}
          />
        ) : exportStatus === "done" && exportJob ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-sm text-foreground">
              فایل {EXPORT_LABELS[exportJob.format]} آمادهٔ بارگیری است.
            </p>
            <Button
              size="sm"
              className="min-h-11 gap-2"
              onClick={() => downloadExport(exportJob.uid)}
            >
              <Download className="size-4" aria-hidden="true" />
              بارگیری فایل
            </Button>
          </div>
        ) : exportError ? (
          <p className="text-sm text-destructive" role="alert">
            {exportError}
          </p>
        ) : null}
      </header>

      {/* ---------- جست‌وجو و برچسب ---------- */}
      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجو در متن فیش‌ها و یادداشت‌ها…"
            aria-label="جست‌وجو در فیش‌های این پرونده"
            className="min-h-11 pe-9"
          />
        </div>
        {allTags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">فیلتر برچسب:</span>
            {tag ? (
              <Button
                variant="secondary"
                size="sm"
                className="min-h-9 gap-1.5 rounded-full px-3"
                onClick={() => setTag(null)}
              >
                حذف فیلتر «{tag}»
              </Button>
            ) : (
              allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="min-h-11 rounded-full border border-border px-3 text-xs text-foreground transition-colors hover:bg-accent md:min-h-9"
                  onClick={() => setTag(t)}
                >
                  {t}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* ---------- تب فیش‌ها / سطل بازیافت ---------- */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as ClipTab)}
        className="mb-4"
      >
        <TabsList className="h-11">
          <TabsTrigger value="active" className="min-h-9">
            فیش‌ها
          </TabsTrigger>
          <TabsTrigger value="trashed" className="min-h-9">
            سطل بازیافت
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {clipsQuery.isPending ? (
        <ListSkeleton rows={4} />
      ) : clipsQuery.isError ? (
        <ErrorState
          message={errorMessage(clipsQuery.error, "بارگیری فیش‌ها ناموفق بود.")}
          onRetry={() => refreshClips()}
        />
      ) : clips.length === 0 ? (
        tab === "active" ? (
          debouncedQ || tag ? (
            <EmptyState
              title="فیشی با این جست‌وجو یا برچسب یافت نشد."
              hint="عبارت جست‌وجو یا فیلتر برچسب را تغییر دهید."
              action={
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    setQ("");
                    setTag(null);
                  }}
                >
                  پاک‌کردن جست‌وجو و فیلتر
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="در این پرونده هنوز فیشی ثبت نشده است."
              hint="در میز مطالعه بخشی از متن را انتخاب کنید و «ثبت فیش» را بزنید تا در این پرونده ذخیره شود."
            />
          )
        ) : (
          <EmptyState
            title="سطل بازیافت خالی است."
            hint="فیش‌های حذف‌شده به این بخش می‌آیند و قابل بازیابی‌اند."
          />
        )
      ) : (
        <ul className="space-y-3" aria-live="polite">
          {clips.map((clip) => (
            <li key={clip.uid}>
              <ClipCard
                clip={clip}
                workTitle={worksMapQuery.data?.[clip.source?.work_uid ?? ""] ?? null}
                trashed={tab === "trashed"}
                pendingAction={pendingAction}
                onEditNote={openEdit}
                onShowHistory={openHistory}
                onTrash={(c) => void trashClip(c)}
                onRestore={(c) => void restoreClip(c)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* ---------- گفت‌وگوی ویرایش یادداشت ---------- */}
      <Dialog
        open={editClip !== null && !conflict}
        onOpenChange={(o) => !o && setEditClip(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ویرایش یادداشت فیش</DialogTitle>
            <DialogDescription>
              یادداشت شما همراه فیش ذخیره می‌شود؛ نقل‌قول اصل دست‌نخورده می‌ماند.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <blockquote className="max-h-28 overflow-y-auto rounded-lg bg-accent/50 px-3 py-2 text-sm leading-7">
              {editClip?.quote_original}
            </blockquote>
            <div className="space-y-1.5">
              <Label htmlFor="clip-note">یادداشت</Label>
              <Textarea
                id="clip-note"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                className="min-h-28 text-sm"
                placeholder="یادداشت پژوهشی خود را بنویسید…"
              />
              {editError ? (
                <p className="text-sm text-destructive" role="alert">
                  {editError}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setEditClip(null)}
            >
              انصراف
            </Button>
            <Button
              className="min-h-11"
              disabled={editClip === null}
              onClick={() => {
                if (editClip) void saveNote(editClip, editNote);
              }}
            >
              ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- تعارض نسخهٔ یادداشت (RES-14): انتخاب کاربر ---------- */}
      <Dialog
        open={conflict !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConflict(null);
            setEditClip(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>این یادداشت پیش‌تر در جای دیگری ذخیره شده است</DialogTitle>
            <DialogDescription>
              نسخهٔ شما با نسخهٔ موجود در سامانه متفاوت است؛ کدام نسخه حفظ شود؟
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-semibold text-foreground">نسخهٔ شما</p>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-7">
                {conflict?.draft || "—"}
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-semibold text-foreground">نسخهٔ موجود در سامانه</p>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-7">
                {conflict?.serverClip.note || "—"}
              </p>
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setConflict(null);
                setEditClip(null);
                refreshClips();
              }}
            >
              حفظ نسخهٔ سامانه
            </Button>
            <Button
              className="min-h-11"
              disabled={!conflict}
              onClick={() => {
                if (conflict) void saveNote(conflict.serverClip, conflict.draft);
              }}
            >
              حفظ نسخهٔ من
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- گفت‌وگوی تاریخچهٔ فیش ---------- */}
      <Dialog
        open={historyClip !== null}
        onOpenChange={(o) => !o && setHistoryClip(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>تاریخچهٔ فیش</DialogTitle>
            <DialogDescription>
              نسخه‌های پیشین این فیش؛ با هر ذخیره، نسخهٔ قبلی نگه داشته می‌شود.
            </DialogDescription>
          </DialogHeader>
          {historyQuery.isPending ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              در حال بارگیری تاریخچه…
            </div>
          ) : historyQuery.isError ? (
            <ErrorState
              message="بارگیری تاریخچهٔ فیش ناموفق بود."
              onRetry={() => void historyQuery.refetch()}
            />
          ) : (historyQuery.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="تغییری ثبت نشده است."
              hint="این فیش تاکنون ویرایش نشده و نسخهٔ پیشینی ندارد."
            />
          ) : (
            <ul className="max-h-80 space-y-3 overflow-y-auto pe-1" aria-live="polite">
              {historyQuery.data?.map((rev, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  <p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden="true" />
                    نسخهٔ {faNum(typeof rev.version === "number" ? rev.version : 0)}
                    {typeof rev.updated_at === "string" ? ` · ${faDate(rev.updated_at)}` : ""}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-7">
                    {typeof rev.note === "string" && rev.note ? rev.note : "بدون یادداشت"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setHistoryClip(null)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ProjectRow = {
  uid: string;
  name: string;
};
