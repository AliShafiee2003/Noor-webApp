"use client";

/**
 * فرم جست‌وجو در منابع — §۱۲، §۴۴، §۴۷
 * - انتخاب mode با توضیح فارسی (پیش‌فرض: عبارت نرمال‌شده)
 * - دامنه: کل کتابخانه / اثر مشخص / سند مشخص
 * - حالت پیشرفته (افشای تدریجی): فاصلهٔ واژه‌ها (near)، فیلتر نقش «در منابع دارای
 *   نشانه‌گذاری»، زبان
 * - submit صریح (Enter یا دکمه) — debounce فقط برای فیلتر عنوان کتاب
 * عبارت و فیلترها فقط در hash نگه داشته می‌شوند (WORK-07/13).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Loader2, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import type {
  SearchMode,
  SearchNear,
  SearchRequest,
  SearchScope,
  SearchScopeTarget,
  Work,
  WorkDetail,
  WorkListResponse,
} from "@/lib/types";

/* ---------- انواع وضعیت hash ---------- */

/** دامنه‌های رابط؛ «titles» = جست‌وجو در نام کتاب‌ها (هم‌نام قرارداد موتور). */
export type FormScope = "library" | "work" | "document" | "titles" | "citations";

export interface SearchHashState {
  q: string;
  mode: SearchMode;
  scope: FormScope;
  /** uid اثر (scope=work یا document) */
  work: string;
  /** uid سند (scope=document) */
  doc: string;
  /** مقادیر فیلتر نقش (کلیدهای ROLE_FILTERS) */
  roles: string[];
  /** "" | "ar" | "fa" */
  lang: string;
  /** slop حالت near — پیش‌فرض ۳ */
  slop: number;
  /** ترتیب واژه‌ها در حالت near */
  ordered: boolean;
  /** استناد قرآنی (QUR-03): سوره/آیه — خالی = غیرفعال */
  sure: string;
  aya: string;
}

export const DEFAULT_SEARCH_STATE: SearchHashState = {
  q: "",
  mode: "normalized_phrase",
  scope: "library",
  work: "",
  doc: "",
  roles: [],
  lang: "",
  slop: 3,
  ordered: true,
  sure: "",
  aya: "",
};

/** فیلترهای نقش — برچسب گروه: «در منابع دارای نشانه‌گذاری» (§۴۵).
 * هر گزینه به کدهای نشانه‌گذاری سمت موتور نگاشت می‌شود. */
export const ROLE_FILTERS: Array<{ value: string; label: string; codes: string[] }> = [
  { value: "G", label: "بدنهٔ روایت", codes: ["G", "body"] },
  { value: "sanad", label: "سند روایت", codes: ["sanad"] },
  { value: "B", label: "بیان مؤلف", codes: ["B", "sharh"] },
  { value: "footnote", label: "پاورقی", codes: ["b", "lfootnote_ref"] },
];

export const SEARCH_MODES: Array<{ value: SearchMode; label: string; hint: string }> = [
  {
    value: "strict_phrase",
    label: "عبارت دقیق",
    hint: "همان‌گونه که نوشته‌اید و بدون هیچ تغییری در حروف و اعلاء.",
  },
  {
    value: "normalized_phrase",
    label: "عبارت نرمال‌شده",
    hint: "با نادیده‌گرفتن تفاوت‌های نگارشی (اعلاء، همزه و …)؛ برای بیشتر جست‌وجوها مناسب است.",
  },
  {
    value: "all_words",
    label: "همهٔ واژه‌ها",
    hint: "مواردی که همهٔ واژه‌ها در آن‌ها هست؛ ترتیب واژه‌ها مهم نیست.",
  },
  {
    value: "any_words",
    label: "یکی از واژه‌ها",
    hint: "مواردی که دست‌کم یکی از واژه‌ها در آن هست.",
  },
  {
    value: "linguistic",
    label: "جست‌وجوی واژه‌ها زبانی",
    hint: "با درنظرگرفتن صرف و اشتقاق واژه‌ها (صیغه‌های مختلف یک ریشه).",
  },
  {
    value: "near",
    label: "تطبیق تقریبی",
    hint: "واژه‌ها در فاصلهٔ مشخصی از یکدیگر؛ برای نقل‌قول‌های نیمه‌یادآوری‌شده.",
  },
];

