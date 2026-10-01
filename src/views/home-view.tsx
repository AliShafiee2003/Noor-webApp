"use client";

/**
 * خانهٔ جست‌وجومحور — طبق DESIGN.md:
 * جست‌وجوی اصلی (متن منابع/نام کتاب) + ۳ ورودی کوتاه + ادامهٔ مطالعه + پرونده‌های اخیر.
 * بدون آمار تزئینی.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Compass,
  FileText,
  FolderOpen,
  Library,
  Play,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ErrorState, ListSkeleton } from "@/components/feedback";
import { MyFichesSection } from "@/components/home/my-fiches-section";
import { api, errorMessage } from "@/lib/api";
import { fetchProjects } from "@/lib/projects";
import { HashLink, useRoute } from "@/lib/hash-router";
import { faDate, faNum } from "@/lib/format";
import type { Project } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspace";

type HomeSearchMode = "normalized_phrase" | "strict_phrase";

const MODES: Array<{ value: HomeSearchMode; label: string; hint: string }> = [
  { value: "normalized_phrase", label: "متن منابع", hint: "جست‌وجوی عبارت در متن کتاب‌ها" },
  { value: "strict_phrase", label: "نام کتاب", hint: "یافتن کتاب با عنوان آن" },
];

function HeroSearch() {
  const { navigate } = useRoute();
  const [mode, setMode] = useState<HomeSearchMode>("normalized_phrase");
  const [q, setQ] = useState("");

  const activeMode = MODES.find((m) => m.value === mode) ?? MODES[0];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    navigate("/search", {
      q: query,
      mode,
      scope: mode === "strict_phrase" ? "titles" : "library",
    });
  };

  return (
    <section aria-labelledby="home-search-title" className="hero-surface">
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="pb-3 text-center">
          <CardTitle id="home-search-title" className="text-2xl font-bold tracking-tight">
            جست‌وجو در منابع
          </CardTitle>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
            عبارت را در متن منابع بنویسید؛ فقط مواضع تأییدشده با نشانی دقیق نمایش داده می‌شود.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="group"
            aria-label="انتخاب دامنهٔ جست‌وجو"
            className="flex flex-wrap justify-center gap-2"
          >
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={mode === m.value}
                className="choice-chip bg-surface"
                onClick={() => setMode(m.value)}
              >
                {m.value === "normalized_phrase" ? (
                  <Search className="size-4" aria-hidden="true" />
                ) : (
                  <BookOpen className="size-4" aria-hidden="true" />
                )}
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">{activeMode.hint}</p>
          <form
            onSubmit={submit}
            className="mx-auto flex w-full max-w-xl flex-col gap-2 sm:flex-row"
          >
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="عبارت مورد نظر را بنویسید…"
              aria-label="عبارت جست‌وجو"
              className="min-h-11 flex-1 bg-surface shadow-sm"
            />
            <Button
              type="submit"
              className="min-h-11 gap-2 shadow-sm transition-all hover:shadow sm:w-32"
              disabled={!q.trim()}
            >
              <Search className="size-4" aria-hidden="true" />
              جست‌وجو
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

function ShortEntries() {
  const entries = [
    {
      to: "/library",
      icon: Library,
      title: "کتابخانه",
      hint: "مرور آثار و مجلدات",
    },
    {
      to: "/topics",
      icon: Compass,
      title: "موضوعات",
      hint: "درخت موضوعی منابع",
    },
    {
      to: "/research",
      icon: FolderOpen,
      title: "پژوهش‌های من",
      hint: "پرونده‌ها و فیش‌ها",
    },
  ] as const;

  return (
    <section aria-label="دسترسی‌های کوتاه">
      <div className="grid gap-3 sm:grid-cols-3">
        {entries.map((entry) => (
          <HashLink
            key={entry.to}
            to={entry.to}
            className="group flex min-h-11 items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-accent"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <entry.icon className="size-5" aria-hidden="true" />
            </span>
            <span className="flex flex-col">
              <span className="font-medium">{entry.title}</span>
              <span className="text-xs text-muted-foreground">{entry.hint}</span>
            </span>
          </HashLink>
        ))}
      </div>
    </section>
  );
}

function ContinueReading() {
  const recent = useWorkspaceStore((s) => s.recent);
  const loading = useWorkspaceStore((s) => s.workspaceLoading);
  const error = useWorkspaceStore((s) => s.workspaceError);
  const refetch = useWorkspaceStore((s) => s.fetchWorkspace);

  const primary = recent[0];
  const rest = recent.slice(1, 4);

  return (
    <section aria-labelledby="continue-reading-title">
      <h2 id="continue-reading-title" className="mb-3 text-base font-semibold">
        ادامهٔ مطالعه
      </h2>
      {loading ? (
        <ListSkeleton rows={1} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : !primary ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            هنوز مطالعه‌ای را شروع نکرده‌اید؛ از کتابخانه کتابی برگزینید.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <HashLink
            to={`/read/${primary.document_uid}`}
            query={primary.page_uid ? { pg: primary.page_uid } : undefined}
            className="block rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-accent"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {primary.work_title ?? "منبع بدون عنوان"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {primary.label ? `صفحهٔ ${primary.label}` : "ادامهٔ خواندن"}
                  {primary.updated_at ? ` · ${faDate(primary.updated_at)}` : ""}
                </p>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Play className="size-4" aria-hidden="true" />
              </span>
            </div>
            {typeof primary.progress === "number" && primary.progress > 0 ? (
              <div className="mt-3 flex items-center gap-2">
                <Progress
                  value={Math.min(100, Math.max(0, primary.progress * 100))}
                  className="h-1.5"
                  aria-label={`پیشرفت مطالعه: ${faNum(Math.round(primary.progress * 100))} درصد`}
                />
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {faNum(Math.round(primary.progress * 100))}٪
                </span>
              </div>
            ) : null}
          </HashLink>
          {rest.length > 0 ? (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {rest.map((item) => (
                <li key={`${item.document_uid}-${item.page_uid}`}>
                  <HashLink
                    to={`/read/${item.document_uid}`}
                    query={item.page_uid ? { pg: item.page_uid } : undefined}
                    className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent"
                  >
                    <span className="truncate">
                      {item.work_title ?? "منبع بدون عنوان"}
                      {item.label ? (
                        <span className="text-muted-foreground"> · صفحهٔ {item.label}</span>
                      ) : null}
                    </span>
                    {item.updated_at ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {faDate(item.updated_at)}
                      </span>
                    ) : null}
                  </HashLink>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

function RecentProjects() {
  const { navigate } = useRoute();
  const projectsQuery = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });

  const projects = [...(projectsQuery.data ?? [])]
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 4);

  return (
    <section aria-labelledby="recent-projects-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="recent-projects-title" className="text-base font-semibold">
          پرونده‌های اخیر
        </h2>
        <HashLink
          to="/research"
          className="flex min-h-11 items-center text-sm text-link hover:underline md:min-h-0"
        >
          همهٔ پژوهش‌ها
        </HashLink>
      </div>
      {projectsQuery.isLoading ? (
        <ListSkeleton rows={2} />
      ) : projectsQuery.isError ? (
        <ErrorState
          message={errorMessage(projectsQuery.error, "بارگیری پرونده‌ها ناموفق بود.")}
          onRetry={() => void projectsQuery.refetch()}
        />
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              هنوز پرونده‌ای نساخته‌اید؛ پرونده جای گردآوری فیش‌ها و یادداشت‌های
              پژوهش شماست.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-1 min-h-11 md:min-h-9"
              onClick={() => navigate("/research")}
            >
              شروع در «پژوهش‌های من»
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.uid}>
              <HashLink
                to={`/project/${project.uid}`}
                className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-accent"
              >
                <FileText className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{project.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {project.clip_count !== null && project.clip_count !== undefined
                      ? `${faNum(project.clip_count)} فیش · `
                      : ""}
                    {project.updated_at ? faDate(project.updated_at) : ""}
                  </span>
                </span>
                {project.archived ? (
                  <Badge variant="outline" className="shrink-0">
                    بایگانی‌شده
                  </Badge>
                ) : null}
              </HashLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HomeView() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
      <HeroSearch />
      <ShortEntries />
      <ContinueReading />
      <RecentProjects />
      <MyFichesSection />
    </div>
  );
}
