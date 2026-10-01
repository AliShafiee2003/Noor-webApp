import "server-only";

import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

/**
 * موتور تولید PDF کتاب (§۷-الف-۲) — فقط سمت سرور.
 *
 * - HTML مستقل راست‌به‌چپ با CSS چاپ A4 ساخته می‌شود و با Puppeteer-core و
 *   کروم محلی سندباکس به PDF تبدیل می‌شود.
 * - قلم‌ها با fs خوانده و به‌صورت base64 (data: URL) در CSS جای می‌گیرند —
 *   مطمئن‌ترین راه بارگیری فونت در صفحهٔ about:blank.
 * - هیچ متن پیکره‌ای بدون escape وارد HTML نمی‌شود؛ هیچ اسکریپتی اجرا نمی‌شود.
 */

/* د-۹: همهٔ مسیرها با env قابل‌پیکربندی‌اند (Docker/web container) —
   مقدار پیش‌فرض فقط برای محیط توسعهٔ همین سندباکس است. */
export const CHROME_PATH =
  process.env.NOOR_CHROME_PATH ??
  "/home/z/.agent-browser/browsers/chrome-153.0.8010.52/chrome";

const FONT_DIR = process.env.NOOR_FONT_DIR ?? "/home/z/my-project/node_modules/@fontsource";

/* ---------- تایپ‌های ورودی ---------- */

export interface PdfSpan {
  role: string;
  start: number;
  end: number;
  G?: string | null;
  ref?: string | null;
}

export interface PdfCitation {
  sure?: string | null;
  aya?: string | null;
  aya_from?: string | null;
  aya_to?: string | null;
  address?: string | null;
}

export interface PdfBlock {
  id: string;
  type: string;
  text: string;
  spans?: PdfSpan[];
  citations?: PdfCitation[];
}

export interface PdfPageInput {
  pageUid: string;
  label: string;
  serial: number | null;
  payload: {
    blocks: PdfBlock[];
    footnotes: Array<{ uid: string; label: string; text: string }>;
    overlay_applied: boolean;
  };
}

export interface PdfWorkInfo {
  title: string;
  author?: string | null;
  publisher?: string | null;
  year?: string | null;
  language?: string | null;
}

export interface PdfIncludeNote {
  pageUid: string;
  pageLabel: string | null;
  body: string;
}

export interface GenerateBookPdfOptions {
  pages: PdfPageInput[];
  work: PdfWorkInfo;
  documentLabel: string;
  /** null+null = کل جلد */
  fromLabel: string | null;
  toLabel: string | null;
  includeNotes: PdfIncludeNote[];
  /** اگر هر صفحه‌ای overlay داشته باشد، شناسهٔ نسخهٔ اصلاح */
  overlayNote: string | null;
}

/* ---------- ابزار ---------- */

/** گریزکردن متن برای درج امن در HTML — هیچ ورودی خام وارد نشاخص نمی‌شود */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readFontBase64(relPath: string): string {
  const buf = readFileSync(`${FONT_DIR}/${relPath}`);
  return buf.toString("base64");
}

/** نشانی آیه از استنادها — مثل «بقره: ۲۱۳» (متن خام پیکره، بدون بازنویسی) */
function ayahCaption(citations: PdfCitation[] | undefined): string | null {
  if (!citations || citations.length === 0) return null;
  const c = citations.find((x) => x.address && x.address.trim()) ??
    citations.find((x) => x.sure && x.sure.trim());
  if (!c) return null;
  if (c.address && c.address.trim()) return c.address.trim();
  const sure = (c.sure ?? "").trim();
  const aya = (c.aya ?? "").trim() ||
    ((c.aya_from ?? "").trim() && (c.aya_to ?? "").trim()
      ? `${(c.aya_from ?? "").trim()}–${(c.aya_to ?? "").trim()}`
      : (c.aya_from ?? "").trim() || (c.aya_to ?? "").trim());
  if (aya) return `${sure}: ${aya}`;
  return sure || null;
}

/* ---------- قلم‌ها (base64) ---------- */

