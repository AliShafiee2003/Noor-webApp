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
    queryFn: ({ signal }) => api.get<WorkDetail>(`/works/${workUid}`, undefined, signal),
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

  if (state.mode !== "normalized_phrase") {
    chips.push({
      key: "mode",
      label: `حالت: ${modeLabel(state.mode)}`,
      onRemove: () => onChange({ mode: "normalized_phrase" }),
    });
  }

  if (state.scope === "titles") {
    chips.push({
      key: "scope-titles",
      label: "دامنه: نام کتاب‌ها",
      onRemove: () => onChange({ scope: "library", mode: "normalized_phrase", work: "", doc: "" }),
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

  if (state.mode === "near") {
    chips.push({
      key: "near",
      label: `فاصلهٔ واژه‌ها: تا ${state.slop} واژه${state.ordered ? " · به‌ترتیب" : ""}`,
      onRemove: () => onChange({ mode: "normalized_phrase" }),
    });
  }

  if (chips.length === 0) return null;

  const clearAll = () => {
    onChange({
      q: "",
      mode: "normalized_phrase",
      scope: "library",
      work: "",
      doc: "",
      roles: [],
      lang: "",
      slop: 3,
      ordered: true,
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
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface py-1 pe-1 ps-3 text-sm"
        >
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`حذف فیلتر: ${chip.label}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
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
