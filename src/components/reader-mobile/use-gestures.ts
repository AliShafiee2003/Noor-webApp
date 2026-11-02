"use client";

/**
 * ژست‌های کتاب‌خوان موبایل — پورت epub_reader_prototype.html:1425-1505.
 * نواحی ضربه (مرکز/پایین بر اساس tapMode و tapArea)، کشیدن برای ورق‌زدن با سرعت و مقاومت لبه،
 * کلیدهای جهت‌دار، چرخ ماوس (قفل ۳۸۰ms)، double-tap و long-press.
 * روی لینک/دکمه‌های درون متن ژست بسته می‌شود (closest).
 */

import { useEffect, useRef } from "react";

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;
const WHEEL_LOCK_MS = 380;
const FLICK_VELOCITY = 0.45; // px/ms

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** محاسبهٔ مستطیل ناحیهٔ لمسی باز کردن پنل‌ها (مشترک بین تشخیص ضربه و پیش‌نمایش بصری) */
export function computeTapRect(
  W: number,
  H: number,
  tapMode: "center" | "bottom",
  tapArea: number,
): { l: number; t: number; w: number; h: number } {
  const r = clamp(tapArea, 0.1, 1);
  if (tapMode === "center") {
    const s = Math.sqrt(r);
    const rw = W * s;
    const rh = H * s;
    return { l: (W - rw) / 2, t: (H - rh) / 2, w: rw, h: rh };
  }
  const rh = H * r;
  return { l: 0, t: H - rh, w: W, h: rh };
}

export interface UseGesturesOptions {
  stageEl: HTMLElement | null;
  W: () => number;
  H: () => number;
  prog: "rtl" | "ltr";
  /** حالت نمایش — کشیدن/چرخ فقط در pages؛ در scroll اسکرول بومی است */
  mode: "pages" | "scroll";
  tapArea: number;
  tapMode: "center" | "bottom";
  canPrev: () => boolean;
  canNext: () => boolean;
  onTurn: (d: 1 | -1) => void;
  /** null = پایان کشیدن و بازگشت انیمیشنی */
  onDrag: (dx: number | null) => void;
  onTapCenter: () => void;
  /** ضربه در ناحیهٔ خنثی بیرون از مستطیل و بیرون از لبه‌های ۲۵٪ (مثلاً برای بستن نوارهای باز) */
  onTapOther?: () => void;
  /** قبل از تفسیر ضربه — true یعنی مصرف شد (مثلاً پاک‌کردن انتخاب فعال یا بستن پیش‌نمایش) */
  onBeforeTap?: () => boolean;
  /** دکمه‌ها/لینک‌های درون متن — ناحیهٔ غیر ژستی */
  gestureSkip?: (target: EventTarget | null) => boolean;
  onLongPress?: (x: number, y: number) => void;
  onDoubleTap?: (x: number, y: number) => void;
  enabled: boolean;
}

interface GestureState {
  id: number;
  x: number;
  y: number;
  lx: number;
  lt: number;
  v: number;
  moved: boolean;
  drag: boolean;
  vdrag: boolean;
  st: number;
  long: boolean;
  /** ماوس روی دسکتاپ انتخاب متن بومی دارد؛ کشیدن نباید ورق را جابه‌جا کند. */
  mouse: boolean;
  lp: ReturnType<typeof setTimeout>;
}

