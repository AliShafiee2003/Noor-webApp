"use client";

/**
 * پنل جست‌وجو در کتاب — عین پروتوتایپ epub_reader_prototype.html:526-532
 * (فیلد گرد + چیپ «نادیده گرفتن فاصله و نیم‌فاصله» + شمارش + tileهای نتیجه).
 * منبع نتایج: جست‌وجوی سروری scope=document (useReaderData.inBookSearch).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Mi } from "./mi";
import { faNum } from "@/lib/format";
import type { SearchHighlight, SearchResultItem } from "@/lib/types";

/* برش snippet با هایلایت بازه‌های سروری — خروجی گرهٔ React، بدون innerHTML */
function Excerpt({ snippet, highlight }: { snippet: string; highlight: SearchHighlight[] | undefined }) {
  const segments = useMemo(() => {
    const cps = Array.from(snippet);
    const ranges = [...(highlight ?? [])]
      .filter((h) => typeof h.start === "number" && typeof h.end === "number" && h.unit !== "char")
      .map((h) => ({ start: Math.max(0, h.start), end: h.end }))
      .filter((h) => h.start < cps.length && h.end > h.start)
      .sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else merged.push({ ...r });
    }
    const out: Array<{ text: string; hot: boolean }> = [];
    let cursor = 0;
    for (const r of merged) {
      if (r.start > cursor) out.push({ text: cps.slice(cursor, r.start).join(""), hot: false });
      out.push({ text: cps.slice(r.start, r.end).join(""), hot: true });
      cursor = r.end;
    }
    if (cursor < cps.length) out.push({ text: cps.slice(cursor).join(""), hot: false });
    return out;
  }, [snippet, highlight]);

  return (
    <div className="ex">
      {segments.map((s, i) => (s.hot ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
    </div>
  );
}

export interface MobileSearchPanelProps {
  open: boolean;
  onClose: () => void;
  /** عبارتِ آخرین جست‌وجوی اجراشده (state سروری) */
  query: string;
  onSearch: (q: string) => void;
  results: SearchResultItem[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  tolerant: boolean;
  scope: "work" | "document";
  onScopeChange: (scope: "work" | "document") => void;
  onToggleTolerant: () => void;
  activeOrd: number;
  onSelect: (ord: number) => void;
  hasMultipleDocs: boolean;
  currentDocUid: string;
  /** درصد موقعیت صفحه در کتاب — برای خط دوم tile */
  pagePercent: (pageUid: string | null | undefined) => number | null;
}

export function MobileSearchPanel({
  open,
  onClose,
  query,
  onSearch,
  results,
  isLoading,
  error,
  onRetry,
  tolerant,
  scope,
  onScopeChange,  onToggleTolerant,
  activeOrd,
  onSelect,
  hasMultipleDocs,
  currentDocUid,
  pagePercent,
}: MobileSearchPanelProps) {
  const [draft, setDraft] = useState(query);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prevOpenRef = useRef(false);

  /* بازشدن پنل → همگام‌سازی پیش‌نویس + فوکوس (پروتوتایپ: open('search') با تأخیر ۳۰۰ms) */
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setDraft(query);
      const t = window.setTimeout(() => inputRef.current?.focus(), 260);
      prevOpenRef.current = true;
      return () => window.clearTimeout(t);
    }
    if (!open) prevOpenRef.current = false;
  }, [open, query]);

  const q = draft.trim();
  const visible = q ? results : [];
  const countText = q ? (visible.length ? `${faNum(visible.length)} نتیجه` : "") : "";

  return (
    <section className={"rm-pop rm-panel" + (open ? " on" : "")} id="rm-searchPanel" aria-hidden={!open}>
      <div className="rm-p-head">
        <h3>جست‌وجو در کتاب</h3>
        <button className="ib big" aria-label="بستن جست‌وجو" onClick={onClose}>
          <Mi name="close" />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q) onSearch(q);
        }}
      >
        <div className="rm-field">
          <Mi name="search" style={{ color: "var(--on-surface-var)" }} />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="جست‌وجوی عبارت…"
            autoComplete="off"
            enterKeyHint="search"
            aria-label="عبارت جست‌وجو"
          />
          {draft ? (
            <button
              type="button"
              className="ib"
              style={{ width: 32, height: 32 }}
              aria-label="پاک‌کردن عبارت"
              onClick={() => {
                setDraft("");
                inputRef.current?.focus();
              }}
            >
              <Mi name="close" size={20} />
            </button>
          ) : null}
        </div>
      </form>
      <div>
        {hasMultipleDocs && <div className="seg" aria-label="دامنه جست‌وجو">
          <button type="button" className={scope === "document" ? "on" : ""} onClick={() => onScopeChange("document")}>همین جلد</button>
          <button type="button" className={scope === "work" ? "on" : ""} onClick={() => onScopeChange("work")}>کل اثر</button>
        </div>}
        <span
          className={"chip" + (tolerant ? " on" : "")}
          role="switch"
          aria-checked={tolerant}
          tabIndex={0}
          onClick={onToggleTolerant}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggleTolerant();
            }
          }}
        >
          {tolerant ? <Mi name="check" size={16} /> : null}
          نادیده گرفتن فاصله و نیم‌فاصله
        </span>
      </div>
      <div className="rm-sec-title">{countText}</div>
      <div className="rm-p-body" aria-busy={isLoading}>
        {!q ? (
          <div className="rm-empty">عبارتی برای جست‌وجو در کتاب بنویسید</div>
        ) : error ? (
          <div className="rm-empty">
            <p>{error.message || "خطا در برقراری ارتباط با سرور."}</p>
            <button type="button" className="fbtn" style={{ marginTop: 12 }} onClick={onRetry}>
              تلاش دوباره
            </button>
          </div>
        ) : isLoading ? (
          <div className="rm-empty">در حال جست‌وجو در متن کتاب…</div>
        ) : visible.length === 0 ? (
          <div className="rm-empty">نتیجه‌ای یافت نشد</div>
        ) : (
          visible.map((item, ord) => {
            const pct = pagePercent(item.page?.uid);
            const sectionTitle = item.section?.title?.split(":")[0]?.trim();
            const pageLabel = item.page?.label;
            const sameDoc = !item.document?.uid || item.document.uid === currentDocUid;
            const pos = [
              sectionTitle,
              pageLabel ? `صفحه ${faNum(pageLabel)}` : null,
              pct != null ? `${faNum(pct)}٪` : null,
              !sameDoc && hasMultipleDocs ? item.document?.label : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={`${item.passage_uid || "res"}-${ord}`}
                className={"rm-rtile" + (ord === activeOrd ? " cur" : "")}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(ord)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(ord);
                }}
              >
                <Excerpt snippet={item.snippet ?? ""} highlight={item.highlight} />
                <div className="pos">{pos}</div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
