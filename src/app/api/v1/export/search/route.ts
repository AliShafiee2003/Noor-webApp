import * as XLSX from "xlsx";
import { goFetch, resolveGoUser, unauthorized } from "@/lib/bff-auth";
import type { SearchResponse, SearchResultItem } from "@/lib/types";

/**
 * خروجی گرفتن از نتایج تأییدشدهٔ جست‌وجو — PRD §۷-الف-۱
 *
 * الگوی BFF: مرورگر به همین مسیر هم‌مبدأ درخواست می‌دهد؛ این مسیر با «نشست خود
 * کاربر» (بدون دورزدن RBAC) نتایج را صفحه‌به‌صفحه از سامانهٔ Go می‌گیرد و در
 * قالب CSV / XLSX / Markdown برمی‌گرداند. سقف صادقانه: ۵۰۰۰ ردیف در هر بخش
 * (EXPORT_CAP)؛ اگر نشست هنوز cursor داشته باشد، خروجی «جزئی» علامت می‌خورد و
 * ادامهٔ آن با offset در همین مسیر ممکن است.
 */
export const dynamic = "force-dynamic";

/** سقف ردیف هر بخش خروجی (§۷-الف-۱) */
const EXPORT_CAP = 5000;

/** اندازهٔ صفحهٔ درخواستی از موتور جست‌وجو (سرویس Go ممکن است کمتر بدهد) */
const PAGE_SIZE = 100;

const ALLOWED_FORMATS = ["csv", "xlsx", "markdown"] as const;
type ExportFormat = (typeof ALLOWED_FORMATS)[number];

interface ExportRequestBody {
  request: {
    query: string;
    mode: string;
    scope: Record<string, unknown>;
    near?: { slop: number; ordered: boolean };
    sort?: "relevance" | "source";
  };
  format: string;
  offset?: number;
}

/* ---------- برچسب‌های فارسی ---------- */

const MATCH_TYPE_LABELS: Record<string, string> = {
  exact: "دقیق",
  normalized: "نرمال‌شده",
  linguistic: "زبان‌شناختی",
  fuzzy: "نزدیک",
};

function matchTypeLabel(value: string): string {
  return MATCH_TYPE_LABELS[value] ?? value;
}

/** سطر استاندارد خروجی — یکی به‌ازای هر موضع تأییدشده */
const EXPORT_HEADER = [
  "عنوان اثر",
  "جلد/سند",
  "شناسهٔ سند",
  "صفحهٔ چاپی",
  "سرفصل",
  "نشانی عمیق",
  "عبارت جست‌وجو",
  "نوع تطبیق",
  "شاهد متن",
] as const;

/* ---------- خطای بالا-دست و اعتبارسنجی ---------- */

/** پیام خطای فارسی بر پایهٔ پاسخ سامانهٔ Go — کد وضعیت عیناً پیش می‌رود */
async function upstreamError(upstream: Response): Promise<Response> {
  let message = "دریافت نتایج برای خروجی با خطا روبه‌رو شد؛ دوباره تلاش کنید.";
  try {
    const data = (await upstream.json()) as { error?: { message?: string } | null };
    if (data?.error?.message) message = data.error.message;
  } catch {
    /* بدنهٔ JSON نداشت — پیام پیش‌فرض می‌ماند */
  }
  return Response.json(
    { error: { code: "export_failed", message, trace_id: null, retryable: true } },
    { status: upstream.status },
  );
}

function badRequest(message: string): Response {
  return Response.json(
    { error: { code: "bad_request", message, trace_id: null, retryable: false } },
    { status: 400 },
  );
}

/* ---------- ساخت سطرها ---------- */

/** نشانی عمیق گشودنی موضع در کتاب‌خوان (نشانک hash — مستقل از مسیر استقرار) */
function deepLink(origin: string, r: SearchResultItem): string {
  let url = `${origin}/#/read/${r.document.uid}?pg=${r.page.uid}`;
  if (r.match_offsets) {
    url += `&hl=${r.match_offsets[0]}:${r.match_offsets[1]}`;
  }
  return url;
}