function fontFaceCss(): string {
  const vazir400 = readFontBase64("vazirmatn/files/vazirmatn-arabic-400-normal.woff2");
  const vazir700 = readFontBase64("vazirmatn/files/vazirmatn-arabic-700-normal.woff2");
  const amiri400 = readFontBase64("amiri/files/amiri-arabic-400-normal.woff2");
  const amiri700 = readFontBase64("amiri/files/amiri-arabic-700-normal.woff2");
  const quran400 = readFontBase64("amiri-quran/files/amiri-quran-arabic-400-normal.woff2");
  const scheher400 = readFontBase64("scheherazade-new/files/scheherazade-new-arabic-400-normal.woff2");
  const latin400 = readFontBase64("source-serif-4/files/source-serif-4-latin-400-normal.woff2");

  return `
@font-face { font-family: "VazirX"; src: url(data:font/woff2;base64,${vazir400}) format("woff2"); font-weight: 400; font-style: normal; }
@font-face { font-family: "VazirX"; src: url(data:font/woff2;base64,${vazir700}) format("woff2"); font-weight: 700; font-style: normal; }
@font-face { font-family: "AmiriX"; src: url(data:font/woff2;base64,${amiri400}) format("woff2"); font-weight: 400; font-style: normal; }
@font-face { font-family: "AmiriX"; src: url(data:font/woff2;base64,${amiri700}) format("woff2"); font-weight: 700; font-style: normal; }
@font-face { font-family: "QuranX"; src: url(data:font/woff2;base64,${quran400}) format("woff2"); font-weight: 400; font-style: normal; }
@font-face { font-family: "ScheherX"; src: url(data:font/woff2;base64,${scheher400}) format("woff2"); font-weight: 400; font-style: normal; }
@font-face { font-family: "LatinX"; src: url(data:font/woff2;base64,${latin400}) format("woff2"); font-weight: 400; font-style: normal; }
`;
}

/* ---------- CSS چاپ ---------- */

