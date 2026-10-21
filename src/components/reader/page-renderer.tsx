"use client";

/**
 * رندر بلوک‌های ساخت‌یافتهٔ صفحه (READ-05..READ-15):
 * - type=p|heading|sanad|hadith_body|ayah_quote|b_note|sharh|maasoom|unknown
 * - نقش‌های span: sanad/G/K/maasoom/ayah_text/B/sharh/unknown — تگ ناشناخته هرگز تفسیر نمی‌شود.
 * - آفست‌ها code point است (تبدیل به UTF-16 با Array.from).
 * - ارجاع حل‌نشده: پیام فارسی + نشانی اصلی، بدون هدایت حدسی (REL-10) — در والد مدیریت می‌شود.
 * - انتخاب متن → دکمهٔ شناور «ثبت فیش» با آفست code point داخل بلوک.
 * - هایلایت شخصی کاربر (§۷-الف-۳): رندر چندرنگ لنگردار (block_id + بازهٔ cp) و
 *   دکمه‌های رنگ در نوار شناور — هردو اختیاری؛ بدون propهای جدید رفتار قبلی دست‌نخورده است.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Landmark, Quote, ScrollText, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { faNum } from "@/lib/format";
import { isLatinBlock } from "@/lib/script";
import { highlightClass, HIGHLIGHT_COLORS } from "@/lib/highlight-color";
import { useTooltipTempo } from "@/lib/tooltip-tempo";
import { cn } from "@/lib/utils";
import {
  QURAN_FONT_SIZE_DEFAULT,
  QURAN_LINE_HEIGHT_DEFAULT,
} from "@/lib/fonts";
import type {
  BlockLink,
  BlockSpan,
  Highlight,
  HighlightColor,
  PageBlock,
  PagePayload,
  ReaderPrefs,
} from "@/lib/types";

/* ---------- ابزار code point ---------- */

interface Mark {
  start: number;
  end: number;
  priority: number; // fnref=3, link=2, span=1, hl=0
  span?: BlockSpan;
  link?: BlockLink;
  refUid?: string;
  isHl?: boolean;
  /** هایلایت شخصی کاربر (§۷-الف-۳) — بالاتر از هایلایت جست‌وجو رندر می‌شود */
  isUserHl?: boolean;
  hlUid?: string;
  hlColor?: string;
}

interface Segment {
  start: number;
  end: number;
  mark?: Mark;
}

/** پوشش بازه‌ها با اولویت؛ خروجی قطعه‌های بدون هم‌پوشانی است. */
function buildSegments(cpLen: number, marks: Mark[]): Segment[] {
  if (cpLen === 0) return [];
  const sorted = [...marks]
    .filter((m) => m.end > m.start)
    .sort((a, b) => a.start - b.start || b.priority - a.priority);

  const segs: Segment[] = [];
  let cursor = 0;
  while (cursor < cpLen) {
    // مرز بعدی: نزدیک‌ترین شروع یا پایان markها بعد از cursor
    let boundary = cpLen;
    for (const m of sorted) {
      if (m.start > cursor) boundary = Math.min(boundary, m.start);
      if (m.end > cursor) boundary = Math.min(boundary, m.end);
    }
    if (boundary <= cursor) break;
    // پراولویت‌ترین mark که کل بازهٔ [cursor, boundary) را می‌پوشاند
    let best: Mark | undefined;
    for (const m of sorted) {
      if (m.start <= cursor && m.end >= boundary) {
        if (!best || m.priority > best.priority) best = m;
      }
    }
    segs.push({ start: cursor, end: boundary, mark: best });
    cursor = boundary;
  }
  return segs;
}

/** بیان مؤلف (B) و شرح فارسی است؛ بقیهٔ بلوک‌ها عربی فرض می‌شوند. */
function blockIsPersian(block: PageBlock): boolean {
  return block.type === "b_note" || block.type === "sharh";
}

/*
 * قلم بلوک بر اساس نقش، نه حدس زبان (سامانهٔ قلم — docs/fonts/README.md):
 * - ayah_quote → قلم قرآنی + اندازه/فاصلهٔ قرآنی (پیش‌فرض ۲۴px / ۲٫۰)
 * - بلوک لاتین شناسایی‌شده (isLatinBlock) → dir=ltr + قلم لاتین
 * - بیان مؤلف/شرح (فارسی) → قلم UI (وزیرمتن)
 * - بقیهٔ نثر عربی → قلم نثر انتخابی کاربر (--font-arabic؛ ران‌های لاتین داخلش
 *   خودکار با قلم لاتین رندر می‌شوند — استک چنداسکریپتی)
 */
interface BlockTextStyle {
  fontFamily: string;
  fontSize: string;
  lineHeight: number;
  lang: "ar" | "fa" | "en";
  dir: "rtl" | "ltr";
}

function blockTextStyle(block: PageBlock, prefs: ReaderPrefs): BlockTextStyle {
  const quranSize = prefs.quran_font_size ?? QURAN_FONT_SIZE_DEFAULT;
  const quranLh = prefs.quran_line_height ?? QURAN_LINE_HEIGHT_DEFAULT;
  if (block.type === "ayah_quote") {
    return {
      fontFamily: "var(--font-quran)",
      fontSize: `${quranSize}px`,
      lineHeight: quranLh,
      lang: "ar",
      dir: "rtl",
    };
  }
  if (isLatinBlock(block.text)) {
    return {
      fontFamily: "var(--font-latin)",
      fontSize: `${prefs.font_size}px`,
      lineHeight: prefs.line_height,
      lang: "en",
      dir: "ltr",
    };
  }
  const persian = blockIsPersian(block);
  return {
    fontFamily: persian ? "var(--font-ui)" : "var(--font-arabic)",
    fontSize: `${prefs.font_size}px`,
    lineHeight: prefs.line_height,
    lang: persian ? "fa" : "ar",
    dir: "rtl",
  };
}

