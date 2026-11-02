import type { Bookmark, Highlight, HighlightColor, Note, PageRef } from "@/lib/types";

/**
 * «نشانه» = نشانک صفحه، یادداشت صفحه، یا هایلایتِ دارای یادداشت.
 * هایلایت بدون یادداشت نشانک نیست.
 */
export interface PageMark {
  pageUid: string;
  pageLabel: string | null;
  serial: number | null;
  bookmark: Bookmark | null;
  notes: Note[];
  highlightNotes: HighlightGroup[];
}

/**
 * یک انتخاب چندپاراگرافی در سرور چند ردیف جدا دارد؛ این‌جا به یک گروه
 * نمایشی تبدیل می‌شود تا متن کامل و حذف گروهی یک‌جا دیده شود.
 */
export interface HighlightGroup {
  /** uid لنگر — قطعه‌ای که متن کامل انتخاب را نگه می‌دارد */
  uid: string;
  groupUid: string | null;
  anchor: Highlight;
  segments: Highlight[];
  text: string;
  note: string | null;
  color: HighlightColor;
  pageUid: string;
  blockId: string;
}

export interface BuildMarksInput {
  bookmarks: Bookmark[];
  notes: Note[];
  annotations: Highlight[];
  pageRefs: PageRef[];
}

export interface MarksData {
  pageMarks: PageMark[];
  /** یادداشت‌های سند/اثر بدون صفحه — در گروه «بدون صفحه» */
  documentNotes: Note[];
}

export function markNoteCount(mark: PageMark): number {
  return mark.notes.length + mark.highlightNotes.length;
}

const cpLength = (value: string) => Array.from(value).length;

/** هایلایت‌ها را بر اساس group_uid (یا uid برای هایلایت تک‌قطعه‌ای) گروه می‌کند. */
export function groupHighlights(items: Highlight[]): HighlightGroup[] {
  const byKey = new Map<string, Highlight[]>();
  for (const item of items) {
    const key = item.group_uid ? `g:${item.group_uid}` : `u:${item.uid}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(item);
    else byKey.set(key, [item]);
  }
  return [...byKey.values()].map((segments) => {
    const anchor = segments.reduce(
      (best, item) => (cpLength(item.text) > cpLength(best.text) ? item : best),
      segments[0],
    );
    const note = segments.find((item) => item.note?.trim())?.note?.trim() ?? null;
    return {
      uid: anchor.uid,
      groupUid: anchor.group_uid ?? null,
      anchor,
      segments,
      text: anchor.text,
      note,
      color: anchor.color,
      pageUid: anchor.page_uid,
      blockId: anchor.block_id,
    };
  });
}

export function buildPageMarks(input: BuildMarksInput): MarksData {
  const refByUid = new Map(input.pageRefs.map((p) => [p.page_uid, p]));
  const marks = new Map<string, PageMark>();

  const ensure = (pageUid: string): PageMark => {
    let mark = marks.get(pageUid);
    if (!mark) {
      const ref = refByUid.get(pageUid);
      mark = {
        pageUid,
        pageLabel: ref?.label ?? null,
        serial: ref?.serial ?? null,
        bookmark: null,
        notes: [],
        highlightNotes: [],
      };
      marks.set(pageUid, mark);
    }
    return mark;
  };

  for (const bookmark of input.bookmarks) {
    const mark = ensure(bookmark.page_uid);
    // نشانک تکراری (بدون قید unique در سرور) — اولین رکورد مرجع است
    if (!mark.bookmark) {
      mark.bookmark = bookmark;
      if (!mark.pageLabel && bookmark.label) mark.pageLabel = bookmark.label;
    }
  }

  const documentNotes: Note[] = [];
  for (const note of input.notes) {
    if (!note.page_uid) {
      if (!note.local_hadith_uid) documentNotes.push(note);
      continue;
    }
    if (note.local_hadith_uid) continue;
    ensure(note.page_uid).notes.push(note);
  }

  for (const group of groupHighlights(input.annotations)) {
    if (!group.note) continue;
    ensure(group.pageUid).highlightNotes.push(group);
  }

  const pageMarks = [...marks.values()].sort(compareMarks);
  documentNotes.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  return { pageMarks, documentNotes };
}

function compareMarks(a: PageMark, b: PageMark): number {
  const sa = a.serial ?? Number.POSITIVE_INFINITY;
  const sb = b.serial ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa - sb;
  return (a.pageLabel ?? a.pageUid).localeCompare(b.pageLabel ?? b.pageUid, "fa", { numeric: true });
}
