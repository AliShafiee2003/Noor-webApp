"use client";

/**
 * رندر بلوک‌های ساخت‌یافتهٔ صفحه (READ-05..READ-15):
 * - type=p|heading|sanad|hadith_body|ayah_quote|b_note|sharh|maasoom|unknown
 * - نقش‌های span: sanad/G/K/maasoom/ayah_text/B/sharh/unknown — تگ ناشناخته هرگز تفسیر نمی‌شود.
 * - آفست‌ها code point است (تبدیل به UTF-16 با Array.from).
 * - ارجاع حل‌نشده: پیام فارسی + نشانی اصلی، بدون هدایت حدسی (REL-10) — در والد مدیریت می‌شود.
 * - انتخاب متن → دکمهٔ شناور «ثبت فیش» با آفست code point داخل بلوک.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Landmark, Quote, ScrollText, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { faNum } from "@/lib/format";
import type {
  BlockLink,
  BlockSpan,
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

function fontFamilyFor(prefs: ReaderPrefs): string {
  return prefs.font_family === "vazirmatn"
    ? "var(--font-ui)"
    : "var(--font-arabic)";
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
  onFootnoteClick,
  onLinkClick,
  semantic,
}: {
  block: PageBlock;
  footnoteLabelFor: (refUid: string) => string | null;
  highlight: { start: number; end: number; blockId?: string | null } | null;
  onFootnoteClick: (refUid: string, anchorId: string) => void;
  onLinkClick: (link: BlockLink) => void;
  semantic: boolean;
}) {
  const cps = useMemo(() => Array.from(block.text), [block.text]);
  const cpLen = cps.length;

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
    if (highlight && highlight.end > highlight.start) {
      out.push({
        start: Math.max(0, Math.min(highlight.start, cpLen)),
        end: Math.max(0, Math.min(highlight.end, cpLen)),
        priority: 0,
        isHl: true,
      });
    }
    return out;
  }, [block, cpLen, highlight]);

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
        if (mark.isHl) {
          return (
            <mark
              key={i}
              id="reader-hl-anchor"
              data-cp-start={seg.start}
              data-cp-end={seg.end}
              className="rounded-sm bg-match px-0.5 text-foreground"
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
              className="mx-0.5 inline cursor-pointer align-super text-[0.62em] font-semibold text-link hover:underline"
              onClick={() => onFootnoteClick(mark.refUid as string, anchorId)}
              aria-label={`نمایش پاورقی ${label}`}
              title="نمایش پاورقی"
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
              <Tooltip key={i}>
                <TooltipTrigger asChild>
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
              <Tooltip key={i}>
                <TooltipTrigger asChild>
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
              <Tooltip key={i}>
                <TooltipTrigger asChild>
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
            return (
              <span
                key={i}
                data-cp-start={seg.start}
                data-cp-end={seg.end}
                className="rounded bg-ayah-soft px-0.5"
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
  collapsed: boolean;
  footnoteLabelFor: (refUid: string) => string | null;
  onFootnoteClick: (refUid: string, anchorId: string) => void;
  onLinkClick: (link: BlockLink) => void;
  onToggleSanad: (blockId: string) => void;
  /** QUR-01: بازکردن پنل آیه */
  onVerseClick?: (block: PageBlock) => void;
  /** HAD-08: بازکردن اطلاعات روایت */
  onHadithClick?: (block: PageBlock) => void;
  /** READ-13: نمایش رنگ/نشان نقش‌های معنایی */
  semantic: boolean;
}

