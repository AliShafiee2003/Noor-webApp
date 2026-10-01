import "server-only";

/**
 * اجراکنندهٔ کارهای خروجی PDF (§۷-الف-۲) — نسخهٔ ج-۷:
 * رکورد کار فقط در Go (app.sqlite) است و این فایل فقط «اجرا»ست:
 * claim داخلی (X-Noor-Service) → واکشی صفحه‌ها/یادداشت‌ها/هایلایت‌ها با کوکی مالک
 * → ساخت PDF با موتور موجود و نوشتن در PDF_EXPORT_DIR → progress/complete/fail داخلی.
 * هیچ دسترسی مستقیم دیتابیس این‌جا نیست (Prisma حذف شده است) و کوکی کاربر فقط
 * در حافظهٔ همین فراخوانی زنده است و هرگز ذخیره نمی‌شود.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { goFetch } from "@/lib/bff-auth";
import { generateBookPdf } from "@/lib/pdf-export";
import type { PdfIncludeNote, PdfPageInput, PdfWorkInfo } from "@/lib/pdf-export";

/** د-۹: خروجی PDF روی volume سوارشونده — با env پیکربندی می‌شود */
export const PDF_EXPORT_DIR =
  process.env.NOOR_PDF_EXPORT_DIR ?? "/home/z/my-project/data/pdf-exports";

/** توکن سرویس داخلی worker↔api — از env (run-local.sh همان را ست می‌کند) */
const SERVICE_TOKEN = process.env.NOOR_SERVICE_TOKEN || "dev-internal-token";
/** د-۹: نشانی داخلی Go API — در compose «http://api:8080» */
const UPSTREAM = process.env.NOOR_API_INTERNAL_URL ?? "http://127.0.0.1:8080";

/** رنگ‌های هایلایت برای متن یادداشت */
const COLOR_FA: Record<string, string> = {
  yellow: "زرد",
  green: "سبز",
  blue: "آبی",
  pink: "صورتی",
  orange: "نارنجی",
};

/* ---------- نرمال‌سازی ارقام فارسی/عربی ---------- */

/** تبدیل ارقام ۰-۹ فارسی/عربی به لاتین برای مقایسهٔ برچسب صفحه‌ها */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
}

/* ---------- فراخوانی داخلی با service token ---------- */

