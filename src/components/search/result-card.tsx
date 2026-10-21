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
  User,
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
  SearchLayer,
  SearchResponse,
  SearchResultItem,
  SimilarityCounts,
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

/* ---------- نشان نوع تطبیق — هر حالت رنگ متمایز با برچسب لایه (L1 تا L4 طبق §۲۰) ---------- */

const MATCH_TONE: Record<string, string> = {
  exact: "border-primary/40 bg-primary/10 text-primary",
  normalized: "border-link/40 bg-link/10 text-link",
  linguistic: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  similar: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  fuzzy: "border-border bg-muted text-muted-foreground",
};

const LAYER_INFO: Record<SearchLayer, { label: string; tone: string }> = {
  L1: { label: "عین متن", tone: MATCH_TONE.exact },
  L2: { label: "نرمال‌شده", tone: MATCH_TONE.normalized },
  L3: { label: "هم‌ارزی املایی", tone: MATCH_TONE.linguistic },
  L4: { label: "نقل‌قول مشابه", tone: MATCH_TONE.similar },
  L5: { label: "واژهٔ نزدیک", tone: MATCH_TONE.fuzzy },
};

/**
 * برچسب لایهٔ تطبیق. موتور FTS5 فیلد `layer` را صریح می‌فرستد؛ برای موتورهای دیگر
 * (local/opensearch) لایه از `match_type` حدس زده می‌شود (سازگاری عقب‌رو).
 */
export function matchTypeLayerLabel(type: string, layer?: SearchLayer | null): { label: string; layer: string } {
  if (layer && LAYER_INFO[layer]) {
    if (layer === "L3" && type.includes("پیوستگی")) return { label: "تفاوت پیوستگی", layer };
    return { label: LAYER_INFO[layer].label, layer };
  }
  if (type === "exact") return { label: "عبارت دقیق", layer: "L1" };
  if (type === "normalized") return { label: "نرمال‌شده", layer: "L2" };
  if (type.includes("پیوستگی")) return { label: "تفاوت پیوستگی", layer: "L3" };
  if (type === "linguistic") return { label: "هم‌ارزی املایی", layer: "L3" };
  if (type.startsWith("L4") || type === "similar") return { label: "نقل‌قول مشابه", layer: "L4" };
  if (type.startsWith("L5")) return { label: "واژهٔ نزدیک", layer: "L5" };
  return { label: matchTypeLabels[type as MatchType] ?? type, layer: "L" };
}

function layerOf(result: SearchResultItem): SearchLayer | null {
  if (result.layer) return result.layer;
  const l = matchTypeLayerLabel(result.match_type).layer;
  return l === "L" ? null : (l as SearchLayer);
}

const faPercent = (v: number) => `${faNum(Math.round(v * 100))}٪`;

function MatchTypeBadge({ result }: { result: SearchResultItem }) {
  if (result.passage_uid?.startsWith("title-") || result.match_type === "title") {
    const isAuthor = result.page?.label === "پدیدآور";
    return (
      <Badge
        variant="outline"
        className="shrink-0 font-medium gap-1.5 border-primary/40 bg-primary/10 text-primary"
      >
        {isAuthor ? <User className="size-3.5" aria-hidden="true" /> : <LibraryBig className="size-3.5" aria-hidden="true" />}
        <span>{isAuthor ? "پدیدآور" : "عنوان کتاب"}</span>
      </Badge>
    );
  }
  const type = result.match_type;
  const layer = layerOf(result);
  const info = matchTypeLayerLabel(type, result.layer);
  const tone = layer ? LAYER_INFO[layer].tone : (MATCH_TONE[type] ?? MATCH_TONE.fuzzy);
  const score = layer === "L4" ? (result.similarity?.score ?? null) : null;
  return (
    <Badge
      variant="outline"
      className={`shrink-0 font-medium gap-1.5 ${tone}`}
    >
      <span className="font-mono text-xs px-1.5 py-0.2 rounded bg-background/60 font-bold border border-current/20">
        {info.layer}
      </span>
      <span>{info.label}</span>
      {score !== null ? (
        <span className="text-[11px] opacity-80 mr-0.5" title="امتیاز شباهت لفظی (نه درصد اطمینان علمی)">
          ({faPercent(score)})
        </span>
      ) : null}
    </Badge>
  );
}

