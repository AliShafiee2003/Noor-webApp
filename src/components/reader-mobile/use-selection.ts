"use client";

/**
 * انتخاب متن موبایل — پورت epub_reader_prototype.html:1307-1420.
 * نگه‌داشتن ۴۵۰ms / دابل‌کلیک / منوی زمینه → انتخاب کلمه، دستگیره‌های قابل کشیدن،
 * منوی حبابی. انتخاب همیشه برنامه‌ای است (addRange) تا با انتخاب بومی iOS تداخل نکند.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { PageBlock } from "@/lib/types";
import { selectionFromRange, type ReaderSelection } from "@/components/reader/selection-offset";

const WORD_BREAK = /[\s.,;:!?()[\]«»"'،؛؟…\-–—]/;
/** عرض تقریبی حباب ۶دکمه‌ای — برای clamp افقی پیش از اندازه‌گیری DOM */
const BUBBLE_W = 280;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type SelSide = "start" | "end";

export interface SelHandlePos {
  left: number;
  top: number;
  radius: string;
}

export interface SelUI {
  bubble: { left: number; top: number } | null;
  start: SelHandlePos | null;
  end: SelHandlePos | null;
}

const EMPTY_UI: SelUI = { bubble: null, start: null, end: null };

interface Caret {
  n: Node;
  o: number;
}

function caretAt(x: number, y: number): Caret | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { n: p.offsetNode, o: p.offset } : null;
  }
  const r = doc.caretRangeFromPoint?.(x, y);
  return r ? { n: r.startContainer, o: r.startOffset } : null;
}

