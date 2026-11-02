"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cpOffsetFromNode } from "@/components/reader/selection-offset";

export interface ReaderLocation {
  document_uid: string;
  page_uid: string;
  block_id?: string;
  offset_cp?: number;
  sub?: number;
}

export function captureReaderLocation(documentUid: string, pageUid: string): ReaderLocation {
  const fallback = { document_uid: documentUid, page_uid: pageUid };
  const root = document.querySelector<HTMLElement>("#rm-scroll") ?? document.querySelector<HTMLElement>('main[aria-label="متن کتاب"]');
  if (!root) return fallback;
  const rect = root.getBoundingClientRect();
  const line = rect.top + Math.min(96, rect.height / 4);
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]"))
    .filter((el) => !el.closest(".rm-measurer") && el.getBoundingClientRect().bottom > line && el.getBoundingClientRect().top < rect.bottom);
  const block = blocks[0];
  if (!block) return fallback;
  const blockRect = block.getBoundingClientRect();
  const x = getComputedStyle(block).direction === "rtl" ? blockRect.right - 8 : blockRect.left + 8;
  const y = Math.max(line, blockRect.top + 4);
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  const caret = doc.caretPositionFromPoint?.(x, y);
  const range = !caret ? document.caretRangeFromPoint?.(x, y) : null;
  const offset = cpOffsetFromNode(caret?.offsetNode ?? range?.startContainer ?? null, caret?.offset ?? range?.startOffset ?? 0);
  return { ...fallback, page_uid: block.closest<HTMLElement>("[data-page-uid]")?.dataset.pageUid ?? pageUid,
    block_id: block.dataset.blockId, offset_cp: offset.blockId === block.dataset.blockId ? offset.cp : 0 };
}

/** Returns false until the destination's DOM exists (for async page loading/pagination). */
export function restoreReaderLocation(location: ReaderLocation): boolean {
  const root = document.querySelector<HTMLElement>("#rm-scroll") ?? document.querySelector<HTMLElement>('main[aria-label="متن کتاب"]');
  if (!root) return false;
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]"));
  const block = blocks.find((el) => el.dataset.blockId === location.block_id && !el.closest(".rm-measurer"));
  const section = Array.from(root.querySelectorAll<HTMLElement>("[data-page-uid]")).find((el) => el.dataset.pageUid === location.page_uid);
  const target = block ?? section;
  if (!target) return false;
  let top = target.getBoundingClientRect().top;
  if (block) {
    const segments = Array.from(block.querySelectorAll<HTMLElement>("[data-cp-start][data-cp-end]"));
    const cp = location.offset_cp ?? 0;
    const segment = segments.find((el) => +el.dataset.cpStart! <= cp && +el.dataset.cpEnd! > cp);
    if (segment) {
      const walker = document.createTreeWalker(segment, NodeFilter.SHOW_TEXT);
      let remaining = cp - Number(segment.dataset.cpStart);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const chars = Array.from(node.textContent ?? "");
        if (remaining <= chars.length) {
          const range = document.createRange();
          range.setStart(node, chars.slice(0, remaining).join("").length);
          range.collapse(true);
          top = range.getBoundingClientRect().top;
          break;
        }
        remaining -= chars.length;
      }
    }
  }
  root.scrollTop += top - root.getBoundingClientRect().top - 96;
  return true;
}

type History = { back: ReaderLocation[]; fwd: ReaderLocation[] };
const storageKey = "noor:reader-navigation";
function load(): History {
  try {
    const data = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as History | null;
    const valid = (items: ReaderLocation[] | undefined) => Array.isArray(items) ? items.filter((p) => typeof p.document_uid === "string" && typeof p.page_uid === "string").slice(-50) : [];
    return { back: valid(data?.back), fwd: valid(data?.fwd) };
  } catch { return { back: [], fwd: [] }; }
}
export function useReaderNavigation() {
  const [counts, setCounts] = useState({ back: 0, fwd: 0 });
  const history = useRef<History | null>(null);
  const sync = useCallback(() => {
    const value = history.current!;
    setCounts({ back: value.back.length, fwd: value.fwd.length });
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Storage can be unavailable. */ }
  }, []);
  const record = useCallback((current: ReaderLocation) => {
    const value = history.current ??= load();
    const previous = value.back.at(-1);
    if (previous && previous.document_uid === current.document_uid && previous.page_uid === current.page_uid && previous.block_id === current.block_id && previous.offset_cp === current.offset_cp) return;
    value.back = [...value.back, current].slice(-50);
    value.fwd = [];
    sync();
  }, [sync]);
  const step = useCallback((direction: "back" | "fwd", current: ReaderLocation) => {
    const value = history.current ??= load();
    const target = value[direction].pop();
    if (!target) return null;
    const other = direction === "back" ? "fwd" : "back";
    value[other] = [...value[other], current].slice(-50);
    sync();
    return target;
  }, [sync]);
  useEffect(() => {
    const timer = setTimeout(() => { history.current = load(); sync(); }, 0);
    return () => clearTimeout(timer);
  }, [sync]);
  return { counts, record, step };
}
