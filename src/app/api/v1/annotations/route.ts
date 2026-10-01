import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveGoUser, unauthorized } from "@/lib/bff-auth";
import { isHighlightColor } from "@/lib/highlight-color";
import type { Highlight, HighlightColor } from "@/lib/types";

/**
 * هایلایت‌های شخصی کاربر (§۷-الف-۳) — لایهٔ BFF با نگاشت به Prisma.
 * GET  ?document_uid= → فهرست هایلایت‌های همان کاربر روی سند (قدیمی→جدید)
 * POST { document_uid, page_uid, block_id, start, end, text, color? } → ساخت هایلایت
 *
 * هویت از نشست سامانهٔ Go resolve می‌شود؛ بدون نشست معتبر همهٔ مسیرها 401 می‌دهند
 * و ردیف‌ها همیشه با userUid همین نشست قید می‌شوند (SEC — دادهٔ خصوصی).
 */

export const dynamic = "force-dynamic";

/** بازهٔ مجاز لنگر هایلایت — code point درون بلوک */
const MAX_CP = 20_000;
/** سقف نرم متن هایلایت — در سرور بریده می‌شود (بدون خطا) */
const MAX_TEXT_LEN = 4_000;

function mapHighlight(row: {
  id: string;
  documentUid: string;
  pageUid: string;
  blockId: string;
  startCp: number;
  endCp: number;
  text: string;
  color: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Highlight {
  return {
    uid: row.id,
    document_uid: row.documentUid,
    page_uid: row.pageUid,
    block_id: row.blockId,
    start: row.startCp,
    end: row.endCp,
    text: row.text,
    color: (isHighlightColor(row.color) ? row.color : "yellow") as HighlightColor,
    note: row.note,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function errJson(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, trace_id: null, retryable: false } },
    { status },
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const goUser = await resolveGoUser(req.headers.get("cookie"));
  if (!goUser) return unauthorized();

  const documentUid = req.nextUrl.searchParams.get("document_uid")?.trim() ?? "";
  if (!documentUid) {
    return errJson(422, "validation", "شناسهٔ سند لازم است.");
  }

  const rows = await db.highlight.findMany({
    where: { userUid: goUser.uid, documentUid },
    orderBy: { createdAt: "asc" },
  });

  return Response.json({ items: rows.map(mapHighlight) });
}

export async function POST(req: NextRequest): Promise<Response> {
  const goUser = await resolveGoUser(req.headers.get("cookie"));
  if (!goUser) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "bad_request", "بدنهٔ درخواست نامعتبر است.");
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const documentUid = typeof b.document_uid === "string" ? b.document_uid.trim() : "";
  const pageUid = typeof b.page_uid === "string" ? b.page_uid.trim() : "";
  const blockId = typeof b.block_id === "string" ? b.block_id.trim() : "";
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!documentUid || !pageUid || !blockId || !text) {
    return errJson(422, "validation", "همهٔ بخش‌های هایلایت (سند، صفحه، بلوک و متن) لازم است.");
  }

  const { start, end } = b as { start?: unknown; end?: unknown };
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end)
  ) {
    return errJson(422, "validation", "بازهٔ هایلایت باید دو عدد صحیح باشد.");
  }
  if (start < 0 || start >= end || end > MAX_CP) {
    return errJson(422, "validation", "بازهٔ هایلایت نامعتبر است (۰ ≤ ابتدا < انتها ≤ ۲۰٬۰۰۰).");
  }

  const colorRaw = typeof b.color === "string" ? b.color : "";
  const color = isHighlightColor(colorRaw) ? colorRaw : "yellow";

  const row = await db.highlight.create({
    data: {
      userUid: goUser.uid,
      documentUid,
      pageUid,
      blockId,
      startCp: start,
      endCp: end,
      text: text.slice(0, MAX_TEXT_LEN),
      color,
    },
  });

  return Response.json(mapHighlight(row), { status: 201 });
}
