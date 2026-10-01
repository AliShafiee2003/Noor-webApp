import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveGoUser, unauthorized } from "@/lib/bff-auth";
import { mapPdfJobRow, reapStalePdfJobs } from "@/lib/pdf-jobs-runner";

/**
 * BFF وضعیت یک کار خروجی PDF (§۷-الف-۲) — فقط برای مالک کار.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ uid: string }> },
): Promise<Response> {
  const cookie = _req.headers.get("cookie");
  const user = await resolveGoUser(cookie);
  if (!user) return unauthorized();

  const { uid } = await ctx.params;
  await reapStalePdfJobs();

  const row = await db.pdfJob.findUnique({ where: { id: uid } });
  if (!row || row.userUid !== user.uid) {
    return Response.json(
      {
        error: {
          code: "not_found",
          message: "کار خروجی یافت نشد.",
          trace_id: null,
          retryable: false,
        },
      },
      { status: 404 },
    );
  }

  return Response.json(mapPdfJobRow(row));
}
