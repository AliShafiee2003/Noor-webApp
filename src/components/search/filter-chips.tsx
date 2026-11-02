"use client";

/**
 * چیپ فیلترهای فعال جست‌وجو — SEARCH-20
 * هر فیلتر فعال یک چیپ قابل‌حذف + دکمهٔ «پاک‌کردن همه».
 * برچسب اثر/سند از سرور حل می‌شود (شناسهٔ فنی هرگز در UI نمایش داده نمی‌شود).
 */
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { languageLabel } from "@/lib/labels";
import { faNum } from "@/lib/format";
import type { WorkDetail, WorkListResponse } from "@/lib/types";
import { ROLE_FILTERS, modeLabel, type SearchHashState } from "@/components/search/search-form";

/** حل عنوان اثر از روی uid (GET /works?q={uid} دقیقاً همان اثر را برمی‌گرداند) */
function useWorkLabel(uid: string): string | null {
  const query = useQuery({
    queryKey: ["work-label", uid],
    queryFn: ({ signal }) =>
      api.get<WorkListResponse>("/works", { q: uid, page: 1, page_size: 5 }, signal),
    enabled: uid !== "",
    staleTime: 5 * 60_000,
  });
  const found = query.data?.items.find((w) => w.uid === uid);
  return found?.title ?? null;
}

/** حل برچسب سند از روی uid اثر + uid سند */
function useDocumentLabel(workUid: string, docUid: string): string | null {
  const query = useQuery({
    queryKey: ["work", workUid, "doc-label"],
    queryFn: ({ signal }) =>
      api.get<WorkDetail>(`/works/${encodeURIComponent(workUid)}`, undefined, signal),
    enabled: workUid !== "" && docUid !== "",
    staleTime: 5 * 60_000,
  });
  const found = query.data?.documents.find((d) => d.uid === docUid);
  return found?.label ?? null;
}

export interface FilterChip {
  /** کلید یکتا برای رندر */
  key: string;
  /** متن چیپ */
  label: string;
  /** حذف فیلتر */
  onRemove: () => void;
}

