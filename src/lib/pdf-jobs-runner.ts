import "server-only";

/**
 * اجراکنندهٔ کارهای خروجی PDF (§۷-الف-۲) — فقط سمت سرور.
 *
 * - کار در DB (Prisma/PdfJob) پیگیری می‌شود؛ کوکی کاربر فقط در حافظهٔ
 *   همین فراخوانی زنده است و هرگز ذخیره نمی‌شود.
 * - پیشرفت: ۵ (شروع) → ۷۰ (واکشی صفحه‌ها) → ۸۰ (ساخت PDF) → ۱۰۰ (پایان).
 * - فایل خروجی خصوصی است: data/pdf-exports/{jobUid}.pdf و فقط با توکن
 *   منقضی‌شدنی (۲۴ ساعت) از مسیر دانلود بی‌نام قابل واکشی است.
 * - بازیافت تنبل: کارهای «running» بیش از ۳۰ دقیقه هنگام فهرست‌گیری مردود می‌شوند.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { goFetch } from "@/lib/bff-auth";
import { generateBookPdf } from "@/lib/pdf-export";
import type { PdfIncludeNote, PdfPageInput, PdfWorkInfo } from "@/lib/pdf-export";
import type { HighlightColor, PdfJob } from "@/lib/types";

export const PDF_EXPORT_DIR = "/home/z/my-project/data/pdf-exports";
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // ۲۴ ساعت
const STALE_RUNNING_MS = 30 * 60 * 1000; // ۳۰ دقیقه
const ACTIVE_STATUSES = ["queued", "running"] as const;

/* ---------- نرمال‌سازی ارقام فارسی/عربی ---------- */

/** تبدیل ارقام ۰-۹ فارسی/عربی به لاتین برای مقایسهٔ برچسب صفحه‌ها */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
}

/* ---------- پارامترهای کار ---------- */

export interface PdfJobParams {
  from: string | null;
  to: string | null;
  whole: boolean;
  include_notes: boolean;
}

export function parsePdfJobParams(raw: string | null | undefined): PdfJobParams | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PdfJobParams> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const from = typeof parsed.from === "string" && parsed.from.trim() ? parsed.from.trim() : null;
    const to = typeof parsed.to === "string" && parsed.to.trim() ? parsed.to.trim() : null;
    return {
      from,
      to,
      whole: parsed.whole === true || (!from && !to),
      include_notes: parsed.include_notes === true,
    };
  } catch {
    return null;
  }
}

/* ---------- نگاشت به شکل فرانت‌اند ---------- */

/** نگاشت ردیف DB به تایپ فرانت‌اند PdfJob — لینک دانلود فقط وقتی معتبر است */
export function mapPdfJobRow(row: {
  id: string;
  documentUid: string;
  documentLabel: string;
  workTitle: string | null;
  status: string;
  progress: number;
  statusNote: string | null;
  fileBytes: number | null;
  createdAt: Date;
  finishedAt: Date | null;
  downloadToken: string | null;
  tokenExpiresAt: Date | null;
  paramsJson: string;
}): PdfJob {
  const tokenLive =
    row.status === "done" &&
    !!row.downloadToken &&
    !!row.tokenExpiresAt &&
    row.tokenExpiresAt.getTime() > Date.now();
  return {
    uid: row.id,
    document_uid: row.documentUid,
    document_label: row.documentLabel,
    work_title: row.workTitle,
    status: row.status as PdfJob["status"],
    progress: row.progress,
    status_note: row.statusNote,
    file_bytes: row.fileBytes,
    created_at: row.createdAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    download_url:
      tokenLive && row.downloadToken
        ? `/api/v1/pdf-jobs/${row.id}/download?token=${encodeURIComponent(row.downloadToken)}`
        : null,
    token_expires_at: row.tokenExpiresAt ? row.tokenExpiresAt.toISOString() : null,
    params: parsePdfJobParams(row.paramsJson) ?? { from: null, to: null, whole: true, include_notes: false },
  };
}

/* ---------- بازیافت تنبل کارهای گیرکرده ---------- */

