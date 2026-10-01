import type { NextRequest } from "next/server";
import { forwardToGo, readJsonBody, resolveGoUser, unauthorized } from "@/lib/bff-auth";

/**
 * ویرایش/حذف هایلایت شخصی (§۷-الف-۳) — ج-۷: فقط پروکسی خالص به Go؛ مالک داده
 * و منطق 404/422 در سامانهٔ Go است (فقط مالک؛ نبودِ مالک یا ردیف هر دو 404).
 * PATCH { color?, note? } و DELETE → 204
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!(await resolveGoUser(cookie))) return unauthorized();
  return forwardToGo(req, { cookie, body: await readJsonBody(req) });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!(await resolveGoUser(cookie))) return unauthorized();
  return forwardToGo(req, { cookie });
}
