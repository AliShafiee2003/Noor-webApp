"use client";

/**
 * «مدیریت» — فقط برای مدیر سامانه (ADMIN-*)
 * - داشبورد موجودی/پردازش/نسخهٔ فعال/فضای داده — بدون دادهٔ پژوهشی کاربران (ADMIN-10)
 * - کارها + لغو؛ ساخت مجدد نمایه با تأیید
 * - اصلاحات: چرخهٔ پیش‌نویس ← اعتبارسنجی ← پیش‌نمایش ← انتشار (با کد دومرحله‌ای) ← بازگشت نسل
 * - کاربران: دعوت با کد یک‌بارمصرف، غیرفعال/فعال، تغییر نقش (با کد دومرحله‌ای)
 * - حسابرسی: عملیات حساس سامانه
 * - درخواست‌های حساس با هدر X-Noor-MFA (کد ۶ رقمی) ارسال می‌شوند.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  HardDrive,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  ShieldX,
  UserPlus,
  Users,
} from "lucide-react";
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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import { api, ApiError, apiUrl, errorMessage, getCsrfToken } from "@/lib/api";
import { faDateTime, faNum } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/store/auth";
import type { UserRole, Work, WorkDetail } from "@/lib/types";

/* ---------- انواع پاسخ‌های مدیریت (مطابق پیاده‌سازی سرور) ---------- */

interface AdminOverviewData {
  release_uid: string | null;
  works_count: number;
  documents_count: number;
  users_count: number;
  active_sessions: number;
  pending_overlays: number;
  active_jobs: number;
  registered_sources: number;
  data_dir_bytes: number;
  engine: string;
  index_version: string;
  n1_version: string;
  note: string;
}

interface AdminJobRow {
  uid: string;
  kind: string;
  status: string;
  progress?: number;
  /** یادداشت پیشرفت — نام فیلد در سرور progress_note است */
  progress_note?: string;
  note?: string;
  error?: string;
  created_at?: string;
}

interface OverlayRow {
  uid: string;
  document_uid: string;
  change_type: string;
  base_hash: string;
  reason: string;
  old_value: string;
  new_value: string;
  status: string;
  created_at: string;
}

interface OverlayPreviewData {
  uid: string;
  status: string;
  change_type: string;
  old_value: string;
  new_value: string;
  reason: string;
  base_hash: string;
  current_hash: string;
  affected_anchors: Array<Record<string, unknown>>;
  note: string;
}

interface ReleaseRow {
  uid: string;
  created_by: string;
  status: string;
  notes: string;
  created_at: string;
}

interface AdminUserRow {
  uid: string;
  username: string;
  display_name: string;
  role: UserRole;
  disabled: boolean;
  created_at: string;
}

interface AuditRow {
  id: number;
  actor: string;
  action: string;
  object_type: string;
  object_uid: string;
  detail: string;
  ip: string;
  created_at: string;
}

/* ---------- واژگان فارسی وضعیت‌ها و انواع ---------- */

const JOB_KIND_LABELS: Record<string, string> = {
  index_rebuild: "ساخت مجدد نمایه",
  import_source: "ورود منبع",
  overlay_publish: "انتشار اصلاح",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "در صف",
  running: "در حال اجرا",
  done: "انجام شد",
  failed: "ناموفق",
  cancelled: "لغو شد",
};

const OVERLAY_STATUS_LABELS: Record<string, string> = {
  draft: "پیش‌نویس",
  validated: "اعتبارسنجی‌شده",
  building: "در حال ساخت نسل",
  ready: "آمادهٔ انتشار",
  published: "منتشر شد",
  superseded: "جایگزین شده",
  failed: "ناموفق",
};

const CHANGE_TYPE_LABELS: Record<string, string> = {
  text_replace: "جایگزینی متن",
  metadata: "فراداده",
};

const RELEASE_STATUS_LABELS: Record<string, string> = {
  published: "منتشرشده",
  rolled_back: "بازگشت‌شده",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: "ورود به سامانه",
  revoke_session: "لغو نشست",
  job_cancel: "لغو کار",
  overlay_publish_start: "آغاز انتشار اصلاح",
  index_rebuild_enqueue: "درخواست ساخت نمایه",
  release_publish: "انتشار نسل محتوا",
  release_rollback: "بازگشت به نسل پیشین",
};

const AUDIT_OBJECT_LABELS: Record<string, string> = {
  user: "کاربر",
  job: "کار",
  overlay: "اصلاح",
  release: "نسل محتوا",
  session: "نشست",
};

