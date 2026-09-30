"use client";

/**
 * «پژوهش‌های من» — فهرست پرونده‌های پژوهشی کاربر (RES-01..04)
 * - فهرست پرونده‌ها: نام، شمار فیش، تاریخ آخرین تغییر
 * - ساخت پروندهٔ جدید (POST /projects)
 * - آرشیو / خروج از آرشیو (PATCH با version — تعارض 409 با پیام فارسی و بارگذاری نسخهٔ فعلی)
 * - حذف (DELETE نرم) → پیام «به سطل بازیافت رفت»
 * - کلیک روی پرونده → #/project/{uid}
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  FolderOpen,
  FolderPlus,
  Loader2,
  Trash2,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import { api, ApiError, errorMessage } from "@/lib/api";
import { HashLink } from "@/lib/hash-router";
import { faDate, faNum } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import type { Project } from "@/lib/types";

type ProjectFilter = "all" | "active" | "archived";

/** پاسخ قرارداد می‌تواند آرایهٔ خام یا {items} باشد — هر دو پذیرفته می‌شود. */
function normalizeItems<T>(data: T[] | { items?: T[] } | undefined | null): T[] {
  if (Array.isArray(data)) return data;
  return data?.items ?? [];
}

const NOT_FOUND_MESSAGE = "این مورد در پژوهش‌های شما یافت نشد.";

