/**
 * نوار ابزار دوطبقهٔ ریدر موبایل — پورت epub_reader_prototype.html:445-476
 * (↕ تیتر ۴۰px + ردیف آیکون‌ها ۴۶px اسکرول‌پذیر + فیدها + مینی‌اسکرول‌بار).
 * ابزارهای مشترک با دسکتاپ (یادداشت‌ها، دریافت PDF، کپی نشانی) نیز در ردیف ابزار در دسترس‌اند.
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  ArrowRight,
  BookMarked,
  BookmarkCheck,
  BookmarkPlus,
  Download,
  Files,
  List,
  Lock,
  Minimize2,
  Moon,
  Search,
  SlidersHorizontal,
  Sun,
} from "lucide-react";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function MobileToolbar({
  workTitle,
  docLabel,
  dark,
  hitBadge,
  isPdf,
  onBack,
  onToc,
  onSearch,
  onToggleTheme,
  isBookmarked,
  bookmarkPending,
  marksCount,
  onToggleBookmark,
  onNotes,
  onExportPdf,
  onCopyAddress,
  onLock,
  onSettings,
  onExitMobile,
}: {
  workTitle: string;
  docLabel: string;
  dark: boolean;
  /** متن نشان نتیجهٔ جست‌وجو — فقط در حالت .searching دیده می‌شود */
  hitBadge?: string | null;
  isPdf?: boolean;
  onBack: () => void;
  onToc: () => void;
  onSearch: () => void;
  /** مبدأ موج تم = مرکز دکمه (مختصات دیدپذیر) */
  onToggleTheme: (origin: { x: number; y: number }) => void;
  isBookmarked: boolean;
  bookmarkPending: boolean;
  marksCount?: number;
  onToggleBookmark: () => void;
  onNotes?: () => void;
  onExportPdf?: () => void;
  onCopyAddress?: () => void;
  onLock: () => void;
  onSettings: () => void;
  onExitMobile?: () => void;
}) {
  const themeBtnRef = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fadeRRef = useRef<HTMLDivElement | null>(null);
  const fadeLRef = useRef<HTMLDivElement | null>(null);

  /* تازه‌سازی فیدها و افکت عمق در دو سر نوار ابزار */
  const syncT2 = useCallback(() => {
    const s = scrollRef.current;
    if (!s) return;
    const max = Math.max(0, s.scrollWidth - s.clientWidth);
    const sl = Math.abs(s.scrollLeft);
    fadeRRef.current?.classList.toggle("on", max > 2 && sl > 4);
    fadeLRef.current?.classList.toggle("on", max > 2 && sl < max - 4);
  }, []);

  useEffect(() => {
    syncT2();
    const raf = requestAnimationFrame(syncT2);
    return () => cancelAnimationFrame(raf);
  }, [syncT2]);

  /* جابه‌جایی تیتر با کشیدن (dragScroll) + چرخ عمودی→افقی */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let st: { x: number; sl: number; moved: boolean; id: number } | null = null;
    let suppress = false;
    const down = (e: PointerEvent) => {
      if (e.button > 0 || e.pointerType === "touch") return;
      st = { x: e.clientX, sl: el.scrollLeft, moved: false, id: e.pointerId };
    };
    const move = (e: PointerEvent) => {
      if (!st) return;
      const dx = e.clientX - st.x;
      if (!st.moved && Math.abs(dx) > 6) {
        st.moved = true;
        try {
          el.setPointerCapture(st.id);
        } catch {}
        el.classList.add("drag");
      }
      if (st.moved) el.scrollLeft = st.sl - dx;
    };
    const up = () => {
      if (!st) return;
      const m = st.moved;
      st = null;
      el.classList.remove("drag");
      if (m) {
        suppress = true;
        window.setTimeout(() => {
          suppress = false;
        }, 30);
      }
    };
    const click = (e: MouseEvent) => {
      if (suppress) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft -= e.deltaY;
      }
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  return (
    <div id="rm-toolbar">
      <header className="rm-t1">
        <button className="ib" aria-label="بازگشت" onClick={onBack}>
          <ArrowRight className="size-[22px]" aria-hidden="true" />
        </button>
        <div className="rm-t1-title">
          <span className="rm-t1-work">{workTitle}</span>
          {docLabel ? <span className="rm-t1-doc">{docLabel}</span> : null}
        </div>
        {hitBadge ? <div className="rm-t1-badge">{hitBadge}</div> : null}
      </header>
      <div className="rm-hr" />
      <div className="rm-t2">
        <div className="rm-t2-scroll" ref={scrollRef} onScroll={syncT2}>
          <div className="rm-t2-row">
            <button className="ib" aria-label="جست‌وجو در کتاب" disabled={isPdf} title={isPdf ? "نسخهٔ اسکن‌شده متن قابل جست‌وجو ندارد" : undefined} onClick={onSearch}>
              <Search className="size-5" aria-hidden="true" />
            </button>
            <button className="ib" aria-label="فهرست مطالب" onClick={onToc}>
              <List className="size-5" aria-hidden="true" />
            </button>
            {onNotes ? (
              <button
                className="ib relative"
                aria-label={isPdf ? "نشانک‌ها" : "نشانک‌ها و یادداشت‌ها"}
                title={isPdf ? "نشانک‌های این سند" : "نشانک‌ها و یادداشت‌ها"}
                onClick={onNotes}
              >
                <BookMarked className="size-5" aria-hidden="true" />
                {marksCount ? (
                  <span className="rm-t1-count" aria-hidden="true">
                    {marksCount.toLocaleString("fa-IR")}
                  </span>
                ) : null}
              </button>
            ) : null}
            <button
              className={"ib" + (isBookmarked ? " acc" : "")}
              aria-label={isBookmarked ? "حذف نشانک این صفحه" : "افزودن نشانک این صفحه"}
              disabled={bookmarkPending}
              onClick={onToggleBookmark}
            >
              {isBookmarked ? <BookmarkCheck className="size-5" aria-hidden="true" /> : <BookmarkPlus className="size-5" aria-hidden="true" />}
            </button>
            <button
              ref={themeBtnRef}
              className={"ib rm-theme-btn" + (dark ? "" : " acc")}
              aria-label="حالت شب / روز"
              onClick={() => {
                const r = themeBtnRef.current?.getBoundingClientRect();
                onToggleTheme(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 });
              }}
            >
              {dark ? <Moon className="size-5" aria-hidden="true" /> : <Sun className="size-5" aria-hidden="true" />}
            </button>
            <button className="ib" aria-label="تنظیمات مطالعه" onClick={onSettings}>
              <SlidersHorizontal className="size-5" aria-hidden="true" />
            </button>
            {!isPdf && onExportPdf ? (
              <button className="ib" aria-label="دریافت PDF از کتاب" onClick={onExportPdf}>
                <Download className="size-5" aria-hidden="true" />
              </button>
            ) : null}
            {onCopyAddress ? (
              <button className="ib" aria-label="کپی نشانی صفحه" onClick={onCopyAddress}>
                <Files className="size-5" aria-hidden="true" />
              </button>
            ) : null}
            {/* سمت چپ‌ترین ابزارها — فقط در نسخهٔ دسکتاپ / موبایل */}
            {onExitMobile ? (
              <button className="ib" title="خروج از مطالعهٔ متمرکز" aria-label="خروج از مطالعهٔ متمرکز" onClick={onExitMobile}>
                <Minimize2 className="size-5" aria-hidden="true" />
              </button>
            ) : null}
            {!onExitMobile ? (
              <button className="ib" aria-label="قفل صفحهٔ مطالعه" onClick={onLock}>
                <Lock className="size-5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="rm-t2-fade r" ref={fadeRRef} />
        <div className="rm-t2-fade l" ref={fadeLRef} />
      </div>
    </div>
  );
}
