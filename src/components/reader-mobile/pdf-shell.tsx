/**
 * پوستهٔ PDF در ریدر موبایل — بارگذار پویا + بندانگشتی کاروسل پیش‌نمایش.
 * اثر تم روی canvas از CSS انجام می‌شود؛ PdfReader دست نمی‌خورد.
 */
"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { mediaFileUrl } from "@/lib/api";

export const PdfReaderDynamic = dynamic(
  () => import("@/components/reader/pdf-reader").then((m) => m.PdfReader),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="size-5 animate-spin" style={{ color: "var(--sec)" }} aria-hidden="true" />
      </div>
    ),
  },
);

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;

/* یک سند مشترک برای همهٔ بندانگشتی‌ها — کارت‌ها یکی‌یکی رندر می‌شوند تا پردازنده خفه نشود */
let shared: { uid: string; promise: Promise<PdfDoc> } | null = null;
function sharedDoc(uid: string): Promise<PdfDoc> {
  if (shared?.uid === uid) return shared.promise;
  const promise = (async () => {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return pdfjs.getDocument({ url: mediaFileUrl(uid), withCredentials: true }).promise;
  })();
  shared = { uid, promise };
  promise.catch(() => {
    if (shared?.promise === promise) shared = null;
  });
  return promise;
}

let queue: Promise<unknown> = Promise.resolve();

export function PdfThumb({
  documentUid,
  page,
  width = 92,
}: {
  documentUid: string;
  page: number;
  width?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    queue = queue
      .then(async () => {
        if (cancelled) return;
        const doc = await sharedDoc(documentUid);
        const p = await doc.getPage(page);
        if (cancelled) return;
        const canvas = ref.current;
        if (!canvas) return;
        const base = p.getViewport({ scale: 1 });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const viewport = p.getViewport({ scale: (width / base.width) * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await p.render({ canvasContext: ctx, viewport }).promise;
      })
      .catch(() => {
        /* کارت اسکلتون می‌ماند */
      });
    return () => {
      cancelled = true;
    };
  }, [documentUid, page, width]);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}
