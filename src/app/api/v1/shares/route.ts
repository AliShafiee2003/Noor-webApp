import type { NextRequest } from "next/server";
import { forwardToGo, readJsonBody, resolveGoUser, unauthorized } from "@/lib/bff-auth";

/**
 * اشتراک‌گذاری لینک یادداشت/هایلایت (§۷-الف-۳) — ج-۷: فقط پروکسی خالص به Go.
 * GET  → فهرست اشتراک‌های فعالِ همین کاربر (جدید→قدیم) با excerpt و url_path
 * POST { kind, item_id, document_uid, page_uid?, page_label?, work_title?, payload, meta? }
 * هویت دارنده (owner_name) فقط سمت Go از نشست سرور ثبت می‌شود — هرگز از کلاینت.
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