export function useSelection(opts: {
  stageEl: HTMLElement | null;
  enabled: boolean;
  getBlock: (blockId: string) => PageBlock | undefined;
  /** صفحهٔ غالب دیدپذیر — مقصد «انتخاب همه» */
  viewEl: () => HTMLElement | null;
  /** تغییر کلید → پاک‌شدن انتخاب (صفحه/زیرصفحه/حالت/بازشدن شیت) */
  resetKey: string;
}) {
  const [sel, setSel] = useState<ReaderSelection | null>(null);
  const [ui, setUi] = useState<SelUI>(EMPTY_UI);
  const rangeRef = useRef<Range | null>(null);
  const dragRef = useRef<{ which: SelSide; fixed: Caret } | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  /* مختصات حباب/دستگیره‌ها نسبت به صحنه (stage = app در پروتوتایپ) */
  const position = useCallback(() => {
    const r = rangeRef.current;
    const stage = optsRef.current.stageEl;
    if (!r || !stage) {
      setUi(EMPTY_UI);
      return;
    }
    const fr = stage.getBoundingClientRect();
    const rects = Array.from(r.getClientRects()).filter(
      (q) =>
        q.width > 1 &&
        q.height > 4 &&
        q.right > fr.left &&
        q.left < fr.right &&
        q.bottom > fr.top &&
        q.top < fr.bottom,
    );
    if (!rects.length) {
      setUi({ bubble: { left: 100, top: 300 }, start: null, end: null });
      return;
    }
    const first = rects[0];
    const last = rects[rects.length - 1];
    const pe = r.startContainer.parentElement;
    const rtl = pe ? getComputedStyle(pe).direction === "rtl" : true;
    const sx = (rtl ? first.right : first.left) - fr.left;
    const sy = first.bottom - fr.top;
    const ex = (rtl ? last.left : last.right) - fr.left;
    const ey = last.bottom - fr.top;
    const start: SelHandlePos = {
      left: rtl ? sx - 22 : sx,
      top: sy,
      radius: rtl ? "50% 0 50% 50%" : "0 50% 50% 50%",
    };
    const end: SelHandlePos = {
      left: rtl ? ex : ex - 22,
      top: ey,
      radius: rtl ? "0 50% 50% 50%" : "50% 0 50% 50%",
    };
    const minL = Math.min(...rects.map((q) => q.left)) - fr.left;
    const maxR = Math.max(...rects.map((q) => q.right)) - fr.left;
    let top = first.top - fr.top - 50;
    if (top < 96) top = last.bottom - fr.top + 34;
    top = Math.min(top, Math.max(96, fr.height - 56));
    const left = clamp((minL + maxR) / 2 - BUBBLE_W / 2, 8, Math.max(8, fr.width - BUBBLE_W - 8));
    setUi({ bubble: { left, top }, start, end });
  }, []);

  const clear = useCallback(() => {
    rangeRef.current = null;
    dragRef.current = null;
    optsRef.current.stageEl?.closest(".rm-root")?.classList.remove("selecting");
    window.getSelection()?.removeAllRanges();
    setSel(null);
    setUi(EMPTY_UI);
  }, []);

  const applyRange = useCallback(
    (r: Range): boolean => {
      const stage = optsRef.current.stageEl;
      if (!stage) return false;
      const info = selectionFromRange(r, stage, optsRef.current.getBlock);
      if (!info) return false;
      rangeRef.current = r.cloneRange();
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r.cloneRange());
      stage.closest(".rm-root")?.classList.add("selecting");
      setSel(info);
      position();
      return true;
    },
    [position],
  );

  const wordRangeAt = useCallback((x: number, y: number): Range | null => {
    const stage = optsRef.current.stageEl;
    if (!stage) return null;
    const c = caretAt(x, y);
    if (!c) return null;
    let n = c.n;
    let o = c.o;
    if (n.nodeType !== Node.TEXT_NODE) {
      const tw = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      const firstText = tw.nextNode();
      if (!firstText) return null;
      n = firstText;
      o = 0;
    }
    const el = n.parentElement;
    if (!el || !stage.contains(n) || !el.closest(".rm-book")) return null;
    const t = n.textContent ?? "";
    const isW = (ch: string | undefined) => !!ch && !WORD_BREAK.test(ch);
    let a = clamp(o, 0, t.length);
    let b = a;
    if (!isW(t[a]) && isW(t[a - 1])) {
      a -= 1;
      b = a;
    }
    while (a > 0 && isW(t[a - 1])) a -= 1;
    while (b < t.length && isW(t[b])) b += 1;
    if (a === b) return null;
    const r = document.createRange();
    r.setStart(n, a);
    r.setEnd(n, b);
    return r;
  }, []);

  /* انتخاب با ماوس در مطالعهٔ متمرکز دسکتاپ — پس از رهاکردن دکمه، بازهٔ بومی خوانده می‌شود. */
  useEffect(() => {
    const stage = opts.stageEl;
    if (!stage) return;
    const onMouseUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (!optsRef.current.enabled) return;
      window.setTimeout(() => {
        const s = window.getSelection();
        if (!s || s.isCollapsed || s.rangeCount === 0) {
          if (sel) clear();
          return;
        }
        const r = s.getRangeAt(0);
        if (!stage.contains(r.commonAncestorContainer)) return;
        if (!applyRange(r)) clear();
      }, 0);
    };
    stage.addEventListener("pointerup", onMouseUp);
    return () => stage.removeEventListener("pointerup", onMouseUp);
  }, [opts.stageEl, applyRange, clear, sel]);

  const selectWordAt = useCallback(
    (x: number, y: number): boolean => {
      if (!optsRef.current.enabled) return false;
      const r = wordRangeAt(x, y);
      if (!r) return false;
      return applyRange(r);
    },
    [wordRangeAt, applyRange],
  );

  const handleDown = useCallback((which: SelSide, e: ReactPointerEvent<HTMLElement>) => {
    const r = rangeRef.current;
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointerId آزمایشی */
    }
    dragRef.current = {
      which,
      fixed:
        which === "start"
          ? { n: r.endContainer, o: r.endOffset }
          : { n: r.startContainer, o: r.startOffset },
    };
    setUi((prev) => ({ ...prev, bubble: null }));
  }, []);

  /* کشیدن دستگیره — پنجره‌ای تا بیرون از دستگیره هم ادامه یابد */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const stage = optsRef.current.stageEl;
      if (!d || !stage) return;
      const c = caretAt(e.clientX, e.clientY - 16);
      if (!c || c.n.nodeType !== Node.TEXT_NODE || !stage.contains(c.n)) return;
      const a = document.createRange();
      a.setStart(c.n, c.o);
      a.collapse(true);
      const b = document.createRange();
      b.setStart(d.fixed.n, d.fixed.o);
      b.collapse(true);
      const nr = document.createRange();
      if (a.compareBoundaryPoints(Range.START_TO_START, b) <= 0) {
        nr.setStart(c.n, c.o);
        nr.setEnd(d.fixed.n, d.fixed.o);
      } else {
        nr.setStart(d.fixed.n, d.fixed.o);
        nr.setEnd(c.n, c.o);
      }
      if (nr.collapsed) return;
      rangeRef.current = nr.cloneRange();
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(nr.cloneRange());
      const info = selectionFromRange(nr, stage, optsRef.current.getBlock);
      if (info) setSel(info);
      position();
      setUi((prev) => ({ ...prev, bubble: null }));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      position();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [position]);

  /* تغییر صفحه/زیرصفحه/حالت/شیت → انتخاب کهنه پاک شود */
  const resetKey = opts.resetKey;
  useEffect(() => {
    const t = window.setTimeout(clear, 0);
    return () => window.clearTimeout(t);
  }, [resetKey, clear]);

  /* اسکرول (پیوسته) انتخاب را جابه‌جا می‌کند — بسته شود */
  useEffect(() => {
    if (!sel) return;
    const onScroll = () => clear();
    const host = optsRef.current.stageEl?.querySelector("#rm-scroll");
    host?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, true);
    return () => {
      host?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [sel, clear]);

  return { sel, ui, clear, selectWordAt, handleDown };
}