function exportRow(r: SearchResultItem, query: string, origin: string): string[] {
  return [
    r.work?.title ?? "",
    r.document?.label ?? "",
    r.document?.uid ?? "",
    r.page?.label ?? "",
    r.section?.title ?? "",
    deepLink(origin, r),
    query,
    matchTypeLabel(String(r.match_type ?? "")),
    r.snippet ?? "",
  ];
}

/* ---------- CSV ---------- */

/** نقل‌قول استاندارد CSV: «"» دوبرابر می‌شود؛ فیلدهای دارای ,/"/سطر جدید درون " می‌روند */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

function buildCsv(producedAt: string, paramsLine: string, rows: string[][]): string {
  const lines: string[] = [
    /* دو سطر فراداده پیش از سطر عنوان — اکسل فارسی آن را جدول می‌بیند (§۷-الف-۱) */
    csvLine(["خروجی جست‌وجوی میزکار نور", producedAt]),
    csvLine(["پارامترها", paramsLine]),
    "",
    csvLine([...EXPORT_HEADER]),
  ];
  for (const row of rows) lines.push(csvLine(row));
  /* BOM الزامی است تا اکسل فارسی، UTF-8 را درست تشخیص دهد */
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/* ---------- XLSX ---------- */

/** برگهٔ «راهنما»: فراداده + توصیف ستون‌ها */
function guideRows(
  producedAt: string,
  query: string,
  mode: string,
  scopeTarget: string,
  rowCount: number,
  totalVerified: number | null,
  partial: boolean,
): string[][] {
  const rows: string[][] = [
    ["خروجی جست‌وجوی میزکار نور"],
    ["تاریخ تولید", producedAt],
    ["عبارت", query],
    ["حالت", mode],
    ["دامنه", scopeTarget],
    ["تعداد ردیف‌ها", String(rowCount)],
    ["مجموع تأییدشده", totalVerified === null ? "—" : String(totalVerified)],
  ];
  if (partial) {
    rows.push([
      "هشدار",
      "این خروجی جزئی است و تا سقف ۵۰۰۰ ردیف ادامه دارد؛ برای دریافت بخش بعدی، همان درخواست را با offset بخش بعد بفرستید.",
    ]);
  }
  rows.push(
    [],
    ["توصیف ستون‌های برگهٔ «نتایج»"],
    ["عنوان اثر", "عنوان اثری که موضع تطبیق در آن یافت شده است"],
    ["جلد/سند", "برچسب جلد یا سند حاوی موضع"],
    ["شناسهٔ سند", "شناسهٔ یکتای سند برای ارجاع دقیق"],
    ["صفحهٔ چاپی", "برچسب صفحهٔ چاپی متناظر با موضع"],
    ["سرفصل", "عنوان سرفصل در صورت وجود"],
    ["نشانی عمیق", "پیوند گشودنی موضع در کتاب‌خوان میزکار نور"],
    ["عبارت جست‌وجو", "عبارتی که جست‌وجو با آن انجام شده است"],
    ["نوع تطبیق", "دقیق / نرمال‌شده / زبان‌شناختی / نزدیک"],
    ["شاهد متن", "گزارهٔ متن پیرامون موضع تطبیق"],
  );
  return rows;
}

function buildXlsx(
  producedAt: string,
  query: string,
  mode: string,
  scopeTarget: string,
  rows: string[][],
  totalVerified: number | null,
  partial: boolean,
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  /* نکته: SheetJS 0.18 هنگام نوشتن فقط نمای دفترکار را در XML می‌ریزد؛
     نمای هر برگه هم به‌عنوان فراداده تنظیم می‌شود و نمای دفترکار باعث
     می‌شود `rightToLeft="1"` در هر دو برگه واقعاً نوشته شود. */
  wb.Workbook = { Views: [{ RTL: true }] };

  const guide = XLSX.utils.aoa_to_sheet(
    guideRows(producedAt, query, mode, scopeTarget, rows.length, totalVerified, partial),
  );
  guide["!views"] = [{ RTL: true }];
  guide["!cols"] = [{ wch: 22 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guide, "راهنما");

  const results = XLSX.utils.aoa_to_sheet([[...EXPORT_HEADER], ...rows]);
  results["!views"] = [{ RTL: true }];
  results["!cols"] = [
    { wch: 26 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 22 },
    { wch: 46 }, { wch: 22 }, { wch: 12 }, { wch: 60 },
  ];
  XLSX.utils.book_append_sheet(wb, results, "نتایج");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  /* کپی در ArrayBuffer برای سازگاری تایپ BodyInit پاسخ */
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

/* ---------- Markdown ---------- */

/** گریز Markdown در سلول جدول: «|» → «\|» و سطر جدید → <br> */
function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function buildMarkdown(
  producedAt: string,
  query: string,
  mode: string,
  scopeTarget: string,
  rows: string[][],
  totalVerified: number | null,
  partial: boolean,
): string {
  const lines: string[] = [
    "# خروجی جست‌وجوی میزکار نور",
    "",
    `- تاریخ تولید: ${mdCell(producedAt)}`,
    `- عبارت: ${mdCell(query)}`,
    `- حالت: ${mdCell(mode)}`,
    `- دامنه: ${mdCell(scopeTarget)}`,
    `- تعداد ردیف‌ها: ${rows.length}`,
    `- مجموع تأییدشده: ${totalVerified === null ? "—" : totalVerified}`,
  ];
  if (partial) {
    lines.push(
      "- ⚠️ این خروجی جزئی است و تا سقف ۵۰۰۰ ردیف ادامه دارد؛ برای دریافت باقی مواضع، «دریافت بخش بعدی» را از منوی خروجی برگزینید.",
    );
  }
  lines.push(
    "",
    `| ${EXPORT_HEADER.map(mdCell).join(" | ")} |`,
    `| ${EXPORT_HEADER.map(() => "---").join(" | ")} |`,
  );
  for (const row of rows) {
    lines.push(`| ${row.map(mdCell).join(" | ")} |`);
  }
  return lines.join("\n") + "\n";
}

/* ---------- نام فایل و سرصفحهٔ پاسخ ---------- */

/** نام فایل فارسی با تاریخ — نویسه‌های غیرمجاز نام فایل حذف می‌شوند */
function persianFilename(ext: string): string {
  const date = new Intl.DateTimeFormat("fa-IR").format(new Date());
  return `نتایج-جست‌وجو-${date}.${ext}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
}

function fileHeaders(
  format: ExportFormat,
  partial: boolean,
  rowCount: number,
  totalVerified: number | null,
  offsetNext: number | null,
): Headers {
  const ext = format === "markdown" ? "md" : format;
  const contentType =
    format === "csv"
      ? "text/csv; charset=utf-8"
      : format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/markdown; charset=utf-8";
  const headers = new Headers({
    "content-type": contentType,
    /* نام لاتین جایگزین + نام فارسی RFC 5987 (§۷-الف-۱) */
    "content-disposition": `attachment; filename="search-export.${ext}"; filename*=UTF-8''${encodeURIComponent(persianFilename(ext))}`,
    "x-export-partial": partial ? "1" : "0",
    "x-export-rows": String(rowCount),
    "x-export-total": totalVerified === null ? "" : String(totalVerified),
    "cache-control": "no-store",
  });
  if (partial && offsetNext !== null) {
    headers.set("x-export-offset-next", String(offsetNext));
  }
  return headers;
}

/* ---------- گردانندهٔ اصلی ---------- */

export async function POST(req: Request): Promise<Response> {
  /* هویت از نشست کاربر — بدون نشست معتبر، همه‌جا 401 */
  const cookie = req.headers.get("cookie");
  const user = await resolveGoUser(cookie);
  if (!user) return unauthorized();

  let body: ExportRequestBody;
  try {
    body = (await req.json()) as ExportRequestBody;
  } catch {
    return badRequest("بدنهٔ درخواست معتبر نیست.");
  }

  const request = body?.request;
  if (
    !request ||
    typeof request.query !== "string" ||
    typeof request.mode !== "string" ||
    !request.scope ||
    typeof request.scope !== "object"
  ) {
    return badRequest("پارامترهای جست‌وجو برای خروجی گرفتن کامل نیست.");
  }
  const format = ALLOWED_FORMATS.find((f) => f === body.format);
  if (!format) {
    return badRequest("قالب خروجی پشتیبانی نمی‌شود؛ قالب‌های مجاز: csv، xlsx، markdown.");
  }
  const offset =
    typeof body.offset === "number" && Number.isFinite(body.offset) && body.offset >= 0
      ? Math.floor(body.offset)
      : 0;

  const origin = new URL(req.url).origin;
  const scopeTarget =
    typeof request.scope.target === "string" ? request.scope.target : "library";

  /* صفحه‌بندی نتایج تأییدشده با «نشست خود کاربر» — بدون دورزدن RBAC */
  const firstResp = await goFetch("/search", {
    method: "POST",
    cookie,
    body: { ...request, page_size: PAGE_SIZE },
  });
  if (!firstResp.ok) return upstreamError(firstResp);
  const first = (await firstResp.json()) as SearchResponse;
  const sessionUid = first.session_uid;
  if (!sessionUid) {
    return Response.json(
      {
        error: {
          code: "export_failed",
          message: "نشست جست‌وجو برای خروجی گرفتن ساخته نشد؛ دوباره تلاش کنید.",
          trace_id: null,
          retryable: true,
        },
      },
      { status: 502 },
    );
  }

  const collected: SearchResultItem[] = [];
  if (Array.isArray(first.results)) collected.push(...first.results);
  const collectLimit = offset + EXPORT_CAP;
  let nextCursor: string | null = first.next_cursor ?? null;
  while (nextCursor && collected.length < collectLimit) {
    const contResp = await goFetch(`/search/${encodeURIComponent(sessionUid)}/continue`, {
      method: "POST",
      cookie,
      body: { cursor: nextCursor },
    });
    if (!contResp.ok) return upstreamError(contResp);
    const cont = (await contResp.json()) as SearchResponse;
    if (Array.isArray(cont.results)) collected.push(...cont.results);
    nextCursor = cont.next_cursor ?? null;
  }

  /* اگر پس از رسیدن به سقف هنوز cursor مانده باشد، خروجی «جزئی» است */
  const partial = nextCursor !== null;
  const rows = collected
    .slice(offset, offset + EXPORT_CAP)
    .map((r) => exportRow(r, request.query, origin));
  const totalVerified =
    typeof first.verified_occurrences === "number" ? first.verified_occurrences : null;
  const offsetNext = partial ? offset + rows.length : null;

  const producedAt = new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
  const paramsLine = `عبارت: ${request.query} | حالت: ${request.mode} | دامنه: ${scopeTarget}${partial ? " | جزئی: تا سقف ۵۰۰۰ ردیف" : ""}`;

  let responseBody: string | ArrayBuffer;
  if (format === "csv") {
    responseBody = buildCsv(producedAt, paramsLine, rows);
  } else if (format === "xlsx") {
    responseBody = buildXlsx(
      producedAt,
      request.query,
      request.mode,
      scopeTarget,
      rows,
      totalVerified,
      partial,
    );
  } else {
    responseBody = buildMarkdown(
      producedAt,
      request.query,
      request.mode,
      scopeTarget,
      rows,
      totalVerified,
      partial,
    );
  }

  return new Response(responseBody, {
    status: 200,
    headers: fileHeaders(format, partial, rows.length, totalVerified, offsetNext),
  });
}
