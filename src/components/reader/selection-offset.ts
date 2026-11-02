/**
 * ریاضیات انتخاب متن → بازهٔ code point در بلوک (READ-15 / §۷-الف-۳).
 * مشترک دسکتاپ (PageRenderer) و موبایل (حباب انتخاب).
 */

import type { PageBlock } from "@/lib/types";

/** یک قطعهٔ انتخاب در یک بلوک — انتخاب چندپاراگرافی به همین قطعه‌ها شکسته می‌شود. */
export interface SelectionSegment {
  blockId: string;
  start: number;
  end: number;
  text: string;
}

export interface ReaderSelection {
  blockId: string;
  start: number;
  end: number;
  text: string;
  hadithUid?: string | null;
  /** قطعه‌های انتخاب در بلوک‌های پوشش‌داده‌شده (به ترتیب سند). */
  segments?: SelectionSegment[];
}

/** نگاشت آفست UTF-16 گرهٔ متنی به code point داخل بلوک */
export function cpOffsetFromNode(
  node: Node | null,
  offset: number,
  atEnd = false,
): { blockId: string | null; cp: number } {
  if (!node) return { blockId: null, cp: 0 };
  let textNode: Text | null = null;
  let utf16Offset = offset;
  if (node.nodeType === Node.TEXT_NODE) {
    textNode = node as Text;
  } else {
    /* مرز روی گرهٔ عنصری (مثلاً selectNodeContents صفحه) — به نزدیک‌ترین متن برگ برو */
    const el = node as Element;
    const child = atEnd
      ? (offset >= el.childNodes.length
          ? el.lastChild
          : el.childNodes[Math.max(0, offset - 1)])
      : (el.childNodes[offset] ?? el.firstChild);
    if (!child) return { blockId: null, cp: 0 };
    let leaf: Node | null = child;
    if (leaf.nodeType !== Node.TEXT_NODE) {
      const tw = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
      if (atEnd) {
        let t = tw.nextNode();
        while (t) {
          leaf = t;
          t = tw.nextNode();
        }
        if (leaf === child) return { blockId: null, cp: 0 };
      } else {
        leaf = tw.nextNode();
        if (!leaf) return { blockId: null, cp: 0 };
      }
    }
    textNode = leaf as Text;
    utf16Offset = atEnd ? (textNode.textContent ?? "").length : 0;
  }
  if (!textNode) return { blockId: null, cp: 0 };
  const spanEl = textNode.parentElement?.closest<HTMLElement>("span[data-cp-start], mark[data-cp-start]");
  const blockEl = textNode.parentElement?.closest<HTMLElement>("[data-block-id]");
  if (!blockEl) return { blockId: null, cp: 0 };
  const base = spanEl ? Number(spanEl.dataset.cpStart ?? 0) : 0;
  const rel = Array.from((textNode.textContent ?? "").slice(0, utf16Offset)).length;
  return { blockId: blockEl.dataset.blockId ?? null, cp: base + rel };
}

/**
 * Range مرورگر → ReaderSelection.
 * انتخاب چندبلوکی به قطعه‌های مستقل در هر بلوک شکسته می‌شود تا هایلایت
 * همهٔ پاراگراف‌های انتخاب‌شده را بپوشاند؛ لنگر اصلی همچنان بلوک اول است.
 */
export function selectionFromRange(
  range: Range,
  root: HTMLElement,
  getBlock: (blockId: string) => PageBlock | undefined,
): ReaderSelection | null {
  if (range.collapsed) return null;
  if (!root.contains(range.commonAncestorContainer)) return null;

  const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]"));
  const segments: SelectionSegment[] = [];
  let anchorHadith: string | null | undefined;

  for (const el of elements) {
    /* ظرفِ دربرگیرندهٔ بلوک‌های تودرتو دوبار شمرده نمی‌شود */
    if (el.querySelector("[data-block-id]")) continue;
    const blockId = el.dataset.blockId;
    if (!blockId) continue;
    let intersects = false;
    try {
      intersects = range.intersectsNode(el);
    } catch {
      intersects = false;
    }
    if (!intersects) continue;
    const block = getBlock(blockId);
    if (!block) continue;
    const blockLen = Array.from(block.text).length;
    const start = el.contains(range.startContainer)
      ? cpOffsetFromNode(range.startContainer, range.startOffset).cp
      : 0;
    const end = el.contains(range.endContainer)
      ? cpOffsetFromNode(range.endContainer, range.endOffset, true).cp
      : blockLen;
    const from = Math.max(0, Math.min(start, blockLen));
    const to = Math.max(0, Math.min(end, blockLen));
    if (to <= from) continue;
    if (segments.length === 0) anchorHadith = block.hadith_uid;
    segments.push({
      blockId,
      start: from,
      end: to,
      text: Array.from(block.text).slice(from, to).join(""),
    });
  }

  if (!segments.length) return null;
  const first = segments[0];
  const sameHadith =
    anchorHadith != null &&
    segments.every((s) => getBlock(s.blockId)?.hadith_uid === anchorHadith);
  return {
    blockId: first.blockId,
    start: first.start,
    end: first.end,
    text: segments.map((s) => s.text).join("\n"),
    hadithUid: sameHadith ? anchorHadith : null,
    segments,
  };
}

/** قطعه‌های هایلایت برای یک انتخاب؛ انتخاب‌های تک‌بلوکی همیشه یک قطعه دارند. */
export function selectionSegments(sel: ReaderSelection): SelectionSegment[] {
  if (sel.segments?.length) return sel.segments;
  return [{ blockId: sel.blockId, start: sel.start, end: sel.end, text: sel.text }];
}
