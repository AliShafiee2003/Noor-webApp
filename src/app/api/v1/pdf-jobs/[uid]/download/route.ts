import type { NextRequest } from "next/server";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { goFetch, resolveGoUser, unauthorized } from "@/lib/bff-auth";
import { PDF_EXPORT_DIR, failPdfJob } from "@/lib/pdf-jobs-runner";
import type { PdfJob } from "@/lib/types";

/**
 * دانلود خصوصی خروجی PDF (§۷-الف-۲) — ج-۷:
 * - احراز مالکیت از GET /pdf-jobs/{uid} سامانهٔ Go با کوکی کاربر (فقط مالک توکن را می‌بیند)؛
 *   غیرمالک/ناموجود → همان 404 فارسی Go. منقضی/نامعتبر → 410/403 با پیام دقیق قبلی.
 * - فایل روی دیسک سمت Next نوشته می‌شود (PDF_EXPORT_DIR/{uid}.pdf) و همین‌جا سرو می‌شود؛
 *   فایل غایب → کار مردود اعلام و 500 فارسی برمی‌گردد.
 */
export const dynamic = "force-dynamic";

function apiError(status: number, code: string, message: string, retryable = false): Response {
  return Response.json(
    { error: { code, message, trace_id: null, retryable } },
    { status },
  );
}

/** ساخت نام فایل ایمن: fallback اسکی + filename* یونیکد فارسی */
function contentDisposition(faName: string): string {
  const asciiFallback = "book-export.pdf";
  const encoded = encodeURIComponent(faName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function safeFileNamePart(input: string): string {
  return input
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ uid: string }> },
): Promise<Response> {
  const cookie = req.headers.get("cookie");
  const user = await resolveGoUser(cookie);
  if (!user) return unauthorized();

  const { uid } = await ctx.params;

  /* احراز مالکیت/توکن از رکورد Go — غیرمالک یا ناموجود همان پاسخ Go (404) */
  const resp = await goFetch(`/pdf-jobs/${encodeURIComponent(uid)}`, { cookie });
  if (!resp.ok) {
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { "content-type": resp.headers.get("content-type") ?? "application/json" },
    });
  }
  const job = (await resp.json()) as PdfJob & { download_token?: string | null };

  if (job.status !== "done") {
    return apiError(
      409,
      "invalid_query",
      job.status === "failed"
        ? "این کار ناموفق بوده است؛ خروجی تازه بگیرید."
        : "خروجی هنوز آماده نیست؛ پس از پایان کار دوباره تلاش کنید.",
    );
  }

  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!job.download_token || token !== job.download_token) {
    return apiError(403, "forbidden", "توکن دانلود معتبر نیست.");
  }
  if (!job.token_expires_at || Date.parse(job.token_expires_at) <= Date.now()) {
    return apiError(410, "gone", "لینک دانلود منقضی شده است؛ خروجی تازه بگیرید.");
  }

  const filePath = path.join(PDF_EXPORT_DIR, `${uid}.pdf`);
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch {
    // فایل از دست رفته → کار مردود اعلام می‌شود (رکورد سمت Go)
    await failPdfJob(uid, "فایل خروجی روی دیسک یافت نشد؛ خروجی تازه بگیرید.");
    try {
      rmSync(filePath, { force: true });
    } catch {
      /* بی‌اهمیت */
    }
    return apiError(500, "internal", "فایل خروجی در دسترس نیست؛ خروجی تازه بگیرید.");
  }

  const title = safeFileNamePart(job.work_title || job.document_label || "کتاب");
  const fmt = new Intl.DateTimeFormat("fa-IR-u-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const finishedMs = job.finished_at ? Date.parse(job.finished_at) : NaN;
  const date = fmt.format(Number.isNaN(finishedMs) ? new Date() : new Date(finishedMs));
  const faName = `کتاب-${title}-${date}.pdf`;

  const bytes = new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buf.length),
      "Content-Disposition": contentDisposition(faName),
      "Cache-Control": "private, no-store",
    },
  });
}
