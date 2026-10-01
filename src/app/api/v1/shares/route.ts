import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveGoUser, unauthorized } from "@/lib/bff-auth";
import type { ShareLinkInfo } from "@/lib/types";

/**
 * اشتراک‌گذاری لینک یادداشت/هایلایت (§۷-الف-۳) — لایهٔ BFF با نگاشت به Prisma.
 * GET  → فهرست اشتراک‌های فعالِ همین کاربر (جدید→قدیم)
 * POST { kind, item_id, document_uid, page_uid?, page_label?, work_title?, payload, meta? }
 *
 * امنیت (PRD): هویتِ دارنده فقط از نشست سرور گرفته می‌شود — owner_name هرگز از
 * کلاینت پذیرفته نمی‌شود و در meta ذخیره می‌گردد. لینک فقط برای کاربران واردشدهٔ
 * همین سامانه حل می‌شود (مسیر GET /shares/[uid]).
 */

export const dynamic = "force-dynamic";

/** سقف محتوای اشتراک — بیشتر از این 422 می‌دهد */
const MAX_PAYLOAD_LEN = 8_000;

function errJson(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, trace_id: null, retryable: false } },
    { status },
  );
}

/** مسیر hash-router کتاب‌خوان: #/read/<doc>?pg=<page>&shared=<uid> — بدون pg اگر صفحه ندارد */
function shareUrlPath(documentUid: string, pageUid: string | null | undefined, id: string): string {
  const params = new URLSearchParams();
  if (pageUid) params.set("pg", pageUid);
  params.set("shared", id);
  const qs = params.toString();
  return qs ? `#/read/${documentUid}?${qs}` : `#/read/${documentUid}`;
}

export async function GET(req: NextRequest): Promise<Response> {
  const goUser = await resolveGoUser(req.headers.get("cookie"));
  if (!goUser) return unauthorized();

  const rows = await db.shareLink.findMany({
    where: { userUid: goUser.uid, revoked: false },
    orderBy: { createdAt: "desc" },
  });

  const items: ShareLinkInfo[] = rows.map((r) => ({
    uid: r.id,
    kind: r.kind === "note" ? "note" : "highlight",
    document_uid: r.documentUid,
    page_uid: r.pageUid,
    page_label: r.pageLabel,
    work_title: r.workTitle,
    excerpt: r.payload.slice(0, 120),
    created_at: r.createdAt.toISOString(),
    expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
    url_path: shareUrlPath(r.documentUid, r.pageUid, r.id),
  }));

  return Response.json({ items });
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

  const kind = typeof b.kind === "string" ? b.kind : "";
  if (kind !== "note" && kind !== "highlight") {
    return errJson(422, "validation", "نوع اشتراک باید «note» یا «highlight» باشد.");
  }
  const itemId = typeof b.item_id === "string" ? b.item_id.trim() : "";
  const documentUid = typeof b.document_uid === "string" ? b.document_uid.trim() : "";
  if (!itemId || !documentUid) {
    return errJson(422, "validation", "شناسهٔ مورد و سند برای اشتراک لازم است.");
  }
  const payload = typeof b.payload === "string" ? b.payload.trim() : "";
  if (!payload) {
    return errJson(422, "validation", "محتوای اشتراک خالی است.");
  }
  if (payload.length > MAX_PAYLOAD_LEN) {
    return errJson(422, "validation", "محتوای اشتراک بیش از حد بلند است (سقف ۸٬۰۰۰ نویسه).");
  }

  const pageUid = typeof b.page_uid === "string" && b.page_uid.trim() !== "" ? b.page_uid.trim() : null;
  const pageLabel =
    typeof b.page_label === "string" && b.page_label.trim() !== "" ? b.page_label.trim() : null;
  const workTitle =
    typeof b.work_title === "string" && b.work_title.trim() !== "" ? b.work_title.trim() : null;

  /* هویت دارنده فقط از نشست سرور — ورودی meta کلاینت قابل اعتماد نیست */
  const clientMeta =
    b.meta !== undefined && b.meta !== null && typeof b.meta === "object" && !Array.isArray(b.meta)
      ? (b.meta as Record<string, unknown>)
      : {};
  const metaJson = JSON.stringify({ ...clientMeta, owner_name: goUser.display_name });

  const row = await db.shareLink.create({
    data: {
      userUid: goUser.uid,
      kind,
      itemId,
      documentUid,
      pageUid,
      pageLabel,
      workTitle,
      payload,
      meta: metaJson,
    },
  });

  return Response.json(
    { uid: row.id, url_path: shareUrlPath(row.documentUid, row.pageUid, row.id) },
    { status: 201 },
  );
}
