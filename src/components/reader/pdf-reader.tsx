"use client";

/**
 * نمایشگر PDF کتاب‌های اسکن‌شده (فاز رسانه) — pdf.js با worker آفلاین.
 * تک‌صفحه روی canvas با fit-width و زوم؛ ناوبری صفحه با خوانندهٔ اصلی است
 * (PageRef مصنوعی p-001…) پس این کامپوننت فقط رندر می‌کند.
 * ماژول pdf.js با dynamic import بار می‌شود تا در SSR اجرا نشود.
 * PDF رمزدار منبع (قفل ناشر): پیام کوتاه، بدون فرم گذرواژه — رمز دستی خواسته نیست.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileWarning, Loader2, LockKeyhole, Minus, Plus, RotateCcw, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { mediaFileUrl } from "@/lib/api";
import { faNum } from "@/lib/format";
import { cn } from "@/lib/utils";

type PdfModule = typeof import("pdfjs-dist");
type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;

const WORKER_SRC = "/pdfjs/pdf.worker.min.mjs";

export interface PdfReaderProps {
  documentUid: string;
  page: number; // یک‌مبنا
  onPageCount: (n: number) => void;
  className?: string;
}

export function PdfReader({ documentUid, page, onPageCount, className }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfRef = useRef<PdfDoc | null>(null);
  const onPageCountRef = useRef(onPageCount);

  const [numPages, setNumPages] = useState(0);
  const [docProgress, setDocProgress] = useState<number>(0);
  const [docError, setDocError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [containerW, setContainerW] = useState(0);
  /** PDF رمزدار منبع — پیام روشن، بدون ورود دستی گذرواژه */
  const [locked, setLocked] = useState(false);

  /* تغییر سند: بازنشانی وضعیت در همان رندر (بدون setState در effect) */
  const [stateUid, setStateUid] = useState(documentUid);
  if (stateUid !== documentUid) {
    setStateUid(documentUid);
    setDocError(null);
    setDocProgress(0);
    setNumPages(0);
    setRenderError(false);
    setLocked(false);
  }

  useEffect(() => {
    onPageCountRef.current = onPageCount;
  });

  /* بارگذاری ماژول + سند (برای هر سند یک‌بار؛ لغو و destroy در تغییر سند) */
  useEffect(() => {
    let cancelled = false;
    let loadingTask: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;
    (async () => {
      try {
        const pdfjs: PdfModule = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
        if (cancelled) return;
        loadingTask = pdfjs.getDocument({
          url: mediaFileUrl(documentUid),
          withCredentials: true,
        });
        loadingTask.onProgress = ({ loaded, total }) => {
          if (!cancelled && total > 0) {
            setDocProgress(Math.min(100, Math.round((loaded / total) * 100)));
          }
        };
        const doc = await loadingTask.promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        pdfRef.current = doc;
        setNumPages(doc.numPages);
        onPageCountRef.current(doc.numPages);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === "PasswordException") {
          setLocked(true);
          return;
        }
        setDocError(
          "بارگیری نسخهٔ اسکن‌شده ناموفق بود؛ فایل منبع در دسترس نیست یا آسیب دیده است.",
        );
      }
    })();
    return () => {
      cancelled = true;
      if (loadingTask) loadingTask.destroy();
      pdfRef.current = null;
    };
  }, [documentUid, reloadKey]);

  /* اندازهٔ ظرف برای fit-width */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* رندر صفحهٔ جاری */
  useEffect(() => {
    const doc = pdfRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || containerW <= 0 || numPages === 0) return;
    let cancelled = false;
    let task: import("pdfjs-dist").RenderTask | null = null;
    (async () => {
      try {
        const p = await doc.getPage(Math.min(Math.max(page, 1), numPages));
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const base = p.getViewport({ scale: 1 });
        const scale = ((containerW - 12) / base.width) * zoom;
        const viewport = p.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        setRenderError(false);
        task = p.render({ canvasContext: ctx, viewport });
        await task.promise;
      } catch (err) {
        if (
          !cancelled &&
          !(err instanceof Error && err.name === "RenderingCancelledException")
        ) {
          setRenderError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (task) task.cancel();
    };
  }, [page, containerW, zoom, numPages]);

  const zoomStep = useCallback((dir: 1 | -1) => {
    setZoom((z) => Math.min(4, Math.max(0.5, Math.round((z + dir * 0.25) * 100) / 100)));
  }, []);

  if (locked) {
    return (
      <div className={cn("flex h-full w-full items-center justify-center p-8", className)}>
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <LockKeyhole className="size-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">نسخهٔ اسکن‌شدهٔ این جلد هنوز آمادهٔ نمایش نیست.</p>
          <p className="text-xs leading-6 text-muted-foreground">
            فایل اصلی منبع با قفل ناشر منتشر شده است؛ پس از تهیهٔ نسخهٔ آزاد، همین‌جا بدون
            هیچ پیام اضافه‌ای نمایش داده می‌شود.
          </p>
        </div>
      </div>
    );
  }

  if (docError) {
    return (
      <div className={cn("flex h-full w-full items-center justify-center p-8", className)}>
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <FileWarning className="size-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm leading-6 text-muted-foreground">{docError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDocError(null);
              setReloadKey((k) => k + 1);
            }}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            تلاش دوباره
          </Button>
        </div>
      </div>
    );
  }

  const loading = numPages === 0;

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", className)}>
      {/* نوار زوم */}
      <div className="flex shrink-0 items-center justify-center gap-1 border-b border-border bg-chrome/95 px-3 py-1 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="کوچک‌نمایی"
          title="کوچک‌نمایی"
          disabled={loading || zoom <= 0.5}
          onClick={() => zoomStep(-1)}
        >
          <Minus className="size-4" aria-hidden="true" />
        </Button>
        <span
          className="min-w-16 text-center text-xs text-muted-foreground"
          aria-live="polite"
        >
          {loading ? (
            "…"
          ) : (
            `${faNum(Math.round(zoom * 100))}٪`
          )}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="بزرگ‌نمایی"
          title="بزرگ‌نمایی"
          disabled={loading || zoom >= 4}
          onClick={() => zoomStep(1)}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="اندازهٔ متناسب با عرض"
          title="اندازهٔ متناسب با عرض"
          disabled={loading || zoom === 1}
          onClick={() => setZoom(1)}
        >
          <ZoomIn className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {/* ظرف اسکرول + canvas */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto bg-muted/40 px-1.5 py-3"
        dir="ltr"
      >
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">در حال بارگیری نسخهٔ اسکن‌شده…</p>
            {docProgress > 0 && (
              <Progress value={docProgress} className="w-56" aria-label="پیشرفت بارگیری" />
            )}
          </div>
        ) : (
          <div className="flex justify-center">
            <canvas
              ref={canvasRef}
              className="max-w-full rounded-sm bg-white shadow-md"
              aria-label={`صفحهٔ ${faNum(page)} نسخهٔ اسکن‌شده`}
            />
          </div>
        )}
        {renderError && !loading && (
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-destructive">
            <span>رندر این صفحه ناموفق بود.</span>
            <Button variant="ghost" size="sm" onClick={() => setRenderError(false)}>
              بستن
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
