import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveGoUser, unauthorized } from "@/lib/bff-auth";
import { isHighlightColor } from "@/lib/highlight-color";
import type { Highlight, HighlightColor } from "@/lib/types";

/**
 * ویرایش/حذف هایلایت شخصی (§۷-الف-۳) — فقط مالک هایلایت.
 * PATCH { color?, note? } → تغییر رنگ یا یادداشتِ هایلایت
 * DELETE → حذف قطعی (بدون سطل بازیافت)
 *
 * برای جلوگیری از افشای وجود ردیف، «نبودِ مالک یا ردیف» هر دو 404 می‌دهند.
 */

export const dynamic = "force-dynamic";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
): Promise<Response> {
  const goUser = await resolveGoUser(req.headers.get("cookie"));
  if (!goUser) return unauthorized();
  const { uid } = await params;

  const row = await db.highlight.findUnique({ where: { id: uid } });
  if (!row || row.userUid !== goUser.uid) {
    return errJson(404, "not_found", "هایلایت مورد نظر یافت نشد.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "bad_request", "بدنهٔ درخواست نامعتبر است.");
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const data: { color?: string; note?: string | null } = {};
  if (b.color !== undefined) {
    const colorRaw = typeof b.color === "string" ? b.color : "";
    if (!isHighlightColor(colorRaw)) {
      return errJson(422, "validation", "رنگ انتخابی مجاز نیست.");
    }
    data.color = colorRaw;
  }
  if (b.note !== undefined) {
    if (b.note === null) {
      data.note = null;
    } else if (typeof b.note === "string") {
      data.note = b.note.slice(0, 4_000);
    } else {
      return errJson(422, "validation", "یادداشت باید متن باشد.");
    }
  }
  if (Object.keys(data).length === 0) {
    return errJson(422, "validation", "چیزی برای تغییر ارسال نشده است.");
  }

  const updated = await db.highlight.update({ where: { id: uid }, data });
  return Response.json(mapHighlight(updated));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
): Promise<Response> {
  const goUser = await resolveGoUser(req.headers.get("cookie"));
  if (!goUser) return unauthorized();
  const { uid } = await params;

  const row = await db.highlight.findUnique({ where: { id: uid } });
  if (!row || row.userUid !== goUser.uid) {
    return errJson(404, "not_found", "هایلایت مورد نظر یافت نشد.");
  }

  await db.highlight.delete({ where: { id: uid } });
  return new Response(null, { status: 204 });
}
