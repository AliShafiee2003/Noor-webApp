"use client";

import { useState } from "react";
import { DEFAULT_SEARCH_STATE, SearchForm, type SearchHashState } from "@/components/search/search-form";
import { FilterChips } from "@/components/search/filter-chips";

/** Exercises the production form without a backend request or authenticated session. */
export function SearchPreview() {
  const [state, setState] = useState<SearchHashState>({ ...DEFAULT_SEARCH_STATE });
  const [submitted, setSubmitted] = useState(false);
  const update = (patch: Partial<SearchHashState>) => { setState(current => ({ ...current, ...patch })); setSubmitted(false); };
  return <main dir="rtl" className="min-h-screen bg-canvas px-4 py-6 text-foreground">
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-lg font-bold">فرم مشترک جست‌وجو</h1>
      <SearchForm value={state} onChange={update} onSubmit={() => setSubmitted(true)} />
      <FilterChips state={state} onChange={update} />
      {submitted ? <p role="status" className="text-sm text-muted-foreground">پیش‌نمایش: تنظیمات آماده‌اند؛ درخواست به سرور ارسال نمی‌شود.</p> : null}
    </div>
  </main>;
}