async function internalPdfPost(pathName: string, body: unknown): Promise<Response> {
  return fetch(`${UPSTREAM}/api/v1${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-noor-service": SERVICE_TOKEN },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
}

/** اعلام شکست کار به سامانهٔ Go (مثلاً از مسیر دانلود هنگام فایل غایب) */
export async function failPdfJob(jobUid: string, statusNote: string): Promise<void> {
  await internalPdfPost(`/internal/pdf-jobs/${encodeURIComponent(jobUid)}/fail`, {
    status_note: statusNote,
  }).catch(() => undefined);
}

/* ---------- ردیف کار همان‌طور که Go برمی‌گرداند ---------- */

interface PdfJobRow {
  uid: string;
  document_uid: string;
  document_label: string;
  work_title?: string | null;
  status: string;
  progress: number;
  download_token?: string | null;
  params?: { from?: string | null; to?: string | null; whole: boolean; include_notes: boolean };
}

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
  workTitle: string | null;
  documentLabel: string | null;
}

async function resolveWork(documentUid: string, cookie: string | null): Promise<WorkResolution> {
  const empty: WorkResolution = { work: null, workTitle: null, documentLabel: null };
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
 * اجرای کامل یک کار PDF: claim از Go، واکشی صفحه‌ها، جمع یادداشت‌ها/هایلایت‌ها،
 * ساخت PDF و ثبت نتیجه با endpoints داخلی. هر خطا → failed با پیام فارسی.
 */
export async function runPdfJob(jobUid: string, cookie: string | null): Promise<void> {
  let filePath: string | null = null;
  try {
    /* ۱) claim رکورد — اگر در صف نبود (claimed قبلی) بی‌صدا خارج شو */
    const claimResp = await internalPdfPost(`/internal/pdf-jobs/claim`, { uid: jobUid });
    if (!claimResp.ok) {
      throw new Error("رکورد کار خروجی در سامانه claim نشد.");
    }
    const claimData = (await claimResp.json()) as { job?: PdfJobRow | null };
    const job = claimData.job;
    if (!job || job.uid !== jobUid) return;
    const params = job.params ?? { from: null, to: null, whole: true, include_notes: false };

    const progress = (p: number): void => {
      void internalPdfPost(`/internal/pdf-jobs/${encodeURIComponent(jobUid)}/progress`, {
        progress: p,
      }).catch(() => undefined);
    };

    progress(5);

    /* ۲) فهرست صفحه‌های سند — با کوکی مالک */
    const pagesResp = await goFetch(
      `/documents/${encodeURIComponent(job.document_uid)}/pages?page_size=500`,
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

    /* ۳) انتخاب بازه — برچسب‌های چاپی با نرمال‌سازی ارقام تطبیق می‌شوند */
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

    /* ۴) حل اثر والد (بهترین تلاش — برای جلد PDF) */
    const resolved = await resolveWork(job.document_uid, cookie);
    const work: PdfWorkInfo = resolved.work ?? { title: job.work_title ?? job.document_label };
    const documentLabel = resolved.documentLabel ?? job.document_label;

    /* ۵) واکشی محتوای صفحه‌ها — پیشرفت ۵ تا ۷۰ */
    const pages: PdfPageInput[] = [];
    let overlayNote: string | null = null;
    let lastProgress = 5;
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      const resp = await goFetch(
        `/documents/${encodeURIComponent(job.document_uid)}/pages/${encodeURIComponent(item.page_uid)}`,
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

      const nextProgress = 5 + Math.round(((i + 1) / selected.length) * 65);
      // به‌روزرسانی هر چند صفحه (هر ۵ صفحه یا صفحهٔ آخر)
      if (nextProgress > lastProgress + 4 || i === selected.length - 1) {
        lastProgress = nextProgress;
        progress(nextProgress);
      }
    }

    /* ۶) یادداشت‌ها و هایلایت‌های خصوصی مالک (فقط با درخواست صریح) */
    const includeNotes: PdfIncludeNote[] = [];
    if (params.include_notes) {
      // یادداشت‌ها در سامانهٔ Go
      try {
        const notesResp = await goFetch(
          `/notes?document_uid=${encodeURIComponent(job.document_uid)}`,
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

      // هایلایت‌ها هم اکنون در Go هستند (ج-۷)
      try {
        const hlResp = await goFetch(
          `/annotations?document_uid=${encodeURIComponent(job.document_uid)}`,
          { cookie },
        );
        if (hlResp.ok) {
          const hlData = (await hlResp.json()) as {
            items?: Array<{ page_uid: string; text: string; color: string; note?: string | null }>;
          };
          for (const h of hlData.items ?? []) {
            const label = selected.find((it) => it.page_uid === h.page_uid)?.label ?? null;
            const color = COLOR_FA[h.color] ?? "";
            const notePart = h.note ? ` — یادداشت: ${h.note}` : "";
            includeNotes.push({
              pageUid: h.page_uid,
              pageLabel: label,
              body: `هایلایت${color ? ` (${color})` : ""}: «${h.text}»${notePart}`,
            });
          }
        }
      } catch (err) {
        console.error("[pdf-jobs] fetch highlights failed:", err);
      }
    }

    /* ۷) ساخت PDF — پیشرفت ۸۰ (موتور و مسیر خروجی دست‌نخورده) */
    progress(80);

    const pdfBuffer = await generateBookPdf({
      pages,
      work,
      documentLabel,
      fromLabel: params.whole || params.from == null ? null : params.from,
      toLabel: params.whole || params.to == null ? null : params.to,
      includeNotes,
      overlayNote,
    });

    /* ۸) نوشتن فایل سمت Next و بستن کار در Go */
    mkdirSync(PDF_EXPORT_DIR, { recursive: true });
    filePath = path.join(PDF_EXPORT_DIR, `${jobUid}.pdf`);
    writeFileSync(filePath, pdfBuffer);

    const completeResp = await internalPdfPost(
      `/internal/pdf-jobs/${encodeURIComponent(jobUid)}/complete`,
      { token: job.download_token ?? "", file_size: pdfBuffer.length },
    );
    if (!completeResp.ok) {
      throw new Error("ثبت پایان کار خروجی در سامانه ناموفق بود.");
    }
  } catch (err) {
    console.error(`[pdf-jobs] job ${jobUid} failed:`, err);
    const message =
      err instanceof Error && err.message
        ? err.message
        : "ساخت PDF ناموفق بود؛ دوباره تلاش کنید.";
    await failPdfJob(jobUid, message);
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