const PRINT_CSS = `
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    direction: rtl;
    font-family: "VazirX", "LatinX", sans-serif;
    font-size: 10.5pt;
    line-height: 1.9;
    color: #21201c;
  }

  /* ---------- جلد ---------- */
  .cover {
    page-break-after: always;
    min-height: 250mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 10mm 6mm;
  }
  .cover-system { font-size: 11pt; color: #5a5648; letter-spacing: 0.02em; }
  .cover-title {
    font-family: "AmiriX", "VazirX", serif;
    font-size: 26pt;
    font-weight: 700;
    line-height: 1.6;
    margin: 10mm 0 3mm;
    max-width: 150mm;
  }
  .cover-doc {
    font-size: 13pt;
    color: #3f3c33;
    border: 1px solid #c9c2ae;
    border-radius: 8px;
    padding: 2mm 8mm;
    background: #f7f4ea;
    margin-bottom: 10mm;
  }
  .cover-meta { margin: 0 0 8mm; font-size: 10.5pt; color: #45413a; line-height: 2.1; }
  .cover-meta dt { display: inline; font-weight: 700; }
  .cover-meta dd { display: inline; margin: 0 0 0 6mm; }
  .cover-range { font-size: 11pt; border-top: 1px solid #d8d2c0; padding-top: 5mm; }
  .cover-date { font-size: 9.5pt; color: #6b6656; margin-top: 3mm; }
  .cover-overlay {
    margin-top: 8mm;
    border: 1.5px solid #b48a3c;
    background: #fdf6e7;
    color: #6d5417;
    border-radius: 8px;
    padding: 3mm 6mm;
    font-size: 10pt;
    max-width: 130mm;
  }
  .cover-honest { margin-top: 10mm; font-size: 9pt; color: #8a8471; }

  /* ---------- صفحهٔ چاپی ---------- */
  .page-section { page-break-inside: auto; }
  .page-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    border-bottom: 1.5px solid #9a9480;
    padding-bottom: 2mm;
    margin: 10mm 0 5mm;
    font-size: 9.5pt;
    color: #5a5648;
  }
  .page-section:first-of-type .page-header { margin-top: 0; }
  .page-header .ph-label { font-weight: 700; font-size: 11pt; color: #2f2c25; }
  .page-overlay-tag {
    font-size: 8.5pt;
    color: #6d5417;
    background: #fdf6e7;
    border: 1px solid #e5cf9c;
    border-radius: 6px;
    padding: 0.5mm 2.5mm;
  }

  /* ---------- بلوک‌ها ---------- */
  .block { margin: 0 0 4.5mm; }
  .b-p, .b-hadith_body, .b-maasoom, .b-unknown {
    font-family: "AmiriX", "LatinX", serif;
    font-size: 13pt;
    line-height: 1.95;
    text-align: justify;
  }
  .b-heading {
    font-family: "AmiriX", "VazirX", serif;
    font-weight: 700;
    font-size: 14pt;
    border-bottom: 1px solid #b9b29c;
    padding-bottom: 1.5mm;
    margin-top: 7mm;
  }
  .b-sanad {
    font-family: "AmiriX", "LatinX", serif;
    font-size: 10.5pt;
    color: #6f6a5c;
    border-inline-start: 2px solid #c4bda6;
    padding-inline-start: 3mm;
  }
  .b-ayah_quote {
    font-family: "QuranX", "ScheherX", "AmiriX", serif;
    font-size: 20pt;
    line-height: 2.0;
    text-align: center;
    background: #f3f7f2;
    border: 1px solid #cfe3d4;
    border-radius: 8px;
    padding: 6mm 7mm 4mm;
    margin: 6mm 0;
    page-break-inside: avoid;
  }
  .ayah-caption {
    font-family: "VazirX", sans-serif;
    font-size: 9pt;
    color: #2f7d5c;
    margin-top: 3mm;
    text-align: center;
    line-height: 1.7;
  }
  .b-b_note, .b-sharh {
    font-family: "VazirX", "LatinX", sans-serif;
    font-size: 10pt;
    line-height: 1.9;
    background: #f7f5ef;
    border: 1px solid #e2ddcf;
    border-radius: 8px;
    padding: 3mm 4.5mm;
    page-break-inside: avoid;
  }

  /* ---------- نقش‌های span ---------- */
  .sp-sanad { color: #6f6a5c; }
  .sp-g { border: 1px solid #cfc8b4; border-radius: 4px; padding: 0 2px; }
  .sp-g-note { font-family: "VazirX", sans-serif; font-size: 8pt; color: #6d5417; }
  .sp-k { color: #7a5c00; }
  .sp-k-ref { font-family: "VazirX", sans-serif; font-size: 8pt; color: #8a7433; }
  .sp-maasoom, .sp-ayah { background: #e4efe7; border-radius: 3px; padding: 0 2px; }
  .sp-ayah { font-family: "QuranX", "AmiriX", serif; }
  .sp-b, .sp-sharh { background: #f3f0e6; border-radius: 3px; padding: 0 2px; }

  /* ---------- پاورقی‌ها ---------- */
  .footnotes-title {
    font-size: 10pt;
    font-weight: 700;
    color: #45413a;
    border-top: 1px dashed #b9b29c;
    padding-top: 3mm;
    margin-top: 7mm;
  }
  .footnotes { margin: 2mm 0 0; padding: 0; list-style: none; }
  .footnotes li { font-size: 9pt; line-height: 1.9; margin-bottom: 1.5mm; color: #45413a; }
  .fn-label { font-weight: 700; color: #2f2c25; }

  /* ---------- یادداشت‌های من ---------- */
  .my-notes {
    background: #eef3fa;
    border: 1px solid #c9d8ec;
    border-radius: 8px;
    padding: 3.5mm 5mm;
    margin-top: 6mm;
    page-break-inside: avoid;
  }
  .my-notes-title { font-size: 9.5pt; font-weight: 700; color: #3d5a80; margin-bottom: 2mm; }
  .my-notes li { font-size: 9pt; line-height: 1.9; margin-bottom: 1.5mm; white-space: pre-wrap; }
  .my-note-page { font-weight: 700; color: #3d5a80; }
`;

