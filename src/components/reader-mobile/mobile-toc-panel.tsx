/**
 * پنل فهرست مطالب موبایل — پورت epub_reader_prototype.html:521-524 + buildToc (:1217-1250).
 * سلسله‌مراتبی از /toc — نشانک‌ها و یادداشت‌ها در پنل یکپارچهٔ «نشانه‌ها» هستند.
 */
"use client";

import { useMemo, useState } from "react";
import { Mi } from "./mi";
import type { TocSection } from "@/lib/types";

export function MobileTocPanel({
  open,
  onClose,
  sections,
  loading,
  error,
  activeSectionUid,
  onGoSection,
}: {
  open: boolean;
  onClose: () => void;
  sections: TocSection[];
  loading: boolean;
  error: boolean;
  activeSectionUid: string | null;
  onGoSection: (s: TocSection) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(() => {
    const out: Array<{ sec: TocSection; depth: number }> = [];
    const walk = (list: TocSection[], depth: number) => {
      for (const s of list) {
        out.push({ sec: s, depth });
        if (s.children?.length && !collapsed.has(s.uid)) walk(s.children, depth + 1);
      }
    };
    walk(sections, 0);
    return out;
  }, [sections, collapsed]);

  const toggle = (uid: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  return (
    <section
      id="rm-tocPanel"
      className={"rm-pop rm-panel" + (open ? " on" : "")}
      aria-hidden={!open}
      aria-label="فهرست مطالب"
    >
      <div className="rm-p-head">
        <h3>فهرست مطالب</h3>
        <button className="ib big" aria-label="بستن فهرست" onClick={onClose}>
          <Mi name="close" />
        </button>
      </div>
      <div className="rm-p-body">
        {loading ? (
          <div className="rm-empty">در حال خواندن فهرست…</div>
        ) : error ? (
          <div className="rm-empty">خواندن فهرست این سند ممکن نشد.</div>
        ) : rows.length === 0 ? (
          <div className="rm-empty">برای این سند فهرستی ثبت نشده است.</div>
        ) : (
          rows.map(({ sec, depth }) => {
            const hasKids = !!sec.children?.length;
            const isCollapsed = collapsed.has(sec.uid);
            return (
              <div
                key={sec.uid}
                className={"li" + (sec.uid === activeSectionUid ? " cur" : "")}
                style={{ paddingRight: 16 + depth * 16, paddingLeft: 4 }}
                onClick={() => onGoSection(sec)}
                data-toc-uid={sec.uid}
              >
                <div className="t">{sec.title}</div>
                {hasKids ? (
                  <span
                    className="ib"
                    style={{ width: 40, height: 40 }}
                    role="button"
                    aria-label={isCollapsed ? "باز کردن زیربخش‌ها" : "بستن زیربخش‌ها"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(sec.uid);
                    }}
                  >
                    <Mi
                      name="keyboard_arrow_right"
                      className={"chev rm-flip" + (isCollapsed ? "" : " open")}
                    />
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
