import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveGoUser, unauthorized } from "@/lib/bff-auth";
import type { HighlightColor, SharedItem } from "@/lib/types";

/**
 * حل کردن لینک اشتراک (§۷-الف-۳) — هر کاربر واردشدهٔ سامانه اجازهٔ دیدن دارد.
 * GET    /shares/{uid} → SharedItem (لغو/انقضا → 410 با پیام فارسی)
 * DELETE /shares/{uid} → لغو اشتراک — فقط مالک؛ 204
 */

export const dynamic = "force-dynamic";

function errJson(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, trace_id: null, retryable: false } },
    { status },
  );
}

/** خواندن امن meta ذخیره‌شده — خرابی JSON هرگز مسیر را نمی‌شکند */
function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
): Promise<Response> {
  const goUser = await resolveGoUser(req.headers.get("cookie"));
  if (!goUser) return unauthorized();
  const { uid } = await params;

  const row = await db.shareLink.findUnique({ where: { id: uid } });
  if (!row || row.revoked) {
    return errJson(410, "gone_cursor", "این اشتراک لغو شده یا وجود ندارد.");
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return errJson(410, "gone_cursor", "این اشتراک منقضی شده است.");
  }

  const meta = parseMeta(row.meta);
  const ownerName = typeof meta.owner_name === "string" ? meta.owner_name : "";

  const item: SharedItem = {
    kind: row.kind === "note" ? "note" : "highlight",
    owner_name: ownerName,
    document_uid: row.documentUid,
    page_uid: row.pageUid,
    page_label: row.pageLabel,
    work_title: row.workTitle,
    payload: row.payload,
    meta: {
      color: typeof meta.color === "string" ? (meta.color as HighlightColor) : undefined,
      start: typeof meta.start === "number" ? meta.start : undefined,
      end: typeof meta.end === "number" ? meta.end : undefined,
      block_id: typeof meta.block_id === "string" ? meta.block_id : undefined,
      revayat_index: typeof meta.revayat_index === "string" ? meta.revayat_index : null,
    },
    created_at: row.createdAt.toISOString(),
  };

  return Response.json(item);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
): Promise<Response> {
  const goUser = await resolveGoUser(req.headers.get("cookie"));
  if (!goUser) return unauthorized();
  const { uid } = await params;

  const row = await db.shareLink.findUnique({ where: { id: uid } });
  if (!row || row.userUid !== goUser.uid) {
    return errJson(404, "not_found", "اشتراک مورد نظر یافت نشد.");
  }

  await db.shareLink.update({
    where: { id: uid },
    data: { revoked: true, revokedAt: new Date() },
  });
  return new Response(null, { status: 204 });
}
