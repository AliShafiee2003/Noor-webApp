import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { goFetch, resolveGoUser, unauthorized } from "@/lib/bff-auth";
import {
  countActivePdfJobs,
  countActivePdfJobsForUser,
  mapPdfJobRow,
  normalizeDigits,
  reapStalePdfJobs,
  runPdfJob,
} from "@/lib/pdf-jobs-runner";

/**
 * BFF کارهای خروجی PDF (§۷-الف-۲):
 * - POST: ایجاد کار پس‌زمینه‌ای ساخت PDF (سقف هم‌زمانی: ۲ کار سراسری، ۱ کار هر کاربر).
 * - GET: فهرست ۲۰ کار آخر کاربر جاری با لینک دانلود خصوصیِ منقضی‌شدنی.
 * کوکی کاربر فقط برای فراخوانی سرویس Go استفاده می‌شود و هرگز ذخیره نمی‌شود.
 */
export const dynamic = "force-dynamic";

function apiError(status: number, code: string, message: string, retryable = false): Response {
  return Response.json(
    { error: { code, message, trace_id: null, retryable } },
    { status },
  );
}

/** تطبیق برچسب چاپی با نرمال‌سازی ارقام فارسی/عربی و لاتین */
function indexOfLabel(
  items: Array<{ page_uid: string; label: string; serial: number | null; num?: string | null }>,
  label: string,
): number {
  const needle = normalizeDigits(label.trim());
  return items.findIndex(
    (it) =>
      normalizeDigits((it.label ?? "").trim()) === needle ||
      (it.num ? normalizeDigits(it.num.trim()) === needle : false),
  );
}

/* ---------- POST: ایجاد کار خروجی ---------- */

export async function POST(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  const user = await resolveGoUser(cookie);
  if (!user) return unauthorized();

  let body: {
    document_uid?: unknown;
    from?: unknown;
    to?: unknown;
    include_notes?: unknown;
    document_label?: unknown;
    work_title?: unknown;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError(422, "invalid_query", "بدنهٔ درخواست معتبر نیست.");
  }

  const documentUid = typeof body.document_uid === "string" ? body.document_uid.trim() : "";
  if (!documentUid) {
    return apiError(422, "invalid_query", "شناسهٔ سند الزامی است.");
  }

  const from = typeof body.from === "string" && body.from.trim() ? body.from.trim() : null;
  const to = typeof body.to === "string" && body.to.trim() ? body.to.trim() : null;
  if ((from && !to) || (!from && to)) {
    return apiError(
      422,
      "invalid_query",
      "برای بازهٔ صفحهٔ چاپی، هر دو مقدار «از صفحهٔ» و «تا صفحهٔ» لازم است.",
    );
  }

  /* اعتبارسنجی سند و برچسب‌های بازه از خود سامانهٔ Go */
  const pagesResp = await goFetch(
    `/documents/${encodeURIComponent(documentUid)}/pages?page_size=500`,
    { cookie },
  );
  if (!pagesResp.ok) {
    const text = await pagesResp.text();
    return new Response(text || JSON.stringify({
      error: { code: "not_found", message: "سند درخواستی یافت نشد.", trace_id: null, retryable: false },
    }), {
      status: pagesResp.status,
      headers: {
        "content-type": pagesResp.headers.get("content-type") ?? "application/json",
      },
    });
  }
  const pagesData = (await pagesResp.json()) as {
    items?: Array<{ page_uid: string; label: string; serial: number | null; num?: string | null }>;
  };
  const items = pagesData.items ?? [];

  if (from && to) {
    const fromIdx = indexOfLabel(items, from);
    const toIdx = indexOfLabel(items, to);
    if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
      return apiError(422, "invalid_query", "بازهٔ صفحهٔ چاپی معتبر نیست.");
    }
  }

  /* بازیافت کارهای گیرکرده + سقف هم‌زمانی (PRD: «سقف هم‌زمانی») */
  await reapStalePdfJobs();
  const activeGlobal = await countActivePdfJobs();
  if (activeGlobal >= 2) {
    return apiError(
      429,
      "rate_limited",
      "کار سنگین دیگری در حال اجراست؛ پس از پایان آن دوباره تلاش کنید.",
      true,
    );
  }
  const activeUser = await countActivePdfJobsForUser(user.uid);
  if (activeUser > 0) {
    return apiError(
      429,
      "rate_limited",
      "شما یک کار خروجی در حال اجرا دارید.",
      true,
    );
  }

  /* برچسب نمایشی سند — از بدنه به‌عنوان پیش‌فرض؛ در اجرای کار از کاتالوگ کامل می‌شود */
  const documentLabel =
    typeof body.document_label === "string" && body.document_label.trim()
      ? body.document_label.trim().slice(0, 200)
      : documentUid;
  const workTitle =
    typeof body.work_title === "string" && body.work_title.trim()
      ? body.work_title.trim().slice(0, 200)
      : null;

  const paramsJson = JSON.stringify({
    from,
    to,
    whole: !from && !to,
    include_notes: body.include_notes === true,
  });

  const row = await db.pdfJob.create({
    data: {
      userUid: user.uid,
      documentUid,
      documentLabel,
      workTitle,
      paramsJson,
      status: "queued",
      progress: 0,
      downloadToken: randomUUID(),
    },
  });

  /* اجرای پس‌زمینه‌ای — نگه‌داشتن کوکی فقط در حافظهٔ همین فراخوانی */
  void runPdfJob(row.id, cookie);

  return Response.json({ uid: row.id }, { status: 202 });
}

/* ---------- GET: فهرست کارهای من ---------- */

export async function GET(req: NextRequest): Promise<Response> {
  const cookie = req.headers.get("cookie");
  const user = await resolveGoUser(cookie);
  if (!user) return unauthorized();

  await reapStalePdfJobs();
  const rows = await db.pdfJob.findMany({
    where: { userUid: user.uid },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return Response.json({ items: rows.map(mapPdfJobRow) });
}