/** خلاصهٔ شمار تغییرات هم‌ترازی L4 به زبان کاربر */
function similarityCountsText(c: SimilarityCounts): string {
  const parts: string[] = [];
  if (c.substitutions) parts.push(`${faNum(c.substitutions)} جانشینی`);
  if (c.deletions) parts.push(`${faNum(c.deletions)} حذف`);
  if (c.insertions) parts.push(`${faNum(c.insertions)} افزوده`);
  if (c.transpositions) parts.push(`${faNum(c.transpositions)} جابه‌جایی`);
  if (c.block_moves) parts.push(`${faNum(c.block_moves)} جابه‌جایی بلوک`);
  if (c.near_spelling) parts.push(`${faNum(c.near_spelling)} واژهٔ نزدیک`);
  if (c.orthographic) parts.push(`${faNum(c.orthographic)} تفاوت املایی`);
  if (c.honorific) parts.push(`${faNum(c.honorific)} واژهٔ عبارت دعایی`);
  return parts.join("، ");
}

/** کادر تفاوت‌ها: L3 (هم‌ارزی‌های اعمال‌شده)، L4 (هم‌ترازی)، L5 (واژهٔ نزدیک) — §۲۰/§۲۳ */
function MatchDiffs({ result }: { result: SearchResultItem }) {
  const layer = layerOf(result);
  if (layer !== "L3" && layer !== "L4" && layer !== "L5") return null;
  const sim = result.similarity ?? null;
  const diffs = (result.diffs && result.diffs.length > 0 ? result.diffs : sim?.diffs) ?? [];
  let summary: string;
  if (layer === "L4") {
    summary = sim
      ? `شباهت لفظی ${faPercent(sim.score)} · پوشش پرسش ${faPercent(sim.coverage)}` +
        (similarityCountsText(sim.counts) ? ` · ${similarityCountsText(sim.counts)}` : "")
      : "تطبیق با هم‌ترازی واژگانی؛ شامل تغییر، حذف یا جابه‌جایی در نقل‌قول.";
  } else if (layer === "L5") {
    summary = "واژه‌ای با یک تفاوت حرفی با واژهٔ پرسش (فقط با گزینهٔ «واژهٔ نزدیک»)؛ در شمار قطعی نیست.";
  } else if (result.match_type.includes("پیوستگی")) {
    summary = "گونهٔ پیوسته/گسستهٔ خط فارسی («می/نمی»، «ها/های» — §۱۶).";
  } else {
    summary = "هم‌ارزی املایی: همزه، ة/ه، ی/ى، رسم‌الخط قرآنی یا پیشوند چسبان (و، ف، ب، ک، ل، ال).";
  }
  return (
    <div className="mt-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
      <div className="flex items-center gap-1.5 font-medium">
        <span className="inline-block size-1.5 rounded-full bg-amber-500" />
        <span>{layer === "L3" ? "علت تطبیق (تفاوت‌های املایی):" : "علت تطبیق:"}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{summary}</p>
      {diffs.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="فهرست تفاوت‌ها">
          {diffs.slice(0, 12).map((d, i) => (
            <li
              key={`${i}-${d}`}
              className="rounded border border-amber-500/30 bg-background/70 px-1.5 py-0.5 text-[11px] text-foreground"
            >
              {d}
            </li>
          ))}
          {diffs.length > 12 ? (
            <li className="px-1 text-[11px] text-muted-foreground">و {faNum(diffs.length - 12)} مورد دیگر</li>
          ) : null}
        </ul>
      ) : null}
      {sim && layer === "L4" ? (
        <p className="mt-1 text-[10px] text-muted-foreground/80" dir="ltr">
          {sim.algorithm} v{sim.version}
        </p>
      ) : null}
    </div>
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
            className="rounded-sm bg-match px-0.5 text-match-foreground"
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

  const isTitle = result.passage_uid?.startsWith("title-") || result.match_type === "title";

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
            {pageLabel && !isTitle ? (
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3.5" aria-hidden="true" />
                ص {pageLabel}
              </span>
            ) : null}
            {result.section?.title ? (
              <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                <span className="text-muted-foreground">پدیدآور:</span>
                {result.section.title.replace(/^مؤلف:\s*/, "")}
              </span>
            ) : null}
            {isTitle && result.work?.label && result.work.label !== result.work.title ? (
              <span className="inline-flex items-center gap-1">
                <span className="text-muted-foreground">عنوان کوتاه:</span>
                {result.work.label}
              </span>
            ) : null}
            {!isTitle && !docLabel && !pageLabel && !result.section?.title ? (
              <span>مشخصات جای‌گیری ثبت نشده</span>
            ) : null}
          </p>
        </div>
        <MatchTypeBadge result={result} />
      </div>

      {result.snippet ? (
        <blockquote className="mt-3 rounded-lg border-s-4 border-match/70 bg-reader px-3.5 py-3">
          <p
            lang="ar"
            dir="rtl"
            className="font-reader text-[15px] leading-9 text-foreground sm:text-base sm:leading-[2.1]"
          >
            <HighlightedSnippet snippet={result.snippet} highlight={result.highlight} />
          </p>
        </blockquote>
      ) : null}

      {/* کادر تفاوت‌های لفظی و رسم‌الخطی برای L3، L4 و L5 (§۲۰/§۲۳) */}
      <MatchDiffs result={result} />

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
            مشاهده کتاب
          </HashLink>
        ) : null}
        {!isTitle ? (
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
        ) : null}
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
  occurrences: number | null | undefined;
  countRelation: string;
  passages?: number | null;
  hadiths?: number | null;
}) {
  if (occurrences === null || occurrences === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        در حال بررسی و شمارش نتایج…
      </p>
    );
  }
  const exact = countRelation === "exact";
  const parts: string[] = [];
  if (typeof passages === "number" && passages > 0) {
    parts.push(`${faNum(passages)} موضع متن`);
  }
  if (typeof hadiths === "number" && hadiths > 0) {
    parts.push(`${faNum(hadiths)} روایت`);
  }
  return (
    <div className="flex flex-wrap items-baseline gap-2" aria-live="polite">
      <span className="text-base font-bold text-foreground">
        {faNum(occurrences)} نتیجه یافت شد
      </span>
      {parts.length > 0 ? (
        <span className="text-xs text-muted-foreground">
          (در {parts.join(" و ")})
        </span>
      ) : null}
      {!exact ? (
        <span className="inline-flex items-center text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full">
          در حال شمارش نهایی…
        </span>
      ) : null}
    </div>
  );
}

