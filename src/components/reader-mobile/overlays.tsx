/**
 * لایه‌های شناور ریدر موبایل — روبان نشانک و قفل مطالعه.
 * منبع: epub_reader_prototype.html:429-439 (روبان) و :1065-1089، 228-234 (قفل).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Mi } from "./mi";
import { frameLoop } from "./frame-loop";

/* ---------- روبان نشانک سه‌بعدی (BookmarkStrip) ---------- */
export function BookmarkRibbon({ on }: { on: boolean }) {
  return (
    <div id="rm-ribbon" className={on ? "on" : ""} aria-hidden="true">
      <svg width="14" height="36" viewBox="0 0 14 36">
        <defs>
          <filter id="rmRbShadow" x="-120%" y="-20%" width="340%" height="160%">
            <feDropShadow dx="-2.5" dy="1.2" stdDeviation="1.6" floodColor="#000" floodOpacity=".32" />
          </filter>
          <linearGradient id="rmRbGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--accent-dark)" />
            <stop offset=".38" stopColor="var(--accent-light)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <path d="M0 0H14V36L7 30.5L0 36Z" fill="url(#rmRbGrad)" filter="url(#rmRbShadow)" />
      </svg>
    </div>
  );
}

/* ---------- قفل مطالعه: نگه‌داشتن ۲ ثانیه‌ای با arc ---------- */
const LOCK_LEN = 62.83;
const HOLD_MS = 2000;

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function StudyLockOverlay({
  locked,
  onUnlock,
  onDblClick,
}: {
  locked: boolean;
  onUnlock: () => void;
  /** دابل‌کلیک روی حلقه — دیالوگ راهنما (فاز ۸) */
  onDblClick?: () => void;
}) {
  const arcRef = useRef<SVGCircleElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef(0);
  const cancelRef = useRef<(() => void) | null>(null);
  const [hint, setHint] = useState(false);

  /* نمایش راهنما هنگام قفل‌شدن (۲.۶ ثانیه) */
  useEffect(() => {
    if (!locked) return;
    const show = window.setTimeout(() => setHint(true), 0);
    const hide = window.setTimeout(() => setHint(false), 2600);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [locked]);

  const paint = (p: number) => {
    progressRef.current = p;
    const e = easeInOut(p);
    if (arcRef.current) arcRef.current.style.strokeDashoffset = String(LOCK_LEN * (1 - clamp(p, 0, 1)));
    if (ringRef.current) ringRef.current.style.transform = `scale(${1 + 0.3 * e})`;
  };

  const stop = () => {
    cancelRef.current?.();
    cancelRef.current = null;
  };

  /* رهاکردن: عقب‌نشینی با سرعت ۲.۵× (proto: dir = -2.5) */
  const release = () => {
    stop();
    let p = progressRef.current;
    if (p <= 0) return;
    let last = performance.now();
    cancelRef.current = frameLoop((now) => {
      const dt = now - last;
      last = now;
      p = clamp(p - (dt / HOLD_MS) * 2.5, 0, 1);
      paint(p);
      return p > 0;
    });
  };

  const hold = (e: React.PointerEvent) => {
    if (e.button > 0 || !locked) return;
    stop();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointerId آزمایشی */
    }
    let p = progressRef.current;
    let last = performance.now();
    cancelRef.current = frameLoop((now) => {
      const dt = now - last;
      last = now;
      p = clamp(p + dt / HOLD_MS, 0, 1);
      paint(p);
      if (p >= 1) {
        paint(0);
        onUnlock();
        return false;
      }
      return true;
    });
  };

  useEffect(() => stop, []);

  return (
    <>
      <div
        id="rm-lockRing"
        title="برای باز کردن قفل نگه دارید"
        onPointerDown={hold}
        onPointerUp={release}
        onPointerCancel={release}
        onDoubleClick={() => {
          stop();
          paint(0);
          onDblClick?.();
        }}
      >
        <div className="rm-lock-ring" ref={ringRef}>
          <svg viewBox="0 0 22 22">
            <circle cx="11" cy="11" r="10" fill="none" stroke="color-mix(in srgb,var(--page-text) 15%,transparent)" strokeWidth="2" />
            <circle
              ref={arcRef}
              id="rm-lockArc"
              cx="11"
              cy="11"
              r="10"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={LOCK_LEN}
              strokeDashoffset={LOCK_LEN}
            />
          </svg>
          <Mi name="lock" size={9} />
        </div>
      </div>
      <div id="rm-lockHint" className={hint && locked ? "show" : ""}>
        برای باز کردن قفل ۲ ثانیه نگه دارید (یا دابل‌کلیک)
      </div>
    </>
  );
}
