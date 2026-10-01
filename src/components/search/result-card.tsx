"use client";

/**
 * کارت نتیجهٔ جست‌وجو — §۴۱ «نتایج»، SEARCH-10..12
 * - نوع تطبیق (badge)، شاهد با highlight بر پایهٔ code point (تبدیل به UTF-16
 *   با Array.from — هایلایت روی متن اصل)، نقش‌های تطبیق
 * - اقدام اصلی «بازکردن در متن» (→ /read/{doc}?page={page}&hl=start:end)
 * - اقدام دوم «افزودن به فیش» (دیالوگ انتخاب پرونده → POST /clips)
 * هیچ innerHTML استفاده نمی‌شود؛ متن همیشه به‌صورت گرهٔ React رندر می‌شود.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  BookOpenText,
  Check,
  Copy,
  FileText,
  LibraryBig,
  ListTree,
  Loader2,
  PanelRightOpen,
  Plus,
  Quote,
  TriangleAlert,
} from "lucide-react";
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
import { HashLink } from "@/lib/hash-router";
import { api, errorMessage } from "@/lib/api";
import { faNum } from "@/lib/format";
import { matchTypeLabels } from "@/lib/labels";
import type {
  ClipKind,
  MatchType,
  Project,
  SearchHighlight,
  SearchResultItem,
} from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { HadithLocationsDialog } from "@/components/search/hadith-locations-dialog";

/* ---------- برچسب نقش‌های تطبیق ---------- */

const ROLE_CHIP_LABELS: Record<string, string> = {
  G: "متن روایت",
  body: "بدنهٔ متن",
  sanad: "سند روایت",
  K: "کلام معصوم",
  maasoom: "سخن معصوم",
  ayah_text: "متن آیه",
  B: "بیان مؤلف",
  sharh: "شرح",
  b: "پاورقی",
  lfootnote_ref: "ارجاع پاورقی",
};

export function roleChipLabel(role: string): string {
  return ROLE_CHIP_LABELS[role] ?? role;
}

/* ---------- نشان نوع تطبیق — هر حالت رنگ متمایز ---------- */

const MATCH_TONE: Record<MatchType, string> = {
  exact: "border-primary/40 bg-primary/10 text-primary",
  normalized: "border-link/40 bg-link/10 text-link",
  linguistic: "border-ayah/50 bg-ayah-soft text-foreground",
  fuzzy: "border-border bg-muted text-muted-foreground",
};

function MatchTypeBadge({ type }: { type: MatchType }) {
  return (
    <Badge
      variant="outline"
      className={`shrink-0 font-medium ${MATCH_TONE[type] ?? ""}`}
    >
      {matchTypeLabels[type] ?? "تطبیق"}
    </Badge>
  );
}

/* ---------- هایلایت code point → UTF-16 ---------- */

export interface NormalizedOffsets {
  start: number;
  end: number;
}

/** source_offsets از موتور ممکن است آرایهٔ [start,end] یا شیء باشد — هر دو پوشش داده می‌شود */
export function normalizeOffsets(value: unknown): NormalizedOffsets | null {
  if (Array.isArray(value) && value.length >= 2) {
    const [start, end] = value as unknown[];
    if (typeof start === "number" && typeof end === "number") return { start, end };
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.start === "number" && typeof v.end === "number") {
      return { start: v.start, end: v.end };
    }
  }
  return null;
}

