"use client";

/**
 * «همهٔ فیش‌های من» در میزکار — GET /my/clips/all?kind=&q=
 * فیش‌های فعال کاربر از همهٔ پرونده‌ها با پالایش نوع و جست‌وجوی متنی؛
 * هر فیش: نشان نوع، نقل‌قول با فونت امیری، پرونده و نشانی اثر،
 * «گشودن پرونده» و «بازکردن در متن» (pg درست کتاب‌خوان).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  ClipboardList,
  FilePenLine,
  FolderOpen,
  NotebookPen,
  RotateCcw,
  Search,
  Tag,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { HashLink } from "@/lib/hash-router";
import { faDate, faNum } from "@/lib/format";
import type { ClipKind, ClipTagSummary, MyClipSummary } from "@/lib/types";

/** نشان نوع فیش — هم‌واژگان پروژه (KIND_META در footnote-panel و project-view) */
const KIND_META: Record<ClipKind, { label: string; className: string; icon: typeof ClipboardList }> = {
  original: {
    label: "نقل‌قول اصل",
    className: "bg-primary/10 text-primary",
    icon: ClipboardList,
  },
  as_read: {
    label: "متن خوانده‌شده",
    className: "bg-ayah/20 text-foreground",
    icon: BookOpen,
  },
  note: {
    label: "یادداشت",
    className: "bg-muted text-foreground",
    icon: NotebookPen,
  },
};

type KindFilter = "" | ClipKind;

const KIND_FILTERS: Array<{ value: KindFilter; label: string }> = [
  { value: "", label: "همه" },
  { value: "original", label: "نقل‌قول اصل" },
  { value: "as_read", label: "متن خوانده‌شده" },
  { value: "note", label: "یادداشت" },
];

