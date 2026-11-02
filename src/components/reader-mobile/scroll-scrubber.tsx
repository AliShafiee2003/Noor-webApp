"use client";

/**
 * اسکرول‌بار سریع — لبهٔ راست در حالت اسکرول:
 * در حالت عادی نوار بسیار باریک (۳px) و محو تا حین مطالعه به چشم نیاید.
 * هنگام لمس/درگ مستقیم کاربر: تامب عریض‌تر شده (۶px) و باکس فصل و شماره صفحه ظاهر می‌شود.
 * پس از پایان جابه‌جایی دقیقاً پس از ۲ ثانیه ناپدید می‌شود.
 */

import { useEffect, useRef } from "react";
import { faNum } from "@/lib/format";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface ScrubberInfo {
  title: string;
  pageLabel: string;
  total?: number;
  pct: number;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function ScrollScrubber({
  active,
  infoAt,
}: {
  active: boolean;
  infoAt: (f: number) => ScrubberInfo;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const infoAtRef = useRef(infoAt);
  useEffect(() => {
    infoAtRef.current = infoAt;
  });

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    const sv = document.getElementById("rm-scroll");
    if (!root || !sv) return;
    const thumb = root.querySelector<HTMLElement>("#rm-scrubThumb");
    const tip = root.querySelector<HTMLElement>("#rm-scrubTip");
    if (!thumb || !tip) return;

    let hideT: number | undefined;
    let holdT: number | undefined;
    let dragging = false;

    const place = () => {
      const max = Math.max(1, sv.scrollHeight - sv.clientHeight);
      const f = clamp(sv.scrollTop / max, 0, 1);
      const H = sv.clientHeight;
      thumb.style.top = `${90 + f * (H - 198)}px`;
    };

    const flash = () => {
      // اسکرول عادی صفحه با لمس متن: فقط نوار باریک تامب برای ۱.۲ ثانیه نشان داده می‌شود
      root.classList.add("show");
      window.clearTimeout(hideT);
      hideT = window.setTimeout(() => {
        if (!dragging && !root.classList.contains("hold")) {
          root.classList.remove("show");
        }
      }, 1200);
    };

    const onScroll = () => {
      if (!dragging) place();
      flash();
    };

    const updateTip = (info: ScrubberInfo) => {
      const safeTitle = escapeHtml(info.title || "بدون عنوان فصل");
      const safePage = faNum(info.pageLabel);
      const safeTotal = info.total ? " از " + faNum(info.total) : "";
      const safePct = faNum(info.pct) + "٪";

      tip.innerHTML = `
        <div class="rm-scrub-title">${safeTitle}</div>
        <div class="rm-scrub-meta">
          <span>صفحه ${safePage}${safeTotal}</span>
          <span class="rm-scrub-dot">•</span>
          <span>${safePct}</span>
        </div>
      `;
    };

    const seek = (clientY: number) => {
      const r = root.getBoundingClientRect();
      const H = sv.clientHeight;
      const f = clamp((clientY - r.top - 90 - 24) / (H - 198), 0, 1);
      sv.scrollTop = f * (sv.scrollHeight - sv.clientHeight);
      const topPx = 90 + f * (H - 198);
      thumb.style.top = `${topPx}px`;

      const info = infoAtRef.current(f);
      updateTip(info);

      // قرارگیری باکس در کنار انگشت کاربر با کنترل لبه‌های بالا و پایین
      tip.style.top = `${clamp(topPx - 14, 70, H - 110)}px`;
    };

    const onDown = (e: PointerEvent) => {
      e.stopPropagation();
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        /* در تست‌های سنتتیک یا برخی مرورگرها بدون خطای مرگبار رد شود */
      }
      window.clearTimeout(holdT);
      window.clearTimeout(hideT);
      dragging = true;
      root.classList.add("drag", "hold", "show");
      // seek اینجا انجام نمی‌شود — فقط حالت بصری (عریض/رنگ) فعال می‌شود
      // seek تنها در pointermove (drag واقعی) اجرا می‌شود تا از جهش صفحه جلوگیری شود
    };

    const onMove = (e: PointerEvent) => {
      if (dragging) seek(e.clientY);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("drag");
      // کاربر درگ را تمام کرد: باکس و تامب عریض دقیقاً ۲ ثانیه باقی می‌مانند و سپس محو می‌شوند
      window.clearTimeout(holdT);
      holdT = window.setTimeout(() => {
        root.classList.remove("hold");
        root.classList.remove("show");
      }, 2000);
    };

    sv.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    place();

    return () => {
      sv.removeEventListener("scroll", onScroll);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      window.clearTimeout(hideT);
      window.clearTimeout(holdT);
    };
  }, [active]);

  return (
    <div id="rm-scrubber" ref={rootRef} aria-hidden="true">
      <div id="rm-scrubThumb" />
      <div id="rm-scrubTip" />
    </div>
  );
}
