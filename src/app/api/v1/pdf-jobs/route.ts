import type { NextRequest } from "next/server";
import { goFetch, forwardToGo, readJsonBody, resolveGoUser, unauthorized } from "@/lib/bff-auth";
import { runPdfJob } from "@/lib/pdf-jobs-runner";

/**
 * کارهای خروجی PDF (§۷-الف-۲) — ج-۷: رکورد کار فقط در Go (app.sqlite) است.
 * POST: اعتبارسنجی سند/بازه، سقف هم‌زمانی (۲ سراسری/۱ کاربری) و توکن دانلود همه
 * سمت Go انجام می‌شود؛ پاسخ 202 {uid} همان‌جا می‌آید و این‌جا فقط اجرای
 * پس‌زمینه‌ای runner آغاز می‌شود (کوکی فقط در حافظهٔ همین فراخوانی).
 * GET: فهرست ۲۰ کار آخر من با download_url فقط برای done با توکن زنده.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!(await resolveGoUser(cookie))) return unauthorized();

  const resp = await goFetch("/pdf-jobs", {
    method: "POST",
    cookie,
    body: await readJsonBody(req),
  });
  const text = await resp.text();

  /* اجرای پس‌زمینه‌ای — فقط پس از پذیرش کار توسط Go */
  if (resp.status === 202) {
    try {
      const data = JSON.parse(text) as { uid?: string };
      if (data?.uid) void runPdfJob(data.uid, cookie);
    } catch {
      /* پاسخ نامعتبر — اجرایی نیست */
    }
  }

  return new Response(text, {
    status: resp.status,
    headers: { "content-type": resp.headers.get("content-type") ?? "application/json" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!(await resolveGoUser(cookie))) return unauthorized();
  return forwardToGo(req, { cookie });
}
