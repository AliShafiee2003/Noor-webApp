"use client";

/**
 * دیالوگ خروجی PDF از کتاب (§۷-الف-۲):
 * - انتخاب «کل جلد» یا «بازهٔ صفحهٔ چاپی» + گزینهٔ درج یادداشت‌ها/هایلایت‌های خصوصی.
 * - کار پس‌زمینه‌ای ساخته می‌شود (سقف هم‌زمانی سمت سرور) و وضعیتش با polling دیده می‌شود.
 * - لینک دانلود خصوصی است و ۲۴ ساعت اعتبار دارد.
 * همهٔ متن‌ها فارسی و RTL-ایمن (خواص منطقی ms-/me-).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { faDateTime, faNum } from "@/lib/format";
import type { PageRef, PdfJob } from "@/lib/types";

export interface PdfExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentUid: string;
  documentLabel: string;
  workTitle: string;
  pages: PageRef[];
  currentPageUid: string | null;
}

type ScopeMode = "whole" | "range";

/** چیپ وضعیت کار — رنگ‌بندی ملایم و هماهنگ با پوسته‌ها */
function StatusChip({ status }: { status: PdfJob["status"] }) {
  const map: Record<PdfJob["status"], { text: string; className: string }> = {
    queued: { text: "در صف", className: "bg-muted text-muted-foreground" },
    running: { text: "در حال ساخت", className: "bg-muted text-foreground" },
    done: { text: "آماده", className: "bg-ayah-soft text-ayah" },
    failed: { text: "ناموفق", className: "bg-destructive/10 text-destructive" },
  };
  const { text, className } = map[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {text}
    </span>
  );
}