function mergeHighlightRanges(
  highlight: SearchHighlight[],
  length: number,
): Array<{ start: number; end: number }> {
  const sorted = [...highlight]
    .filter((h) => typeof h.start === "number" && typeof h.end === "number" && h.unit !== "char")
    .map((h) => ({ start: Math.max(0, h.start), end: h.end }))
    .filter((h) => h.start < length && h.end > h.start)
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * شاهد با هایلایت — آرایهٔ code pointها با Array.from ساخته می‌شود تا
 * highlight (بر حسب code point) روی متن اصل بدون خطای surrogate pair درست
 * بیفتد. خروجی گره‌های React است (بدون innerHTML).
 */
export function HighlightedSnippet({
  snippet,
  highlight,
}: {
  snippet: string;
  highlight: SearchHighlight[] | undefined;
}) {
  const segments = useMemo(() => {
    const cps = Array.from(snippet);
    const ranges = mergeHighlightRanges(highlight ?? [], cps.length);
    const out: Array<{ text: string; highlighted: boolean }> = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) {
        out.push({ text: cps.slice(cursor, range.start).join(""), highlighted: false });
      }
      out.push({ text: cps.slice(range.start, range.end).join(""), highlighted: true });
      cursor = range.end;
    }
    if (cursor < cps.length) {
      out.push({ text: cps.slice(cursor).join(""), highlighted: false });
    }
    return out;
  }, [snippet, highlight]);

  return (
    <span lang="ar" dir="rtl" className="font-reader text-[1.05rem] leading-8 text-foreground">
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <mark
            key={i}
            className="rounded-sm bg-match px-0.5 text-foreground"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

/* ---------- دیالوگ افزودن به فیش ---------- */

function AddToClipDialog({
  result,
  releaseUid,
  open,
  onOpenChange,
}: {
  result: SearchResultItem;
  releaseUid: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string>("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) =>
      api.get<Project[] | { items?: Project[] }>("/projects", undefined, signal),
    enabled: open,
    staleTime: 30_000,
  });
  // قرارداد می‌تواند آرایهٔ خام یا {items} برگرداندد — هر دو پذیرفته می‌شود
  const projects = Array.isArray(projectsQuery.data)
    ? projectsQuery.data
    : (projectsQuery.data?.items ?? []);

  const offsets = result.source_offsets ? normalizeOffsets(result.source_offsets) : null;

  const createClip = useMutation({
    mutationFn: async () => {
      if (!offsets) {
        throw new Error("موقعیت این نتیجه در منبع ثبت نشده است؛ افزودن فیش ممکن نیست.");
      }
      return api.post("/clips", {
        project_uid: projectId,
        kind: "original" as ClipKind,
        quote_original: result.snippet,
        source: {
          work_uid: result.work?.uid ?? "",
          document_uid: result.document?.uid ?? "",
          page_uid: result.page?.uid ?? null,
          page_label: result.page?.label ?? null,
          section_uid: result.section?.uid ?? null,
          source_offsets: {
            start: offsets.start,
            end: offsets.end,
            unit: "codepoint",
          },
          release_uid: releaseUid ?? null,
          local_hadith_uid: result.local_hadith_uid ?? null,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({
        title: "فیش ذخیره شد",
        description: "نقل‌قول به پروندهٔ انتخاب‌شده افزوده شد.",
      });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "ذخیرهٔ فیش ناموفق بود",
        description: errorMessage(err),
      });
    },
  });

  const noSource = !result.document?.uid || !offsets;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>افزودن به فیش</DialogTitle>
          <DialogDescription>
            نقل‌قول با نشانی منبع (اثر، سند، صفحه و موقعیت دقیق) در پروندهٔ شما ذخیره می‌شود.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-reader p-3">
            <HighlightedSnippet snippet={result.snippet} highlight={result.highlight} />
          </div>

          {projectsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">در حال بارگیری پرونده‌ها…</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              هنوز پرونده‌ای نساخته‌اید؛ از «پژوهش‌های من» یک پرونده بسازید و دوباره تلاش کنید.
            </p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">انتخاب پرونده</legend>
              <div
                role="radiogroup"
                aria-label="انتخاب پروندهٔ مقصد"
                className="max-h-44 space-y-1.5 overflow-y-auto pe-1"
              >
                {projects.map((p) => (
                  <label
                    key={p.uid}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-accent"
                  >
                    <input
                      type="radio"
                      name="clip-project"
                      value={p.uid}
                      checked={projectId === p.uid}
                      onChange={() => setProjectId(p.uid)}
                      className="accent-primary"
                    />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {noSource ? (
            <p className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              برای این نتیجه نشانی منبع ثبت نشده است؛ افزودن فیش ممکن نیست.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
            disabled={createClip.isPending}
          >
            بستن
          </Button>
          <Button
            className="min-h-11 gap-2"
            disabled={!projectId || createClip.isPending || noSource}
            onClick={() => createClip.mutate()}
          >
            {createClip.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            ذخیرهٔ فیش
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- کارت نتیجه ---------- */

export function ResultCard({
  result,
  releaseUid,
  defaultOpenClip = false,
  onOpenSplit,
  splitActive = false,
}: {
  result: SearchResultItem;
  releaseUid: string | null;
  defaultOpenClip?: boolean;
  /** SEARCH-11: بازکردن متن نتیجه کنار نتایج (اگر داده نشود، دکمه نمایش نمی‌یابد) */
  onOpenSplit?: (result: SearchResultItem) => void;
  /** آیا این نتیجه اکنون در پنل کنار نتایج باز است؟ */
  splitActive?: boolean;
}) {
  const [clipOpen, setClipOpen] = useState(defaultOpenClip);
  const [hadithLookupOpen, setHadithLookupOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const docLabel = result.document?.label ?? null;
  const pageLabel = result.page?.label ?? null;
  const roles = Array.isArray(result.roles) ? result.roles : [];

  const offsets = result.source_offsets ? normalizeOffsets(result.source_offsets) : null;
  const hasDocument = Boolean(result.document?.uid);

  // مقصد «بازکردن در متن»: سند + صفحه + بازهٔ هایلایت (code point در مختصات سند)
  // توجه: پارامتر صفحه باید «pg» باشد (قرارداد کتاب‌خوان)
  // بازهٔ دقیق تطبیق (match_offsets) مقدم بر بازهٔ passage است — هر دو ممکن است آرایه باشند
  const hlOffsets = normalizeOffsets(result.match_offsets) ?? offsets;
  const readHref = hasDocument
    ? {
        to: `/read/${result.document.uid}`,
        query: {
          ...(result.page?.uid ? { pg: result.page.uid } : {}),
          ...(hlOffsets ? { hl: `${hlOffsets.start}:${hlOffsets.end}` } : {}),
        },
      }
    : null;

  /* RES-08: ارجاع متنی با نشانی عمیق — برای چسباندن در یادداشت/متن پژوهش */
  const copyCitation = async () => {
    // اگر برچسب جلد خودش با «ج» آغاز شده باشد (مثل «ج ۲») دوباره «جلد» اضافه نمی‌شود
    const docPart = docLabel
      ? /^ج\s|جلد/.test(docLabel)
        ? docLabel
        : `جلد ${docLabel}`
      : "";
    const citation = [
      result.work?.title ?? "",
      docPart,
      /* صفحهٔ بدون شمارهٔ چاپی («—») در ارجاع نمی‌آید — بدون جعل شماره */
      pageLabel && pageLabel !== "—" ? `صفحهٔ ${pageLabel}` : "",
    ]
      .filter(Boolean)
      .join("، ");
    const address = readHref
      ? `#/read/${result.document.uid}${
          readHref.query.pg || readHref.query.hl
            ? `?${[
                readHref.query.pg ? `pg=${readHref.query.pg}` : "",
                readHref.query.hl ? `hl=${readHref.query.hl}` : "",
              ]
                .filter(Boolean)
                .join("&")}`
            : ""
        }`
      : "";
    try {
      await navigator.clipboard.writeText([citation, address].filter(Boolean).join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* کپی در دسترس نیست — بی‌صدا */
    }
  };

  return (
    <article
      className={`quiet-card anim-rise rounded-xl border bg-surface p-4 transition-all duration-200 hover:-translate-y-px hover:shadow-[0_2px_12px_-4px_rgb(0_0_0/0.08)] ${
        splitActive
          ? "border-primary/50 ring-1 ring-primary/30"
          : "border-border hover:border-control-border/60"
      }`}
      aria-current={splitActive ? "true" : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground">
            {result.work?.title ?? "منبع بدون عنوان"}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {docLabel ? (
              <span className="inline-flex items-center gap-1">
                <BookMarked className="size-3.5" aria-hidden="true" />
                {docLabel}
              </span>
            ) : null}
            {pageLabel ? (
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3.5" aria-hidden="true" />
                ص {pageLabel}
              </span>
            ) : null}
            {result.section?.title ? (
              <span className="inline-flex items-center gap-1">
                <ListTree className="size-3.5" aria-hidden="true" />
                {result.section.title}
              </span>
            ) : null}
            {!docLabel && !pageLabel && !result.section?.title ? (
              <span>مشخصات جای‌گیری ثبت نشده</span>
            ) : null}
          </p>
        </div>
        <MatchTypeBadge type={result.match_type} />
      </div>

      <blockquote className="mt-3 rounded-lg border-s-4 border-match/70 bg-reader px-3.5 py-3">
        <p
          lang="ar"
          dir="rtl"
          className="font-reader text-[15px] leading-9 text-foreground sm:text-base sm:leading-[2.1]"
        >
          <HighlightedSnippet snippet={result.snippet} highlight={result.highlight} />
        </p>
      </blockquote>

      {roles.length > 0 || result.local_hadith_uid ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="نقش‌های تطبیق">
          {result.local_hadith_uid ? (
            /* روایت لینک‌پذیر (HAD-08) + پرس‌وجوی میان‌کتابی (§۴۷) —
               شمارهٔ درون‌منبع روایت (RevayatIndex) اگر در نمایه ثبت باشد */
            <button
              type="button"
              onClick={() => setHadithLookupOpen(true)}
              className="inline-flex min-h-7 items-center gap-1 rounded-full border border-ayah/50 bg-ayah-soft px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-ayah-soft/70"
              title="این روایت در چه کتاب‌هایی آمده است؟"
            >
              <Quote className="size-3" aria-hidden="true" />
              روایت
              {result.revayat_index ? (
                <span className="text-primary">{faNum(result.revayat_index)}</span>
              ) : null}
            </button>
          ) : null}
          {roles.map((role) => (
            <Badge
              key={role}
              variant="outline"
              className="gap-1 bg-muted/40 font-normal text-muted-foreground"
            >
              {roleChipLabel(role)}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {readHref ? (
          <>
            <HashLink
              to={readHref.to}
              query={readHref.query}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow"
            >
              <BookOpenText className="size-4" aria-hidden="true" />
              بازکردن در متن
            </HashLink>
            {onOpenSplit ? (
              <Button
                type="button"
                variant={splitActive ? "secondary" : "outline"}
                className={`min-h-11 gap-2 ${splitActive ? "border-primary/50 bg-primary/10 text-primary" : ""}`}
                onClick={() => onOpenSplit(result)}
                aria-pressed={splitActive}
                title="متن نتیجه در کنار فهرست نتایج باز می‌شود؛ مواضع و فیلترها از دست نمی‌روند"
              >
                <PanelRightOpen className="size-4" aria-hidden="true" />
                کنار نتایج
              </Button>
            ) : null}
          </>
        ) : result.work?.uid ? (
          <HashLink
            to={`/book/${result.work.uid}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow"
          >
            <BookOpenText className="size-4" aria-hidden="true" />
            بازکردن اثر
          </HashLink>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="min-h-11 gap-2"
          onClick={() => setClipOpen(true)}
          disabled={!hasDocument || !offsets}
          aria-label="افزودن این نتیجه به فیش"
        >
          <Plus className="size-4" aria-hidden="true" />
          افزودن به فیش
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 gap-2 text-muted-foreground"
          onClick={() => void copyCitation()}
          aria-label="کپی ارجاع متنی این نتیجه"
          title="ارجاع متنی + نشانی عمیق برای یادداشت‌های شما"
        >
          {copied ? (
            <Check className="size-4 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {copied ? "کپی شد" : "کپی ارجاع"}
        </Button>
        {result.local_hadith_uid ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 gap-2 text-muted-foreground"
            onClick={() => setHadithLookupOpen(true)}
            aria-label="این روایت در چه کتاب‌هایی آمده است؟"
          >
            <LibraryBig className="size-4" aria-hidden="true" />
            در کدام کتاب‌ها؟
          </Button>
        ) : null}
      </div>

      <AddToClipDialog
        result={result}
        releaseUid={releaseUid}
        open={clipOpen}
        onOpenChange={setClipOpen}
      />
      {result.local_hadith_uid && result.document?.uid ? (
        <HadithLocationsDialog
          documentUid={result.document.uid}
          localHadithUid={result.local_hadith_uid}
          open={hadithLookupOpen}
          onOpenChange={setHadithLookupOpen}
        />
      ) : null}
    </article>
  );
}

/** اسکلت کارت نتیجه */
export function ResultCardSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-4" aria-hidden="true">
      <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-16 w-full animate-pulse rounded bg-muted" />
      <div className="h-9 w-40 animate-pulse rounded bg-muted" />
    </div>
  );
}

/** شمارش صادقانهٔ §۴۷ + تفکیک TECH-11 — مواضع/قطعات/روایت‌ها/کتاب‌ها مخلوط نمی‌شوند */
export function VerifiedCountLine({
  occurrences,
  countRelation,
  passages,
  hadiths,
}: {
  occurrences: number | null;
  countRelation: string;
  passages?: number | null;
  hadiths?: number | null;
}) {
  if (occurrences === null || occurrences === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        شمارش تطبیق‌ها هنوز کامل نشده است؛ فهرست زیر مواضع تأییدشده است.
      </p>
    );
  }
  const exact = countRelation === "exact";
  const parts: string[] = [];
  if (typeof passages === "number" && passages > 0) {
    parts.push(`${faNum(passages)} قطعهٔ متمایز`);
  }
  if (typeof hadiths === "number" && hadiths > 0) {
    parts.push(`${faNum(hadiths)} روایت متمایز`);
  }
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      تطبیق‌های تأییدشده تا این لحظه: {faNum(occurrences)}
      {exact ? " (شمارش کامل)" : ""}
      {parts.length > 0 ? ` — شامل ${parts.join(" و ")}` : ""}
    </p>
  );
}
