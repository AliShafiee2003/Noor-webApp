/**
 * نوار پایین ریدر موبایل — پورت #bottom/#previewBox/#carousel/#slideBar پروتوتایپ
 * (epub_reader_prototype.html:478-490, 187-204, 1003-1047, 1780-1843).
 * اسلایدر پیش‌روی + پیش‌نمایش کارت‌های صفحه + هم‌گامی دوطرفه.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { Mi } from "./mi";
import { RmSlider } from "./rm-slider";
import { PdfThumb } from "./pdf-shell";
import { faNum } from "@/lib/format";

/** فاصلهٔ مرکز کارت‌ها در پروتوتایپ (۹۲ عرض + ۱۲ فاصله) */
const STRIDE = 104;
const WINDOW = 12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface PreviewBlockLine {
  text: string;
  isHeading?: boolean;
}

export interface PreviewCard {
  lines: PreviewBlockLine[];
  label?: string;
  bookmarked: boolean;
  /** سند PDF: شمارهٔ صفحهٔ یک‌مبنا برای بندانگشتی pdf.js */
  thumbPage?: number;
}

export function MobileBottomBar({
  previewing,
  previewIdx,
  pageIdx,
  total,
  progress,
  scrollMode = false,
  scrollHostRef,
  active = true,
  canUndo,
  onUndo,
  canForward,
  onForward,
  onPctClick,
  onPageClick,
  onTogglePreview,
  onProgressInput,
  onProgressCommit,
  onHidePreview,
  onPreviewIdx,
  onJumpIndex,
  cardFor,
  pdfDocumentUid,
  para,
}: {
  previewing: boolean;
  previewIdx: number;
  pageIdx: number;
  total: number;
  /** کسر پیشرفت جاری (حالت اسکرول از اسکرول واقعی می‌آید) */
  progress?: number;
  scrollMode?: boolean;
  scrollHostRef?: RefObject<HTMLElement | null>;
  active?: boolean;
  canUndo: boolean;
  onUndo: () => void;
  canForward?: boolean;
  onForward?: () => void;
  onPctClick: () => void;
  onPageClick?: () => void;
  onTogglePreview?: () => void;
  onProgressInput: (f: number) => void;
  onProgressCommit: (f: number) => void;
  onHidePreview: () => void;
  onPreviewIdx: (i: number) => void;
  onJumpIndex: (i: number) => void;
  cardFor: (i: number) => PreviewCard | null;
  /** برای اسناد PDF: بندانگشتی واقعی از pdf.js */
  pdfDocumentUid?: string | null;
  /** فاصلهٔ پاراگراف از prefs — همان --para روت */
  para: number;
}) {
  const [scrollProgress, setScrollProgress] = useState(0);
  useEffect(() => {
    if (!scrollMode || !active) return;
    const host = scrollHostRef?.current;
    if (!host) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      setScrollProgress(clamp(host.scrollTop / Math.max(1, host.scrollHeight - host.clientHeight), 0, 1));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(paint); };
    paint();
    host.addEventListener("scroll", onScroll, { passive: true });
    const resize = new ResizeObserver(onScroll);
    resize.observe(host);
    return () => { host.removeEventListener("scroll", onScroll); resize.disconnect(); cancelAnimationFrame(raf); };
  }, [scrollMode, scrollHostRef, active, pageIdx, total]);
  if (scrollMode) progress = scrollProgress;
  const carRef = useRef<HTMLDivElement | null>(null);
  const programmaticRef = useRef(false);
  const progTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; sl: number; moved: boolean; id: number } | null>(null);
  const suppressClickRef = useRef(false);
  const wasOpenRef = useRef(false);
  /* تشخیص اینکه تغییر previewIdx از اسکرول مستقیم خود کاروسل بوده یا از اسلایدر/کلید */
  const fromCarouselScrollRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const shownIdx = previewing ? previewIdx : Math.max(0, pageIdx);
  const shownF = previewing ? (total > 1 ? shownIdx / (total - 1) : 0) : (progress ?? (total > 1 ? shownIdx / (total - 1) : 0));

  const centerCard = (idx: number, smooth: boolean) => {
    const car = carRef.current;
    if (!car) return;
    const target = -idx * STRIDE;
    programmaticRef.current = true;
    if (progTimerRef.current) window.clearTimeout(progTimerRef.current);
    if (!smooth) {
      car.scrollLeft = target;
    } else if (Math.abs(car.scrollLeft - target) >= 2) {
      car.scrollTo({ left: target, behavior: "smooth" });
    }
    progTimerRef.current = window.setTimeout(
      () => {
        programmaticRef.current = false;
      },
      smooth ? 260 : 60,
    );
  };

  /* مرکزکردن کارت جاری — هنگام بازشدن «auto» با rAF، هنگام جابه‌جایی اسلایدر «smooth» */
  useEffect(() => {
    if (!previewing) {
      wasOpenRef.current = false;
      fromCarouselScrollRef.current = false;
      return;
    }
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = true;
    if (!wasOpen) {
      fromCarouselScrollRef.current = false;
      const raf = requestAnimationFrame(() => {
        centerCard(previewIdx, false);
      });
      return () => cancelAnimationFrame(raf);
    }
    if (fromCarouselScrollRef.current) {
      fromCarouselScrollRef.current = false;
      return;
    }
    centerCard(previewIdx, true);
  }, [previewing, previewIdx]);

  useEffect(
    () => () => {
      if (progTimerRef.current) window.clearTimeout(progTimerRef.current);
    },
    [],
  );

  const onScroll = () => {
    if (!previewing || programmaticRef.current) return;
    const car = carRef.current;
    if (!car) return;
    const i = clamp(Math.round(Math.abs(car.scrollLeft) / STRIDE), 0, total - 1);
    if (i !== previewIdx) {
      fromCarouselScrollRef.current = true;
      onPreviewIdx(i);
    }
  };

  const onWheel = (e: ReactWheelEvent) => {
    if (!previewing) return;
    const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) > 0 ? 1 : -1;
    const idx = clamp(previewIdx + d, 0, total - 1);
    if (idx !== previewIdx) {
      fromCarouselScrollRef.current = false;
      onPreviewIdx(idx);
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button > 0 || e.pointerType === "touch") return;
    const car = carRef.current;
    if (!car) return;
    dragRef.current = { x: e.clientX, sl: car.scrollLeft, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const st = dragRef.current;
    const car = carRef.current;
    if (!st || !car) return;
    const dx = e.clientX - st.x;
    if (!st.moved && Math.abs(dx) > 6) {
      st.moved = true;
      try {
        car.setPointerCapture(st.id);
      } catch {
        /* pointerId آزمایشی */
      }
      car.style.scrollSnapType = "none";
      setDragging(true);
    }
    if (st.moved) car.scrollLeft = st.sl - dx;
  };
  const onPointerUp = () => {
    const car = carRef.current;
    const st = dragRef.current;
    dragRef.current = null;
    if (car) car.style.scrollSnapType = "";
    setDragging(false);
    if (st?.moved) {
      if (car && total > 0) {
        const nearest = clamp(Math.round(Math.abs(car.scrollLeft) / STRIDE), 0, total - 1);
        centerCard(nearest, true);
      }
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 30);
    }
  };

  /* مجازی‌سازی پنجره‌ای کاروسل: رندر فقط پنجرهٔ فعال [from..to] با دو Spacer دقیق */
  const from = Math.max(0, shownIdx - WINDOW);
  const to = Math.min(total - 1, shownIdx + WINDOW);
  const startCount = from;
  const endCount = Math.max(0, total - 1 - to);
  const startSpacerW = startCount > 0 ? startCount * STRIDE - 12 : 0;
  const endSpacerW = endCount > 0 ? endCount * STRIDE - 12 : 0;
  const visibleIndices: number[] = [];
  if (previewing && total > 0) {
    for (let i = from; i <= to; i += 1) visibleIndices.push(i);
  }

  return (
    <footer id="rm-bottom">
      <div
        id="rm-previewBox"
        onClick={(e) => {
          if (e.target === e.currentTarget) onHidePreview();
        }}
      >
        <div
          id="rm-carousel"
          ref={carRef}
          className={dragging ? "drag" : ""}
          onScroll={onScroll}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {startSpacerW > 0 ? (
            <div style={{ flex: `0 0 ${startSpacerW}px`, width: startSpacerW, height: 1 }} aria-hidden="true" />
          ) : null}
          {visibleIndices.map((i) => {
            const card = cardFor(i);
            return (
              <div
                key={i}
                className={"rm-pitem" + (i === shownIdx ? " sel" : "")}
                data-idx={i}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  onHidePreview();
                  onJumpIndex(i);
                }}
              >
                <div className="rm-pcard">
                  {pdfDocumentUid && card?.thumbPage ? (
                    <PdfThumb documentUid={pdfDocumentUid} page={card.thumbPage} />
                  ) : card && card.lines.length ? (
                    <div className="rm-pcard-scale" aria-hidden="true">
                      {card.label ? (
                        <div className="rm-pcard-head">
                          <span>صفحه {faNum(card.label)}</span>
                        </div>
                      ) : null}
                      {card.lines.map((line, k) =>
                        line.isHeading ? (
                          <div key={k} className="rm-book-h" style={{ margin: "0 0 0.45em" }}>
                            {line.text}
                          </div>
                        ) : (
                          <p key={k} className="rm-book-p" style={{ margin: `0 0 ${para}em` }}>
                            {line.text}
                          </p>
                        ),
                      )}
                    </div>
                  ) : (
                    <div className="rm-pcard-scale" aria-hidden="true">
                      <div className="rm-pcard-skel">
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )}
                  {card?.bookmarked ? <i className="bmk" /> : null}
                </div>
                <div className="rm-pnum">{faNum(i + 1)}</div>
              </div>
            );
          })}
          {endSpacerW > 0 ? (
            <div style={{ flex: `0 0 ${endSpacerW}px`, width: endSpacerW, height: 1 }} aria-hidden="true" />
          ) : null}
        </div>
        <div id="rm-bigIndicator" onClick={onHidePreview}>
          {faNum(shownIdx + 1) + " / " + faNum(total)}
        </div>
      </div>

      <div id="rm-slideBar">
        <div className="rm-slide-top">
          <button
            type="button"
            className="rm-slide-badge"
            title="رفتن به صفحه"
            onClick={onPageClick ?? onTogglePreview}
          >
            صفحه {faNum(shownIdx + 1)} از {faNum(total)}
          </button>
          <button
            type="button"
            className="rm-slide-pct"
            title="رفتن به درصد"
            onClick={onPctClick}
          >
            {faNum(Math.round(shownF * 100))}٪
          </button>
        </div>
        <div className="rm-slide-bot">
          <div className="rm-slide-history">
            <button
              type="button"
              className="ib"
              style={{ width: 36, height: 36 }}
              title="بازگشت به موقعیت قبلی"
              aria-label="بازگشت به موقعیت قبلی"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Mi name="undo_rounded" flip style={{ fontSize: 20 }} />
            </button>
            {canForward && onForward ? (
              <button
                type="button"
                className="ib"
                style={{ width: 36, height: 36 }}
                title="رفتن به موقعیت بعدی"
                aria-label="رفتن به موقعیت بعدی"
                onClick={onForward}
              >
                <Mi name="redo_rounded" flip style={{ fontSize: 20 }} />
              </button>
            ) : null}
          </div>
          <RmSlider
            className="small acc sl-progress"
            min={0}
            max={1}
            step={0.001}
            value={shownF}
            onInput={onProgressInput}
            onCommit={onProgressCommit}
          />
          <button
            type="button"
            className={"ib" + (previewing ? " acc" : "")}
            style={{ width: 36, height: 36 }}
            title={previewing ? "بستن پیش‌نمایش صفحات" : "نمایش پیش‌نمایش صفحات"}
            aria-label="پیش‌نمایش صفحات کتاب"
            onClick={onTogglePreview}
          >
            <Mi name="view_carousel" style={{ fontSize: 22 }} />
          </button>
        </div>
      </div>
    </footer>
  );
}
