"use client";

/**
 * فرم بازطراحی‌شدهٔ جست‌وجو در منابع — منطبق بر اسکچ و ساختار سلسله‌مراتبی جدید:
 * ۱. نوع جستجو (Segmented Control: عبارت / واژگان)
 * ۲. کادر جستجو (بزرگ و در مرکز توجه)
 * ۳. شیوهٔ تطبیق (طیف دقیق‌تر به گسترده‌تر برای عبارت / شرط و فاصله و ترتیب برای واژگان)
 * ۴. محدودهٔ جستجو (کل کتابخانه / کتاب مشخص) و فیلترها و تنظیمات بیشتر (افشای تدریجی)
 * ۵. دکمهٔ اجرای جستجو (برجسته و تمام‌عرض)
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Boxes,
  CircleDot,
  Info,
  Layers,
  Library,
  Loader2,
  MoveHorizontal,
  Quote,
  Search,
  SlidersHorizontal,
  User,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChoiceButton } from "@/components/design-system/choice-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { faNum } from "@/lib/format";
import { languageLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type {
  SearchLayer,
  SearchMode,
  SearchNear,
  SearchRequest,
  SearchScope,
  SearchScopeTarget,
  TextFlex,
  WordsOpts,
  Work,
  WorkDetail,
  WorkListResponse,
} from "@/lib/types";

/* ---------- انواع وضعیت hash و فرم ---------- */

export type SearchTarget = "text" | "titles" | "authors";
export type FormScope = "library" | "author" | "work" | "document" | "titles" | "authors" | "citations";
export type WordsMatch = "all" | "any";

export interface SearchHashState {
  q: string;
  target: SearchTarget;
  scope: FormScope;
  author: string;
  mode: SearchMode; // "text" | "words"
  flex: TextFlex; // exact | written | spelling | similar
  wordsMatch: WordsMatch; // all | any
  wordsDistance: number; // 0 = مهم نیست (هر جای قطعه)، 1..50 = سقف فاصله
  wordsOrdered: boolean; // رعایت ترتیب قرارگیری
  work: string;
  doc: string;
  roles: string[];
  lang: string;
  slop: number;
  ordered: boolean;
  sure: string;
  aya: string;
  diacritics: "" | "respect" | "respect_strict";
  sort: "relevance" | "similarity" | "source";
  minScore: number;
  nearSpelling: boolean;
  expandMorphology: boolean;
  layers: SearchLayer[];
  resultLayers: string[];
}

export const LAYERED_MODES: SearchMode[] = ["tiered", "similar_quote", "long_quote", "text"];

export const LAYER_OPTIONS: Array<{ value: SearchLayer; label: string; hint: string }> = [
  { value: "L1", label: "L1 عین متن", hint: "همان نویسه‌ها، با اعراب و نشانه‌ها" },
  { value: "L2", label: "L2 نرمال‌شده", hint: "بدون اعراب، نشانه‌ها؛ ی/ک عربی و فارسی؛ فاصله و نیم‌فاصله" },
  { value: "L3", label: "L3 هم‌ارزی املایی", hint: "همزه، ة/ه، رسم‌الخط قرآنی، پیشوندها، یای اضافه و اختصارات دعایی" },
  { value: "L4", label: "L4 نقل‌قول مشابه", hint: "تغییر، حذف، افزوده یا جابه‌جایی واژه (دست‌کم ۳ واژه)" },
];

export const DEFAULT_SEARCH_STATE: SearchHashState = {
  q: "",
  target: "text",
  scope: "library",
  author: "",
  mode: "text",
  flex: "similar",
  wordsMatch: "all",
  wordsDistance: 0,
  wordsOrdered: false,
  work: "",
  doc: "",
  roles: [],
  lang: "",
  slop: 3,
  ordered: true,
  sure: "",
  aya: "",
  diacritics: "",
  sort: "relevance",
  minScore: 0,
  nearSpelling: false,
  expandMorphology: false,
  layers: [],
  resultLayers: [],
};

export const ROLE_FILTERS: Array<{ value: string; label: string; codes: string[] }> = [
  { value: "G", label: "بدنهٔ روایت", codes: ["G", "body"] },
  { value: "sanad", label: "سند روایت", codes: ["sanad"] },
  { value: "B", label: "بیان مؤلف", codes: ["B", "sharh"] },
  { value: "footnote", label: "پاورقی", codes: ["b", "lfootnote_ref"] },
];

/* ---------- گزینه‌های طیف تطبیق عبارت (چیده شده از دقیق‌تر به گسترده‌تر در RTL) ---------- */

export interface FlexSpectrumItem {
  value: TextFlex;
  label: string;
  shortDesc: string;
}

export const FLEX_SPECTRUM_OPTIONS: FlexSpectrumItem[] = [
  {
    value: "exact",
    label: "عین عبارت",
    shortDesc: "دقیقاً همان عبارت و همان ترتیب واژه‌ها با اعراب تایپ‌شده جستجو می‌شود.",
  },
  {
    value: "written",
    label: "تفاوت نوشتاری",
    shortDesc: "تفاوت‌های ساده در رسم‌الخط، فاصله، نیم‌فاصله و اعراب نادیده گرفته می‌شود.",
  },
  {
    value: "spelling",
    label: "گونه املایی",
    shortDesc: "صورت‌های مختلف املایی و رسم‌الخط واژه‌ها نیز در نظر گرفته می‌شود.",
  },
  {
    value: "similar",
    label: "مشابه",
    shortDesc: "جابه‌جایی یا حذف و اضافهٔ محدود واژه‌ها هم در نظر گرفته می‌شود.",
  },
];