export function modeLabel(mode: SearchMode): string {
  return SEARCH_MODES.find((m) => m.value === mode)?.label ?? "عبارت نرمال‌شده";
}

export function modeHint(mode: SearchMode): string {
  return SEARCH_MODES.find((m) => m.value === mode)?.hint ?? "";
}

/* ---------- نگاشت hash ↔ درخواست API ---------- */

const VALID_MODES: SearchMode[] = [
  "strict_phrase",
  "normalized_phrase",
  "all_words",
  "any_words",
  "near",
  "linguistic",
];

export function parseSearchParams(query: Record<string, string>): SearchHashState {
  const modeRaw = query.mode ?? DEFAULT_SEARCH_STATE.mode;
  const mode: SearchMode = VALID_MODES.includes(modeRaw as SearchMode)
    ? (modeRaw as SearchMode)
    : DEFAULT_SEARCH_STATE.mode;
  const scopeRaw = query.scope;
  const scope: FormScope =
    scopeRaw === "work" ||
    scopeRaw === "document" ||
    scopeRaw === "titles" ||
    scopeRaw === "citations"
      ? scopeRaw
      : DEFAULT_SEARCH_STATE.scope;
  const roles = (query.roles ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => ROLE_FILTERS.some((f) => f.value === r));
  const slopRaw = Number.parseInt(query.slop ?? "", 10);
  return {
    q: query.q ?? "",
    mode,
    scope,
    work: query.work ?? "",
    doc: query.doc ?? "",
    roles,
    lang: query.lang === "ar" || query.lang === "fa" ? query.lang : "",
    slop:
      Number.isFinite(slopRaw) && slopRaw >= 1 && slopRaw <= 20
        ? slopRaw
        : DEFAULT_SEARCH_STATE.slop,
    ordered: query.ordered === "0" ? false : DEFAULT_SEARCH_STATE.ordered,
    sure: query.sure ?? "",
    aya: query.aya ?? "",
  };
}

/** کلید یکتای وضعیت جست‌وجو برای تشخیص تغییر فیلترها */
export function searchStateKey(state: SearchHashState): string {
  return JSON.stringify([
    state.q.trim(),
    state.mode,
    state.scope,
    state.work,
    state.doc,
    [...state.roles].sort(),
    state.lang,
    state.slop,
    state.ordered,
    state.sure,
    state.aya,
  ]);
}

