/**
 * Theme switch reveal. Uses the View Transitions API to animate the NEW snapshot
 * with an expanding circle from the tapped button. Applies DOM mutations
 * synchronously inside startViewTransition so there is zero frame delay.
 */
"use client";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type VTDocument = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => {
    ready: Promise<void>;
    finished: Promise<void>;
    skipTransition?: () => void;
  };
};

export interface ThemeRippleOptions {
  root: HTMLElement;
  /** Circle centre in viewport coordinates (the pressed button). */
  origin?: { x: number; y: number };
  /** Applies the theme change synchronously on the DOM. */
  onCommit: () => void;
}

let activeTransition: { skipTransition?: () => void } | null = null;

/** Returns a cancel function. */
export function playThemeRipple(opts: ThemeRippleOptions): () => void {
  const { root, origin, onCommit } = opts;
  const doc = document as VTDocument;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduce) {
    onCommit();
    return () => {};
  }

  /* If a previous transition is still running, skip it immediately so rapid clicks never block */
  try {
    activeTransition?.skipTransition?.();
  } catch {
    /* ignore */
  }

  const fr = root.getBoundingClientRect();
  const ox = clamp(origin ? origin.x : fr.left + fr.width / 2, 0, window.innerWidth);
  const oy = clamp(origin ? origin.y : fr.top, 0, window.innerHeight);
  const R = Math.ceil(
    Math.max(
      Math.hypot(ox, oy),
      Math.hypot(window.innerWidth - ox, oy),
      Math.hypot(ox, window.innerHeight - oy),
      Math.hypot(window.innerWidth - ox, window.innerHeight - oy),
    ),
  );

  const html = document.documentElement;
  html.classList.add("rm-vt");
  const vt = doc.startViewTransition(() => {
    onCommit();
  });
  activeTransition = vt;
  void vt.ready
    .then(() =>
      html.animate(
        { clipPath: [`circle(0px at ${ox}px ${oy}px)`, `circle(${R}px at ${ox}px ${oy}px)`] },
        { duration: 450, easing: "cubic-bezier(.42,0,1,1)", pseudoElement: "::view-transition-new(root)" },
      ),
    )
    .catch(() => {});
  void vt.finished
    .finally(() => {
      if (activeTransition === vt) activeTransition = null;
      html.classList.remove("rm-vt");
    })
    .catch(() => {});
  return () => {
    try {
      vt.skipTransition?.();
    } catch {
      /* ignore */
    }
  };
}