/* موقعیت افقی نشانگر طیف در RTL (از راست: exact=0, written=1, spelling=2, similar=3) */
const SPECTRUM_DOT_POSITION: Record<TextFlex, string> = {
  exact: "12.5%",
  written: "37.5%",
  spelling: "62.5%",
  similar: "87.5%",
};

/* گزینه‌های پیش‌تنظیم فاصلهٔ واژه‌ها */
export const DISTANCE_OPTIONS = [
  { value: 0, label: "مهم نیست" },
  { value: 3, label: "حداکثر ۳" },
  { value: 5, label: "حداکثر ۵" },
  { value: 10, label: "حداکثر ۱۰" },
];

/* ---------- توابع کمکی سازگاری ---------- */

export function modeLabel(mode: SearchMode): string {
  switch (mode) {
    case "text":
      return "جست‌وجوی عبارت";
    case "words":
      return "جست‌وجوی واژگان";
    case "strict_phrase":
      return "عین عبارت";
    case "normalized_phrase":
      return "تفاوت‌های نوشتاری";
    case "linguistic":
      return "گونه‌های املایی";
    case "tiered":
    case "long_quote":
    case "similar_quote":
      return "مشابه";
    case "all_words":
      return "شامل همهٔ واژه‌ها";
    case "any_words":
      return "شامل حداقل یک واژه";
    case "near":
      return "واژه‌های نزدیک";
    default:
      return "جست‌وجو";
  }
}

export function modeHint(mode: SearchMode): string {
  if (mode === "text") return "جست‌وجوی عبارت و جملات با حفظ چینش واژه‌ها";
  if (mode === "words") return "جست‌وجوی کلمات مستقل در قطعات متن";
  return "";
}

export function modeWarning(_mode: SearchMode): string | undefined {
  return undefined;
}

export function modeItem(mode: SearchMode) {
  return {
    value: mode,
    label: modeLabel(mode),
    hint: modeHint(mode),
    example: "",
    icon: mode === "words" ? Boxes : Quote,
  };
}

/* ---------- نگاشت hash ↔ درخواست API ---------- */