/** ساخت بدنهٔ POST /search از وضعیت hash */
export function buildSearchRequest(state: SearchHashState, pageSize = 20): SearchRequest {
  const scope: SearchScope =
    state.scope === "titles"
      ? { target: "titles" as SearchScopeTarget }
      : state.scope === "citations" || state.sure.trim() !== ""
        ? { target: "citations" as SearchScopeTarget }
        : { target: "library" as SearchScopeTarget };
  if (state.sure.trim() !== "") {
    scope.quran = { sure: state.sure.trim(), aya: state.aya.trim() || undefined };
  }
  if (state.scope === "work" && state.work) {
    scope.target = "work";
    scope.work_uid = state.work;
  } else if (state.scope === "document" && state.doc) {
    scope.target = "document";
    scope.document_uids = [state.doc];
    if (state.work) scope.work_uid = state.work;
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

  const near: SearchNear | undefined =
    state.mode === "near" ? { slop: state.slop, ordered: state.ordered } : undefined;

  return {
    query: state.q.trim(),
    mode: state.mode,
    scope,
    ...(near ? { near } : {}),
    sort: "relevance",
    page_size: pageSize,
  };
}

/* ---------- فرم ---------- */

export interface SearchFormProps {
  value: SearchHashState;
  onChange: (patch: Partial<SearchHashState>) => void;
  onSubmit: () => void;
  busy?: boolean;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** انتخاب اثر — debounce فقط اینجا (فیلتر عنوان کتاب) */
function WorkPicker({
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
  const debounced = useDebounced(filter, 250);

  const worksQuery = useQuery({
    queryKey: ["works", { q: debounced, picker: true }],
    queryFn: ({ signal }) =>
      api.get<WorkListResponse>(
        "/works",
        { q: debounced || undefined, page: 1, page_size: 30 },
        signal,
      ),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const works = useMemo(() => worksQuery.data?.items ?? [], [worksQuery.data]);
  const selected = works.find((w) => w.uid === value) ?? null;
  const fetching = worksQuery.isFetching && !worksQuery.isLoading;

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor={`search-work-filter-${ariaLabel}`}>{placeholderLabel}</Label>
        <Input
          id={`search-work-filter-${ariaLabel}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="نام کتاب…"
          className="min-h-11"
          autoComplete="off"
        />
      </div>
      <div className="relative">
        <Select
          value={value || undefined}
          onValueChange={(uid) => onSelect(works.find((w) => w.uid === uid) ?? null)}
        >
          <SelectTrigger aria-label={ariaLabel} className="min-h-11 w-full">
            <SelectValue placeholder={selected ? selected.title : "انتخاب اثر…"} />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {works.map((w) => (
              <SelectItem key={w.uid} value={w.uid}>
                <span className="flex max-w-full flex-col">
                  <span className="truncate">{w.title}</span>
                  {w.author ? (
                    <span className="truncate text-xs text-muted-foreground">{w.author}</span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
            {works.length === 0 && !worksQuery.isLoading ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                اثری یافت نشد.
              </div>
            ) : null}
          </SelectContent>
        </Select>
        {fetching ? (
          <Loader2
            className="pointer-events-none absolute end-8 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}

export function SearchForm({ value, onChange, onSubmit, busy = false }: SearchFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState(
    value.roles.length > 0 || value.lang !== "" || value.mode === "near",
  );

  // انتخاب سند: فهرست اسناد اثر انتخاب‌شده
  const workDetailQuery = useQuery({
    queryKey: ["work", value.work, "for-picker"],
    queryFn: ({ signal }) => api.get<WorkDetail>(`/works/${value.work}`, undefined, signal),
    enabled: value.scope === "document" && value.work !== "",
    staleTime: 60_000,
  });
  const documents = useMemo(() => workDetailQuery.data?.documents ?? [], [workDetailQuery.data]);

  // جست‌وجوی صرفاً استنادی (بدون عبارت) نیز مجاز است — QUR-03
  const canSubmit = (value.q.trim().length > 0 || value.sure.trim().length > 0) && !busy;

  return (
    <form
      role="search"
      aria-label="جست‌وجو در منابع"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      {/* عبارت + دکمهٔ اجرا */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <Label htmlFor="search-query" className="sr-only">
            عبارت جست‌وجو
          </Label>
          <Input
            id="search-query"
            value={value.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="عبارت مورد نظر را بنویسید…"
            className="min-h-11"
            autoComplete="off"
          />
        </div>
        <Button type="submit" className="min-h-11 gap-2 sm:w-36" disabled={!canSubmit}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-4" aria-hidden="true" />
          )}
          جست‌وجو
        </Button>
      </div>

      {/* mode */}
      <div className="space-y-1.5">
        <Label htmlFor="search-mode">حالت جست‌وجو</Label>
        <Select value={value.mode} onValueChange={(v) => onChange({ mode: v as SearchMode })}>
          <SelectTrigger id="search-mode" className="min-h-11 w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEARCH_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {modeHint(value.mode)}
        </p>
      </div>

      {/* دامنه */}
      <div className="space-y-1.5">
        <Label htmlFor="search-scope">دامنهٔ جست‌وجو</Label>
        <Select
          value={value.scope}
          onValueChange={(v) => {
            const next = v as FormScope;
            if (next === "library") onChange({ scope: next, work: "", doc: "" });
            else if (next === "work") onChange({ scope: next, doc: "" });
            else onChange({ scope: next });
          }}
        >
          <SelectTrigger id="search-scope" className="min-h-11 w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="library">کل کتابخانه</SelectItem>
            <SelectItem value="titles">نام کتاب‌ها</SelectItem>
            <SelectItem value="work">اثر مشخص</SelectItem>
            <SelectItem value="document">سند مشخص</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* انتخاب اثر/سند */}
      {value.scope === "work" ? (
        <WorkPicker
          value={value.work}
          onSelect={(w) => onChange({ work: w?.uid ?? "" })}
          ariaLabel="انتخاب اثر برای دامنهٔ جست‌وجو"
          placeholderLabel="انتخاب اثر"
        />
      ) : null}
      {value.scope === "document" ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <WorkPicker
            value={value.work}
            onSelect={(w) => onChange({ work: w?.uid ?? "", doc: "" })}
            ariaLabel="انتخاب اثر سند"
            placeholderLabel="اول اثر را انتخاب کنید"
          />
          {value.work ? (
            <div className="space-y-1.5">
              <Label htmlFor="search-doc">سند (جلد/مدخل)</Label>
              {workDetailQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">در حال بارگیری اسناد…</p>
              ) : (
                <Select
                  value={value.doc || undefined}
                  onValueChange={(uid) => onChange({ doc: uid })}
                >
                  <SelectTrigger id="search-doc" className="min-h-11 w-full">
                    <SelectValue placeholder="انتخاب سند…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {documents.map((d) => (
                      <SelectItem key={d.uid} value={d.uid}>
                        {d.label}
                      </SelectItem>
                    ))}
                    {documents.length === 0 ? (
                      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                        سندی برای این اثر ثبت نشده است.
                      </div>
                    ) : null}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* حالت پیشرفته — افشای تدریجی */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 gap-2 px-2 text-sm text-muted-foreground"
            aria-expanded={advancedOpen}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            تنظیمات پیشرفته
            {advancedOpen ? (
              <ChevronUp className="size-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4" aria-hidden="true" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 rounded-xl border border-border bg-surface p-4">
          {/* فاصلهٔ واژه‌ها (near) */}
          {value.mode === "near" ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">فاصلهٔ واژه‌ها</legend>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="search-slop" className="whitespace-nowrap text-sm">
                    حداکثر فاصله (واژه):
                  </Label>
                  <Input
                    id="search-slop"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={20}
                    value={value.slop}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      onChange({
                        slop: Number.isFinite(n) && n >= 1 && n <= 20 ? n : value.slop,
                      });
                    }}
                    className="min-h-11 w-20"
                  />
                </div>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.ordered}
                    onCheckedChange={(checked) => onChange({ ordered: checked === true })}
                    aria-label="واژه‌ها به‌ترتیب"
                  />
                  واژه‌ها به‌ترتیب
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                تعداد واژه‌های مجاز بین واژه‌های عبارت شما؛ مقدار کنونی: {faNum(value.slop)}
              </p>
            </fieldset>
          ) : null}

          {/* فیلتر نقش */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">در منابع دارای نشانه‌گذاری</legend>
            <p className="text-xs text-muted-foreground">
              فقط مواضعی که در بخش‌های نشانه‌گذاری‌شدهٔ منبع قرار دارند.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLE_FILTERS.map((role) => (
                <label
                  key={role.value}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm"
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
                    aria-label={role.label}
                  />
                  {role.label}
                </label>
              ))}
            </div>
          </fieldset>

          {/* زبان */}
          <div className="space-y-1.5">
            <Label htmlFor="search-lang">زبان منبع</Label>
            <Select
              value={value.lang || "all"}
              onValueChange={(v) => onChange({ lang: v === "all" ? "" : v })}
            >
              <SelectTrigger id="search-lang" className="min-h-11 w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همهٔ زبان‌ها</SelectItem>
                <SelectItem value="ar">{languageLabel("ar")}</SelectItem>
                <SelectItem value="fa">{languageLabel("fa")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* استناد قرآنی — QUR-03 */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">استناد قرآنی</legend>
            <p className="text-xs text-muted-foreground">
              جست‌وجوی مواضع دارای استناد به سوره و آیه یا بازهٔ آیه؛ بدون عبارت هم کار می‌کند.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={value.sure}
                onChange={(e) => onChange({ sure: e.target.value })}
                placeholder="شمارهٔ سوره (مثلاً ۲)"
                aria-label="شمارهٔ سوره"
                inputMode="numeric"
                className="min-h-11 w-40"
              />
              <Input
                value={value.aya}
                onChange={(e) => onChange({ aya: e.target.value })}
                placeholder="آیه (اختیاری)"
                aria-label="شمارهٔ آیه"
                inputMode="numeric"
                className="min-h-11 w-36"
              />
              {value.sure.trim() !== "" ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => onChange({ sure: "", aya: "" })}
                >
                  حذف فیلتر استناد
                </Button>
              ) : null}
            </div>
          </fieldset>
        </CollapsibleContent>
      </Collapsible>
    </form>
  );
}