export function ResearchView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () =>
      normalizeItems<Project>(await api.get<Project[] | { items: Project[] }>("/projects")),
  });

  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  /** تعارض نسخه در تغییر آرشیو — پیام فارسی + بارگذاری نسخهٔ فعلی */
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  /* ---------- ساخت پروندهٔ جدید ---------- */
  const createMutation = useMutation({
    mutationFn: (name: string) => api.post<Project>("/projects", { name }),
    onSuccess: () => {
      setNewOpen(false);
      setNewName("");
      setNewError(null);
      setFilter("all");
      refresh();
      toast({ title: "پروندهٔ جدید ساخته شد." });
    },
    onError: (err) => {
      setNewError(errorMessage(err, "ساخت پرونده ممکن نشد؛ دوباره تلاش کنید."));
    },
  });

  /* ---------- آرشیو / خروج از آرشیو (با version) ---------- */
  const archiveMutation = useMutation({
    mutationFn: ({ project, archived }: { project: Project; archived: boolean }) =>
      api.patch<Project>(`/projects/${project.uid}`, {
        archived,
        version: project.version,
      }),
    onSuccess: (_data, vars) => {
      refresh();
      toast({
        title: vars.archived ? "پرونده به بایگانی منتقل شد." : "پرونده از بایگانی خارج شد.",
      });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setConflictMsg(
          errorMessage(
            err,
            "این پرونده در جای دیگری تغییر کرده است و نسخهٔ شما کهنه است.",
          ),
        );
        setConflictOpen(true);
      } else {
        toast({
          title: "تغییر وضعیت بایگانی ممکن نشد.",
          description: errorMessage(err),
          variant: "destructive",
        });
      }
    },
  });

  /* ---------- حذف (سطل بازیافت) ---------- */
  const deleteMutation = useMutation({
    mutationFn: (uid: string) => api.del<{ ok: boolean }>(`/projects/${uid}`),
    onSuccess: () => {
      setDeleteTarget(null);
      refresh();
      toast({ title: "پرونده به سطل بازیافت رفت.", description: "فیش‌های آن نیز قابل بازیابی‌اند." });
    },
    onError: (err) => {
      setDeleteTarget(null);
      if (err instanceof ApiError && err.message === NOT_FOUND_MESSAGE) {
        refresh();
        toast({ title: "این پرونده پیش‌تر حذف شده است." });
      } else {
        toast({
          title: "حذف پرونده ممکن نشد.",
          description: errorMessage(err),
          variant: "destructive",
        });
      }
    },
  });

  const projects = projectsQuery.data ?? [];
  const visible = projects.filter((p) => {
    if (filter === "active") return !p.archived;
    if (filter === "archived") return p.archived;
    return true;
  });
  const archivedCount = projects.filter((p) => p.archived).length;
  const activeCount = projects.length - archivedCount;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">پژوهش‌های من</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            پرونده‌های شما و فیش‌های گردآوری‌شده از منابع؛ برای کار روی فیش‌ها، پرونده را باز کنید.
          </p>
        </div>
        <Button className="min-h-11 gap-2" onClick={() => setNewOpen(true)}>
          <FolderPlus className="size-4" aria-hidden="true" />
          پروندهٔ جدید
        </Button>
      </header>

      {projectsQuery.isPending ? (
        <ListSkeleton rows={4} />
      ) : projectsQuery.isError ? (
        <ErrorState
          message={errorMessage(
            projectsQuery.error,
            "بارگیری فهرست پرونده‌ها ناموفق بود.",
          )}
          onRetry={() => refresh()}
        />
      ) : projects.length === 0 ? (
        <EmptyState
          title="هنوز پرونده‌ای ندارید."
          hint="پرونده جای گردآوری فیش‌ها و یادداشت‌های پژوهشی شماست؛ نخستین پرونده را بسازید."
          action={
            <Button className="min-h-11 gap-2" onClick={() => setNewOpen(true)}>
              <FolderPlus className="size-4" aria-hidden="true" />
              ساخت پروندهٔ جدید
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <Tabs
            value={filter}
            onValueChange={(v) => setFilter(v as ProjectFilter)}
          >
            <TabsList className="h-11">
              <TabsTrigger value="all" className="min-h-9 gap-2">
                همه
                <Badge variant="secondary" className="px-1.5">
                  {faNum(projects.length)}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="active" className="min-h-9 gap-2">
                فعال
                <Badge variant="secondary" className="px-1.5">
                  {faNum(activeCount)}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="archived" className="min-h-9 gap-2">
                بایگانی
                <Badge variant="secondary" className="px-1.5">
                  {faNum(archivedCount)}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {visible.length === 0 ? (
            <EmptyState
              title="پرونده‌ای در این بخش نیست."
              hint="فیلتر بالا را تغییر دهید یا پروندهٔ تازه‌ای بسازید."
            />
          ) : (
            <ul className="space-y-3" aria-live="polite">
              {visible.map((project) => (
                <li key={project.uid}>
                  <Card className="transition-colors hover:border-control-border/60">
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <HashLink
                          to={`/project/${project.uid}`}
                          className="block rounded-md focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <span className="flex items-center gap-2">
                            <FolderOpen
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span className="truncate font-semibold text-foreground">
                              {project.name}
                            </span>
                            {project.archived ? (
                              <Badge variant="outline">بایگانی</Badge>
                            ) : null}
                          </span>
                        </HashLink>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {project.clip_count !== null && project.clip_count !== undefined
                            ? `${faNum(project.clip_count)} فیش`
                            : "شمار فیش: ثبت نشده"}
                          {project.updated_at ? ` · آخرین تغییر: ${faDate(project.updated_at)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 gap-2"
                          disabled={archiveMutation.isPending}
                          onClick={() =>
                            archiveMutation.mutate({
                              project,
                              archived: !project.archived,
                            })
                          }
                        >
                          {archiveMutation.isPending &&
                          archiveMutation.variables?.project.uid === project.uid ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : project.archived ? (
                            <ArchiveRestore className="size-4" aria-hidden="true" />
                          ) : (
                            <Archive className="size-4" aria-hidden="true" />
                          )}
                          {project.archived ? "خروج از بایگانی" : "بایگانی"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-11 gap-2 text-destructive hover:text-destructive"
                          aria-label={`حذف پروندهٔ ${project.name}`}
                          onClick={() => setDeleteTarget(project)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          حذف
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---------- گفت‌وگوی ساخت پرونده ---------- */}
      <Dialog
        open={newOpen}
        onOpenChange={(o) => {
          setNewOpen(o);
          if (o) setNewError(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>پروندهٔ جدید</DialogTitle>
            <DialogDescription>
              نامی برای پروندهٔ پژوهشی خود برگزینید؛ بعداً می‌توانید فیش‌ها را در آن گردآوری کنید.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-project-name">نام پرونده</Label>
            <Input
              id="new-project-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="مثلاً: پژوهش باب ولایت"
              className="min-h-11"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  createMutation.mutate(newName.trim());
                }
              }}
            />
            {newError ? (
              <p className="text-sm text-destructive" role="alert">
                {newError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setNewOpen(false)}
            >
              انصراف
            </Button>
            <Button
              className="min-h-11 gap-2"
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(newName.trim())}
            >
              {createMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              ساخت پرونده
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- تعارض نسخه (409) ---------- */}
      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>تعارض در نسخهٔ اطلاعات</DialogTitle>
            <DialogDescription>{conflictMsg}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            برای ادامه، نسخهٔ فعلی پرونده‌ها را بارگیری کنید؛ سپس دوباره تلاش نمایید.
          </p>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setConflictOpen(false)}>
              بستن
            </Button>
            <Button
              className="min-h-11"
              onClick={() => {
                setConflictOpen(false);
                refresh();
              }}
            >
              بارگذاری نسخهٔ فعلی
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- تأیید حذف ---------- */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف پروندهٔ «{deleteTarget?.name}»؟</AlertDialogTitle>
            <AlertDialogDescription>
              پرونده به سطل بازیافت منتقل می‌شود و از فهرست پژوهش‌های شما خارج می‌شود؛ فیش‌های آن
              نیز همراه پرونده قابل بازیابی‌اند.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.uid);
              }}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              حذف و انتقال به سطل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
