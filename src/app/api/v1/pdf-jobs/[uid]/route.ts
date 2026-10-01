import type { NextRequest } from "next/server";
import { forwardToGo, resolveGoUser, unauthorized } from "@/lib/bff-auth";

/**
 * وضعیت یک کار خروجی PDF (§۷-الف-۲) — ج-۷: فقط پروکسی خالص به Go.
 * فقط مالک (وگرنه 404 فارسی سمت Go). پاسخ Go برای مالک شامل download_token و
 * token_expires_at نیز هست تا مسیر دانلود همین‌جا منطق 403/410 را اجرا کند.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!(await resolveGoUser(cookie))) return unauthorized();
  return forwardToGo(req, { cookie });
}