const FRIENDLY_LAYER_NAMES: Record<SearchLayer, string> = {
  L1: "عین عبارت",
  L2: "تفاوت نوشتاری",
  L3: "گونه املایی",
  L4: "مشابه",
  L5: "نزدیک",
};

/**
 * تفکیک نوع تطبیق به زبان ساده و کاربرپسند به جای اصطلاحات فنی L1/L2/L3
 */
export function LayerCountsLine({ meta }: { meta: SearchResponse | null | undefined }) {
  if (!meta) return null;
  const lc = meta.layer_counts ?? null;
  const layers = (["L1", "L2", "L3", "L4", "L5"] as SearchLayer[]).filter((l) => (lc?.[l] ?? 0) > 0);
  const similar = meta.similar_occurrences ?? 0;
  if (layers.length === 0 && similar === 0) return null;
  return (
    <div className="space-y-1 pt-1">
      {layers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground text-[11px]">تفکیک تطبیق:</span>
          {layers.map((l) => (
            <span
              key={l}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] bg-muted/60 border border-border/70 text-foreground"
            >
              <span className="text-muted-foreground">{FRIENDLY_LAYER_NAMES[l] || LAYER_INFO[l].label}:</span>
              <span className="font-semibold text-primary">{faNum(lc?.[l] ?? 0)}</span>
            </span>
          ))}
        </div>
      ) : null}
      {similar > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          همچنین {faNum(similar)} مورد با شباهت تقریبی یافت شد.
        </p>
      ) : null}
    </div>
  );
}