function BlockView({
  block,
  prefs,
  highlight,
  collapsed,
  footnoteLabelFor,
  onFootnoteClick,
  onLinkClick,
  onToggleSanad,
  onVerseClick,
  onHadithClick,
  semantic,
}: BlockViewProps) {
  const isPersian = blockIsPersian(block);
  const style: React.CSSProperties = {
    fontSize: `${prefs.font_size}px`,
    lineHeight: prefs.line_height,
    fontFamily: isPersian ? "var(--font-ui)" : fontFamilyFor(prefs),
  };
  const text = (
    <BlockText
      block={block}
      semantic={semantic}
      highlight={highlight}
      footnoteLabelFor={footnoteLabelFor}
      onFootnoteClick={onFootnoteClick}
      onLinkClick={onLinkClick}
    />
  );

  switch (block.type) {
    case "heading":
      // از BlockText می‌رود تا هایلایت نتیجهٔ جست‌وجو درون سرفصل هم دیده شود
      return (
        <h3
          className="mt-6 mb-2 border-b border-border/70 pb-1.5 text-xl font-bold text-foreground first:mt-0"
          lang={isPersian ? "fa" : "ar"}
          dir="rtl"
          style={{ fontFamily: isPersian ? "var(--font-ui)" : fontFamilyFor(prefs) }}
        >
          {text}
        </h3>
      );
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
        <p lang="ar" dir="rtl" style={style}>
          {block.text}
        </p>
      );
    default: {
      // p با استناد آیه (ayahAddress مستقل — QUR-02): بعد از متن، چیپ نشانی کلیک‌پذیر
      const cit = block.citations?.[0];
      if (cit) {
        return (
          <p lang={isPersian ? "fa" : "ar"} dir="rtl" style={style}>
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
        <p lang={isPersian ? "fa" : "ar"} dir="rtl" style={style}>
          {text}
        </p>
      );
    }
  }
}

/* ---------- رندر صفحه ---------- */

export interface PageRendererProps {
  page: PagePayload;
  prefs: ReaderPrefs;
  /** نگاشت block_id → section_uid برای لنگرهای فهرست */
  sectionUidByBlockId: Record<string, string>;
  /** بلوک مقصد پرش از فهرست — با رنگ زمینه ظریف برجسته می‌شود */
  flashBlockId?: string | null;
  /** بازهٔ highlight نتیجهٔ جست‌وجو (code point در بلوک) */
  highlight?: { start: number; end: number; blockId?: string | null } | null;
  collapsedSanads: ReadonlySet<string>;
  onToggleSanad: (blockId: string) => void;
  onFootnoteClick: (refUid: string, anchorId: string) => void;
  onLinkClick: (link: BlockLink) => void;
  onSelection: (sel: ReaderSelection | null) => void;
  /** QUR-01: بازکردن پنل آیه */
  onVerseClick?: (block: PageBlock) => void;
  /** HAD-08: بازکردن اطلاعات روایت */
  onHadithClick?: (block: PageBlock) => void;
}

export function PageRenderer({
  page,
  prefs,
  sectionUidByBlockId,
  flashBlockId,
  highlight,
  collapsedSanads,
  onToggleSanad,
  onFootnoteClick,
  onLinkClick,
  onSelection,
  onVerseClick,
  onHadithClick,
}: PageRendererProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selRect, setSelRect] = useState<{ top: number; left: number } | null>(null);
  const [sel, setSel] = useState<ReaderSelection | null>(null);

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
      className="relative select-text rounded-2xl border border-border bg-reader px-4 py-5 shadow-sm md:px-8 md:py-6"
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
          const untaggedRun =
            block.untagged === true &&
            (idx === 0 || page.blocks[idx - 1]?.untagged !== true);
          const hlHere =
            highlight && highlight.end > highlight.start
              ? highlight.blockId
                ? highlight.blockId === block.id
                : // بدون blockId: اولین بلوکی که بازه در آن جا می‌شود
                  idx === 0 && highlight.end <= Array.from(block.text).length
              : null;
          return (
            <div key={block.id} className="group">
              {untaggedRun ? (
                <p className="mt-5 mb-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground first:mt-0">
                  <span
                    className="inline-block size-1.5 rounded-full bg-muted-foreground/60"
                    aria-hidden="true"
                  />
                  این منبع نشانه‌گذاری تخصصی ندارد
                </p>
              ) : null}
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
                  highlight={hlHere && highlight ? highlight : null}
                  collapsed={collapsedSanads.has(block.id)}
                  footnoteLabelFor={footnoteLabelFor}
                  onFootnoteClick={onFootnoteClick}
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

      {/* دکمهٔ شناور «ثبت فیش» روی انتخاب متن */}
      {sel && selRect ? (
        <div
          className="absolute z-20"
          style={{ top: Math.max(selRect.top - 44, 4), left: selRect.left }}
        >
          <Button
            size="sm"
            className="min-h-11 gap-1.5 shadow-md md:min-h-9"
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
        </div>
      ) : null}
    </div>
  );
}