export function parseSearchParams(query: Record<string, string>): SearchHashState {
  const modeRaw = query.mode ?? "text";
  let mode: SearchMode = "text";
  let flex: TextFlex = "similar";
  let wordsMatch: WordsMatch = "all";
  let wordsDistance = 0;
  let wordsOrdered = false;
  let sort: "relevance" | "similarity" | "source" = "relevance";

  if (query.sort === "similarity") sort = "similarity";
  else if (query.sort === "source") sort = "source";

  if (modeRaw === "words" || modeRaw === "near" || modeRaw === "all_words" || modeRaw === "any_words") {
    mode = "words";
    wordsMatch = query.match === "any" || modeRaw === "any_words" ? "any" : "all";
    const parsedDist = Number.parseInt(query.dist ?? query.slop ?? (modeRaw === "near" ? "3" : "0"), 10);
    wordsDistance = Number.isFinite(parsedDist) && parsedDist >= 0 && parsedDist <= 50 ? parsedDist : 0;
    wordsOrdered = query.ord === "1" || (modeRaw === "near" && query.ordered !== "0");
  } else {
    mode = "text";
    if (query.flex === "exact" || query.flex === "written" || query.flex === "spelling" || query.flex === "similar") {
      flex = query.flex;
    } else if (modeRaw === "strict_phrase") {
      flex = "exact";
    } else if (modeRaw === "normalized_phrase") {
      flex = "written";
    } else if (modeRaw === "linguistic") {
      flex = "spelling";
    } else if (modeRaw === "similar_quote") {
      flex = "similar";
      sort = "similarity";
    } else {
      flex = "similar";
    }
  }

  const targetRaw = query.target;
  const scopeRaw = query.scope;
  let target: SearchTarget = "text";
  if (targetRaw === "titles" || scopeRaw === "titles") {
    target = "titles";
  } else if (targetRaw === "authors" || scopeRaw === "authors") {
    target = "authors";
  } else if (targetRaw === "text") {
    target = "text";
  }

  let scope: FormScope = "library";
  if (scopeRaw === "author") {
    scope = "author";
  } else if (scopeRaw === "work") {
    scope = "work";
  } else if (scopeRaw === "document") {
    scope = "document";
  } else if (scopeRaw === "citations") {
    scope = "citations";
  } else if (target === "titles" || target === "authors") {
    scope = scopeRaw === "author" ? "author" : "library";
  }

  const author = query.author ?? "";

  const roles = (query.roles ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => ROLE_FILTERS.some((f) => f.value === r));

  const slopRaw = Number.parseInt(query.slop ?? "", 10);
  const slop = Number.isFinite(slopRaw) && slopRaw >= 1 && slopRaw <= 20 ? slopRaw : DEFAULT_SEARCH_STATE.slop;

  return {
    q: query.q ?? "",
    target,
    scope,
    author,
    mode,
    flex,
    wordsMatch,
    wordsDistance,
    wordsOrdered,
    work: query.work ?? "",
    doc: query.doc ?? "",
    roles,
    lang: query.lang === "ar" || query.lang === "fa" ? query.lang : "",
    slop,
    ordered: query.ordered === "0" ? false : DEFAULT_SEARCH_STATE.ordered,
    sure: query.sure ?? "",
    aya: query.aya ?? "",
    diacritics: query.dia === "respect" || query.dia === "respect_strict" ? query.dia : "",
    sort,
    minScore: parseMinScore(query.ms),
    nearSpelling: query.ns === "1",
    expandMorphology: query.mx === "1",
    layers: (query.layers ?? "")
      .split(",")
      .map((l) => l.trim())
      .filter((l): l is SearchLayer => LAYER_OPTIONS.some((o) => o.value === l)),
    resultLayers: (query.rlayers ?? "")
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

function parseMinScore(raw: string | undefined): number {
  const n = Number.parseFloat(raw ?? "");
  return Number.isFinite(n) && n >= 0.5 && n <= 1 ? n : 0;
}

export function searchStateKey(state: SearchHashState): string {
  return JSON.stringify([
    state.q.trim(),
    state.target,
    state.scope,
    state.author,
    state.mode,
    state.flex,
    state.wordsMatch,
    state.wordsDistance,
    state.wordsOrdered,
    state.work,
    state.doc,
    [...state.roles].sort(),
    state.lang,
    state.diacritics,
    state.sort,
    state.minScore,
    state.nearSpelling,
    state.expandMorphology,
    [...state.layers].sort(),
    [...state.resultLayers].sort(),
  ]);
}

export function buildSearchRequest(state: SearchHashState, pageSize = 20): SearchRequest {
  const isTitles = state.target === "titles" || state.scope === "titles";
  const isAuthors = state.target === "authors" || state.scope === "authors";
  const isCitations = state.scope === "citations" || state.sure.trim() !== "";

  const scopeTarget: SearchScopeTarget = isTitles
    ? "titles"
    : isAuthors
      ? "authors"
      : isCitations
        ? "citations"
        : state.scope === "document" && state.work && state.doc
          ? "document"
          : state.scope === "work" && state.work
            ? "work"
            : "library";

  const scope: SearchScope = { target: scopeTarget };

  if (state.author.trim() !== "") {
    scope.author = state.author.trim();
  }
  if (state.sure.trim() !== "") {
    scope.quran = { sure: state.sure.trim(), aya: state.aya.trim() || undefined };
  }
  if ((scopeTarget === "work" || scopeTarget === "document") && state.work) {
    scope.work_uid = state.work;
    if (state.doc) {
      scope.document_uids = [state.doc];
    }
  }
  if (state.roles.length > 0) {
    const codes = new Set<string>();
    for (const value of state.roles) {
      for (const code of ROLE_FILTERS.find((f) => f.value === value)?.codes ?? [value]) {
        codes.add(code);
      }
    }
    scope.roles = [...codes];
  }
  if (state.lang) scope.language = state.lang;

  if (isTitles || isAuthors) {
    return {
      query: state.q.trim(),
      mode: "text",
      scope,
      sort: "relevance",
      page_size: pageSize,
    };
  }

  if (state.mode === "words") {
    const words: WordsOpts = {
      match: state.wordsMatch,
      distance: state.wordsMatch === "any" ? 0 : state.wordsDistance,
      ordered: state.wordsMatch === "all" && state.wordsDistance > 0 ? state.wordsOrdered : false,
    };
    return {
      query: state.q.trim(),
      mode: "words",
      words,
      scope,
      sort: state.sort === "source" ? "source" : "relevance",
      page_size: pageSize,
      ...(state.diacritics !== "" ? { diacritics: state.diacritics } : {}),
    };
  }

  // حالت text
  const flex = state.flex || "similar";
  const reqSort =
    state.sort === "similarity" && flex === "similar"
      ? "similarity"
      : state.sort === "source"
        ? "source"
        : "relevance";

  return {
    query: state.q.trim(),
    mode: "text",
    flex,
    scope,
    sort: reqSort,
    page_size: pageSize,
    ...(state.diacritics !== "" ? { diacritics: state.diacritics } : {}),
    ...(flex === "similar" && state.nearSpelling ? { near_spelling: true } : {}),
    ...((flex === "similar" || flex === "spelling") && state.expandMorphology
      ? { expand_morphology: true }
      : {}),
    ...(flex === "similar" && state.minScore > 0 ? { min_score: state.minScore } : {}),
    ...(flex === "similar" && state.layers.length > 0 ? { layers: state.layers } : {}),
    ...(state.resultLayers.length > 0 ? { result_layers: state.resultLayers } : {}),
  };
}

/* ---------- انتخابگر کتاب مشخص ---------- */

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function WorkPicker({
  value,
  onSelect,
  ariaLabel,
  placeholderLabel,
}: {
  value: string;
  onSelect: (work: Work | null) => void;
  ariaLabel: string;
  placeholderLabel: string;
}) {
  const [filter, setFilter] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(filter, 200);

  const currentWorkQuery = useQuery({
    queryKey: ["work-info", value],
    queryFn: ({ signal }) =>
      api.get<WorkDetail>(`/works/${encodeURIComponent(value)}`, undefined, signal),
    enabled: Boolean(value),
    staleTime: 5 * 60_000,
  });

  const selectedWork = currentWorkQuery.data ?? null;
  const shouldFetch = debounced.trim().length >= 3;

  const worksQuery = useQuery({
    queryKey: ["works-autocomplete", debounced],
    queryFn: ({ signal }) =>
      api.get<WorkListResponse>(
        "/works",
        { q: debounced.trim(), page: 1, page_size: 25 },
        signal,
      ),
    enabled: shouldFetch,
    staleTime: 60_000,
  });

  const suggestions = useMemo(() => worksQuery.data?.items ?? [], [worksQuery.data]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="space-y-2">
      <Label htmlFor={`search-work-filter-${ariaLabel}`} className="text-xs font-semibold">
        {placeholderLabel}
      </Label>

      {value && (selectedWork || filter) ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <BookOpen className="size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {selectedWork?.title || filter}
              </p>
              {selectedWork?.author ? (
                <p className="truncate text-xs text-muted-foreground">{selectedWork.author}</p>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => {
              onSelect(null);
              setFilter("");
            }}
          >
            <X className="size-3.5" />
            تغییر کتاب
          </Button>
        </div>
      ) : (
        <div className="relative">
          <div className="relative">
            <Input
              id={`search-work-filter-${ariaLabel}`}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => {
                if (filter.trim().length >= 3) setIsOpen(true);
              }}
              placeholder="نام کتاب یا پدیدآور را بنویسید (مثلاً: کافی، المیزان، آسمان)…"
              className="min-h-11 pe-10 text-xs"
              autoComplete="off"
            />
            {worksQuery.isLoading ? (
              <Loader2 className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : filter ? (
              <button
                type="button"
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setFilter("");
                  setIsOpen(false);
                }}
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          {isOpen && (
            <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl">
              {filter.trim().length < 3 ? (
                <div className="p-3 text-center text-xs text-muted-foreground">
                  حداقل ۳ حرف تایپ کنید تا پیشنهادهای کتاب نمایش داده شود.
                </div>
              ) : worksQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  در حال جست‌وجوی کتاب‌ها…
                </div>
              ) : suggestions.length > 0 ? (
                <ul className="divide-y divide-border/40">
                  {suggestions.map((w) => (
                    <li key={w.uid}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-lg p-2.5 text-start text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
                        onClick={() => {
                          onSelect(w);
                          setFilter(w.title);
                          setIsOpen(false);
                        }}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{w.title}</p>
                          {w.author ? (
                            <p className="text-xs text-muted-foreground truncate">{w.author}</p>
                          ) : null}
                        </div>
                        {w.volumes_count && w.volumes_count > 1 ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {faNum(w.volumes_count)} جلد
                          </Badge>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  کتابی با این عبارت یافت نشد.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- انتخابگر مؤلف مشخص ---------- */

export interface AuthorItem {
  name: string;
  works_count?: number;
}

export function AuthorPicker({
  value,
  onSelect,
  ariaLabel,
  placeholderLabel,
}: {
  value: string;
  onSelect: (author: string | null) => void;
  ariaLabel: string;
  placeholderLabel: string;
}) {
  const [filter, setFilter] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(filter, 200);

  const authorsQuery = useQuery({
    queryKey: ["authors-autocomplete", debounced],
    queryFn: ({ signal }) =>
      api.get<{ items: AuthorItem[] }>(
        "/authors",
        { q: debounced.trim() },
        signal,
      ),
    enabled: debounced.trim().length >= 2,
    staleTime: 60_000,
  });

  const suggestions = useMemo(() => authorsQuery.data?.items ?? [], [authorsQuery.data]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="space-y-2">
      <Label htmlFor={`search-author-filter-${ariaLabel}`} className="text-xs font-semibold">
        {placeholderLabel}
      </Label>

      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <User className="size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{value}</p>
              <p className="truncate text-xs text-muted-foreground">دامنه محدود به آثار این مؤلف است</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => {
              onSelect(null);
              setFilter("");
            }}
          >
            <X className="size-3.5" />
            تغییر مؤلف
          </Button>
        </div>
      ) : (
        <div className="relative">
          <div className="relative">
            <Input
              id={`search-author-filter-${ariaLabel}`}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => {
                if (filter.trim().length >= 2) setIsOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filter.trim()) {
                  e.preventDefault();
                  onSelect(filter.trim());
                  setIsOpen(false);
                }
              }}
              placeholder="نام مؤلف یا پدیدآور را بنویسید (مثلاً: مجلسی، کلینی، شیخ طوسی)…"
              className="min-h-11 pe-10 text-xs"
              autoComplete="off"
            />
            {authorsQuery.isLoading ? (
              <Loader2 className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : filter ? (
              <button
                type="button"
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setFilter("");
                  setIsOpen(false);
                }}
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          {isOpen && (
            <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl">
              {filter.trim().length < 2 ? (
                <div className="p-3 text-center text-xs text-muted-foreground">
                  دست‌کم ۲ حرف تایپ کنید تا پیشنهادهای مؤلفان نمایش داده شود.
                </div>
              ) : authorsQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  در حال جست‌وجوی مؤلفان…
                </div>
              ) : suggestions.length > 0 ? (
                <ul className="divide-y divide-border/40">
                  {suggestions.map((a) => (
                    <li key={a.name}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-lg p-2.5 text-start text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
                        onClick={() => {
                          onSelect(a.name);
                          setFilter(a.name);
                          setIsOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <User className="size-3.5 text-primary shrink-0" />
                          <span className="font-medium text-foreground truncate">{a.name}</span>
                        </div>
                        {a.works_count ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {faNum(a.works_count)} اثر
                          </Badge>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-3 text-center text-xs">
                  <p className="text-muted-foreground mb-2">مؤلفی با این عنوان دقیق در پیشنهادها یافت نشد.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 gap-1"
                    onClick={() => {
                      onSelect(filter.trim());
                      setIsOpen(false);
                    }}
                  >
                    استفاده از «{filter.trim()}» به‌عنوان مؤلف
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- کامپوننت اصلی SearchForm بازطراحی‌شده ---------- */

export interface SearchFormProps {
  value: SearchHashState;
  onChange: (patch: Partial<SearchHashState>) => void;
  onSubmit: () => void;
  busy?: boolean;
  variant?: "default" | "hero";
  showTitle?: boolean;
}

export function SearchForm({
  value,
  onChange,
  onSubmit,
  busy = false,
  variant = "default",
  showTitle = true,
}: SearchFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const optionsId = useId();
  const [customDistOpen, setCustomDistOpen] = useState(false);

  const isText = value.mode !== "words";
  const currentFlexOption =
    FLEX_SPECTRUM_OPTIONS.find((opt) => opt.value === value.flex) ?? FLEX_SPECTRUM_OPTIONS[3];

  const workDetailQuery = useQuery({
    queryKey: ["work-docs", value.work],
    queryFn: ({ signal }) =>
      api.get<WorkDetail>(`/works/${encodeURIComponent(value.work)}`, undefined, signal),
    enabled: Boolean(value.work),
    staleTime: 60_000,
  });
  const documents = useMemo(() => workDetailQuery.data?.documents ?? [], [workDetailQuery.data]);

  // شمارش تعداد فیلترهای پیشرفته فعال
  const activeAdvancedCount = useMemo(() => {
    let count = 0;
    if (value.scope !== "library") count += 1;
    if (value.diacritics !== "") count += 1;
    if (value.expandMorphology) count += 1;
    if (value.nearSpelling) count += 1;
    if (value.sort === "similarity") count += 1;
    if (value.roles.length > 0) count += 1;
    if (value.lang !== "") count += 1;
    if (value.sure.trim() !== "") count += 1;
    if (value.layers.length > 0) count += 1;
    if (value.minScore > 0) count += 1;
    return count;
  }, [value]);

  const canSubmit = (value.q.trim().length > 0 || value.sure.trim().length > 0) && !busy;

  const isCustomDistance =
    value.mode === "words" &&
    value.wordsDistance > 0 &&
    !DISTANCE_OPTIONS.some((opt) => opt.value === value.wordsDistance);

  return (
    <div className="w-full">
      <form
        role="search"
        aria-label="جست‌وجو در منابع"
        className={cn(
          "rounded-3xl border border-border/70 bg-card p-5 sm:p-7 shadow-xs space-y-5 transition-all",
          variant === "hero" ? "max-w-2xl mx-auto" : "w-full"
        )}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        {/* ۱. عنوان و توضیح بالا (در صورت فعال بودن) */}
        {showTitle ? (
          <div className="text-center space-y-1">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              جستجو در منابع
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              جستجو در متن و عنوان منابع
            </p>
          </div>
        ) : null}

        {/* نوع جستجو (Segmented Switch: عبارت / واژگان) */}
        <div className="flex justify-center">
          <div
            role="group"
            aria-label="نوع جستجو"
            className="inline-flex p-1 rounded-full bg-muted/70 border border-border/80 shadow-2xs"
          >
            <button
              type="button"
              aria-pressed={isText}
              onClick={() => onChange({ mode: "text" })}
              className={cn(
                "flex min-h-11 items-center justify-center gap-2 py-2 px-5 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200",
                isText
                  ? "bg-primary text-primary-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              <Quote className="size-3.5 sm:size-4" />
              عبارت
            </button>

            <button
              type="button"
              aria-pressed={!isText}
              onClick={() => onChange({ mode: "words" })}
              className={cn(
                "flex min-h-11 items-center justify-center gap-2 py-2 px-5 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200",
                !isText
                  ? "bg-primary text-primary-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              <Boxes className="size-3.5 sm:size-4" />
              واژگان
            </button>
          </div>
        </div>

        <Label htmlFor="search-main-input">{isText ? "عبارت جست‌وجو" : "واژه‌های جست‌وجو"}</Label>

        {/* کادر اصلی جستجو (عنصر اصلی و چشمگیر صفحه) */}
        <div className="relative" style={{ position: "relative", width: "100%" }}>
          {/* آیکون جستجو در سمت چپ - موقعیت ثابت بدون وابستگی به کامپایل css */}
          <Search
            className="pointer-events-none size-5"
            style={{
              position: "absolute",
              left: "16px",
              top: "50%",
              transform: "translateY(-50%)",
              width: "20px",
              height: "20px",
              color: "var(--muted)",
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
          <Input
            id="search-main-input"
            value={value.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder={
              isText
                ? "عبارت یا حدیث موردنظر را بنویسید..."
                : "واژه‌های موردنظر را با فاصله بنویسید..."
            }
            className="w-full rounded-xl bg-input-surface border border-control-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 shadow-2xs transition-colors outline-none"
            style={{
              height: "56px",
              paddingRight: "20px",
              paddingLeft: value.q ? "76px" : "48px",
              borderRadius: "14px",
              fontSize: "15px",
              direction: "rtl",
              textAlign: "right",
            }}
            autoComplete="off"
          />
          {value.q ? (
            <button
              type="button"
              style={{
                position: "absolute",
                left: "44px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "28px",
                height: "28px",
                borderRadius: "9999px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                zIndex: 10,
              }}
              onClick={() => onChange({ q: "" })}
              aria-label="پاک کردن متن"
            >
              <X className="size-4" style={{ width: "16px", height: "16px" }} />
            </button>
          ) : null}
        </div>

        <p className="text-sm leading-6 text-start text-muted-foreground" aria-live="polite">
          {isText ? `نوع تطبیق: ${currentFlexOption.label}` : value.wordsMatch === "all" ? "همهٔ واژه‌ها در متن پیدا شوند." : "حداقل یکی از واژه‌ها در متن پیدا شود."}
          {value.mode === "words" && value.wordsDistance > 0 ? ` فاصله: حداکثر ${faNum(value.wordsDistance)} واژه${value.wordsOrdered ? "، به‌ترتیب" : ""}.` : ""}
          {" برای تغییر گزینه‌ها، تنظیمات دقیق‌تر را باز کنید."}
        </p>
        <div id={optionsId} hidden={!advancedOpen} className="max-h-[min(60dvh,640px)] space-y-5 overflow-y-auto overscroll-contain rounded-xl border border-border p-3 sm:p-4">
        {/* تنظیمات بلافاصله پس از کادر جستجو */}
        {isText ? (
          /* ---------- حالت عبارت: طیف نوع تطبیق عبارت ---------- */
          <div className="space-y-3 pt-1">
            {/* سربرگ بخش */}
            <div className="flex items-center justify-start gap-1.5">
              <Layers className="size-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">نوع تطبیق عبارت</span>
            </div>

            {/* گزینه‌های افقی: همه دارای کادر و بک‌گراند؛ در حالت انتخاب به رنگ سبز */}
            <div
              className="w-full gap-2.5"
              style={{
                display: "flex",
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "10px",
                width: "100%",
              }}
            >
              {FLEX_SPECTRUM_OPTIONS.map((opt) => {
                const isSelected = value.flex === opt.value;
                return (
                  <ChoiceButton selected={isSelected}
                    key={opt.value}
                    type="button"
                    onClick={() => onChange({ flex: opt.value })}

                  >
                    {opt.label}
                  </ChoiceButton>
                );
              })}
            </div>

            {/* نوار طیف گرافیکی (دقیق‌تر به گسترده‌تر) با خط ضخیم و بولت متحرک */}
            <div
              className="flex items-center gap-3 py-1.5 px-1"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                width: "100%",
              }}
            >
              <span
                className="shrink-0 text-xs font-semibold text-muted-foreground select-none"
                style={{ minWidth: "48px", textAlign: "right" }}
              >
                دقیق‌تر
              </span>

              <div
                className="relative flex-1"
                style={{
                  flex: 1,
                  position: "relative",
                  height: "4px",
                  backgroundColor: "var(--border)",
                  borderRadius: "9999px",
                }}
              >
                {/* نقطه نشانگر متحرک (بولن) */}
                <span
                  className="transition-all duration-300"
                  style={{
                    position: "absolute",
                    top: "50%",
                    right: SPECTRUM_DOT_POSITION[value.flex],
                    transform: "translate(50%, -50%)",
                    width: "16px",
                    height: "16px",
                    borderRadius: "9999px",
                    backgroundColor: "var(--primary)",
                    border: "2.5px solid var(--surface)",
                    boxShadow: "0 0 0 3px color-mix(in srgb, var(--primary) 35%, transparent)",
                    display: "block",
                    zIndex: 10,
                  }}
                />
              </div>

              <span
                className="shrink-0 text-xs font-semibold text-muted-foreground select-none"
                style={{ minWidth: "52px", textAlign: "left" }}
              >
                گسترده‌تر
              </span>
            </div>

            {/* کادر توضیح تک‌جمله‌ای فقط برای گزینهٔ فعال */}
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 flex items-start gap-2.5 text-xs text-foreground/90">
              <Info className="size-4 text-primary shrink-0 mt-0.5" />
              <p className="leading-relaxed">{currentFlexOption.shortDesc}</p>
            </div>
          </div>
        ) : (
          /* ---------- حالت واژگان: شرط تطبیق + فاصله + رعایت ترتیب ---------- */
          <div className="space-y-4 pt-1">
            {/* انتخاب «همه واژه‌ها» یا «حداقل یکی» */}
            <div className="flex items-center justify-start">
              <div
                className="inline-flex max-w-full flex-wrap gap-1 p-1 rounded-2xl"
                style={{
                  backgroundColor: "var(--chrome)",
                  border: "1px solid var(--control-border)",
                  display: "inline-flex",
                  padding: "4px",
                  borderRadius: "8px",
                }}
              >
                <ChoiceButton selected={value.wordsMatch === "all"}
                  type="button"
                  onClick={() => onChange({ wordsMatch: "all" })}

                >
                  <Boxes className="size-3.5" />
                  همه واژه‌ها
                </ChoiceButton>

                <ChoiceButton selected={value.wordsMatch === "any"}
                  type="button"
                  onClick={() => onChange({ wordsMatch: "any" })}

                >
                  <CircleDot className="size-3.5" />
                  حداقل یکی
                </ChoiceButton>
              </div>
            </div>

            {/* فاصله و ترتیب واژه‌ها (فقط در صورتی که «همه واژه‌ها» فعال باشد نمایش داده می‌شود) */}
            {value.wordsMatch === "all" ? (
              <div className="space-y-3.5 pt-1">
                <div className="flex items-center justify-start gap-1.5">
                  <MoveHorizontal className="size-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground">فاصله واژه‌ها</span>
                </div>

                {/* دکمه‌های فاصله: درشت‌تر و در مرکز با کادر و بک‌گراند سبز هنگام انتخاب */}
                <div
                  className="w-full"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "10px",
                    flexWrap: "wrap",
                    width: "100%",
                  }}
                >
                  {(() => {
                    const isCustomActive = customDistOpen || isCustomDistance;
                    return (
                      <>
                        {DISTANCE_OPTIONS.map((opt) => {
                          const isSelected = !isCustomActive && value.wordsDistance === opt.value;
                          return (
                            <ChoiceButton selected={isSelected}
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                setCustomDistOpen(false);
                                onChange({ wordsDistance: opt.value });
                              }}

                            >
                              {opt.label}
                            </ChoiceButton>
                          );
                        })}

                        {/* دکمه و اینپوت فاصلهٔ دلخواه */}
                        <div className="inline-flex items-center gap-1.5">
                          <ChoiceButton selected={isCustomActive}
                            type="button"
                            onClick={() => {
                              if (isCustomActive) {
                                setCustomDistOpen(false);
                                onChange({ wordsDistance: 0 });
                              } else {
                                setCustomDistOpen(true);
                              }
                            }}

                          >
                            {isCustomDistance ? `دلخواه (${faNum(value.wordsDistance)})` : "دلخواه"}
                          </ChoiceButton>

                          {customDistOpen || isCustomDistance ? (
                            <div className="flex items-center gap-1 ms-1">
                              <Input
                                type="number"
                                min={1}
                                max={50}
                                value={value.wordsDistance || ""}
                                placeholder="۱-۵۰"
                                onChange={(e) => {
                                  const n = Number.parseInt(e.target.value, 10);
                                  onChange({
                                    wordsDistance: Number.isFinite(n) && n >= 1 && n <= 50 ? n : 0,
                                  });
                                }}
                                className="h-9 w-16 text-center text-xs p-1 rounded-xl"
                                autoFocus={customDistOpen && !isCustomDistance}
                              />
                              <span className="text-[11px] text-muted-foreground">واژه</span>
                            </div>
                          ) : null}
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* چک‌باکس رعایت ترتیب واژه‌ها */}
                <div className="flex items-center justify-start pt-1">
                  <label
                    className={cn(
                      "flex items-center gap-2 text-xs cursor-pointer select-none transition-opacity",
                      value.wordsDistance === 0 && "opacity-50 pointer-events-none"
                    )}
                    title={value.wordsDistance === 0 ? "رعایت ترتیب فقط با فاصله مشخص کاربرد دارد" : undefined}
                  >
                    <Checkbox
                      checked={value.wordsOrdered && value.wordsDistance > 0}
                      onCheckedChange={(checked) => onChange({ wordsOrdered: checked === true })}
                      disabled={value.wordsDistance === 0}
                    />
                    <span className="font-medium text-foreground">رعایت ترتیب واژه‌ها</span>
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* دامنهٔ جستجو (محدودسازی به مؤلف، کتاب یا کل کتابخانه) و تنظیمات بیشتر */}
        <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {/* سمت راست: دامنهٔ جستجو */}
              <Select
                value={
                  value.scope === "document"
                    ? "work"
                    : value.scope === "author"
                      ? "author"
                      : value.scope === "work"
                        ? "work"
                        : "library"
                }
                onValueChange={(v) => {
                  const next = v as FormScope;
                  if (next === "library") onChange({ scope: "library", author: "", work: "", doc: "" });
                  else if (next === "author") onChange({ scope: "author", work: "", doc: "" });
                  else if (next === "work") onChange({ scope: "work", author: "" });
                }}
              >
                <SelectTrigger className="min-h-11 rounded-xl bg-muted/40 hover:bg-muted/60 border-border/70 text-xs sm:text-sm font-medium transition-colors">
                  <div className="flex items-center gap-2 truncate">
                    {value.scope === "author" ? (
                      <User className="size-4 text-primary shrink-0" />
                    ) : value.scope === "work" || value.scope === "document" ? (
                      <BookOpen className="size-4 text-primary shrink-0" />
                    ) : (
                      <Library className="size-4 text-primary shrink-0" />
                    )}
                    <span>
                      دامنه:{" "}
                      {value.scope === "author"
                        ? "یک مؤلف خاص…"
                        : value.scope === "work" || value.scope === "document"
                          ? "یک کتاب خاص…"
                          : "کل کتابخانه"}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="library" className="py-2">
                    <div className="flex items-center gap-2">
                      <Library className="size-4 text-primary shrink-0" />
                      <span>کل کتابخانه (متن تمام آثار)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="author" className="py-2">
                    <div className="flex items-center gap-2">
                      <User className="size-4 text-primary shrink-0" />
                      <span>یک مؤلف خاص… (متن آثار این مؤلف)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="work" className="py-2">
                    <div className="flex items-center gap-2">
                      <BookOpen className="size-4 text-primary shrink-0" />
                      <span>یک کتاب خاص…</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* سمت چپ: دکمه‌ٔ بازشوی فیلترها و تنظیمات بیشتر */}

            </div>

            {/* فیلد انتخاب مؤلف مشخص (در صورت انتخاب دامنهٔ مؤلف) */}
            {value.scope === "author" ? (
              <div className="mt-3 space-y-2 rounded-2xl border border-border bg-surface p-4">
                <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <User className="size-4 text-primary" />
                  <span>انتخاب مؤلف برای محدودسازی جست‌وجوی متن:</span>
                </div>
                <AuthorPicker
                  value={value.author}
                  onSelect={(a) => onChange({ author: a ?? "" })}
                  ariaLabel="انتخاب مؤلف برای دامنهٔ جست‌وجو"
                  placeholderLabel="نام مؤلف را جست‌وجو کنید (مثلاً: علامه مجلسی، کلینی، شیخ طوسی)..."
                />
              </div>
            ) : null}

            {/* فیلد انتخاب کتاب مشخص (در صورت انتخاب دامنهٔ کتاب) */}
            {value.scope === "work" || value.scope === "document" ? (
              <div className="mt-3 space-y-3 rounded-2xl border border-border bg-surface p-4">
                <WorkPicker
                  value={value.work}
                  onSelect={(w) => onChange({ work: w?.uid ?? "", doc: "" })}
                  ariaLabel="انتخاب کتاب برای دامنهٔ جست‌وجو"
                  placeholderLabel="انتخاب کتاب مشخص"
                />

                {value.work && documents.length > 1 ? (
                  <div className="space-y-1.5 pt-2 border-t border-border/40">
                    <Label htmlFor="search-doc-select" className="text-xs">
                      جلد یا بخش مشخص (اختیاری):
                    </Label>
                    <Select
                      value={value.doc || "all"}
                      onValueChange={(uid) => onChange({ doc: uid === "all" ? "" : uid })}
                    >
                      <SelectTrigger id="search-doc-select" className="min-h-10 w-full sm:w-72 text-xs">
                        <SelectValue placeholder="همهٔ جلدها" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        <SelectItem value="all">همهٔ جلدها</SelectItem>
                        {documents.map((d) => (
                          <SelectItem key={d.uid} value={d.uid}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            ) : null}

          {/* محتوای تنظیمات پیشرفته (فقط در صورت باز شدن توسط کاربر) */}
          <div className="space-y-4 rounded-2xl border border-border bg-muted/20 p-4 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {/* اعراب */}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-background p-2.5 text-xs">
                <Checkbox
                  checked={value.diacritics !== ""}
                  onCheckedChange={(checked) => onChange({ diacritics: checked === true ? "respect" : "" })}
                  className="mt-0.5"
                />
                <div>
                  <span className="font-semibold text-foreground">رعایت اعراب نوشته‌شده</span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    هر حرکتی که تایپ کرده‌اید باید روی همان حرف در متن باشد.
                  </p>
                </div>
              </label>

              {/* صورت صرفی */}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-background p-2.5 text-xs">
                <Checkbox
                  checked={value.expandMorphology}
                  onCheckedChange={(checked) => onChange({ expandMorphology: checked === true })}
                  className="mt-0.5"
                />
                <div>
                  <span className="font-semibold text-foreground">صورت صرفی (مفرد/جمع با «ها»)</span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    «کتاب» ↔ «کتاب‌ها» با برچسب مشخص گزارش می‌شود.
                  </p>
                </div>
              </label>

              {/* واژه نزدیک L5 (در حالت مشابه) */}
              {isText && value.flex === "similar" ? (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-background p-2.5 text-xs">
                  <Checkbox
                    checked={value.nearSpelling}
                    onCheckedChange={(checked) => onChange({ nearSpelling: checked === true })}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="font-semibold text-foreground">واژهٔ نزدیک با ۱ حرف ویرایش (L5)</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      برای پرسش تک‌واژه: پیدا کردن خطای تایپی با ۱ حرف اختلاف.
                    </p>
                  </div>
                </label>
              ) : null}

              {/* شبیه‌ترین نقل‌ها در صدر نتایج (در حالت مشابه) */}
              {isText && value.flex === "similar" ? (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-background p-2.5 text-xs">
                  <Checkbox
                    checked={value.sort === "similarity"}
                    onCheckedChange={(checked) =>
                      onChange({ sort: checked === true ? "similarity" : "relevance" })
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <span className="font-semibold text-foreground">ترتیب بر اساس شباهت</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      شبیه‌ترین نقل‌ها بالاتر از سایر نتایج قرار می‌گیرند.
                    </p>
                  </div>
                </label>
              ) : null}
            </div>

            {/* بخش‌های نشانه‌گذاری‌شده و زبان */}
            <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-border/50">
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-semibold text-foreground">بخش‌های نشانه‌گذاری‌شده</legend>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_FILTERS.map((role) => (
                    <label
                      key={role.value}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background p-2 text-xs"
                    >
                      <Checkbox
                        checked={value.roles.includes(role.value)}
                        onCheckedChange={(checked) => {
                          onChange({
                            roles: checked
                              ? [...value.roles, role.value]
                              : value.roles.filter((r) => r !== role.value),
                          });
                        }}
                      />
                      <span>{role.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="search-lang-select" className="text-xs font-semibold">
                  زبان منبع
                </Label>
                <Select
                  value={value.lang || "all"}
                  onValueChange={(v) => onChange({ lang: v === "all" ? "" : v })}
                >
                  <SelectTrigger id="search-lang-select" className="h-9 text-xs bg-background">
                    <SelectValue placeholder="همهٔ زبان‌ها" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همهٔ زبان‌ها</SelectItem>
                    <SelectItem value="ar">{languageLabel("ar")}</SelectItem>
                    <SelectItem value="fa">{languageLabel("fa")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!canSubmit} loading={busy} className="min-w-32 flex-1 gap-2">
            {!busy ? <Search className="size-5" aria-hidden="true" /> : null}
            جست‌وجو
          </Button>
          <Button type="button" variant="outline" aria-expanded={advancedOpen} aria-controls={optionsId} className="min-w-32 flex-1 gap-2" onClick={() => setAdvancedOpen(!advancedOpen)}>
            <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
            {advancedOpen ? "جست‌وجوی ساده" : "تنظیمات دقیق‌تر"}
            {activeAdvancedCount > 0 ? <Badge variant="accent">{faNum(activeAdvancedCount)}</Badge> : null}
          </Button>
        </div>
      </form>
    </div>
  );
}
