"use client";

/**
 * موتور زیرصفحه‌بندی measurer — پورت layout پروتوتایپ (epub_reader_prototype.html:730-781).
 *
 * هر صفحهٔ سروری (PagePayload) با PageRenderer واقعی در ظرف مخفی .rm-measurer رندر می‌شود؛
 * با offsetTop/offsetHeight بلاک‌ها بسته‌بندی حریصانه در زیرصفحه‌های حداکثر (ارتفاع صحنه − ۶۴)
 * انجام می‌شود. سرفصل‌ها شکست اجباری دارند (فقط وقتی اولین بلاکِ زیرصفحهٔ تازه نباشند).
 * خروجی: تعداد زیرصفحه‌ها + بازهٔ بلاک هر زیرصفحه؛ رندر زیرصفحه با برش blocks انجام می‌شود
 * (بدون هیچ تغییری در PageRenderer).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { PagePayload } from "@/lib/types";

export interface PageMeasure {
  /** تعداد زیرصفحه‌های این صفحهٔ سروری */
  subs: number;
  /** بازهٔ بلاک [start,end] هر زیرصفحه (اندیس در payload.blocks) */
  ranges: Array<[number, number]>;
}

interface InternalMeasure extends PageMeasure {
  epoch: string;
}

/** انعطاف عمودی پروتوتایپ: maxH = ارتفاع صحنه − ۶۴ */
const MAXH_SLACK = 64;
/** debounce اندازه‌گیری مجدد هنگام تغییر تایپوگرافی/اندازه */
const MEASURE_DEBOUNCE_MS = 60;

function nextFrames(n: number): Promise<void> {
  const chain = new Promise<void>((resolve) => {
    let left = n;
    const step = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  /* میزبان‌های بدون پینت rAF را هرگز اجرا نمی‌کنند — تایمر پشتیبان
     تا اندازه‌گیری معطل نماند (در مرورگر واقعی rAF زودتر می‌برد) */
  return Promise.race([chain, new Promise<void>((r) => setTimeout(r, 60 * n + 60))]);
}

export interface UsePaginationOptions {
  /** ظرف میزبان measurer — باید المان position‌دار باشد (stage) */
  hostEl: HTMLElement | null;
  /** صحنه برای اندازه‌گیری w/h */
  stageEl: HTMLElement | null;
  /** پودهای بارگذاری‌شدهٔ قابل اندازه‌گیری */
  payloads: PagePayload[];
  /** تغییر هر مؤلفه تایپوگرافی/اندازه = اندازه‌گیری از نو */
  typoKey: string;
  /** صفحهٔ اول جلد — سرفصل اول آن شکست اجباری نمی‌گیرد */
  volumeFirstPageUid: string | null;
  /** رندر محتوای یک پود (همان props نمای قابل‌مشاهده) */
  renderPage: (p: PagePayload) => ReactNode;
}

export function usePagination(opts: UsePaginationOptions): {
  measures: Record<string, PageMeasure>;
  stage: { w: number; h: number } | null;
} {
  const { hostEl, stageEl, payloads, typoKey, volumeFirstPageUid, renderPage } = opts;

  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const [measures, setMeasures] = useState<Record<string, InternalMeasure>>({});

  const rootRef = useRef<Root | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const fontsReadyRef = useRef<Promise<void> | null>(null);
  const renderPageRef = useRef(renderPage);
  const stageRefValue = useRef({ w: 0, h: 0 });
  const volumeFirstRef = useRef(volumeFirstPageUid);
  useEffect(() => {
    renderPageRef.current = renderPage;
    volumeFirstRef.current = volumeFirstPageUid;
  });

  /* ---------- اندازهٔ صحنه ---------- */
  useEffect(() => {
    if (!stageEl) return;
    const apply = () => {
      stageRefValue.current = { w: stageEl.clientWidth, h: stageEl.clientHeight };
      setStage(stageRefValue.current);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(stageEl);
    return () => ro.disconnect();
  }, [stageEl]);

  /* ---------- ظرف مخفی measurer (یک React root مستقل) ---------- */
  useEffect(() => {
    if (!hostEl) return;
    const el = document.createElement("div");
    el.className = "rm-measurer";
    hostEl.appendChild(el);
    elRef.current = el;
    rootRef.current = createRoot(el);
    return () => {
      const root = rootRef.current;
      const q = queueRef.current;
      rootRef.current = null;
      elRef.current = null;
      void q.then(() => {
        void root?.unmount();
      });
      el.remove();
    };
  }, [hostEl]);

  useEffect(() => {
    fontsReadyRef.current =
      typeof document !== "undefined" && document.fonts?.ready
        ? document.fonts.ready.then(() => undefined)
        : Promise.resolve();
  }, []);

  const measureOne = (payload: PagePayload, epoch: string) => {
    queueRef.current = queueRef.current.then(async () => {
      const root = rootRef.current;
      const el = elRef.current;
      if (!root || !el) return;
      await fontsReadyRef.current;
      try {
        flushSync(() => {
          root.render(renderPageRef.current(payload));
        });
        await nextFrames(1);
        if (elRef.current !== el) return;
        /* بلاک‌ها، نه فرزندان مستقیم — renderPage یک پوشش .rm-book دارد و
           PageRenderer بلاک‌ها را در گروه‌های تودرتو می‌چیند. offsetTop هر
           [data-block-id] نسبت به ریشهٔ position‌دار PageRenderer است. */
        const kids = Array.from(el.querySelectorAll<HTMLElement>("[data-block-id]"));
        const blockWrappers = kids.map((k) => k.parentElement ?? k);
        const maxH = Math.max(120, stageRefValue.current.h - MAXH_SLACK);
        const ranges: Array<[number, number]> = [];
        let curStart = 0;
        for (let i = 1; i < blockWrappers.length; i += 1) {
          const consumed = blockWrappers[i].offsetTop;
          const isHeading = payload.blocks[i]?.type === "heading";
          const over = consumed > maxH && i > curStart;
          const forced = isHeading && i > curStart;
          if (over || forced) {
            ranges.push([curStart, i - 1]);
            curStart = i;
          }
        }
        if (blockWrappers.length === 0) ranges.push([0, -1]);
        else ranges.push([curStart, blockWrappers.length - 1]);
        setMeasures((prev) =>
          prev[payload.page_uid]?.epoch === epoch
            ? prev
            : { ...prev, [payload.page_uid]: { epoch, subs: ranges.length, ranges } },
        );
      } finally {
        /* پاک‌سازی DOM — جلوگیری از تکرار id بلاک‌ها در سند */
        if (rootRef.current === root) {
          flushSync(() => {
            root.render(null);
          });
        }
      }
    });
  };

  /* ---------- اندازه‌گیری صفحات بارگذاری‌شده (debounce ۲۵۰ms) ---------- */
  const payloadSignature = payloads.map((p) => p.page_uid).join(",");
  const payloadListRef = useRef(payloads);
  useEffect(() => {
    payloadListRef.current = payloads;
  }, [payloads]);

  useEffect(() => {
    if (!stage) return;
    const epoch = `${stage.w}x${stage.h}|${typoKey}`;
    const timer = setTimeout(() => {
      for (const payload of payloadListRef.current) {
        if (measures[payload.page_uid]?.epoch === epoch) continue;
        measureOne(payload, epoch);
      }
    }, MEASURE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [stage, typoKey, payloadSignature, hostEl, stageEl]);

  return { measures, stage };
}
