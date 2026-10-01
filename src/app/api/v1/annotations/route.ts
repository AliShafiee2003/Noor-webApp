import type { NextRequest } from "next/server";
import { forwardToGo, readJsonBody, resolveGoUser, unauthorized } from "@/lib/bff-auth";

/**
 * هایلایت‌های شخصی کاربر (§۷-الف-۳) — ج-۷: مالک داده Go API است (app.sqlite)
 * و این مسیر فقط پروکسی خالص BFF است؛ قرارداد JSON، کدهای خطا و پیام‌های فارسی
 * عیناً از سامانهٔ Go برمی‌گردد. بدون نشست معتبر → 401 سریع همین‌جا.
 * GET  ?document_uid= → فهرست هایلایت‌های همان کاربر (قدیمی→جدید)
 * POST { document_uid, page_uid, block_id, start, end, text, color? } → 201 Highlight
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!(await resolveGoUser(cookie))) return unauthorized();
  return forwardToGo(req, { cookie });
}

export async function POST(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!(await resolveGoUser(cookie))) return unauthorized();
  return forwardToGo(req, { cookie, body: await readJsonBody(req) });
}
