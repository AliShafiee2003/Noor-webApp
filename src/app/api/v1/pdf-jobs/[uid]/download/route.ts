import type { NextRequest } from "next/server";
import { readFileSync, rmSync } from "node:fs";
import { db } from "@/lib/db";
import { resolveGoUser, unauthorized } from "@/lib/bff-auth";

/**
 * دانلود خصوصی خروجی PDF (§۷-الف-۲):
 * - فقط مالک کار؛ فقط وقتی کار done است؛ فقط با توکن معتبر و منقضی‌نشده (۲۴ ساعت).
 * - فایل از دیسک خوانده و با Content-Disposition مناسب فارسی برمی‌گردد.
 * - توکن منقضی یا نامعتبر → 410/403 با پیام فارسی.
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
  const row = await db.pdfJob.findUnique({ where: { id: uid } });
  if (!row || row.userUid !== user.uid) {
    return apiError(404, "not_found", "کار خروجی یافت نشد.");
  }

  if (row.status !== "done") {
    return apiError(
      409,
      "invalid_query",
      row.status === "failed"
        ? "این کار ناموفق بوده است؛ خروجی تازه بگیرید."
        : "خروجی هنوز آماده نیست؛ پس از پایان کار دوباره تلاش کنید.",
    );
  }

  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!row.downloadToken || token !== row.downloadToken) {
    return apiError(403, "forbidden", "توکن دانلود معتبر نیست.");
  }
  if (!row.tokenExpiresAt || row.tokenExpiresAt.getTime() <= Date.now()) {
    return apiError(410, "gone", "لینک دانلود منقضی شده است؛ خروجی تازه بگیرید.");
  }

  if (!row.filePath) {
    return apiError(500, "internal", "فایل خروجی در دسترس نیست؛ خروجی تازه بگیرید.");
  }

  let buf: Buffer;
  try {
    buf = readFileSync(row.filePath);
  } catch {
    // فایل از دست رفته → کار مردود اعلام می‌شود
    await db.pdfJob
      .update({
        where: { id: row.id },
        data: {
          status: "failed",
          statusNote: "فایل خروجی روی دیسک یافت نشد؛ خروجی تازه بگیرید.",
        },
      })
      .catch(() => undefined);
    try {
      rmSync(row.filePath, { force: true });
    } catch {
      /* بی‌اهمیت */
    }
    return apiError(500, "internal", "فایل خروجی در دسترس نیست؛ خروجی تازه بگیرید.");
  }

  const title = safeFileNamePart(row.workTitle || row.documentLabel || "کتاب");
  const date = row.finishedAt
    ? new Intl.DateTimeFormat("fa-IR-u-nu-latn", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(row.finishedAt)
    : new Intl.DateTimeFormat("fa-IR-u-nu-latn", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
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