export async function reapStalePdfJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  try {
    await db.pdfJob.updateMany({
      where: { status: "running", createdAt: { lt: cutoff } },
      data: {
        status: "failed",
        statusNote: "کار بیش از حد طول کشید؛ دوباره تلاش کنید.",
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[pdf-jobs] reap failed:", err);
  }
}

/* ---------- رنگ‌های هایلایت برای متن یادداشت ---------- */

const COLOR_FA: Record<string, string> = {
  yellow: "زرد",
  green: "سبز",
  blue: "آبی",
  pink: "صورتی",
  orange: "نارنجی",
};

/* ---------- خطای معنادار فارسی از پاسخ Go ---------- */

async function goErrorMessage(resp: Response, fallback: string): Promise<string> {
  try {
    const data = (await resp.json()) as { error?: { message?: string } };
    if (data?.error?.message) return data.error.message;
  } catch {
    /* بدنهٔ غیر JSON */
  }
  return fallback;
}

/* ---------- حل اثرِ والد (به‌صورت بهترین تلاش) ---------- */

interface WorkResolution {
  work: PdfWorkInfo | null;
  workUid: string | null;
  workTitle: string | null;
  documentLabel: string | null;
}

async function resolveWork(documentUid: string, cookie: string | null): Promise<WorkResolution> {
  const empty: WorkResolution = { work: null, workUid: null, workTitle: null, documentLabel: null };
  try {
    const resp = await goFetch("/works?page_size=100", { cookie });
    if (!resp.ok) return empty;
    const data = (await resp.json()) as { items?: Array<{ uid: string }> };
    const works = data.items ?? [];
    for (const w of works.slice(0, 20)) {
      const detailResp = await goFetch(`/works/${encodeURIComponent(w.uid)}`, { cookie });
      if (!detailResp.ok) continue;
      const detail = (await detailResp.json()) as {
        title?: string;
        author?: string | null;
        publisher?: string | null;
        year?: string | null;
        language?: string | null;
        documents?: Array<{ uid: string; label: string }>;
      };
      const doc = (detail.documents ?? []).find((d) => d.uid === documentUid);
      if (doc) {
        return {
          work: {
            title: detail.title ?? "",
            author: detail.author ?? null,
            publisher: detail.publisher ?? null,
            year: detail.year ?? null,
            language: detail.language ?? null,
          },
          workUid: w.uid,
          workTitle: detail.title ?? null,
          documentLabel: doc.label || null,
        };
      }
    }
  } catch (err) {
    console.error("[pdf-jobs] resolveWork failed:", err);
  }
  return empty;
}

/* ---------- اجرای کار ---------- */

/**
 * اجرای کامل یک کار PDF: واکشی صفحه‌ها از سامانهٔ Go، جمع یادداشت‌ها/هایلایت‌ها،
 * ساخت PDF و ثبت نتیجه. کوکی فقط در همین فراخوانی زنده است.
 * هر خطا → status=failed با پیام فارسی.
 */
export async function runPdfJob(jobUid: string, cookie: string | null): Promise<void> {
  let filePath: string | null = null;
  try {
    const job = await db.pdfJob.findUnique({ where: { id: jobUid } });
    if (!job || !ACTIVE_STATUSES.includes(job.status as (typeof ACTIVE_STATUSES)[number])) return;

    const params = parsePdfJobParams(job.paramsJson) ?? {
      from: null,
      to: null,
      whole: true,
      include_notes: false,
    };

    await db.pdfJob.update({
      where: { id: jobUid },
      data: { status: "running", progress: 5, statusNote: null },
    });

    /* فهرست صفحه‌های سند */
    const pagesResp = await goFetch(
      `/documents/${encodeURIComponent(job.documentUid)}/pages?page_size=500`,
      { cookie },
    );
    if (!pagesResp.ok) {
      throw new Error(
        await goErrorMessage(pagesResp, "واکشی فهرست صفحه‌های سند ناموفق بود."),
      );
    }
    const pagesData = (await pagesResp.json()) as {
      items?: Array<{ page_uid: string; label: string; serial: number | null; num?: string | null }>;
    };
    const allItems = pagesData.items ?? [];

    /* انتخاب بازه — برچسب‌های چاپی با نرمال‌سازی ارقام تطبیق می‌شوند */
    let selected = allItems;
    if (!params.whole) {
      const idxOf = (label: string): number =>
        allItems.findIndex(
          (it) =>
            normalizeDigits(it.label ?? "") === normalizeDigits(label) ||
            (it.num ? normalizeDigits(it.num) === normalizeDigits(label) : false),
        );
      const fromIdx = params.from ? idxOf(params.from) : -1;
      const toIdx = params.to ? idxOf(params.to) : -1;
      if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
        throw new Error("بازهٔ صفحهٔ چاپی معتبر نیست.");
      }
      selected = allItems.slice(fromIdx, toIdx + 1);
    }
    if (selected.length === 0) throw new Error("هیچ صفحه‌ای برای خروجی یافت نشد.");

    /* حل اثر والد (بهترین تلاش — هم‌زمان جلد و برچسب سند را کامل می‌کند) */
    const resolved = await resolveWork(job.documentUid, cookie);
    const work: PdfWorkInfo = resolved.work ?? { title: job.workTitle ?? job.documentLabel };
    const documentLabel = resolved.documentLabel ?? job.documentLabel;
    if (resolved.workUid || resolved.documentLabel) {
      await db.pdfJob
        .update({
          where: { id: jobUid },
          data: {
            workUid: resolved.workUid ?? undefined,
            workTitle: resolved.workTitle ?? undefined,
            documentLabel,
          },
        })
        .catch(() => undefined);
    }

    /* واکشی محتوای صفحه‌ها — پیشرفت ۵ تا ۷۰ */
    const pages: PdfPageInput[] = [];
    let overlayNote: string | null = null;
    let lastProgress = 5;
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      const resp = await goFetch(
        `/documents/${encodeURIComponent(job.documentUid)}/pages/${encodeURIComponent(item.page_uid)}`,
        { cookie },
      );
      if (!resp.ok) {
        throw new Error(
          await goErrorMessage(
            resp,
            `واکشی صفحهٔ «${item.label}» ناموفق بود.`,
          ),
        );
      }
      const payload = (await resp.json()) as {
        blocks?: PdfPageInput["payload"]["blocks"];
        footnotes?: PdfPageInput["payload"]["footnotes"];
        overlay_applied?: boolean;
        overlay_revision_uid?: string | null;
      };
      if (payload.overlay_applied && !overlayNote && payload.overlay_revision_uid) {
        overlayNote = payload.overlay_revision_uid;
      }
      pages.push({
        pageUid: item.page_uid,
        label: item.label,
        serial: item.serial,
        payload: {
          blocks: payload.blocks ?? [],
          footnotes: payload.footnotes ?? [],
          overlay_applied: payload.overlay_applied === true,
        },
      });

      const progress = 5 + Math.round(((i + 1) / selected.length) * 65);
      // به‌روزرسانی هر چند صفحه (هر ۵ صفحه یا صفحهٔ آخر)
      if (progress > lastProgress + 4 || i === selected.length - 1) {
        lastProgress = progress;
        await db.pdfJob
          .update({ where: { id: jobUid }, data: { progress } })
          .catch(() => undefined);
      }
    }

    /* یادداشت‌ها و هایلایت‌های خصوصی کاربر (فقط با درخواست صریح) */
    const includeNotes: PdfIncludeNote[] = [];
    if (params.include_notes) {
      // یادداشت‌ها در سامانهٔ Go نگهداری می‌شوند
      try {
        const notesResp = await goFetch(
          `/notes?document_uid=${encodeURIComponent(job.documentUid)}`,
          { cookie },
        );
        if (notesResp.ok) {
          const notesData = (await notesResp.json()) as {
            items?: Array<{ page_uid?: string | null; body: string }>;
          };
          for (const n of notesData.items ?? []) {
            if (!n.page_uid) continue;
            const label =
              selected.find((it) => it.page_uid === n.page_uid)?.label ?? null;
            includeNotes.push({ pageUid: n.page_uid, pageLabel: label, body: n.body });
          }
        }
      } catch (err) {
        console.error("[pdf-jobs] fetch notes failed:", err);
      }

      // هایلایت‌ها در DB محلی کاربر
      try {
        const highlights = await db.highlight.findMany({
          where: { userUid: job.userUid, documentUid: job.documentUid },
          orderBy: { createdAt: "asc" },
        });
        for (const h of highlights) {
          const label = selected.find((it) => it.page_uid === h.pageUid)?.label ?? null;
          const color = COLOR_FA[h.color] ?? "";
          const notePart = h.note ? ` — یادداشت: ${h.note}` : "";
          includeNotes.push({
            pageUid: h.pageUid,
            pageLabel: label,
            body: `هایلایت${color ? ` (${color})` : ""}: «${h.text}»${notePart}`,
          });
        }
      } catch (err) {
        console.error("[pdf-jobs] fetch highlights failed:", err);
      }
    }

    /* ساخت PDF — پیشرفت ۸۰ */
    await db.pdfJob
      .update({ where: { id: jobUid }, data: { progress: 80 } })
      .catch(() => undefined);

    const pdfBuffer = await generateBookPdf({
      pages,
      work,
      documentLabel,
      fromLabel: params.whole ? null : params.from,
      toLabel: params.whole ? null : params.to,
      includeNotes,
      overlayNote,
    });

    /* نوشتن فایل و بستن کار */
    mkdirSync(PDF_EXPORT_DIR, { recursive: true });
    filePath = path.join(PDF_EXPORT_DIR, `${jobUid}.pdf`);
    writeFileSync(filePath, pdfBuffer);

    const now = new Date();
    await db.pdfJob.update({
      where: { id: jobUid },
      data: {
        status: "done",
        progress: 100,
        statusNote: null,
        fileBytes: pdfBuffer.length,
        filePath,
        downloadToken: job.downloadToken ?? randomUUID(),
        tokenExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        finishedAt: now,
      },
    });
  } catch (err) {
    console.error(`[pdf-jobs] job ${jobUid} failed:`, err);
    const message =
      err instanceof Error && err.message
        ? err.message
        : "ساخت PDF ناموفق بود؛ دوباره تلاش کنید.";
    try {
      await db.pdfJob.updateMany({
        where: { id: jobUid, status: { in: [...ACTIVE_STATUSES] } },
        data: { status: "failed", statusNote: message, finishedAt: new Date() },
      });
    } catch (dbErr) {
      console.error(`[pdf-jobs] failed to mark job ${jobUid}:`, dbErr);
    }
    // پاک‌سازی فایل ناتمام در صورت وجود
    if (filePath) {
      try {
        rmSync(filePath, { force: true });
      } catch {
        /* بی‌اهمیت */
      }
    }
  }
}

/* ---------- شمار کارهای فعال ---------- */

export async function countActivePdfJobs(): Promise<number> {
  return db.pdfJob.count({
    where: { status: { in: [...ACTIVE_STATUSES] } },
  });
}

export async function countActivePdfJobsForUser(userUid: string): Promise<number> {
  return db.pdfJob.count({
    where: { userUid, status: { in: [...ACTIVE_STATUSES] } },
  });
}
