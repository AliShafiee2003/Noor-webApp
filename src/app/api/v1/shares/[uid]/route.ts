import type { NextRequest } from "next/server";
import { forwardToGo, resolveGoUser, unauthorized } from "@/lib/bff-auth";

/**
 * حل کردن/لغو لینک اشتراک (§۷-الف-۳) — ج-۷: فقط پروکسی خالص به Go.
 * GET    /shares/{uid} → SharedItem برای هر کاربر واردشده (لغو/ناموجود → 410)
 * DELETE /shares/{uid} → لغو — فقط مالک → 204 (غیرمالک/ناموجود → 404 همان BFF)
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!(await resolveGoUser(cookie))) return unauthorized();
  return forwardToGo(req, { cookie });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!(await resolveGoUser(cookie))) return unauthorized();
  return forwardToGo(req, { cookie });
}
