"use client";

/**
 * دیالوگ ثبت فیش (READ-15 / RES-05 / WORK-05 / TECH-08):
 * - انتخاب پروندهٔ مقصد (GET /projects) + ساخت «پروندهٔ جدید» در همان‌جا.
 * - نوع نقل: نقل‌قول اصل / متن خوانده‌شده + یادداشت اختیاری.
 * - پیش‌نمایش نشانی (اثر، جلد، صفحه) و snapshot کامل منبع در POST /clips.
 * - وضعیت ذخیره: «در حال ذخیره…/ذخیره شد/ذخیرهٔ ناموفق + تلاش دوباره».
 * - بستن با تغییر ذخیره‌نشده → هشدار (WORK-05).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FilePlus2, RotateCcw } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { ClipKind, PagePayload, Project } from "@/lib/types";
import type { ReaderSelection } from "./page-renderer";

type SaveState = "idle" | "saving" | "saved" | "failed";

export interface FicheDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: ReaderSelection | null;
  documentUid: string;
  documentLabel: string;
  page: PagePayload | null;
  sectionUid: string | null;
  work: { uid: string; title: string } | null;
}

export function FicheDialog({
  open,
  onOpenChange,
  selection,
  documentUid,
  documentLabel,
  page,
  sectionUid,
  work,
}: FicheDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: ["reader", "projects"],
    queryFn: () => api.get<{ items: Project[] }>("/projects"),
    enabled: open,
    staleTime: 30_000,
  });

  const projects = useMemo(
    () => (projectsQuery.data?.items ?? []).filter((p) => !p.archived),
    [projectsQuery.data],
  );

  const [projectUid, setProjectUid] = useState<string>("");
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [kind, setKind] = useState<ClipKind>("original");
  const [note, setNote] = useState("");
  const [asRead, setAsRead] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // پروندهٔ پیش‌فرض: اولین پروندهٔ فعال (تنظیم state هنگام رندر — الگوی مجاز React)
  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open && !syncedOpen) {
    setSyncedOpen(true);
    setKind("original");
    setNote("");
    setAsRead("");
    setSaveState("idle");
    setSaveError(null);
    setConfirmClose(false);
    setNewProjectName("");
    setCreatingProject(false);
    if (!projectUid && projects.length > 0) {
      setProjectUid(projects[0].uid);
    }
  }
  if (!open && syncedOpen) {
    setSyncedOpen(false);
  }

  const hasUnsavedEdits =
    (kind === "as_read" && asRead.trim() !== "") || note.trim() !== "";

  const attemptClose = (next: boolean) => {
    if (!next && (hasUnsavedEdits || saveState === "failed") && saveState !== "saved") {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  };

  const createProject = useMutation({
    mutationFn: async (name: string) => {
      return api.post<Project>("/projects", { name });
    },
    onSuccess: (p) => {
      void queryClient.invalidateQueries({ queryKey: ["reader", "projects"] });
      setProjectUid(p.uid);
      setCreatingProject(false);
      setNewProjectName("");
      toast({ title: "پروندهٔ جدید ساخته شد." });
    },
    onError: (err) => {
      toast({ title: errorMessage(err, "ساخت پروندهٔ ناموفق بود."), variant: "destructive" });
    },
  });

  const saveClip = useMutation({
    mutationFn: async () => {
      if (!selection || !page || !work) throw new Error("missing");
      return api.post("/clips", {
        project_uid: projectUid,
        kind,
        quote_original: selection.text,
        quote_as_read: kind === "as_read" ? asRead : null,
        note: note.trim() ? note : null,
        source: {
          work_uid: work.uid,
          document_uid: documentUid,
          page_uid: page.page_uid,
          page_label: page.label,
          section_uid: sectionUid ?? null,
          source_offsets: {
            start: selection.start,
            end: selection.end,
            unit: "codepoint",
          },
          // شکل تخت هم‌ارز — پیاده‌سازی فعلی سرور این را می‌خواند
          start: selection.start,
          end: selection.end,
          offset_unit: "codepoint",
          release_uid: page.release_uid ?? null,
          overlay_revision_uid: page.overlay_revision_uid ?? null,
          local_hadith_uid: selection.hadithUid ?? null,
        },
      });
    },
    onMutate: () => {
      setSaveState("saving");
      setSaveError(null);
    },
    onSuccess: () => {
      setSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project"] });
      toast({ title: "فیش ذخیره شد." });
      window.setTimeout(() => onOpenChange(false), 900);
    },
    onError: (err) => {
      setSaveState("failed");
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "ذخیرهٔ فیش ناموفق بود؛ دوباره تلاش کنید.",
      );
    },
  });

  const addressPreview = work
    ? `${work.title}، ${documentLabel}، صفحهٔ ${page?.label ?? "—"}`
    : `${documentLabel}، صفحهٔ ${page?.label ?? "—"}`;

  return (
    <>
      <Dialog open={open} onOpenChange={attemptClose}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>ثبت فیش در پرونده</DialogTitle>
            <DialogDescription>
              متن انتخاب‌شده با نشانی کامل آن در پروندهٔ شما ذخیره می‌شود.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* متن انتخاب‌شده */}
            <div className="space-y-1.5">
              <Label>متن انتخاب‌شده</Label>
              <p className="max-h-32 overflow-y-auto rounded-lg border border-border bg-reader px-3 py-2 text-sm leading-7 whitespace-pre-wrap">
                {selection?.text}
              </p>
            </div>

            {/* پروندهٔ مقصد */}
            <div className="space-y-1.5">
              <Label htmlFor="fiche-project">پروندهٔ مقصد</Label>
              {projectsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">در حال بارگیری پرونده‌ها…</p>
              ) : projectsQuery.isError ? (
                <p className="text-sm text-destructive">
                  {errorMessage(projectsQuery.error, "فهرست پرونده‌ها در دسترس نیست.")}
                </p>
              ) : projects.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-3 text-center">
                  <p className="mb-2 text-xs text-muted-foreground">
                    هنوز پرونده‌ای ندارید؛ یک پروندهٔ جدید بسازید.
                  </p>
                  {creatingProject ? (
                    <div className="flex gap-2">
                      <input
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        placeholder="نام پروندهٔ جدید"
                        aria-label="نام پروندهٔ جدید"
                        className="min-h-11 flex-1 rounded-lg border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9"
                      />
                      <Button
                        size="sm"
                        className="min-h-11 md:min-h-9"
                        disabled={newProjectName.trim().length < 2 || createProject.isPending}
                        onClick={() => createProject.mutate(newProjectName.trim())}
                      >
                        ایجاد
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 gap-1.5 md:min-h-9"
                      onClick={() => setCreatingProject(true)}
                    >
                      <FilePlus2 className="size-4" aria-hidden="true" />
                      پروندهٔ جدید
                    </Button>
                  )}
                </div>
              ) : (
                <Select value={projectUid} onValueChange={setProjectUid}>
                  <SelectTrigger id="fiche-project" className="min-h-11 w-full md:min-h-9">
                    <SelectValue placeholder="انتخاب پرونده" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.uid} value={p.uid}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {projects.length > 0 ? (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1.5 text-xs text-primary hover:underline md:min-h-0"
                  onClick={() => setCreatingProject((v) => !v)}
                >
                  <FilePlus2 className="size-3.5" aria-hidden="true" />
                  پروندهٔ جدید
                </button>
              ) : null}
              {creatingProject && projects.length > 0 ? (
                <div className="flex gap-2">
                  <input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="نام پروندهٔ جدید"
                    aria-label="نام پروندهٔ جدید"
                    className="min-h-11 flex-1 rounded-lg border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9"
                  />
                  <Button
                    size="sm"
                    className="min-h-11 md:min-h-9"
                    disabled={newProjectName.trim().length < 2 || createProject.isPending}
                    onClick={() => createProject.mutate(newProjectName.trim())}
                  >
                    ایجاد
                  </Button>
                </div>
              ) : null}
            </div>

            {/* نوع نقل */}
            <div className="space-y-1.5">
              <Label>نوع نقل</Label>
              <RadioGroup
                value={kind}
                onValueChange={(v) => setKind(v as ClipKind)}
                className="gap-2"
              >
                <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
                  <RadioGroupItem value="original" id="fiche-kind-original" className="mt-1" />
                  <div>
                    <Label htmlFor="fiche-kind-original" className="cursor-pointer">
                      نقل‌قول اصل
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      متن دقیقاً همان‌طور که در منبع است.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
                  <RadioGroupItem value="as_read" id="fiche-kind-as-read" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="fiche-kind-as-read" className="cursor-pointer">
                      متن خوانده‌شده
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      برداشت و بازنویسی خودتان از این موضع.
                    </p>
                  </div>
                </div>
              </RadioGroup>
              {kind === "as_read" ? (
                <Textarea
                  value={asRead}
                  onChange={(e) => setAsRead(e.target.value)}
                  placeholder="متن خوانده‌شدهٔ خود را بنویسید…"
                  aria-label="متن خوانده‌شده"
                  className="min-h-20 text-sm"
                />
              ) : null}
            </div>

            {/* یادداشت */}
            <div className="space-y-1.5">
              <Label htmlFor="fiche-note">یادداشت (اختیاری)</Label>
              <Textarea
                id="fiche-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="یادداشت پژوهشی خود دربارهٔ این فیش…"
                className="min-h-16 text-sm"
              />
            </div>

            <Separator />

            {/* پیش‌نمایش نشانی */}
            <div>
              <Label>نشانی فیش</Label>
              <p className="mt-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] leading-6">
                {addressPreview}
              </p>
            </div>

            {/* وضعیت ذخیره */}
            {saveState === "saving" ? (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                در حال ذخیره…
              </p>
            ) : null}
            {saveState === "saved" ? (
              <p className="flex items-center gap-1 text-xs text-ayah" aria-live="polite">
                <Check className="size-3.5" aria-hidden="true" />
                ذخیره شد.
              </p>
            ) : null}
            {saveState === "failed" ? (
              <div
                className="flex flex-wrap items-center gap-2 text-xs text-destructive"
                aria-live="assertive"
              >
                <p>ذخیرهٔ ناموفق{saveError ? `: ${saveError}` : " بود."}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 md:min-h-8"
                  onClick={() => saveClip.mutate()}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  تلاش دوباره
                </Button>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-11 md:min-h-9" onClick={() => attemptClose(false)}>
              بستن
            </Button>
            <Button
              className="min-h-11 md:min-h-9"
              disabled={
                saveState === "saving" ||
                saveState === "saved" ||
                !projectUid ||
                (kind === "as_read" && asRead.trim() === "")
              }
              onClick={() => saveClip.mutate()}
            >
              {saveState === "saving" ? "در حال ذخیره…" : "ذخیرهٔ فیش"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WORK-05: هشدار تغییر ذخیره‌نشده هنگام بستن */}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>بستن بدون ذخیره؟</AlertDialogTitle>
            <AlertDialogDescription>
              تغییرات این فیش هنوز ذخیره نشده است؛ اگر ادامه دهید این تغییرات از دست می‌رود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 md:min-h-9">
              ادامهٔ ویرایش
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 md:min-h-9"
              onClick={() => {
                setConfirmClose(false);
                onOpenChange(false);
              }}
            >
              بستن بدون ذخیره
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