export function FilterChips({
  state,
  onChange,
}: {
  state: SearchHashState;
  onChange: (patch: Partial<SearchHashState>) => void;
}) {
  const workLabel = useWorkLabel(state.scope === "library" ? "" : state.work);
  const docLabel = useDocumentLabel(
    state.scope === "document" ? state.work : "",
    state.scope === "document" ? state.doc : "",
  );

  const chips: FilterChip[] = [];

  if (state.q.trim()) {
    chips.push({
      key: "q",
      label: `عبارت: ${state.q.trim().slice(0, 40)}${state.q.trim().length > 40 ? "…" : ""}`,
      onRemove: () => onChange({ q: "" }),
    });
  }

  if (state.mode === "words") {
    chips.push({
      key: "mode-words",
      label: "حالت: واژگان",
      onRemove: () => onChange({ mode: "text" }),
    });
    if (state.wordsMatch === "any") {
      chips.push({
        key: "match-any",
        label: "شرط: حداقل یک واژه",
        onRemove: () => onChange({ wordsMatch: "all" }),
      });
    }
    if (state.wordsDistance > 0) {
      chips.push({
        key: "words-dist",
        label: `فاصله: تا ${faNum(state.wordsDistance)} واژه${state.wordsOrdered ? " · به‌ترتیب" : ""}`,
        onRemove: () => onChange({ wordsDistance: 0, wordsOrdered: false }),
      });
    }
  } else {
    // حالت text
    if (state.flex !== "similar") {
      const flexNames: Record<string, string> = {
        exact: "عین عبارت",
        written: "تفاوت‌های نوشتاری",
        spelling: "گونه‌های املایی",
      };
      chips.push({
        key: "flex",
        label: `انعطاف: ${flexNames[state.flex] ?? state.flex}`,
        onRemove: () => onChange({ flex: "similar" }),
      });
    }
    if (state.sort === "similarity") {
      chips.push({
        key: "sort-sim",
        label: "ترتیب: شبیه‌ترین نقل‌ها",
        onRemove: () => onChange({ sort: "relevance" }),
      });
    }
  }

  if (state.target === "titles") {
    chips.push({
      key: "target-titles",
      label: "موضوع: عنوان کتاب‌ها",
      onRemove: () => onChange({ target: "text" }),
    });
  } else if (state.target === "authors") {
    chips.push({
      key: "target-authors",
      label: "موضوع: نام مؤلف",
      onRemove: () => onChange({ target: "text" }),
    });
  }

  if (state.author.trim() !== "") {
    chips.push({
      key: "scope-author",
      label: `محدود به مؤلف: ${state.author.trim()}`,
      onRemove: () => onChange({ author: "", scope: "library" }),
    });
  }

  if (state.scope === "titles") {
    chips.push({
      key: "scope-titles",
      label: "دامنه: عنوان کتاب‌ها",
      onRemove: () => onChange({ scope: "library", work: "", doc: "" }),
    });
  } else if (state.scope === "authors") {
    chips.push({
      key: "scope-authors",
      label: "دامنه: پدیدآور (مؤلف)",
      onRemove: () => onChange({ scope: "library", work: "", doc: "" }),
    });
  } else if (state.scope === "work") {
    chips.push({
      key: "scope-work",
      label: `اثر: ${workLabel ?? "انتخاب‌شده"}`,
      onRemove: () => onChange({ scope: "library", work: "", doc: "" }),
    });
  } else if (state.scope === "document") {
    chips.push({
      key: "scope-doc",
      label: `سند: ${docLabel ?? workLabel ?? "انتخاب‌شده"}`,
      onRemove: () => onChange({ scope: "library", work: "", doc: "" }),
    });
  }

  if (state.sure.trim() !== "") {
    chips.push({
      key: "quran",
      label: `استناد: سورهٔ ${faNum(Number(state.sure))}${state.aya.trim() ? "، آیهٔ " + faNum(Number(state.aya)) : ""}`,
      onRemove: () => onChange({ sure: "", aya: "" }),
    });
  }

  if (state.roles.length > 0) {
    const labels = ROLE_FILTERS.filter((f) => state.roles.includes(f.value)).map((f) => f.label);
    chips.push({
      key: "roles",
      label: `دارای نشانه‌گذاری: ${labels.join("، ")}`,
      onRemove: () => onChange({ roles: [] }),
    });
  }

  if (state.lang) {
    chips.push({
      key: "lang",
      label: `زبان: ${languageLabel(state.lang)}`,
      onRemove: () => onChange({ lang: "" }),
    });
  }

  if (state.diacritics !== "") {
    chips.push({
      key: "diacritics",
      label: state.diacritics === "respect_strict" ? "رعایت اعراب (سخت‌گیرانه)" : "رعایت اعرابِ نوشته‌شده",
      onRemove: () => onChange({ diacritics: "" }),
    });
  }

  if (state.mode === "text") {
    if (state.layers.length > 0) {
      chips.push({
        key: "layers",
        label: `لایه‌ها: ${state.layers.join("، ")}`,
        onRemove: () => onChange({ layers: [] }),
      });
    }
    if (state.minScore > 0) {
      chips.push({
        key: "min-score",
        label: `کمینهٔ شباهت: ${faNum(Math.round(state.minScore * 100))}٪`,
        onRemove: () => onChange({ minScore: 0 }),
      });
    }
    if (state.nearSpelling) {
      chips.push({
        key: "near-spelling",
        label: "واژهٔ نزدیک (L5)",
        onRemove: () => onChange({ nearSpelling: false }),
      });
    }
    if (state.expandMorphology) {
      chips.push({
        key: "morphology",
        label: "صورت صرفی (مفرد/جمع)",
        onRemove: () => onChange({ expandMorphology: false }),
      });
    }
  }

  if (chips.length === 0) return null;

  const clearAll = () => {
    onChange({
      q: "",
      target: "text",
      author: "",
      mode: "text",
      flex: "similar",
      wordsMatch: "all",
      wordsDistance: 0,
      wordsOrdered: false,
      scope: "library",
      work: "",
      doc: "",
      roles: [],
      lang: "",
      slop: 3,
      ordered: true,
      diacritics: "",
      sort: "relevance",
      minScore: 0,
      nearSpelling: false,
      expandMorphology: false,
      layers: [],
    });
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="فیلترهای فعال جست‌وجو"
    >
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface py-1 pe-1 ps-3 text-sm"
        >
          <span className="min-w-0 truncate" title={chip.label}>{chip.label}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`حذف فیلتر: ${chip.label}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-9 text-muted-foreground"
        onClick={clearAll}
      >
        پاک‌کردن همه
      </Button>
    </div>
  );
}