function citationAddress(block: PageBlock): string | null {
  for (const c of block.citations ?? []) {
    if (c.address && c.address.trim() !== "") return c.address.trim();
    if (c.sure) {
      const range = c.aya ?? [c.aya_from, c.aya_to].filter(Boolean).join("–");
      return range ? `${c.sure}: ${range}` : c.sure;
    }
  }
  return null;
}

/* ---------- نشان‌های نقش ---------- */

function RoleBadge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "green" | "paper";
}) {
  const cls =
    tone === "green"
      ? "border-ayah/40 bg-ayah-soft text-ayah"
      : tone === "paper"
        ? "border-border bg-sharh-soft text-foreground"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-px align-middle text-[10px] leading-4 font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

/* ---------- متن بلوک با نقش‌ها ---------- */

function BlockText({
  block,
  footnoteLabelFor,
  highlight,
  userHls,
  onFootnoteClick,
  onFootnoteEnter,
  onFootnoteLeave,
  onHighlightClick,
  onLinkClick,
  semantic,
}: {
  block: PageBlock;
  footnoteLabelFor: (refUid: string) => string | null;
  highlight: { start: number; end: number; blockId?: string | null } | null;
  /** هایلایت‌های شخصی همین بلوک — لنگر: بازهٔ code point (§۷-الف-۳) */
  userHls?: ReadonlyArray<Pick<Highlight, "uid" | "start" | "end" | "color">>;
  onFootnoteClick: (refUid: string, anchorId: string) => void;
  /** هاور روی شمارهٔ پاورقی → پاپ‌آپ متن پاورقی (با ریتم هوشمند) */
  onFootnoteEnter: (refUid: string, label: string, el: HTMLElement) => void;
  onFootnoteLeave: () => void;
  /** کلیک روی هایلایت شخصی → منوی تغییر رنگ/حذف */
  onHighlightClick?: (uid: string, color: string, el: HTMLElement) => void;
  onLinkClick: (link: BlockLink) => void;
  semantic: boolean;
}) {
  const cps = useMemo(() => Array.from(block.text), [block.text]);
  const cpLen = cps.length;
  /* ریتم تولتیپ: اولین هاور با تأخیر، هاورهای بعدی بی‌درنگ (درخواست کاربر) */
  const { delay: tempoDelay, onHoverEnter, onOpened } = useTooltipTempo();

  const marks = useMemo<Mark[]>(() => {
    const out: Mark[] = [];
    for (const s of block.spans ?? []) {
      out.push({
        start: Math.max(0, Math.min(s.start, cpLen)),
        end: Math.max(0, Math.min(s.end, cpLen)),
        priority: 1,
        span: s,
      });
    }
    for (const l of block.links ?? []) {
      out.push({
        start: Math.max(0, Math.min(l.start, cpLen)),
        end: Math.max(0, Math.min(l.end, cpLen)),
        priority: 2,
        link: l,
      });
    }
    for (const f of block.footnote_refs ?? []) {
      out.push({
        start: Math.max(0, Math.min(f.start, cpLen)),
        end: Math.max(0, Math.min(f.end, cpLen)),
        priority: 3,
        refUid: f.ref,
      });
    }
    for (const uh of userHls ?? []) {
      if (uh.end <= uh.start) continue;
      out.push({
        start: Math.max(0, Math.min(uh.start, cpLen)),
        end: Math.max(0, Math.min(uh.end, cpLen)),
        priority: 0,
        isUserHl: true,
        hlUid: uh.uid,
        hlColor: uh.color,
      });
    }
    if (highlight && highlight.end > highlight.start) {
      out.push({
        start: Math.max(0, Math.min(highlight.start, cpLen)),
        end: Math.max(0, Math.min(highlight.end, cpLen)),
        priority: 0,
        isHl: true,
      });
    }
    return out;
  }, [block, cpLen, highlight, userHls]);

  const segs = useMemo(() => buildSegments(cpLen, marks), [cpLen, marks]);

  return (
    <>
      {segs.map((seg, i) => {
        const text = cps.slice(seg.start, seg.end).join("");
        const mark = seg.mark;
        if (!mark) {
          return (
            <span key={i} data-cp-start={seg.start} data-cp-end={seg.end}>
              {text}
            </span>
          );
        }
        if (mark.isUserHl) {
          // هایلایت شخصی کاربر — مقدم بر هایلایت جست‌وجو (§۷-الف-۳)
          // کلیک روی هایلایت → منوی تغییر رنگ/حذف (بازخورد فوری روی خود متن)
          return (
            <mark
              key={i}
              id={`userhl-${mark.hlUid ?? ""}`}
              data-hl-uid={mark.hlUid ?? ""}
              data-cp-start={seg.start}
              data-cp-end={seg.end}
              className={cn(
                "cursor-pointer rounded-sm px-0.5 text-foreground transition-shadow hover:ring-2 hover:ring-foreground/25",
                highlightClass(mark.hlColor ?? "yellow"),
              )}
              title="تغییر رنگ یا حذف هایلایت"
              onClick={(e) => {
                e.stopPropagation();
                if (mark.hlUid) {
                  onHighlightClick?.(mark.hlUid, mark.hlColor ?? "yellow", e.currentTarget);
                }
              }}
            >
              {text}
            </mark>
          );
        }
        if (mark.isHl) {
          return (
            <mark
              key={i}
              id="reader-hl-anchor"
              data-cp-start={seg.start}
              data-cp-end={seg.end}
              className="rounded-sm bg-match px-0.5 text-match-foreground"
            >
              {text}
            </mark>
          );
        }
        if (mark.refUid) {
          const anchorId = `fnref-${block.id}-${seg.start}`;
          const label = footnoteLabelFor(mark.refUid) ?? "*";
          return (
            <button
              key={i}
              type="button"
              id={anchorId}
              data-cp-start={seg.start}
              data-cp-end={seg.end}
              className="mx-0.5 inline cursor-pointer whitespace-nowrap align-super text-[0.62em] font-semibold text-link hover:underline"
              onClick={() => onFootnoteClick(mark.refUid as string, anchorId)}
              onMouseEnter={(e) => onFootnoteEnter(mark.refUid as string, label, e.currentTarget)}
              onMouseLeave={onFootnoteLeave}
              onFocus={(e) => onFootnoteEnter(mark.refUid as string, label, e.currentTarget)}
              onBlur={onFootnoteLeave}
              aria-label={`پاورقی ${label} — هاور برای پیش‌نمایش، کلیک برای بازکردن در پنل`}
            >
              ({label})
            </button>
          );
        }
        if (mark.link) {
          return (
            <button
              key={i}
              type="button"
              data-cp-start={seg.start}
              data-cp-end={seg.end}
              className="inline cursor-pointer text-link underline decoration-dotted underline-offset-4 hover:decoration-solid"
              onClick={() => onLinkClick(mark.link as BlockLink)}
              title={`ارجاع: ${mark.link.original_address}`}
            >
              {text}
            </button>
          );
        }
        const span = mark.span as BlockSpan;
        if (!semantic) {
          // READ-13 خاموش: نقش‌ها فقط متن ساده — بدون رنگ و نشان (دسترس‌پذیر و خنثی)
          return (
            <span key={i} data-cp-start={seg.start} data-cp-end={seg.end}>
              {text}
            </span>
          );
        }
        switch (span.role) {
          case "sanad":
            return (
              <span
                key={i}
                data-cp-start={seg.start}
                data-cp-end={seg.end}
                className="rounded bg-muted/55 px-0.5 text-muted-foreground"
              >
                {text}
              </span>
            );
          case "G":
            return (
              <Tooltip
                key={i}
                delayDuration={tempoDelay}
                onOpenChange={(o) => {
                  if (o) onOpened();
                }}
              >
                <TooltipTrigger asChild onMouseEnter={onHoverEnter}>
                  <span
                    data-cp-start={seg.start}
                    data-cp-end={seg.end}
                    className="inline-flex items-baseline gap-0.5 rounded border border-border bg-surface px-0.5"
                  >
                    {text}
                    <UserRound className="size-3 self-center text-primary" aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-60 text-xs">
                  راوی: {span.G ?? text}
                </TooltipContent>
              </Tooltip>
            );
          case "K":
            return (
              <Tooltip
                key={i}
                delayDuration={tempoDelay}
                onOpenChange={(o) => {
                  if (o) onOpened();
                }}
              >
                <TooltipTrigger asChild onMouseEnter={onHoverEnter}>
                  <span
                    data-cp-start={seg.start}
                    data-cp-end={seg.end}
                    className="inline-flex items-baseline gap-0.5 rounded border border-border bg-surface px-0.5 text-link"
                  >
                    {text}
                    <Bookmark className="size-3 self-center" aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="text-xs">مأخذ: {span.ref ?? text}</TooltipContent>
              </Tooltip>
            );
          case "maasoom":
            return (
              <Tooltip
                key={i}
                delayDuration={tempoDelay}
                onOpenChange={(o) => {
                  if (o) onOpened();
                }}
              >
                <TooltipTrigger asChild onMouseEnter={onHoverEnter}>
                  <span
                    data-cp-start={seg.start}
                    data-cp-end={seg.end}
                    className="rounded bg-ayah-soft px-0.5"
                  >
                    {text}
                    <RoleBadge tone="green">سخن معصوم</RoleBadge>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  بخش منسوب به سخن معصوم (نشانه‌گذاری‌شده)
                </TooltipContent>
              </Tooltip>
            );
          case "B":
            return (
              <span
                key={i}
                data-cp-start={seg.start}
                data-cp-end={seg.end}
                className="rounded bg-sharh-soft px-0.5"
              >
                <RoleBadge tone="paper">بیان مؤلف</RoleBadge> {text}
              </span>
            );
          case "sharh":
            return (
              <span
                key={i}
                data-cp-start={seg.start}
                data-cp-end={seg.end}
                className="rounded bg-sharh-soft px-0.5"
              >
                <RoleBadge tone="paper">شرح</RoleBadge> {text}
              </span>
            );
          case "ayah_text":
            // نقش تگ آیه → قلم قرآنی (مستقل از زبان کتاب)
            return (
              <span
                key={i}
                data-cp-start={seg.start}
                data-cp-end={seg.end}
                className="rounded bg-ayah-soft px-0.5"
                style={{ fontFamily: "var(--font-quran)" }}
              >
                {text}
              </span>
            );
          case "ayahWord":
            // کلمهٔ آیه → قلم قرآنی
            return (
              <span
                key={i}
                data-cp-start={seg.start}
                data-cp-end={seg.end}
                className="rounded bg-ayah-soft/70 px-0.5"
                style={{ fontFamily: "var(--font-quran)" }}
              >
                {text}
              </span>
            );
          default:
            // نقش ناشناخته → بدون تفسیر، فقط متن
            return (
              <span key={i} data-cp-start={seg.start} data-cp-end={seg.end}>
                {text}
              </span>
            );
        }
      })}
    </>
  );
}

/* ---------- بلوک سند روایت (قابل جمع — HAD-10/HAD-14) ---------- */

function SanadBlock({
  block,
  collapsed,
  onToggle,
  onHadithClick,
  children,
}: {
  block: PageBlock;
  collapsed: boolean;
  onToggle: (blockId: string) => void;
  onHadithClick?: (block: PageBlock) => void;
  children: React.ReactNode;
}) {
  const cps = Array.from(block.text);
  const gCount = (block.spans ?? []).filter((s) => s.role === "G").length;
  const countLabel =
    gCount > 0 ? `${faNum(gCount)} راوی` : `${faNum(cps.length)} نویسه`;
  return (
    <div data-block-id={block.id} className="border-s-2 border-muted-foreground/40 ps-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onToggle(block.id)}
          aria-expanded={!collapsed}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-muted-foreground hover:bg-accent md:min-h-8"
          title={
            collapsed
              ? "بدنهٔ روایت بدون سند نمایش داده می‌شود؛ به معنی سخن معصوم نیست"
              : "جمع‌کردن سند روایت"
          }
        >
          <span
            className={`inline-block text-[9px] transition-transform ${collapsed ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            ▼
          </span>
          سند روایت
          <span className="rounded-full border border-border bg-muted px-1.5 py-px text-[10px] leading-4">
            {countLabel}
          </span>
        </button>
        {block.revayat_index ? (
          <button
            type="button"
            onClick={() => onHadithClick?.(block)}
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 md:min-h-6"
            aria-label={`اطلاعات روایت شمارهٔ ${faNum(block.revayat_index)} در پنل زمینه`}
            title={`شمارهٔ روایت در این منبع: ${block.revayat_index} — نمایش جزئیات`}
          >
            <ScrollText className="size-3" aria-hidden="true" />
            روایت {faNum(block.revayat_index)}
          </button>
        ) : null}
        {collapsed ? (
          <span className="sr-only">
            بدنهٔ روایت بدون سند نمایش داده می‌شود؛ به معنی سخن معصوم نیست
          </span>
        ) : null}
      </div>
      {collapsed ? (
        <p className="text-xs italic text-muted-foreground/80">سند جمع شده است.</p>
      ) : (
        <p lang="ar" dir="rtl" className="text-muted-foreground" style={{ fontSize: "0.92em" }}>
          {children}
        </p>
      )}
    </div>
  );
}

/* ---------- انتخاب متن → فیش ---------- */

export interface ReaderSelection {
  blockId: string;
  start: number;
  end: number;
  text: string;
  hadithUid?: string | null;
}

function cpOffsetFromNode(node: Node | null, offset: number): {
  blockId: string | null;
  cp: number;
} {
  if (!node) return { blockId: null, cp: 0 };
  let textNode: Text | null = null;
  let utf16Offset = offset;
  if (node.nodeType === Node.TEXT_NODE) {
    textNode = node as Text;
  } else {
    const child = node.childNodes[offset] ?? node.firstChild;
    if (child && child.nodeType === Node.TEXT_NODE) {
      textNode = child as Text;
      utf16Offset = 0;
    }
  }
  if (!textNode) return { blockId: null, cp: 0 };
  const spanEl = textNode.parentElement?.closest<HTMLElement>("span[data-cp-start], mark[data-cp-start]");
  const blockEl = textNode.parentElement?.closest<HTMLElement>("[data-block-id]");
  if (!blockEl) return { blockId: null, cp: 0 };
  const base = spanEl ? Number(spanEl.dataset.cpStart ?? 0) : 0;
  const rel = Array.from((textNode.textContent ?? "").slice(0, utf16Offset)).length;
  return { blockId: blockEl.dataset.blockId ?? null, cp: base + rel };
}

/* ---------- رندر یک بلوک ---------- */

interface BlockViewProps {
  block: PageBlock;
  prefs: ReaderPrefs;
  highlight: { start: number; end: number; blockId?: string | null } | null;
  /** هایلایت‌های شخصی همین بلوک (§۷-الف-۳) — از PageRenderer بر اساس block_id فیلتر شده */
  userHls?: ReadonlyArray<Pick<Highlight, "uid" | "start" | "end" | "color">>;
  collapsed: boolean;
  footnoteLabelFor: (refUid: string) => string | null;
  onFootnoteClick: (refUid: string, anchorId: string) => void;
  onFootnoteEnter: (refUid: string, label: string, el: HTMLElement) => void;
  onFootnoteLeave: () => void;
  onHighlightClick?: (uid: string, color: string, el: HTMLElement) => void;
  onLinkClick: (link: BlockLink) => void;
  onToggleSanad: (blockId: string) => void;
  /** QUR-01: بازکردن پنل آیه */
  onVerseClick?: (block: PageBlock) => void;
  /** HAD-08: بازکردن اطلاعات روایت */
  onHadithClick?: (block: PageBlock) => void;
  /** READ-13: نمایش رنگ/نشان نقش‌های معنایی */
  semantic: boolean;
  /** شمارهٔ سطح تیتر (۱، ۲، ۳، ۴، ۵...) برای تایپوگرافی سلسله‌مراتبی و فاصله‌گذاری */
  headingLevel?: number;
  /** آیا این بلوک در ابتدای صفحه است (بدون متن قبلی) */
  isFirstOnPage?: boolean;
  /** نوع بلوک قبلی در صفحه (برای پیوستگی تیترهای متوالی) */
  prevBlockType?: string;
}

/** memo: در حالت پیوسته و رندرهای مکرر، بلوک‌های بی‌تغییر دوباره reconcile نمی‌شوند */
const BlockView = memo(function BlockView({
  block,
  prefs,
  highlight,
  userHls,
  collapsed,
  footnoteLabelFor,
  onFootnoteClick,
  onFootnoteEnter,
  onFootnoteLeave,
  onHighlightClick,
  onLinkClick,
  onToggleSanad,
  onVerseClick,
  onHadithClick,
  semantic,
  headingLevel,
  isFirstOnPage,
  prevBlockType,
}: BlockViewProps) {
  const ts = blockTextStyle(block, prefs);
  const style: React.CSSProperties = {
    fontSize: ts.fontSize,
    lineHeight: ts.lineHeight,
    fontFamily: ts.fontFamily,
  };
  const text = (
    <BlockText
      block={block}
      semantic={semantic}
      highlight={highlight}
      userHls={userHls}
      footnoteLabelFor={footnoteLabelFor}
      onFootnoteClick={onFootnoteClick}
      onFootnoteEnter={onFootnoteEnter}
      onFootnoteLeave={onFootnoteLeave}
      onHighlightClick={onHighlightClick}
      onLinkClick={onLinkClick}
    />
  );

  switch (block.type) {
    case "heading": {
      const rawLevel = headingLevel ?? block.level ?? 2;
      const level = Math.max(1, rawLevel);
      const isSubheading = prevBlockType === "heading";

      // فاصله‌گذاری سلسله‌مراتبی بر اساس سطح تیتر:
      // تیتر ۱ (بخش/باب): بیشترین فاصله از متن قبلی، فونت بزرگ، خط زیرین مشخص
      // تیتر ۲ (فصل): فاصله کمتر از اول، خط زیرین ملایم
      // تیتر ۳ (مبحث): فاصله کمتر از دوم
      // تیتر ۴ (مطلب): فاصله کمتر از سوم
      // تیتر ۵ و بعد (بند/عنوان فرعی): فاصله کمتر از چهارم
      if (level === 1) {
        const topSpacing = isFirstOnPage
          ? "mt-1 pt-0"
          : isSubheading
            ? "mt-5 md:mt-7 pt-0"
            : "mt-12 md:mt-16 pt-5 md:pt-6";
        return (
          <h2
            className={`${topSpacing} mb-4 pb-2.5 text-2xl md:text-3xl font-extrabold text-foreground border-b-2 border-border/80 leading-snug tracking-tight`}
            lang={ts.lang}
            dir={ts.dir}
            style={{ fontFamily: ts.fontFamily }}
          >
            {text}
          </h2>
        );
      }
      if (level === 2) {
        const topSpacing = isFirstOnPage
          ? "mt-1 pt-0"
          : isSubheading
            ? "mt-4 md:mt-5 pt-0"
            : "mt-10 md:mt-12 pt-4 md:pt-5";
        return (
          <h3
            className={`${topSpacing} mb-3 pb-2 text-xl md:text-2xl font-bold text-foreground border-b border-border/60 leading-snug`}
            lang={ts.lang}
            dir={ts.dir}
            style={{ fontFamily: ts.fontFamily }}
          >
            {text}
          </h3>
        );
      }
      if (level === 3) {
        const topSpacing = isFirstOnPage
          ? "mt-1 pt-0"
          : isSubheading
            ? "mt-3 md:mt-4 pt-0"
            : "mt-8 md:mt-10 pt-3 md:pt-4";
        return (
          <h4
            className={`${topSpacing} mb-2.5 pb-1 text-lg md:text-xl font-bold text-foreground/95 leading-snug`}
            lang={ts.lang}
            dir={ts.dir}
            style={{ fontFamily: ts.fontFamily }}
          >
            {text}
          </h4>
        );
      }
      if (level === 4) {
        const topSpacing = isFirstOnPage
          ? "mt-1 pt-0"
          : isSubheading
            ? "mt-2.5 md:mt-3 pt-0"
            : "mt-6 md:mt-8 pt-2 md:pt-3";
        return (
          <h5
            className={`${topSpacing} mb-2 pb-0.5 text-[1.1rem] md:text-lg font-bold text-foreground/90 leading-snug`}
            lang={ts.lang}
            dir={ts.dir}
            style={{ fontFamily: ts.fontFamily }}
          >
            {text}
          </h5>
        );
      }
      // level >= 5
      const topSpacing = isFirstOnPage
        ? "mt-1 pt-0"
        : isSubheading
          ? "mt-2 pt-0"
          : "mt-4 md:mt-6 pt-1.5 md:pt-2";
      return (
        <h6
          className={`${topSpacing} mb-1.5 pb-0.5 text-[1.02rem] md:text-base font-bold text-foreground/85 leading-snug`}
          lang={ts.lang}
          dir={ts.dir}
          style={{ fontFamily: ts.fontFamily }}
        >
          {text}
        </h6>
      );
    }
    case "sanad":
      return (
        <SanadBlock
          block={block}
          collapsed={collapsed}
          onToggle={onToggleSanad}
          onHadithClick={onHadithClick}
        >
          {text}
        </SanadBlock>
      );
    case "hadith_body":
      return (
        <div className="rounded-lg border-e-2 border-primary/30 bg-surface/40 py-1 pe-3 ps-0">
          <p lang="ar" dir="rtl" style={style}>
            {text}
          </p>
        </div>
      );
    case "ayah_quote": {
      const addr = citationAddress(block);
      const cit = block.citations?.[0];
      return (
        <figure className="rounded-xl border border-ayah/30 bg-ayah-soft px-4 py-3">
          <figcaption className="mb-1.5 flex flex-wrap items-center gap-2">
            <RoleBadge tone="green">آیه</RoleBadge>
            {cit ? (
              <button
                type="button"
                onClick={() => onVerseClick?.(block)}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-ayah/40 bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent md:min-h-7"
                aria-label="نمایش جزئیات آیه در پنل زمینه"
                title="نمایش جزئیات آیه در پنل زمینه"
              >
                <Landmark className="size-3.5 text-primary" aria-hidden="true" />
                {addr || "استناد قرآنی"}
              </button>
            ) : addr ? (
              <span className="text-xs text-muted-foreground">نشانی: {addr}</span>
            ) : null}
          </figcaption>
          <blockquote lang="ar" dir="rtl" style={style}>
            {text}
          </blockquote>
        </figure>
      );
    }
    case "b_note":
      return (
        <aside className="rounded-xl border border-border bg-sharh-soft px-4 py-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <RoleBadge tone="paper">بیان مؤلف</RoleBadge>
          </p>
          <p lang="fa" dir="rtl" style={style}>
            {text}
          </p>
        </aside>
      );
    case "sharh":
      return (
        <aside className="rounded-xl border border-border bg-sharh-soft px-4 py-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <RoleBadge tone="paper">شرح / بیان مؤلف</RoleBadge>
          </p>
          <p lang="fa" dir="rtl" style={style}>
            {text}
          </p>
        </aside>
      );
    case "maasoom":
      return (
        <div className="rounded-lg border border-ayah/25 bg-ayah-soft/60 px-3 py-2">
          <p className="mb-0.5">
            <RoleBadge tone="green">سخن معصوم</RoleBadge>
          </p>
          <p lang="ar" dir="rtl" style={style}>
            {text}
          </p>
        </div>
      );
    case "unknown":
      // تگ ناشناخته: فقط متن، بدون هیچ تفسیر و نقش‌دهی (§۱۹)
      return (
        <p lang={ts.lang} dir={ts.dir} style={style}>
          {block.text}
        </p>
      );
    default: {
      // p با استناد آیه (ayahAddress مستقل — QUR-02): بعد از متن، چیپ نشانی کلیک‌پذیر
      const cit = block.citations?.[0];
      if (cit) {
        return (
          <p lang={ts.lang} dir={ts.dir} style={style}>
            {text}{" "}
            <button
              type="button"
              onClick={() => onVerseClick?.(block)}
              className="inline-flex min-h-11 translate-y-0.5 items-center gap-1 rounded-full border border-ayah/40 bg-ayah-soft px-2.5 align-middle text-xs font-medium text-foreground transition-colors hover:bg-accent md:min-h-7"
              aria-label="نمایش جزئیات نشانی آیه در پنل زمینه"
              title="نمایش جزئیات نشانی آیه در پنل زمینه"
            >
              <Landmark className="size-3.5 text-primary" aria-hidden="true" />
              {citationAddress(block) || "استناد قرآنی"}
            </button>
          </p>
        );
      }
      return (
        <p lang={ts.lang} dir={ts.dir} style={style}>
          {text}
        </p>
      );
    }
  }
});

/* ---------- رندر صفحه ---------- */

export interface PageRendererProps {
  page: PagePayload;
  prefs: ReaderPrefs;
  /** نگاشت block_id → section_uid برای لنگرهای فهرست */
  sectionUidByBlockId: Record<string, string>;
  /** نگاشت block_id → level برای تعیین سطح سرتیتر */
  sectionLevelByBlockId?: Record<string, number>;
  /** بلوک مقصد پرش از فهرست — با رنگ زمینه ظریف برجسته می‌شود */
  flashBlockId?: string | null;
  /** بازهٔ highlight نتیجهٔ جست‌وجو (code point در بلوک) */
  highlight?: { start: number; end: number; blockId?: string | null } | null;
  /** هایلایت‌های شخصی کاربر برای همین صفحه — لنگر: blockId + بازهٔ cp (§۷-الف-۳) */
  userHighlights?: ReadonlyArray<Pick<Highlight, "uid" | "block_id" | "start" | "end" | "color">>;
  /** انتخاب متن → هایلایت با رنگ (اگر داده نشود دکمهٔ هایلایت نشان داده نمی‌شود) */
  onHighlightSelection?: (sel: ReaderSelection, color: HighlightColor) => void;
  /** تغییر رنگ هایلایت موجود (کلیک روی هایلایت در متن) */
  onHighlightUpdate?: (uid: string, color: HighlightColor) => void;
  /** حذف هایلایت موجود (کلیک روی هایلایت در متن) */
  onHighlightDelete?: (uid: string) => void;
  collapsedSanads: ReadonlySet<string>;
  onToggleSanad: (blockId: string) => void;
  onFootnoteClick: (refUid: string, anchorId: string) => void;
  onLinkClick: (link: BlockLink) => void;
  onSelection: (sel: ReaderSelection | null) => void;
  /** QUR-01: بازکردن پنل آیه */
  onVerseClick?: (block: PageBlock) => void;
  /** HAD-08: بازکردن اطلاعات روایت */
  onHadithClick?: (block: PageBlock) => void;
  /** حالت بدون قاب برای جریان پیوسته و یکپارچه متن */
  frameless?: boolean;
}

export function PageRenderer({
  page,
  prefs,
  sectionUidByBlockId,
  sectionLevelByBlockId,
  flashBlockId,
  highlight,
  userHighlights,
  onHighlightSelection,
  onHighlightUpdate,
  onHighlightDelete,
  collapsedSanads,
  onToggleSanad,
  onFootnoteClick,
  onLinkClick,
  onSelection,
  onVerseClick,
  onHadithClick,
  frameless,
}: PageRendererProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selRect, setSelRect] = useState<{ top: number; left: number } | null>(null);
  const [sel, setSel] = useState<ReaderSelection | null>(null);

  /* ---------- پاپ‌آپ هاور پاورقی (ریتم هوشمند: اولین هاور ۳ ثانیه، بعدی فوری) ---------- */
  const { delay: tempoDelay, onHoverEnter, onOpened } = useTooltipTempo();
  const [fnPopup, setFnPopup] = useState<{
    refUid: string;
    label: string;
    text: string;
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const fnOpenTimer = useRef<number | null>(null);
  const fnCloseTimer = useRef<number | null>(null);

  const clearFnTimers = useCallback(() => {
    if (fnOpenTimer.current) {
      window.clearTimeout(fnOpenTimer.current);
      fnOpenTimer.current = null;
    }
    if (fnCloseTimer.current) {
      window.clearTimeout(fnCloseTimer.current);
      fnCloseTimer.current = null;
    }
  }, []);

  const closeFnPopup = useCallback(() => {
    setFnPopup(null);
  }, []);

  const onFootnoteEnter = useCallback(
    (refUid: string, label: string, el: HTMLElement) => {
      onHoverEnter();
      clearFnTimers();
      fnOpenTimer.current = window.setTimeout(() => {
        fnOpenTimer.current = null;
        const wrap = wrapRef.current;
        if (!wrap) return;
        const fn = page.footnotes.find((f) => f.uid === refUid);
        const r = el.getBoundingClientRect();
        const w = wrap.getBoundingClientRect();
        const width = Math.min(288, w.width - 12);
        const top = r.bottom - w.top + 6;
        const left = Math.max(6, Math.min(r.left - w.left, w.width - width - 6));
        setFnPopup({ refUid, label, text: fn?.text ?? "", top, left, width });
        onOpened();
      }, tempoDelay);
    },
    [clearFnTimers, onHoverEnter, onOpened, page.footnotes, tempoDelay],
  );

  const onFootnoteLeave = useCallback(() => {
    /* تایمر بازشدن لغو می‌شود؛ بسته‌شدن نرم ۱۸۰ms تا حرکت به خود پاپ‌آپ */
    if (fnOpenTimer.current) {
      window.clearTimeout(fnOpenTimer.current);
      fnOpenTimer.current = null;
    }
    if (fnCloseTimer.current) window.clearTimeout(fnCloseTimer.current);
    fnCloseTimer.current = window.setTimeout(() => {
      fnCloseTimer.current = null;
      setFnPopup(null);
    }, 180);
  }, []);

  /* پاک‌شدن پاپ‌آپ‌ها با اسکرول/تغییر متن — مثل نوار انتخاب */
  useEffect(() => {
    if (!fnPopup) return;
    const onScroll = () => setFnPopup(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [fnPopup]);

  /* ---------- منوی هایلایت شخصی (تغییر رنگ / حذف) — با کلیک روی خود هایلایت ---------- */
  const [hlMenu, setHlMenu] = useState<{
    uid: string;
    color: string;
    top: number;
    left: number;
  } | null>(null);

  const onHighlightClick = useCallback(
    (uid: string, color: string, el: HTMLElement) => {
      if (uid.startsWith("temp-")) return; // هنوز در حال ذخیره — هنوز کنترلی ندارد
      const wrap = wrapRef.current;
      if (!wrap) return;
      const r = el.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      const top = Math.max(4, r.top - w.top - 46);
      const left = Math.max(6, Math.min(r.left - w.left, w.width - 268));
      setHlMenu({ uid, color, top, left });
    },
    [],
  );

  useEffect(() => {
    if (!hlMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-hl-menu]")) return;
      if (t?.closest("mark[data-hl-uid]")) return;
      setHlMenu(null);
    };
    const onScroll = () => setHlMenu(null);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [hlMenu]);

  /* هایلایت نتیجهٔ جست‌وجو: پس از رندر، به آن اسکرول می‌شود (یک بار برای هر بازه) */
  const hlKey = highlight ? `${highlight.start}:${highlight.end}:${highlight.blockId ?? ""}` : "";
  const lastScrolled = useRef<string>("");
  useEffect(() => {
    if (!hlKey || lastScrolled.current === hlKey) return;
    lastScrolled.current = hlKey;
    const t = window.setTimeout(() => {
      document.getElementById("reader-hl-anchor")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [hlKey]);

  const clearSelection = useCallback(() => {
    setSel(null);
    setSelRect(null);
  }, []);

  /* هایلایت‌های شخصی به تفکیک بلوک — identity پایدار برای memoizedهای BlockText (§۷-الف-۳) */
  const userHlByBlock = useMemo(() => {
    const map = new Map<string, Array<Pick<Highlight, "uid" | "start" | "end" | "color">>>();
    for (const h of userHighlights ?? []) {
      const arr = map.get(h.block_id);
      if (arr) arr.push({ uid: h.uid, start: h.start, end: h.end, color: h.color });
      else map.set(h.block_id, [{ uid: h.uid, start: h.start, end: h.end, color: h.color }]);
    }
    return map;
  }, [userHighlights]);

  const computeSelection = useCallback(() => {
    const wrapper = wrapRef.current;
    if (!wrapper) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0) {
      clearSelection();
      return;
    }
    const range = s.getRangeAt(0);
    if (!wrapper.contains(range.commonAncestorContainer)) {
      clearSelection();
      return;
    }
    const a = cpOffsetFromNode(range.startContainer, range.startOffset);
    const b = cpOffsetFromNode(range.endContainer, range.endOffset);
    const blockId = a.blockId ?? b.blockId;
    if (!blockId) {
      clearSelection();
      return;
    }
    const block = page.blocks.find((bl) => bl.id === blockId);
    if (!block) {
      clearSelection();
      return;
    }
    const blockLen = Array.from(block.text).length;
    let start: number;
    let end: number;
    if (a.blockId === b.blockId) {
      start = Math.min(a.cp, b.cp);
      end = Math.max(a.cp, b.cp);
    } else {
      // انتخاب چندبلوکی: به بلوک لنگر محدود می‌شود (snapshot فیش یک بازهٔ پیوسته است)
      if (a.blockId === blockId) {
        start = a.cp;
        end = blockLen;
      } else {
        start = 0;
        end = Math.min(b.cp, blockLen);
      }
      if (end < start) [start, end] = [end, start];
    }
    if (end - start < 1) {
      clearSelection();
      return;
    }
    const text = Array.from(block.text).slice(start, end).join("");
    const rect = range.getBoundingClientRect();
    const wrapRect = wrapper.getBoundingClientRect();
    setSelRect({ top: rect.top - wrapRect.top, left: rect.left - wrapRect.left });
    setSel({ blockId, start, end, text, hadithUid: block.hadith_uid ?? null });
  }, [clearSelection, page.blocks]);

  // با اسکرول، دکمهٔ شناور پاک می‌شود تا جای آن از متن جدا نماند
  useEffect(() => {
    if (!sel) return;
    const onScroll = () => clearSelection();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [sel, clearSelection]);

  useEffect(() => clearFnTimers, [clearFnTimers]);

  const footnoteLabelFor = useCallback(
    (refUid: string) => {
      const fn = page.footnotes.find((f) => f.uid === refUid);
      return fn?.label ?? null;
    },
    [page.footnotes],
  );

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative select-text",
        frameless
          ? "py-1"
          : "rounded-2xl border border-border bg-reader px-4 py-5 shadow-sm md:px-8 md:py-6"
      )}
      onMouseUp={computeSelection}
      onKeyUp={(e) => {
        if (e.shiftKey || e.key.startsWith("Arrow")) computeSelection();
      }}
    >
      {page.blocks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          این صفحه متنی برای نمایش ندارد.
        </p>
      ) : (
        page.blocks.map((block, idx) => {
          const sectionUid = sectionUidByBlockId[block.id];
          const flash = flashBlockId === block.id;
          const isFirstOnPage = idx === 0;
          const prevBlock = idx > 0 ? page.blocks[idx - 1] : null;
          const prevBlockType = prevBlock?.type;
          const hlHere =
            highlight && highlight.end > highlight.start
              ? highlight.blockId
                ? highlight.blockId === block.id
                : // بدون blockId: اولین بلوکی که بازه در آن جا می‌شود
                  idx === 0 && highlight.end <= Array.from(block.text).length
              : null;
          return (
            <div key={block.id} className="group">
              <div
                id={sectionUid ? `sec-block-${block.id}` : undefined}
                data-block-id={block.id}
                data-section-uid={sectionUid}
                className={`rounded-lg transition-colors duration-700 ${
                  flash ? "bg-match/40" : ""
                }`}
              >
                <BlockView
                  block={block}
                  prefs={prefs}
                  headingLevel={block.level ?? (sectionLevelByBlockId ? sectionLevelByBlockId[block.id] : undefined)}
                  isFirstOnPage={isFirstOnPage}
                  prevBlockType={prevBlockType}
                  highlight={hlHere && highlight ? highlight : null}
                  userHls={userHlByBlock.get(block.id)}
                  collapsed={collapsedSanads.has(block.id)}
                  footnoteLabelFor={footnoteLabelFor}
                  onFootnoteClick={onFootnoteClick}
                  onFootnoteEnter={onFootnoteEnter}
                  onFootnoteLeave={onFootnoteLeave}
                  onHighlightClick={onHighlightClick}
                  onLinkClick={onLinkClick}
                  onToggleSanad={onToggleSanad}
                  onVerseClick={onVerseClick}
                  onHadithClick={onHadithClick}
                  semantic={prefs.semantic_colors === true}
                />
              </div>
            </div>
          );
        })
      )}

      {/* نوار شناور روی انتخاب متن: ثبت فیش + (در صورت فعال بودن) هایلایت چندرنگ */}
      {sel && selRect ? (
        <div
          className="absolute z-20 flex items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-md"
          style={{ top: Math.max(selRect.top - 48, 4), left: selRect.left }}
        >
          <Button
            size="sm"
            className="min-h-11 gap-1.5 md:min-h-9"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onSelection(sel);
              clearSelection();
              window.getSelection()?.removeAllRanges();
            }}
          >
            <Quote className="size-4" aria-hidden="true" />
            ثبت فیش
          </Button>
          {onHighlightSelection ? (
            <>
              <div aria-hidden="true" className="mx-0.5 h-6 w-px bg-border" />
              <div role="group" aria-label="هایلایت متن با رنگ" className="flex items-center gap-1">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={`هایلایت ${c.label}`}
                    aria-label={`هایلایت ${c.label}`}
                    className={`size-5 rounded-full ${c.dotClass} min-h-0 w-5 ring-primary ring-offset-1 ring-offset-surface transition-transform hover:scale-110 hover:ring-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onHighlightSelection(sel, c.value);
                      clearSelection();
                      window.getSelection()?.removeAllRanges();
                    }}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {/* پاپ‌آپ پیش‌نمایش پاورقی — با هاور روی شمارهٔ پاورقی (بدون کلیک) */}
      {fnPopup ? (
        <div
          role="tooltip"
          data-testid="footnote-popup"
          className="absolute z-30 rounded-xl border border-border bg-popover p-3 shadow-lg"
          style={{ top: fnPopup.top, left: fnPopup.left, width: fnPopup.width }}
          onMouseEnter={() => {
            if (fnCloseTimer.current) {
              window.clearTimeout(fnCloseTimer.current);
              fnCloseTimer.current = null;
            }
          }}
          onMouseLeave={closeFnPopup}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
              <sup className="font-bold">({fnPopup.label})</sup>
              متن پاورقی
            </span>
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => {
                closeFnPopup();
                onFootnoteClick(fnPopup.refUid, "");
              }}
            >
              بازکردن در پنل
            </button>
          </div>
          <p
            lang="ar"
            dir="rtl"
            className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-6 text-foreground/90"
          >
            {fnPopup.text || "متن این پاورقی در نسخهٔ فعلی در دسترس نیست."}
          </p>
        </div>
      ) : null}

      {/* منوی کنترل هایلایت شخصی — با کلیک روی هایلایت: تغییر رنگ / حذف */}
      {hlMenu ? (
        <div
          data-hl-menu
          role="menu"
          aria-label="کنترل هایلایت"
          className="absolute z-30 flex items-center gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-md"
          style={{ top: hlMenu.top, left: hlMenu.left }}
        >
          <div role="group" aria-label="تغییر رنگ هایلایت" className="flex items-center gap-1">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="menuitemradio"
                aria-checked={hlMenu.color === c.value}
                title={c.label}
                aria-label={`رنگ ${c.label}`}
                className={cn(
                  "size-5 rounded-full min-h-0 w-5 transition-transform hover:scale-110",
                  c.dotClass,
                  hlMenu.color === c.value
                    ? "ring-2 ring-foreground/70 ring-offset-1 ring-offset-surface"
                    : "ring-1 ring-foreground/10",
                )}
                onClick={() => {
                  onHighlightUpdate?.(hlMenu.uid, c.value);
                  setHlMenu(null);
                }}
              />
            ))}
          </div>
          <div aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
          <button
            type="button"
            role="menuitem"
            className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            onClick={() => {
              onHighlightDelete?.(hlMenu.uid);
              setHlMenu(null);
            }}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            حذف
          </button>
        </div>
      ) : null}
    </div>
  );
}