export function useGestures(opts: UseGesturesOptions): void {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const { stageEl, enabled } = opts;

  useEffect(() => {
    const stage = stageEl;
    if (!stage || !enabled) return;

    const liveSize = () => {
      const rect = stage.getBoundingClientRect();
      const o = optsRef.current;
      const W = rect.width || stage.clientWidth || o.W() || 412;
      const H = rect.height || stage.clientHeight || o.H() || 860;
      return { rect, W, H };
    };

    const zoneOf = (
      x: number,
      y: number,
      W: number,
      H: number,
    ): "center" | "edgeLeft" | "edgeRight" | "other" => {
      const o = optsRef.current;
      const rc = computeTapRect(W, H, o.tapMode, o.tapArea);
      if (x >= rc.l && x <= rc.l + rc.w && y >= rc.t && y <= rc.t + rc.h) return "center";
      if (x <= W * 0.25) return "edgeLeft";
      if (x >= W * 0.75) return "edgeRight";
      return "other";
    };

    let G: GestureState | null = null;
    let wheelLock = 0;
    let lastLongPressAt = 0;

    const skip = (target: EventTarget | null): boolean =>
      optsRef.current.gestureSkip
        ? optsRef.current.gestureSkip(target)
        : target instanceof Element &&
          !!target.closest(
            "a,button,input,textarea,select,[role='button'],#rm-scrubber,#rm-selBubble,#rm-hStart,#rm-hEnd,[data-hl-menu],mark[data-hl-uid]",
          );

    const onPointerDown = (e: PointerEvent) => {
      if (e.button > 0 || skip(e.target)) return;
      const now = performance.now();
      const sv = document.getElementById("rm-scroll");
      G = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        lx: e.clientX,
        lt: now,
        v: 0,
        moved: false,
        drag: false,
        vdrag: false,
        st: sv ? sv.scrollTop : 0,
        long: false,
        mouse: e.pointerType === "mouse",
        lp: 0 as unknown as ReturnType<typeof setTimeout>,
      };
      if (!G.mouse && optsRef.current.onLongPress) {
        G.lp = setTimeout(() => {
          if (G && !G.moved) {
            G.long = true;
            lastLongPressAt = performance.now();
            optsRef.current.onLongPress?.(G.x, G.y);
          }
        }, LONG_PRESS_MS);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!G || e.pointerId !== G.id) return;
      const dx = e.clientX - G.x;
      const dy = e.clientY - G.y;
      const now = performance.now();
      if (!G.moved && Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        G.moved = true;
        clearTimeout(G.lp);
      }
      if (now - G.lt > 0) {
        G.v = (e.clientX - G.lx) / (now - G.lt);
      }
      G.lx = e.clientX;
      G.lt = now;
      if (!G.moved || G.long || G.mouse) return;
      const o = optsRef.current;
      if (o.mode === "pages") {
        const sign = o.prog === "ltr" ? -1 : 1;
        if (G.drag || Math.abs(dx) > Math.abs(dy)) {
          if (!G.drag) {
            G.drag = true;
            try {
              stage.setPointerCapture(e.pointerId);
            } catch {
              /* نادیده */
            }
          }
          const toward = dx * sign > 0;
          let off = dx;
          if ((toward && !o.canNext()) || (!toward && !o.canPrev())) off = dx * 0.3;
          o.onDrag(off);
        }
      } else if (
        o.mode === "scroll" &&
        e.pointerType === "mouse" &&
        (G.vdrag || Math.abs(dy) > Math.abs(dx))
      ) {
        G.vdrag = true;
        const sv = document.getElementById("rm-scroll");
        if (sv) {
          sv.classList.add("dragging");
          sv.scrollTop = G.st - dy;
        }
      }
    };

    const onTap = (cx: number, cy: number) => {
      const o = optsRef.current;
      if (o.onBeforeTap?.()) return;
      const { rect, W, H } = liveSize();
      const x = cx - rect.left;
      const y = cy - rect.top;
      switch (zoneOf(x, y, W, H)) {
        case "center":
          o.onTapCenter();
          break;
        case "edgeLeft":
          o.onTurn(o.prog === "rtl" ? 1 : -1);
          break;
        case "edgeRight":
          o.onTurn(o.prog === "rtl" ? -1 : 1);
          break;
        default:
          o.onTapOther?.();
          break;
      }
    };

    const endG = (e: PointerEvent) => {
      if (!G || (e && e.pointerId !== G.id)) return;
      const g = G;
      G = null;
      clearTimeout(g.lp);
      if (g.vdrag) {
        document.getElementById("rm-scroll")?.classList.remove("dragging");
        return;
      }
      if (g.long) return;
      const o = optsRef.current;
      if (g.drag) {
        const { W } = liveSize();
        const dx = (e ? e.clientX : g.lx) - g.x;
        const sign = o.prog === "ltr" ? -1 : 1;
        const nd = dx * sign;
        o.onDrag(null);
        if (nd > W * 0.15 || g.v * sign > FLICK_VELOCITY) o.onTurn(1);
        else if (nd < -W * 0.15 || g.v * sign < -FLICK_VELOCITY) o.onTurn(-1);
        return;
      }
      if (!g.moved && e && e.type === "pointerup") onTap(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent) => endG(e);
    const onPointerCancel = (e: PointerEvent) => {
      if (!G) return;
      const g = G;
      G = null;
      clearTimeout(g.lp);
      if (g.vdrag) document.getElementById("rm-scroll")?.classList.remove("dragging");
      if (g.drag) optsRef.current.onDrag(null);
      void e;
    };

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
      const o = optsRef.current;
      const rtl = o.prog === "rtl";
      if (e.key === "ArrowLeft") {
        o.onTurn(rtl ? 1 : -1);
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        o.onTurn(rtl ? -1 : 1);
        e.preventDefault();
      } else if (e.key === "PageDown" || e.key === " ") {
        o.onTurn(1);
        e.preventDefault();
      } else if (e.key === "PageUp") {
        o.onTurn(-1);
        e.preventDefault();
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (optsRef.current.mode !== "pages") return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelLock < WHEEL_LOCK_MS) return;
      wheelLock = now;
      optsRef.current.onTurn(e.deltaY > 0 ? 1 : -1);
    };

    const onDblClick = (e: MouseEvent) => {
      if (skip(e.target)) return;
      optsRef.current.onDoubleTap?.(e.clientX, e.clientY);
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (skip(e.target)) return;
      if (G?.moved || G?.long || performance.now() - lastLongPressAt < 600) return;
      optsRef.current.onDoubleTap?.(e.clientX, e.clientY);
    };

    stage.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKey);
    if (opts.mode === "pages") stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("dblclick", onDblClick);
    stage.addEventListener("contextmenu", onContextMenu);
    return () => {
      if (G) clearTimeout(G.lp);
      stage.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKey);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("dblclick", onDblClick);
      stage.removeEventListener("contextmenu", onContextMenu);
    };
  }, [stageEl, enabled, opts.mode]);
}