function FicheCard({ clip }: { clip: MyClipSummary }) {
  const meta = KIND_META[clip.kind] ?? KIND_META.original;
  const Icon = meta.icon;
  const tags = (clip.tags ?? []).filter((t) => t && t.trim() !== "");
  return (
    <li
      className={`anim-rise quiet-card group rounded-xl border bg-surface p-3 transition-all hover:-translate-y-px hover:shadow-sm ${
        clip.kind === "original"
          ? "border-s-[3px] border-s-primary/50 border-border"
          : clip.kind === "as_read"
            ? "border-s-[3px] border-s-ayah/60 border-border"
            : "border-s-[3px] border-s-muted-foreground/40 border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.className}`}
        >
          <Icon className="size-3" aria-hidden="true" />
          {meta.label}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          <FolderOpen className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{clip.project_name || "پرونده"}</span>
        </span>
        {clip.updated_at ? (
          <span className="ms-auto text-[10px] text-muted-foreground/70">
            {faDate(clip.updated_at)}
          </span>
        ) : null}
      </div>

      <p
        lang="ar"
        dir="rtl"
        className="mt-2 line-clamp-3 font-reader text-[13.5px] leading-7 text-foreground"
      >
        {clip.quote_original}
      </p>

      {clip.note ? (
        <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap border-t border-border/60 pt-1.5 text-[12px] leading-6 text-muted-foreground">
          {clip.note}
        </p>
      ) : null}

      {tags.length > 0 ? (
        <ul className="mt-2 flex flex-wrap items-center gap-1" aria-label="برچسب‌های فیش">
          {tags.map((t) => (
            <li
              key={t}
              className="inline-flex max-w-36 items-center gap-1 rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              <Tag className="size-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
        {clip.work_title ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <BookOpen className="size-3 shrink-0" aria-hidden="true" />
            <span className="max-w-40 truncate">{clip.work_title}</span>
            {clip.page_label && clip.page_label !== "—" ? (
              <span className="shrink-0 text-muted-foreground/80">
                · ص {faNum(clip.page_label)}
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="ms-auto flex items-center gap-1.5">
          <HashLink
            to={`/project/${clip.project_uid}`}
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            <FolderOpen className="size-3" aria-hidden="true" />
            گشودن پرونده
          </HashLink>
          {clip.document_uid ? (
            <HashLink
              to={`/read/${clip.document_uid}`}
              query={clip.page_uid ? { pg: clip.page_uid } : undefined}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              <FilePenLine className="size-3" aria-hidden="true" />
              بازکردن در متن
            </HashLink>
          ) : null}
        </span>
      </div>
    </li>
  );
}

export function MyFichesSection() {
  const [kind, setKind] = useState<KindFilter>("");
  const [tag, setTag] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");

  const query = useQuery({
    queryKey: ["my-clips-all", kind, tag, q],
    queryFn: ({ signal }) => {
      const params: Record<string, string> = {};
      if (kind) params.kind = kind;
      if (tag) params.tag = tag;
      if (q) params.q = q;
      return api.get<{ items: MyClipSummary[]; total: number }>("/my/clips/all", params, signal);
    },
    staleTime: 15_000,
  });

  /* توزیع برچسب‌ها برای چیپ‌های پالایش — شمار صادقانهٔ سرور از کل فیش‌های فعال */
  const tagsQuery = useQuery({
    queryKey: ["my-clips-tags"],
    queryFn: ({ signal }) =>
      api.get<{ items: ClipTagSummary[] }>("/my/clips/tags", undefined, signal),
    staleTime: 30_000,
  });
  const availableTags = tagsQuery.data?.items ?? [];

  const clips = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const truncated = total > clips.length;
  const hasFilter = Boolean(kind || tag || q);

  const clearFilters = () => {
    setKind("");
    setTag("");
    setQ("");
    setQInput("");
  };

  return (
    <section aria-labelledby="my-fiches-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="my-fiches-title" className="flex items-center gap-1.5 text-base font-semibold">
          <ClipboardList className="size-4 text-primary" aria-hidden="true" />
          همهٔ فیش‌های من
        </h2>
        <HashLink
          to="/research"
          className="flex min-h-11 items-center text-sm text-link hover:underline md:min-h-0"
        >
          پژوهش‌های من
          <ArrowLeft className="size-3.5" aria-hidden="true" />
        </HashLink>
      </div>

      {/* پالایش: نوع فیش + برچسب‌ها + جست‌وجوی متنی */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div
          role="group"
          aria-label="پالایش نوع فیش"
          className="flex flex-wrap gap-1.5"
        >
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={kind === f.value}
              className="choice-chip"
              onClick={() => setKind(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <form
          role="search"
          aria-label="جست‌وجو در فیش‌های من"
          className="flex min-h-11 flex-1 items-center gap-1.5 rounded-lg border border-input bg-surface px-2.5 sm:min-h-9 sm:max-w-xs sm:ms-auto"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(qInput.trim());
          }}
        >
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="جست‌وجو در فیش‌ها…"
            aria-label="جست‌وجو در فیش‌ها"
            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
          {qInput ? (
            <button
              type="button"
              aria-label="پاک‌کردن جست‌وجوی فیش‌ها"
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setQInput("");
                setQ("");
              }}
            >
              ×
            </button>
          ) : null}
        </form>
      </div>

      {/* چیپ‌های برچسب — فقط وقتی برچسبی وجود دارد (شمار صادقانهٔ سرور) */}
      {availableTags.length > 0 ? (
        <div
          role="group"
          aria-label="پالایش برچسب فیش"
          className="mb-3 flex flex-wrap items-center gap-1.5"
        >
          <Tag
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">پالایش بر اساس برچسب:</span>
          {availableTags.map((t) => {
            const active = tag === t.tag;
            return (
              <button
                key={t.tag}
                type="button"
                aria-pressed={active}
                title={`${faNum(t.count)} فیش با برچسب «${t.tag}»`}
                className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                  active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-surface text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                }`}
                onClick={() => setTag(active ? "" : t.tag)}
              >
                {t.tag}
                <span
                  className={`rounded-full px-1.5 text-[10px] leading-4 ${
                    active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {faNum(t.count)}
                </span>
              </button>
            );
          })}
          {tag ? (
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setTag("")}
            >
              <X className="size-3" aria-hidden="true" />
              برداشتن برچسب
            </button>
          ) : null}
        </div>
      ) : null}

      {query.isPending ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <span className="sr-only">در حال بارگیری فیش‌ها…</span>
        </div>
      ) : query.isError ? (
        <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="flex items-start gap-1.5 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {errorMessage(query.error, "فهرست فیش‌ها در دسترس نیست.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 gap-1.5 md:min-h-9"
            onClick={() => void query.refetch()}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            تلاش دوباره
          </Button>
        </div>
      ) : clips.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-1.5 p-6 text-center">
            <ClipboardList className="size-6 text-muted-foreground/50" aria-hidden="true" />
            {hasFilter ? (
              <>
                <p className="text-sm text-muted-foreground">
                  فیشی با این پالایش یافت نشد.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 md:min-h-9"
                  onClick={clearFilters}
                >
                  برداشتن پالایش
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                هنوز فیشی ثبت نکرده‌اید؛ در کتاب‌خوان متنی را انتخاب کنید یا از پنل روایت
                «ثبت فیش این روایت» را بزنید.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
            {faNum(total)} فیش
            {truncated ? " — ۱۰۰ مورد نخست نمایش داده می‌شود" : ""}
            {hasFilter ? " (با پالایش فعلی)" : ""}
          </p>
          <ul className="grid gap-3 lg:grid-cols-2">
            {clips.map((c) => (
              <FicheCard key={c.uid} clip={c} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