/* ---------- رندر بلوک ---------- */

function renderSpan(role: string, text: string, span: PdfSpan): string {
  switch (role) {
    case "sanad":
      return `<span class="sp-sanad">${text}</span>`;
    case "G": {
      const gloss = (span.G ?? "").trim();
      const note =
        gloss && gloss !== text
          ? ` <span class="sp-g-note">(راوی: ${escapeHtml(gloss)})</span>`
          : "";
      return `<span class="sp-g">${text}${note}</span>`;
    }
    case "K": {
      const ref = (span.ref ?? "").trim();
      const note = ref ? ` <span class="sp-k-ref">(مأخذ: ${escapeHtml(ref)})</span>` : "";
      return `<span class="sp-k">${text}${note}</span>`;
    }
    case "maasoom":
      return `<span class="sp-maasoom">${text}</span>`;
    case "ayah_text":
    case "ayahWord":
      return `<span class="sp-ayah">${text}</span>`;
    case "B":
      return `<span class="sp-b">${text}</span>`;
    case "sharh":
      return `<span class="sp-sharh">${text}</span>`;
    default:
      // نقش ناشناخته → بدون تفسیر
      return text;
  }
}

/** متن بلوک با اعمال نقش‌های span (بازه‌ها بر حسب code point) */
function renderBlockBody(block: PdfBlock): string {
  const chars = Array.from(block.text);
  const spans = [...(block.spans ?? [])]
    .filter((s) => typeof s.start === "number" && typeof s.end === "number")
    .sort((a, b) => a.start - b.start);

  let out = "";
  let pos = 0;
  for (const sp of spans) {
    const s = Math.max(0, Math.min(sp.start, chars.length));
    const e = Math.max(s, Math.min(sp.end, chars.length));
    if (s < pos) continue; // بازهٔ هم‌پوشان ناسازگار → نادیده
    if (s > pos) out += escapeHtml(chars.slice(pos, s).join(""));
    const seg = escapeHtml(chars.slice(s, e).join(""));
    out += renderSpan(sp.role, seg, sp);
    pos = e;
  }
  if (pos < chars.length) out += escapeHtml(chars.slice(pos).join(""));
  return out;
}

function renderBlock(block: PdfBlock): string {
  const cls = `block b-${escapeHtml(block.type)}`;
  const body = renderBlockBody(block);
  if (block.type === "ayah_quote") {
    const caption = ayahCaption(block.citations);
    return `<div class="${cls}"><div class="ayah-text">${body}</div>${
      caption ? `<div class="ayah-caption">آیه — ${escapeHtml(caption)}</div>` : ""
    }</div>`;
  }
  return `<div class="${cls}">${body}</div>`;
}

/* ---------- رندر صفحهٔ چاپی ---------- */