function labelFor(map: Record<string, string>, key: string | null | undefined, fallback: string): string {
  if (!key) return fallback;
  return map[key] ?? key;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "ثبت نشده";
  const units = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${faNum(value.toFixed(i === 0 ? 0 : 1))} ${units[i]}`;
}

/* ---------- درخواست حساس با هدر X-Noor-MFA (کد دومرحله‌ای) ---------- */

const MFA_NETWORK_ERROR =
  "ارتباط با سرور برقرار نشد؛ اتصال خود را بررسی کنید و دوباره تلاش کنید.";

async function postWithMfa<T>(path: string, body: unknown, code: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Noor-MFA": code,
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-Noor-CSRF"] = csrf;

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError({
      code: "unavailable",
      message: MFA_NETWORK_ERROR,
      retryable: true,
      status: 0,
    });
  }

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      /* بدنهٔ غیر JSON */
    }
    const err =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: { code?: string; message?: string; trace_id?: string; retryable?: boolean } }).error
        : null;
    throw new ApiError({
      code: err?.code ?? "internal",
      message:
        err?.message ?? "پاسخ نامعتبری از سرور دریافت شد؛ دوباره تلاش کنید.",
      traceId: err?.trace_id ?? null,
      retryable: err?.retryable === true,
      status: response.status,
    });
  }

  return (await response.json()) as T;
}

/* ---------- گفت‌وگوی کد تأیید دومرحله‌ای (۶ رقمی) ---------- */

function MfaDialog({
  open,
  onOpenChange,
  title,
  description,
  pending,
  error,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  pending: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  // بازنشانی کد هنگام باز شدن گفت‌وگو (تنظیم state در زمان رندر — الگوی مجاز)
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setCode("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2" dir="ltr">
          <InputOTP maxLength={6} value={code} onChange={(v) => setCode(v.replace(/\D/g, ""))}>
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} className="size-11 text-base" />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {error ? (
            <p className="text-sm text-destructive" role="alert" dir="rtl">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button
            className="min-h-11 gap-2"
            disabled={code.length !== 6 || pending}
            onClick={() => onSubmit(code)}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- کارت آماری داشبورد ---------- */

function StatCard({ icon: Icon, title, value, hint }: {
  icon: typeof Users;
  title: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{title}</p>
          <p className="text-lg font-bold text-foreground">{value}</p>
          {hint ? <p className="truncate text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- تب داشبورد ---------- */

function AdminOverviewTab() {
  const overviewQuery = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => api.get<AdminOverviewData>("/admin/overview"),
    refetchInterval: 20_000,
  });

  if (overviewQuery.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
        <span className="sr-only">در حال بارگیری داشبورد…</span>
      </div>
    );
  }
  if (overviewQuery.isError) {
    return (
      <ErrorState
        message={errorMessage(overviewQuery.error, "بارگیری داشبورد مدیریت ناموفق بود.")}
        onRetry={() => void overviewQuery.refetch()}
      />
    );
  }

  const d = overviewQuery.data;
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={Database} title="آثار" value={faNum(d.works_count)} />
        <StatCard icon={Database} title="اسناد" value={faNum(d.documents_count)} />
        <StatCard icon={Users} title="کاربران" value={faNum(d.users_count)} />
        <StatCard icon={ShieldCheck} title="نشست‌های فعال" value={faNum(d.active_sessions)} />
        <StatCard icon={History} title="اصلاحات در انتظار" value={faNum(d.pending_overlays)} hint="پیش‌نویس و اعتبارسنجی‌شده" />
        <StatCard icon={RefreshCw} title="کارهای فعال" value={faNum(d.active_jobs)} />
        <StatCard icon={HardDrive} title="فضای داده" value={formatBytes(d.data_dir_bytes)} />
        <StatCard icon={Database} title="منابع ثبت‌شده" value={faNum(d.registered_sources)} />
        <StatCard
          icon={ShieldCheck}
          title="نسخهٔ فعال محتوا"
          value={d.release_uid ? "نسخهٔ منتشرشده" : "ثبت نشده"}
          hint={d.release_uid ?? undefined}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface p-4 text-sm">
        <p className="font-medium text-foreground">
          نسخهٔ فعال محتوا:{" "}
          {d.release_uid ? (
            <span className="bidi-ltr font-mono text-xs">{d.release_uid}</span>
          ) : (
            "ثبت نشده"
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          موتور جست‌وجو: {labelFor({}, d.engine, "نامشخص")} · نسخهٔ نمایه:{" "}
          <span className="bidi-ltr">{d.index_version}</span>
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-border bg-accent/40 p-4">
        <p className="text-sm leading-7 text-foreground">
          {d.note || "دادهٔ پژوهشی خصوصی کاربران در این داشبورد نمایش داده نمی‌شود."}
        </p>
      </div>
    </div>
  );
}

/* ---------- تب کارها ---------- */

function AdminJobsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rebuildOpen, setRebuildOpen] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ["admin-jobs"],
    queryFn: () => api.get<{ items: AdminJobRow[] }>("/admin/jobs"),
    refetchInterval: 8_000,
  });
  const jobs = jobsQuery.data?.items ?? [];

  const cancelMutation = useMutation({
    mutationFn: (uid: string) => api.post<{ ok: boolean }>(`/admin/jobs/${uid}/cancel`),
    onSuccess: () => {
      toast({ title: "کار لغو شد." });
      void queryClient.invalidateQueries({ queryKey: ["admin-jobs"] });
    },
    onError: (err) => {
      toast({ title: "لغو کار ممکن نشد.", description: errorMessage(err), variant: "destructive" });
    },
  });

  const rebuildMutation = useMutation({
    mutationFn: () => api.post<{ job_uid: string }>("/admin/index/rebuild"),
    onSuccess: () => {
      setRebuildOpen(false);
      toast({ title: "کار ساخت مجدد نمایه در صف قرار گرفت." });
      void queryClient.invalidateQueries({ queryKey: ["admin-jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (err) => {
      toast({
        title: "درخواست ساخت نمایه ثبت نشد.",
        description: errorMessage(err),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="outline"
          className="min-h-11 gap-2"
          disabled={rebuildMutation.isPending}
          onClick={() => setRebuildOpen(true)}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          ساخت مجدد نمایه
        </Button>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          وضعیت کارها هر چند ثانیه به‌روزرسانی می‌شود.
        </p>
      </div>

      {jobsQuery.isPending ? (
        <ListSkeleton rows={4} />
      ) : jobsQuery.isError ? (
        <ErrorState
          message={errorMessage(jobsQuery.error, "بارگیری فهرست کارها ناموفق بود.")}
          onRetry={() => void jobsQuery.refetch()}
        />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="کاری در صف یا اجرا نیست."
          hint="کارهای پردازش (مانند ساخت مجدد نمایه) در این فهرست دیده می‌شوند."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>نوع کار</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>پیشرفت</TableHead>
                <TableHead>زمان ثبت</TableHead>
                <TableHead className="text-start">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const cancellable = job.status === "queued" || job.status === "running";
                return (
                  <TableRow key={job.uid}>
                    <TableCell className="font-medium">
                      {labelFor(JOB_KIND_LABELS, job.kind, "کار سامانه")}
                      {job.error ? (
                        <p className="mt-1 max-w-64 text-xs text-destructive">{job.error}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          job.status === "done"
                            ? "secondary"
                            : job.status === "failed"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {labelFor(JOB_STATUS_LABELS, job.status, "نامشخص")}
                      </Badge>
                      {job.progress_note || job.note ? (
                        <p className="mt-1 text-xs text-muted-foreground">{job.progress_note || job.note}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {typeof job.progress === "number" ? `${faNum(job.progress)}٪` : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {faDateTime(job.created_at) || "—"}
                    </TableCell>
                    <TableCell>
                      {cancellable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-11 text-destructive hover:text-destructive"
                          disabled={cancelMutation.isPending}
                          onClick={() => cancelMutation.mutate(job.uid)}
                        >
                          لغو کار
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={rebuildOpen} onOpenChange={setRebuildOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ساخت مجدد نمایهٔ جست‌وجو؟</AlertDialogTitle>
            <AlertDialogDescription>
              نمایهٔ تازه‌ای از کل منابع ساخته می‌شود؛ تا پایان کار، جست‌وجو با نمایهٔ فعلی ادامه
              می‌یابد و هیچ نتیجه‌ای از دست نمی‌رود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={(e) => {
                e.preventDefault();
                rebuildMutation.mutate();
              }}
            >
              {rebuildMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              شروع ساخت نمایه
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------- تب اصلاحات (overlay) ---------- */

function AdminOverlaysTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const overlaysQuery = useQuery({
    queryKey: ["admin-overlays"],
    queryFn: () => api.get<{ items: OverlayRow[] }>("/admin/overlays"),
  });
  const overlays = overlaysQuery.data?.items ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-overlays"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
  };

  /* خطای سطری (مثلاً تعارض hash در اعتبارسنجی) */
  const [rowError, setRowError] = useState<{ uid: string; message: string } | null>(null);

  /* ---------- گفت‌وگوی ساخت اصلاح ---------- */
  const [createOpen, setCreateOpen] = useState(false);
  const worksQuery = useQuery({
    queryKey: ["admin-works"],
    queryFn: () => api.get<{ items: Work[] }>("/works", { page_size: 100 }),
    enabled: createOpen,
    staleTime: 5 * 60_000,
  });
  const [formWork, setFormWork] = useState<string | null>(null);
  const workDetailQuery = useQuery({
    queryKey: ["admin-work-docs", formWork],
    queryFn: () => api.get<WorkDetail>(`/works/${formWork}`),
    enabled: !!formWork,
    staleTime: 5 * 60_000,
  });
  const [formDoc, setFormDoc] = useState<string | null>(null);
  const [formType, setFormType] = useState<"text_replace" | "metadata">("text_replace");
  const [formReason, setFormReason] = useState("");
  const [formBaseHash, setFormBaseHash] = useState("");
  const [formNewText, setFormNewText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // نشانهٔ متن مبنی سند (دور ۱۴): قبلاً ادمین راهی برای دانستن base_hash نداشت و
  // ثبت پیش‌نویسِ قابل اعتبارسنجی عملاً ناممکن بود. با انتخاب سند، نشانهٔ فعلی
  // واکشی و خودکار پر می‌شود؛ دکمهٔ به‌روزرسانی هم در کنار فیلد هست.
  const revisionInfoQuery = useQuery({
    queryKey: ["admin-doc-revision-info", formDoc],
    queryFn: () => api.get<{ document_uid: string; base_hash: string }>(`/admin/documents/${formDoc}/revision-info`),
    enabled: !!formDoc,
    staleTime: 30_000,
  });
  const [hashAutoDoc, setHashAutoDoc] = useState<string | null>(null);
  if (revisionInfoQuery.data && formDoc && hashAutoDoc !== formDoc) {
    // الگوی مجاز: تنظیم state در زمان رندر برای واکنش به دادهٔ تازه
    setHashAutoDoc(formDoc);
    setFormBaseHash(revisionInfoQuery.data.base_hash);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<OverlayRow>("/admin/overlays", {
        document_uid: formDoc,
        change_type: formType,
        reason: formReason.trim(),
        base_hash: formBaseHash.trim(),
        // قرارداد Go: new_value (رفع باگ دور ۱۴ — قبلاً new_text فرستاده می‌شد و
        // سرور «متن جدید خالی است» می‌داد؛ ثبت اصلاح از رابط کاربری عملاً شکسته بود)
        new_value: formNewText,
      }),
    onSuccess: () => {
      setCreateOpen(false);
      setFormWork(null);
      setFormDoc(null);
      setFormType("text_replace");
      setFormReason("");
      setFormBaseHash("");
      setFormNewText("");
      setFormError(null);
      refresh();
      toast({ title: "پیش‌نویس اصلاح ثبت شد؛ پس از اعتبارسنجی قابل انتشار است." });
    },
    onError: (err) => {
      setFormError(errorMessage(err, "ثبت اصلاح ممکن نشد؛ داده‌ها را بررسی کنید."));
    },
  });

  const openCreate = () => {
    setFormError(null);
    setCreateOpen(true);
  };

  /* ---------- اعتبارسنجی ---------- */
  const validateMutation = useMutation({
    mutationFn: (uid: string) => api.post<OverlayRow>(`/admin/overlays/${uid}/validate`),
    onSuccess: () => {
      setRowError(null);
      refresh();
      toast({ title: "اعتبارسنجی موفق بود؛ اصلاح برای انتشار آماده است." });
    },
    onError: (err, uid) => {
      setRowError({ uid, message: errorMessage(err, "اعتبارسنجی ناموفق بود.") });
    },
  });

  /* ---------- پیش‌نمایش ---------- */
  const [previewUid, setPreviewUid] = useState<string | null>(null);
  const previewQuery = useQuery({
    queryKey: ["admin-overlay-preview", previewUid],
    queryFn: () => api.get<OverlayPreviewData>(`/admin/overlays/${previewUid}/preview`),
    enabled: !!previewUid,
  });
  const preview = previewQuery.data ?? null;
  const baseHashMismatch = preview ? preview.base_hash !== preview.current_hash : false;

  /* ---------- انتشار (با کد دومرحله‌ای) ---------- */
  const [publishTarget, setPublishTarget] = useState<OverlayRow | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [publishPending, setPublishPending] = useState(false);

  const submitPublish = async (code: string) => {
    if (!publishTarget) return;
    setPublishPending(true);
    setMfaError(null);
    try {
      await postWithMfa<{ job_uid: string; status: string }>(
        `/admin/overlays/${publishTarget.uid}/publish`,
        {},
        code,
      );
      setPublishTarget(null);
      refresh();
      toast({
        title: "فرایند انتشار آغاز شد.",
        description: "پس از ساخت نسل تازه، متن اصلاح‌شده برای همهٔ کاربران فعال می‌شود.",
      });
    } catch (err) {
      setMfaError(errorMessage(err, "انتشار ممکن نشد؛ کد را بررسی کنید."));
    } finally {
      setPublishPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          اصلاحات پیش از دیدن کاربران، از چرخهٔ اعتبارسنجی و انتشار می‌گذرند.
        </p>
        <Button className="min-h-11" onClick={openCreate}>
          اصلاح جدید
        </Button>
      </div>

      {overlaysQuery.isPending ? (
        <ListSkeleton rows={3} />
      ) : overlaysQuery.isError ? (
        <ErrorState
          message={errorMessage(overlaysQuery.error, "بارگیری فهرست اصلاحات ناموفق بود.")}
          onRetry={() => void overlaysQuery.refetch()}
        />
      ) : overlays.length === 0 ? (
        <EmptyState
          title="اصلاحی ثبت نشده است."
          hint="برای اصلاح متن یا فرادادهٔ یک سند، «اصلاح جدید» را آغاز کنید."
          action={
            <Button className="min-h-11" onClick={openCreate}>
              اصلاح جدید
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3" aria-live="polite">
          {overlays.map((ov) => (
            <li key={ov.uid}>
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{labelFor(OVERLAY_STATUS_LABELS, ov.status, "نامشخص")}</Badge>
                      <Badge variant="secondary" className="font-normal">
                        {labelFor(CHANGE_TYPE_LABELS, ov.change_type, "تغییر")}
                      </Badge>
                      <span className="bidi-ltr font-mono text-xs text-muted-foreground">
                        {ov.document_uid}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {faDateTime(ov.created_at) || ""}
                    </span>
                  </div>
                  <p className="text-sm leading-7 text-foreground">
                    <span className="text-xs text-muted-foreground">دلیل: </span>
                    {ov.reason || "ثبت نشده"}
                  </p>
                  {ov.change_type === "text_replace" && ov.new_value ? (
                    <p className="rounded-lg bg-accent/50 px-3 py-2 text-sm leading-7" lang="ar" dir="rtl">
                      {ov.new_value}
                    </p>
                  ) : null}
                  {rowError?.uid === ov.uid ? (
                    <p className="text-sm text-destructive" role="alert">
                      {rowError.message}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                    {ov.status === "draft" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 gap-2"
                        disabled={validateMutation.isPending}
                        onClick={() => validateMutation.mutate(ov.uid)}
                      >
                        {validateMutation.isPending && validateMutation.variables === ov.uid ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        اعتبارسنجی
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={() => setPreviewUid(ov.uid)}
                    >
                      پیش‌نمایش
                    </Button>
                    {(ov.status === "validated" || ov.status === "ready") ? (
                      <Button
                        size="sm"
                        className="min-h-11 gap-2"
                        onClick={() => {
                          setMfaError(null);
                          setPublishTarget(ov);
                        }}
                      >
                        انتشار اصلاحات
                      </Button>
                    ) : null}
                    {ov.status === "published" ? (
                      <span className="text-xs text-muted-foreground">این اصلاح منتشر شده است.</span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* گفت‌وگوی اصلاح جدید */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>اصلاح جدید</DialogTitle>
            <DialogDescription>
              پیش‌نویس اصلاح پیش از انتشار، اعتبارسنجی و پیش‌نمایش می‌شود؛ متن کاربران تا انتشار
              تغییر نمی‌کند.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="overlay-work">اثر</Label>
                <Select
                  value={formWork ?? ""}
                  onValueChange={(v) => {
                    setFormWork(v || null);
                    setFormDoc(null);
                  }}
                >
                  <SelectTrigger id="overlay-work" className="min-h-11 w-full">
                    <SelectValue
                      placeholder={
                        worksQuery.isPending ? "در حال بارگیری…" : "اثر را انتخاب کنید"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(worksQuery.data?.items ?? []).map((w) => (
                      <SelectItem key={w.uid} value={w.uid}>
                        {w.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="overlay-doc">سند</Label>
                <Select
                  value={formDoc ?? ""}
                  onValueChange={(v) => setFormDoc(v || null)}
                  disabled={!formWork}
                >
                  <SelectTrigger id="overlay-doc" className="min-h-11 w-full">
                    <SelectValue
                      placeholder={!formWork ? "نخست اثر را انتخاب کنید" : "سند را انتخاب کنید"}
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(workDetailQuery.data?.documents ?? []).map((doc) => (
                      <SelectItem key={doc.uid} value={doc.uid}>
                        {doc.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>نوع تغییر</Label>
              <RadioGroup
                value={formType}
                onValueChange={(v) => setFormType(v === "metadata" ? "metadata" : "text_replace")}
                className="gap-2"
              >
                <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <RadioGroupItem value="text_replace" id="overlay-type-text" />
                  <Label htmlFor="overlay-type-text" className="cursor-pointer font-normal">
                    جایگزینی متن
                  </Label>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <RadioGroupItem value="metadata" id="overlay-type-meta" />
                  <Label htmlFor="overlay-type-meta" className="cursor-pointer font-normal">
                    فراداده
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="overlay-reason">دلیل اصلاح</Label>
              <Input
                id="overlay-reason"
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                placeholder="مثلاً: تصحیح خطای تایپی منبع چاپی"
                className="min-h-11"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="overlay-base-hash">نشانهٔ متن مبنا</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-9 gap-1 text-xs"
                  disabled={!formDoc || revisionInfoQuery.isFetching}
                  onClick={() => {
                    setHashAutoDoc(null); // اجازهٔ پرکردن مجدد خودکار
                    void revisionInfoQuery.refetch();
                  }}
                >
                  <Loader2 className={revisionInfoQuery.isFetching ? "size-3 animate-spin" : "hidden size-3"} aria-hidden="true" />
                  به‌روزرسانی نشانهٔ فعلی
                </Button>
              </div>
              <Input
                id="overlay-base-hash"
                value={formBaseHash}
                onChange={(e) => setFormBaseHash(e.target.value)}
                dir="ltr"
                className="bidi-ltr min-h-11 font-mono text-xs"
                placeholder="sha256:…"
              />
              <p className="text-xs text-muted-foreground">
                {formDoc
                  ? revisionInfoQuery.isPending
                    ? "در حال خواندن نشانهٔ فعلی سند…"
                    : "با انتخاب سند پر شد؛ برای سازگاری هم‌زمانی ویرایش‌ها در زمان انتشار کنترل می‌شود."
                  : "نخست اثر و سند را انتخاب کنید تا نشانهٔ متن مبنی خودکار پر شود."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="overlay-new-text">متن جدید</Label>
              <Textarea
                id="overlay-new-text"
                value={formNewText}
                onChange={(e) => setFormNewText(e.target.value)}
                className="min-h-24 text-sm"
                placeholder="متن جایگزین…"
              />
            </div>
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setCreateOpen(false)}>
              انصراف
            </Button>
            <Button
              className="min-h-11 gap-2"
              disabled={!formDoc || !formReason.trim() || !formBaseHash.trim() || !formNewText.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              ثبت پیش‌نویس
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* گفت‌وگوی پیش‌نمایش */}
      <Dialog open={previewUid !== null} onOpenChange={(o) => !o && setPreviewUid(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>پیش‌نمایش اصلاح</DialogTitle>
            <DialogDescription>
              تا انتشار، متن نمایشی کاربران تغییر نمی‌کند.
            </DialogDescription>
          </DialogHeader>
          {previewQuery.isPending ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              در حال آماده‌سازی پیش‌نمایش…
            </div>
          ) : previewQuery.isError || !preview ? (
            <ErrorState
              message="آماده‌سازی پیش‌نمایش ممکن نشد."
              onRetry={() => void previewQuery.refetch()}
            />
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-muted-foreground">متن فعلی</p>
                  <p className="whitespace-pre-wrap text-sm leading-7" lang="ar" dir="rtl">
                    {preview.old_value || "—"}
                  </p>
                </div>
                <div className="space-y-1 rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-muted-foreground">پس از اصلاح</p>
                  <p className="whitespace-pre-wrap text-sm leading-7" lang="ar" dir="rtl">
                    {preview.new_value || "—"}
                  </p>
                </div>
              </div>
              {baseHashMismatch ? (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  متن مبنا پس از ثبت این اصلاح تغییر کرده است؛ پیش از انتشار، اعتبارسنجی دوباره لازم است.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                تعداد ارجاع‌های متأثر: {faNum(preview.affected_anchors.length)}
              </p>
              <p className="rounded-lg bg-accent/40 px-3 py-2 text-xs leading-6 text-muted-foreground">
                {preview.note}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setPreviewUid(null)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* گفت‌وگوی انتشار با کد دومرحله‌ای */}
      <MfaDialog
        open={publishTarget !== null}
        onOpenChange={(o) => {
          if (!o) setPublishTarget(null);
        }}
        title="انتشار اصلاحات"
        description="برای انتشار، کد تأیید دومرحله‌ای (۶ رقمی) حساب خود را وارد کنید."
        pending={publishPending}
        error={mfaError}
        submitLabel="انتشار"
        onSubmit={(code) => void submitPublish(code)}
      />
    </div>
  );
}

/* ---------- تب نسل‌ها ---------- */

function AdminReleasesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const releasesQuery = useQuery({
    queryKey: ["admin-releases"],
    queryFn: () => api.get<{ items: ReleaseRow[] }>("/admin/releases"),
  });
  const overviewQuery = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => api.get<AdminOverviewData>("/admin/overview"),
    staleTime: 15_000,
  });
  const releases = releasesQuery.data?.items ?? [];
  const activeRelease = overviewQuery.data?.release_uid ?? null;

  const [rollbackTarget, setRollbackTarget] = useState<ReleaseRow | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submitRollback = async (code: string) => {
    if (!rollbackTarget) return;
    setPending(true);
    setMfaError(null);
    try {
      await postWithMfa<{ ok: boolean }>(
        `/admin/releases/${rollbackTarget.uid}/rollback`,
        {},
        code,
      );
      setRollbackTarget(null);
      toast({ title: "بازگشت به نسل انجام شد." });
      void queryClient.invalidateQueries({ queryKey: ["admin-releases"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    } catch (err) {
      setMfaError(errorMessage(err, "بازگشت نسل ممکن نشد؛ کد را بررسی کنید."));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        نسل‌های محتوا تاریخچهٔ متن منتشرشده را نگه می‌دارند؛ بازگشت به نسل پیشین با کد دومرحله‌ای
        انجام می‌شود.
      </p>

      {releasesQuery.isPending ? (
        <ListSkeleton rows={3} />
      ) : releasesQuery.isError ? (
        <ErrorState
          message={errorMessage(releasesQuery.error, "بارگیری فهرست نسل‌ها ناموفق بود.")}
          onRetry={() => void releasesQuery.refetch()}
        />
      ) : releases.length === 0 ? (
        <EmptyState
          title="نسلی ثبت نشده است."
          hint="نسل‌ها با انتشار اصلاحات یا ساخت نمایه ایجاد می‌شوند."
        />
      ) : (
        <ul className="space-y-3" aria-live="polite">
          {releases.map((rel) => {
            const isActive = rel.uid === activeRelease;
            return (
              <li key={rel.uid}>
                <Card className={isActive ? "border-primary/50" : undefined}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="bidi-ltr font-mono text-xs text-foreground">{rel.uid}</span>
                        <Badge variant={isActive ? "default" : "outline"}>
                          {isActive ? "نسخهٔ فعال" : labelFor(RELEASE_STATUS_LABELS, rel.status, "نسخهٔ محتوا")}
                        </Badge>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {faDateTime(rel.created_at) || ""}
                        {rel.notes ? ` · ${rel.notes}` : ""}
                      </p>
                    </div>
                    {!isActive && rel.status === "published" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 gap-2"
                        onClick={() => {
                          setMfaError(null);
                          setRollbackTarget(rel);
                        }}
                      >
                        <RotateCcw className="size-4" aria-hidden="true" />
                        بازگشت به این نسل
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <MfaDialog
        open={rollbackTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRollbackTarget(null);
        }}
        title="بازگشت به نسل پیشین"
        description="با بازگشت نسل، متن منتشرشده به نسخهٔ انتخاب‌شده برمی‌گردد. کد تأیید دومرحله‌ای را وارد کنید."
        pending={pending}
        error={mfaError}
        submitLabel="بازگشت نسل"
        onSubmit={(code) => void submitRollback(code)}
      />
    </div>
  );
}

/* ---------- تب کاربران ---------- */

function AdminUsersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get<{ items: AdminUserRow[] }>("/admin/users"),
  });
  const users = usersQuery.data?.items ?? [];

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  /* ---------- دعوت ---------- */
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<UserRole>("reader");
  const [inviteResult, setInviteResult] = useState<{ code: string; note: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitePending, setInvitePending] = useState(false);

  const openInvite = () => {
    setInviteResult(null);
    setInviteError(null);
    setInviteRole("reader");
    setInviteOpen(true);
  };

  const submitInvite = async () => {
    setInvitePending(true);
    setInviteError(null);
    try {
      const res = await api.post<{ code: string; note?: string }>("/admin/invitations", {
        role: inviteRole,
      });
      setInviteResult({ code: res.code, note: res.note ?? "" });
      toast({ title: "دعوت ساخته شد." });
    } catch (err) {
      setInviteError(errorMessage(err, "ساخت دعوت ممکن نشد؛ دوباره تلاش کنید."));
    } finally {
      setInvitePending(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteResult) return;
    try {
      await navigator.clipboard.writeText(inviteResult.code);
      toast({ title: "کد دعوت کپی شد." });
    } catch {
      toast({
        title: "کپی ممکن نشد.",
        description: "کد را به‌صورت دستی بردارید.",
        variant: "destructive",
      });
    }
  };

  /* ---------- غیرفعال / فعال ---------- */
  const [disableTarget, setDisableTarget] = useState<AdminUserRow | null>(null);
  const toggleMutation = useMutation({
    mutationFn: ({ uid, disable }: { uid: string; disable: boolean }) =>
      api.post<{ ok: boolean }>(`/admin/users/${uid}/${disable ? "disable" : "enable"}`),
    onSuccess: (_data, vars) => {
      setDisableTarget(null);
      refresh();
      toast({
        title: vars.disable ? "حساب کاربر غیرفعال شد." : "حساب کاربر فعال شد.",
      });
    },
    onError: (err) => {
      setDisableTarget(null);
      toast({
        title: "تغییر وضعیت حساب ممکن نشد.",
        description: errorMessage(err),
        variant: "destructive",
      });
    },
  });

  /* ---------- تغییر نقش (با کد دومرحله‌ای) ---------- */
  const [roleTarget, setRoleTarget] = useState<AdminUserRow | null>(null);
  const [roleChoice, setRoleChoice] = useState<UserRole>("reader");
  const [roleCode, setRoleCode] = useState("");
  const [roleMfaError, setRoleMfaError] = useState<string | null>(null);
  const [rolePending, setRolePending] = useState(false);

  const openRoleChange = (u: AdminUserRow) => {
    setRoleChoice(u.role);
    setRoleCode("");
    setRoleMfaError(null);
    setRoleTarget(u);
  };

  const submitRoleChange = async () => {
    if (!roleTarget || roleCode.length !== 6) return;
    setRolePending(true);
    setRoleMfaError(null);
    try {
      await postWithMfa<{ ok: boolean }>(
        `/admin/users/${roleTarget.uid}/role`,
        { role: roleChoice },
        roleCode,
      );
      setRoleTarget(null);
      refresh();
      toast({ title: "نقش کاربر تغییر کرد." });
    } catch (err) {
      setRoleMfaError(errorMessage(err, "تغییر نقش ممکن نشد؛ کد را بررسی کنید."));
    } finally {
      setRolePending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          حساب‌ها و نقش‌ها؛ آخرین مدیر سامانه همیشه محافظت می‌شود.
        </p>
        <Button className="min-h-11 gap-2" onClick={openInvite}>
          <UserPlus className="size-4" aria-hidden="true" />
          دعوت کاربر
        </Button>
      </div>

      {usersQuery.isPending ? (
        <ListSkeleton rows={3} />
      ) : usersQuery.isError ? (
        <ErrorState
          message={errorMessage(usersQuery.error, "بارگیری فهرست کاربران ناموفق بود.")}
          onRetry={() => void usersQuery.refetch()}
        />
      ) : users.length === 0 ? (
        <EmptyState title="کاربری ثبت نشده است." hint="با «دعوت کاربر» نخستین حساب را بسازید." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>نام</TableHead>
                <TableHead>نقش</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead className="text-start">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.uid}>
                  <TableCell>
                    <p className="font-medium text-foreground">{u.display_name}</p>
                    <p className="text-xs text-muted-foreground">{u.username}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                      {roleLabels[u.role] ?? "خواننده"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.disabled ? "destructive" : "outline"}>
                      {u.disabled ? "غیرفعال" : "فعال"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11"
                        onClick={() => openRoleChange(u)}
                      >
                        تغییر نقش
                      </Button>
                      {u.disabled ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          disabled={toggleMutation.isPending}
                          onClick={() => toggleMutation.mutate({ uid: u.uid, disable: false })}
                        >
                          فعال‌سازی
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-11 text-destructive hover:text-destructive"
                          onClick={() => setDisableTarget(u)}
                        >
                          غیرفعال‌سازی
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* گفت‌وگوی دعوت */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>دعوت کاربر</DialogTitle>
            <DialogDescription>
              کد یک‌بارمصرف دعوت ساخته می‌شود؛ فرد دعوت‌شده با همان کد حساب خود را می‌سازد.
            </DialogDescription>
          </DialogHeader>
          {inviteResult ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-dashed border-border bg-accent/40 p-4 text-center">
                <p className="mb-2 text-xs text-muted-foreground">کد یک‌بارمصرف دعوت</p>
                <p className="bidi-ltr select-all font-mono text-lg font-bold tracking-widest text-foreground">
                  {inviteResult.code}
                </p>
              </div>
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive" role="alert">
                این کد یک‌بارمصرف است و ۲۴ ساعت اعتبار دارد؛ آن را همین حالا در جای امن نگه دارید —
                پس از بستن این گفت‌وگو دوباره نمایش داده نمی‌شود.
              </p>
              {inviteResult.note ? (
                <p className="text-xs text-muted-foreground">{inviteResult.note}</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>نقش حساب دعوت‌شده</Label>
                <RadioGroup
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v === "admin" ? "admin" : "reader")}
                  className="gap-2"
                >
                  <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <RadioGroupItem value="reader" id="invite-role-reader" />
                    <Label htmlFor="invite-role-reader" className="cursor-pointer font-normal">
                      خواننده
                    </Label>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <RadioGroupItem value="admin" id="invite-role-admin" />
                    <Label htmlFor="invite-role-admin" className="cursor-pointer font-normal">
                      مدیر سامانه
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              {inviteError ? (
                <p className="text-sm text-destructive" role="alert">
                  {inviteError}
                </p>
              ) : null}
            </div>
          )}
          <DialogFooter>
            {inviteResult ? (
              <>
                <Button variant="outline" className="min-h-11" onClick={() => setInviteOpen(false)}>
                  بستن
                </Button>
                <Button className="min-h-11" onClick={() => void copyInvite()}>
                  کپی کد
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" className="min-h-11" onClick={() => setInviteOpen(false)}>
                  انصراف
                </Button>
                <Button
                  className="min-h-11 gap-2"
                  disabled={invitePending}
                  onClick={() => void submitInvite()}
                >
                  {invitePending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  ساخت کد دعوت
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید غیرفعال‌سازی */}
      <AlertDialog open={disableTarget !== null} onOpenChange={(o) => !o && setDisableTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              غیرفعال‌سازی حساب «{disableTarget?.display_name}»؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              این کاربر تا فعال‌سازی دوباره به سامانه وارد نمی‌شود؛ داده‌های پژوهشی او محفوظ می‌ماند.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (disableTarget) {
                  toggleMutation.mutate({ uid: disableTarget.uid, disable: true });
                }
              }}
            >
              غیرفعال‌سازی حساب
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* گفت‌وگوی تغییر نقش (نقش + کد دومرحله‌ای) */}
      <Dialog
        open={roleTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRoleTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>تغییر نقش «{roleTarget?.display_name}»</DialogTitle>
            <DialogDescription>
              نقش تازه را انتخاب و برای تأیید، کد تأیید دومرحله‌ای (۶ رقمی) را وارد کنید.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="role-choice">نقش تازه</Label>
              <Select
                value={roleChoice}
                onValueChange={(v) => setRoleChoice(v === "admin" ? "admin" : "reader")}
              >
                <SelectTrigger id="role-choice" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reader">خواننده</SelectItem>
                  <SelectItem value="admin">مدیر سامانه</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col items-center gap-3" dir="ltr">
              <InputOTP
                maxLength={6}
                value={roleCode}
                onChange={(v) => setRoleCode(v.replace(/\D/g, ""))}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} className="size-11 text-base" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {roleMfaError ? (
                <p className="text-sm text-destructive" role="alert" dir="rtl">
                  {roleMfaError}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setRoleTarget(null)}>
              انصراف
            </Button>
            <Button
              className="min-h-11 gap-2"
              disabled={roleCode.length !== 6 || rolePending}
              onClick={() => void submitRoleChange()}
            >
              {rolePending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              تأیید تغییر نقش
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- تب حسابرسی ---------- */

function AdminAuditTab() {
  const auditQuery = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => api.get<{ items: AuditRow[] }>("/admin/audit"),
  });
  const items = auditQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        آخرین عملیات حساس سامانه؛ ثبت‌ها بدون امکان ویرایش نگه داشته می‌شوند.
      </p>
      {auditQuery.isPending ? (
        <ListSkeleton rows={4} />
      ) : auditQuery.isError ? (
        <ErrorState
          message={errorMessage(auditQuery.error, "بارگیری گزارش حسابرسی ناموفق بود.")}
          onRetry={() => void auditQuery.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="رویدادی ثبت نشده است."
          hint="عملیات حساس مانند انتشار اصلاح و بازگشت نسل اینجا ثبت می‌شود."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>زمان</TableHead>
                <TableHead>رویداد</TableHead>
                <TableHead>موضوع</TableHead>
                <TableHead>جزئیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {faDateTime(row.created_at) || "—"}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-foreground">
                    {labelFor(AUDIT_ACTION_LABELS, row.action, "رویداد سامانه")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {labelFor(AUDIT_OBJECT_LABELS, row.object_type, "سامانه")}
                    {row.object_uid ? (
                      <>
                        {" · "}
                        <span className="bidi-ltr font-mono text-xs">{row.object_uid}</span>
                      </>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                    {row.detail || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* ---------- نمای اصلی مدیریت ---------- */

const TAB_ITEMS: Array<{ value: string; label: string }> = [
  { value: "overview", label: "داشبورد" },
  { value: "jobs", label: "کارها" },
  { value: "overlays", label: "اصلاحات" },
  { value: "releases", label: "نسل‌ها" },
  { value: "users", label: "کاربران" },
  { value: "audit", label: "حسابرسی" },
];

export function AdminView() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const [tab, setTab] = useState("overview");

  if (role !== "admin") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldX className="size-6 text-destructive" aria-hidden="true" />
            </span>
            <h1 className="text-lg font-semibold">دسترسی فقط برای مدیر سامانه</h1>
            <p className="max-w-sm text-sm leading-7 text-muted-foreground">
              این بخش شامل تنظیمات و عملیات حساس سامانه است؛ برای دسترسی با مدیر سامانه در تماس
              باشید.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold">مدیریت سامانه</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          موجودی منابع، پردازش‌ها، اصلاحات محتوا، کاربران و گزارش حسابرسی.
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="بخش‌های مدیریت سامانه" className="mb-4 h-auto flex-wrap">
          {TAB_ITEMS.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="min-h-9">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <AdminOverviewTab />
        </TabsContent>
        <TabsContent value="jobs">
          <AdminJobsTab />
        </TabsContent>
        <TabsContent value="overlays">
          <AdminOverlaysTab />
        </TabsContent>
        <TabsContent value="releases">
          <AdminReleasesTab />
        </TabsContent>
        <TabsContent value="users">
          <AdminUsersTab />
        </TabsContent>
        <TabsContent value="audit">
          <AdminAuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