/** حجم فایل — زیر یک مگابایت کیلوبایت نشان داده می‌شود تا «۰.۰ مگابایت» نداشته باشیم */
function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${faNum(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
  return `${faNum((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
}

export function PdfExportDialog({
  open,
  onOpenChange,
  documentUid,
  documentLabel,
  workTitle,
  pages,
  currentPageUid,
}: PdfExportDialogProps) {
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<ScopeMode>("whole");
  const [fromLabel, setFromLabel] = useState<string>("");
  const [toLabel, setToLabel] = useState<string>("");
  const [includeNotes, setIncludeNotes] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // برچسب‌های یگانهٔ صفحه‌ها (مقدار = برچسب خام، نمایش = ارقام فارسی)
  const uniqueLabels = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of pages) {
      const label = p.label ?? "";
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
    return out;
  }, [pages]);

  // همگام‌سازی هنگام گشودن: بازهٔ پیش‌فرض = صفحهٔ جاری
  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open && !syncedOpen) {
    setSyncedOpen(true);
    setMode("whole");
    setIncludeNotes(false);
    setCreateError(null);
    const current = pages.find((p) => p.page_uid === currentPageUid);
    const def = current?.label ?? uniqueLabels[0] ?? "";
    setFromLabel(def);
    setToLabel(def);
  }
  if (!open && syncedOpen) {
    setSyncedOpen(false);
  }

  const switchToRange = () => {
    setMode("range");
    if (!fromLabel) {
      const current = pages.find((p) => p.page_uid === currentPageUid);
      const def = current?.label ?? uniqueLabels[0] ?? "";
      setFromLabel(def);
      if (!toLabel) setToLabel(def);
    }
  };

  const createJob = useMutation({
    mutationFn: async () => {
      const range = mode === "range";
      return api.post<{ uid: string }>("/pdf-jobs", {
        document_uid: documentUid,
        document_label: documentLabel,
        work_title: workTitle || null,
        from: range ? fromLabel || null : null,
        to: range ? toLabel || null : null,
        include_notes: includeNotes,
      });
    },
    onSuccess: () => {
      setCreateError(null);
      void queryClient.invalidateQueries({ queryKey: ["pdf-jobs"] });
    },
    onError: (err) => {
      setCreateError(errorMessage(err, "ایجاد کار خروجی ناموفق بود؛ دوباره تلاش کنید."));
    },
  });

  // فهرست کارهای من — هنگام کار فعال هر ۲ ثانیه
  const jobsQuery = useQuery({
    queryKey: ["pdf-jobs"],
    queryFn: () => api.get<{ items: PdfJob[] }>("/pdf-jobs"),
    enabled: open,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((j) => j.status === "queued" || j.status === "running")
        ? 2000
        : false;
    },
  });

  const docJobs = useMemo(
    () => (jobsQuery.data?.items ?? []).filter((j) => j.document_uid === documentUid),
    [jobsQuery.data, documentUid],
  );

  const activeCount = docJobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>خروجی PDF از کتاب</DialogTitle>
          <DialogDescription>
            از متن واقعی همین نسخه، فایلی با جهت راست‌به‌چپ، قلم‌های سه‌گانه و صفحه‌بندی خوانا ساخته می‌شود؛ سپس می‌توانید آن را دانلود کنید.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* بازهٔ استخراج */}
          <div className="space-y-1.5">
            <Label>بازهٔ استخراج</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => (v === "range" ? switchToRange() : setMode("whole"))}
              className="gap-2"
            >
              <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
                <RadioGroupItem value="whole" id="pdf-scope-whole" className="mt-1" />
                <Label htmlFor="pdf-scope-whole" className="cursor-pointer">
                  کل جلد
                </Label>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
                <RadioGroupItem value="range" id="pdf-scope-range" className="mt-1" />
                <Label htmlFor="pdf-scope-range" className="cursor-pointer">
                  بازهٔ صفحهٔ چاپی
                </Label>
              </div>
            </RadioGroup>

            {mode === "range" ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-from" className="text-xs text-muted-foreground">
                    از صفحهٔ
                  </Label>
                  <Select value={fromLabel} onValueChange={setFromLabel}>
                    <SelectTrigger id="pdf-from" className="min-h-11 w-full md:min-h-9">
                      <SelectValue placeholder="انتخاب صفحه" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueLabels.map((label) => (
                        <SelectItem key={label} value={label}>
                          {faNum(label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-to" className="text-xs text-muted-foreground">
                    تا صفحهٔ
                  </Label>
                  <Select value={toLabel} onValueChange={setToLabel}>
                    <SelectTrigger id="pdf-to" className="min-h-11 w-full md:min-h-9">
                      <SelectValue placeholder="انتخاب صفحه" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueLabels.map((label) => (
                        <SelectItem key={label} value={label}>
                          {faNum(label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
          </div>

          {/* یادداشت‌های خصوصی */}
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="pdf-include-notes" className="cursor-pointer">
                درج یادداشت‌ها و هایلایت‌های من
              </Label>
              <p className="text-[11px] text-muted-foreground">
                خصوصی؛ فقط در PDF خودتان درج می‌شود.
              </p>
            </div>
            <Switch
              id="pdf-include-notes"
              checked={includeNotes}
              onCheckedChange={setIncludeNotes}
              aria-label="درج یادداشت‌ها و هایلایت‌های من در PDF"
            />
          </div>

          {/* خطای ایجاد کار */}
          {createError ? (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
              aria-live="assertive"
            >
              {createError}
            </p>
          ) : null}

          {/* فهرست کارهای این سند */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">کارهای خروجی این جلد</Label>
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-1 text-xs text-primary hover:underline md:min-h-0"
                onClick={() => void jobsQuery.refetch()}
                aria-label="بازخوانی فهرست کارها"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                بازخوانی
              </button>
            </div>

            {jobsQuery.isLoading ? (
              <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                در حال بارگیری…
              </p>
            ) : docJobs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                هنوز کاری نساخته‌اید؛ با «ساخت PDF» شروع کنید.
              </div>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto pe-1">
                {docJobs.map((job) => (
                  <li key={job.uid} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <StatusChip status={job.status} />
                      <span className="text-xs text-muted-foreground">
                        {job.params?.whole
                          ? "کل جلد"
                          : `صفحات ${faNum(job.params?.from ?? "")} تا ${faNum(job.params?.to ?? "")}`}
                        {job.params?.include_notes ? " + یادداشت‌های من" : ""}
                      </span>
                      {job.created_at ? (
                        <span className="ms-auto text-[11px] text-muted-foreground">
                          {faDateTime(job.created_at)}
                        </span>
                      ) : null}
                    </div>

                    {job.status === "running" ? (
                      <div className="mt-2 space-y-1">
                        <Progress value={job.progress} aria-label={`پیشرفت ساخت PDF: ${job.progress} درصد`} />
                        <p className="text-[11px] text-muted-foreground">
                          {faNum(job.progress)}٪ — ساخت PDF معمولاً چند دقیقه طول می‌کشد.
                        </p>
                      </div>
                    ) : null}

                    {job.status === "queued" ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        کار شما در صف اجراست؛ به‌زودی آغاز می‌شود.
                      </p>
                    ) : null}

                    {job.status === "failed" ? (
                      <p className="mt-2 text-xs text-destructive" aria-live="assertive">
                        {job.status_note || "ساخت PDF ناموفق بود؛ دوباره تلاش کنید."}
                      </p>
                    ) : null}

                    {job.status === "done" ? (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {job.file_bytes ? (
                            <span className="text-xs text-muted-foreground">
                              {formatSize(job.file_bytes)}
                            </span>
                          ) : null}
                          {job.token_expires_at ? (
                            <span className="text-[11px] text-muted-foreground">
                              اعتبار لینک: تا {faDateTime(job.token_expires_at)}
                            </span>
                          ) : null}
                        </div>
                        {job.download_url ? (
                          <Button asChild size="sm" className="min-h-11 gap-1.5 md:min-h-8">
                            <a href={job.download_url} download>
                              <Download className="size-3.5" aria-hidden="true" />
                              دانلود PDF
                            </a>
                          </Button>
                        ) : (
                          <span className="text-[11px] text-destructive">
                            لینک دانلود منقضی شده است؛ خروجی تازه بگیرید.
                          </span>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="min-h-11 md:min-h-9"
            onClick={() => onOpenChange(false)}
          >
            بستن
          </Button>
          <Button
            className="min-h-11 md:min-h-9"
            disabled={createJob.isPending || activeCount > 0 || (mode === "range" && (!fromLabel || !toLabel))}
            onClick={() => createJob.mutate()}
          >
            {createJob.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                در حال ارسال…
              </>
            ) : activeCount > 0 ? (
              "کاری در حال اجراست…"
            ) : (
              "ساخت PDF"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