function renderPageSection(
  page: PdfPageInput,
  pageNotes: PdfIncludeNote[],
): string {
  const parts: string[] = [];
  parts.push(`<section class="page-section">`);

  const overlayTag = page.payload.overlay_applied
    ? `<span class="page-overlay-tag">شامل اصلاح سامانه</span>`
    : "";
  parts.push(
    `<div class="page-header"><span>صفحهٔ چاپی</span>` +
      `<span class="ph-label">${escapeHtml(page.label)}</span>${overlayTag}</div>`,
  );

  for (const block of page.payload.blocks) {
    parts.push(renderBlock(block));
  }

  if (page.payload.footnotes.length > 0) {
    parts.push(`<div class="footnotes-title">پاورقی‌ها</div>`);
    parts.push(`<ol class="footnotes">`);
    for (const fn of page.payload.footnotes) {
      parts.push(
        `<li><span class="fn-label">${escapeHtml(fn.label)}</span> — ${escapeHtml(fn.text)}</li>`,
      );
    }
    parts.push(`</ol>`);
  }

  if (pageNotes.length > 0) {
    parts.push(`<div class="my-notes">`);
    parts.push(`<div class="my-notes-title">یادداشت‌های من (خصوصی)</div>`);
    parts.push(`<ul class="my-notes" style="padding:0;margin:0;list-style:none;">`);
    for (const n of pageNotes) {
      const pageTag = n.pageLabel ? `<span class="my-note-page">صفحهٔ ${escapeHtml(n.pageLabel)}: </span>` : "";
      parts.push(`<li>${pageTag}${escapeHtml(n.body)}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  parts.push(`</section>`);
  return parts.join("\n");
}

/* ---------- جلد ---------- */

function languageLabel(lang: string | null | undefined): string | null {
  if (!lang || !lang.trim()) return null;
  switch (lang.trim().toLowerCase()) {
    case "ar":
      return "عربی";
    case "fa":
      return "فارسی";
    case "en":
      return "انگلیسی";
    default:
      return lang.trim();
  }
}

function renderCover(opts: GenerateBookPdfOptions, productionDate: string): string {
  const { work, documentLabel, fromLabel, toLabel, overlayNote } = opts;
  const metaRows: string[] = [];
  if (work.author) metaRows.push(`<dt>مؤلف:</dt><dd>${escapeHtml(work.author)}</dd>`);
  if (work.publisher) metaRows.push(`<dt>ناشر:</dt><dd>${escapeHtml(work.publisher)}</dd>`);
  if (work.year) metaRows.push(`<dt>سال:</dt><dd>${escapeHtml(work.year)}</dd>`);
  const lang = languageLabel(work.language);
  if (lang) metaRows.push(`<dt>زبان:</dt><dd>${escapeHtml(lang)}</dd>`);

  const range =
    fromLabel && toLabel
      ? `صفحات چاپی ${escapeHtml(fromLabel)} تا ${escapeHtml(toLabel)}`
      : `بازهٔ استخراج: کل جلد`;

  return `
  <section class="cover">
    <div class="cover-system">سامانهٔ «میزکار پژوهشی نور»</div>
    <h1 class="cover-title">${escapeHtml(work.title)}</h1>
    <div class="cover-doc">${escapeHtml(documentLabel)}</div>
    ${metaRows.length > 0 ? `<dl class="cover-meta">${metaRows.join("")}</dl>` : ""}
    <div class="cover-range">${range}</div>
    <div class="cover-date">تاریخ تولید: ${escapeHtml(productionDate)}</div>
    ${overlayNote ? `<div class="cover-overlay">این متن شامل اصلاحات نسخه‌دار سامانه است — نسخهٔ ${escapeHtml(overlayNote)}</div>` : ""}
    <div class="cover-honest">این PDF از متن بازگشایی‌شدهٔ همان نسخهٔ سامانه ساخته شده است.</div>
  </section>`;
}

/* ---------- نقطهٔ ورود ---------- */

/**
 * ساخت PDF کتاب: HTML مستقل → کروم headless → بافر PDF.
 * خروجی کامل و ایستاده است؛ هیچ اسکریپت یا دادهٔ پویا در آن اجرا نمی‌شود.
 */
export async function generateBookPdf(opts: GenerateBookPdfOptions): Promise<Buffer> {
  const productionDate = new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "full",
  }).format(new Date());

  const notesByPage = new Map<string, PdfIncludeNote[]>();
  for (const n of opts.includeNotes) {
    const list = notesByPage.get(n.pageUid) ?? [];
    list.push(n);
    notesByPage.set(n.pageUid, list);
  }

  const cover = renderCover(opts, productionDate);
  const sections = opts.pages.map((p) =>
    renderPageSection(p, notesByPage.get(p.pageUid) ?? []),
  );

  const html = `<!doctype html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.work.title)}</title>
<style>${fontFaceCss()}${PRINT_CSS}</style>
</head>
<body>
${cover}
${sections.join("\n")}
</body>
</html>`;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--allow-file-access-from-files",
    ],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 120000 });
    // اطمینان از بارگیری کامل قلم‌های درون‌خطی پیش از چاپ
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const pdf: Uint8Array = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "13mm", right: "13mm" },
      timeout: 180000,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
