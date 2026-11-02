"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Highlighter,
  Loader2,
  Pencil,
  Share2,
  StickyNote,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { faDateTime, faNum } from "@/lib/format";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-color";
import { markNoteCount, type PageMark } from "@/lib/reader/marks";
import type { Highlight, Note } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface NoteEditing {
  uid: string;
  body: string;
  version: number;
}

export interface MarksListProps {
  marks: PageMark[];
  documentNotes: Note[];
  currentPageUid: string | null;
  anchorStatus?: Record<string, "ok" | "missing">;
  editing: NoteEditing | null;
  editError: string | null;
  onBeginEdit: (note: Note) => void;
  onEditChange: (body: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (uid: string, version: number, body: string) => void;
  onDeleteNote: (note: Note) => void;
  onShareNote: (note: Note) => void;
  sharingUid: string | null;
  onDeleteHighlight: (highlight: Highlight) => void;
  onOpenHighlight: (uid: string) => void;
  onDeletePageMark: (pageUid: string) => void;
  onJumpMark: (mark: PageMark) => void;
  busy?: boolean;
}

function pageTitle(mark: PageMark): string {
  if (mark.pageLabel && mark.pageLabel !== "—") return `صفحهٔ ${faNum(mark.pageLabel)}`;
  return mark.pageUid === "__doc" ? "بدون صفحه" : "صفحهٔ نامعلوم";
}

function NoteEditor({
  editing,
  editError,
  onEditChange,
  onCancelEdit,
  onSaveEdit,
}: Pick<MarksListProps, "editing" | "editError" | "onEditChange" | "onCancelEdit" | "onSaveEdit">) {
  if (!editing) return null;
  return (
    <div className="space-y-2">
      <Textarea
        aria-label="ویرایش یادداشت"
        value={editing.body}
        onChange={(e) => onEditChange(e.target.value)}
        className="min-h-24 resize-y text-sm"
      />
      {editError ? (
        <p role="alert" className="flex items-start gap-1.5 text-[11px] text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {editError}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">نسخهٔ مبنا: {faNum(editing.version)}</span>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="min-h-9 gap-1" onClick={onCancelEdit}>
            <X className="size-3.5" aria-hidden="true" /> انصراف
          </Button>
          <Button
            size="sm"
            className="min-h-9 gap-1"
            disabled={!editing.body.trim()}
            onClick={() => onSaveEdit(editing.uid, editing.version, editing.body.trim())}
          >
            <Check className="size-3.5" aria-hidden="true" /> ذخیره
          </Button>
        </div>
      </div>
    </div>
  );
}

function NoteRow({
  note,
  currentPageUid,
  expanded,
  onToggleExpand,
  editing,
  editError,
  onBeginEdit,
  onEditChange,
  onCancelEdit,
  onSaveEdit,
  onDeleteNote,
  onShareNote,
  sharingUid,
}: {
  note: Note;
  currentPageUid: string | null;
  expanded: boolean;
  onToggleExpand: () => void;
} & Pick<
  MarksListProps,
  | "editing"
  | "editError"
  | "onBeginEdit"
  | "onEditChange"
  | "onCancelEdit"
  | "onSaveEdit"
  | "onDeleteNote"
  | "onShareNote"
  | "sharingUid"
>) {
  if (editing?.uid === note.uid) {
    return (
      <div className="rounded-xl border border-primary/30 bg-surface p-3">
        <NoteEditor
          editing={editing}
          editError={editError}
          onEditChange={onEditChange}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
        />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <button
        type="button"
        className="block w-full text-start"
        onClick={onToggleExpand}
        aria-expanded={expanded}
      >
        <p
          className={cn(
            "whitespace-pre-wrap text-[13px] leading-7 text-foreground",
            !expanded && "line-clamp-3",
          )}
        >
          {note.body}
        </p>
        {note.body.length > 140 ? (
          <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
            {expanded ? "بستن" : "نمایش کامل"}
          </span>
        ) : null}
      </button>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
            <StickyNote className="size-3" aria-hidden="true" />
            {note.page_uid
              ? note.page_uid === currentPageUid
                ? "همین صفحه"
                : note.page_label && note.page_label !== "—"
                  ? `صفحهٔ ${faNum(note.page_label)}`
                  : "صفحهٔ دیگر"
              : "بدون صفحه"}
          </span>
          {note.updated_at ? <span>{faDateTime(note.updated_at)}</span> : null}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="اشتراک‌گذاری یادداشت"
            title="اشتراک‌گذاری یادداشت (کپی لینک)"
            className="size-8"
            disabled={sharingUid === note.uid}
            onClick={() => onShareNote(note)}
          >
            {sharingUid === note.uid ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Share2 className="size-3.5" aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="ویرایش یادداشت"
            title="ویرایش یادداشت"
            className="size-8"
            onClick={() => onBeginEdit(note)}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="حذف یادداشت"
            title="حذف یادداشت"
            className="size-8 text-destructive hover:text-destructive"
            onClick={() => onDeleteNote(note)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MarksList({
  marks,
  documentNotes,
  currentPageUid,
  anchorStatus,
  editing,
  editError,
  onBeginEdit,
  onEditChange,
  onCancelEdit,
  onSaveEdit,
  onDeleteNote,
  onShareNote,
  sharingUid,
  onDeleteHighlight,
  onOpenHighlight,
  onDeletePageMark,
  onJumpMark,
  busy,
}: MarksListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const currentRef = useRef<HTMLDivElement | null>(null);

  const toggleExpand = (uid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentPageUid]);

  if (marks.length === 0 && documentNotes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-center">
        <Bookmark className="mx-auto size-5 text-muted-foreground/60" aria-hidden="true" />
        <p className="mt-1.5 text-xs font-medium">هنوز نشانکی ثبت نشده است</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          صفحه را نشانک کنید یا روی متنی یادداشت بنویسید؛ هر دو اینجا و به ترتیب صفحه دیده می‌شوند.
        </p>
      </div>
    );
  }

  const sharedNoteProps = {
    currentPageUid,
    editing,
    editError,
    onBeginEdit,
    onEditChange,
    onCancelEdit,
    onSaveEdit,
    onDeleteNote,
    onShareNote,
    sharingUid,
  };

  return (
    <div className="space-y-3">
      {marks.map((mark) => {
        const isCurrent = mark.pageUid === currentPageUid;
        const count = markNoteCount(mark);
        return (
          <article
            key={mark.pageUid}
            ref={isCurrent ? currentRef : undefined}
            data-mark-page={mark.pageUid}
            data-bm-uid={mark.bookmark?.uid ?? mark.pageUid}
            className={cn(
              "rounded-xl border bg-surface",
              isCurrent ? "border-primary/40" : "border-border",
            )}
          >
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
              <button
                type="button"
                onClick={() => onJumpMark(mark)}
                className="min-h-9 flex-1 text-start text-[13px] font-semibold text-foreground hover:text-primary"
                title={isCurrent ? "رفتن به این صفحه" : `رفتن به ${pageTitle(mark)}`}
              >
                {pageTitle(mark)}
              </button>
              {count > 0 ? (
                <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                  {faNum(count)} یادداشت
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">
                  <Bookmark className="size-3" aria-hidden="true" />
                  نشانک صفحه
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="min-h-9 px-2 text-[11px] text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => onDeletePageMark(mark.pageUid)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                حذف نشانک صفحه
              </Button>
            </div>

            <div className="space-y-2 p-2.5">
              {mark.notes.map((note) => (
                <NoteRow
                  key={note.uid}
                  note={note}
                  expanded={expanded.has(note.uid)}
                  onToggleExpand={() => toggleExpand(note.uid)}
                  {...sharedNoteProps}
                />
              ))}

              {mark.highlightNotes.map((group) => {
                const dot = HIGHLIGHT_COLORS.find((c) => c.value === group.color);
                const isOpen = expanded.has(group.uid);
                return (
                  <div key={group.uid} className="rounded-xl border border-border bg-surface p-3">
                    {anchorStatus?.[group.uid] === "missing" ? (
                      <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-5 text-amber-700 dark:text-amber-400">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        لنگر یافت نشد — متن نسخه تغییر کرده است
                      </p>
                    ) : null}
                    <div className="flex items-start gap-1.5">
                      <span
                        className={cn("mt-2 inline-block size-2.5 shrink-0 rounded-full", dot?.dotClass ?? "bg-yellow-500")}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 px-2 py-1.5 text-[12px] leading-6 text-muted-foreground"
                          data-hl-quote={group.uid}
                        >
                          {group.text}
                        </div>
                        {group.note ? (
                          <p
                            className={cn(
                              "mt-2 whitespace-pre-wrap text-[13px] leading-7 text-foreground",
                              !isOpen && "line-clamp-3",
                            )}
                          >
                            {group.note}
                          </p>
                        ) : null}
                        {group.note && group.note.length > 140 ? (
                          <button
                            type="button"
                            className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary"
                            onClick={() => toggleExpand(group.uid)}
                            aria-expanded={isOpen}
                          >
                            <ChevronDown className={cn("size-3 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                            {isOpen ? "بستن" : "نمایش کامل"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          <Highlighter className="size-3" aria-hidden="true" />
                          یادداشت روی متن
                        </span>
                        {group.segments.length > 1 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                            {faNum(group.segments.length)} پاراگراف
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-8 gap-1 px-2 text-[11px]"
                          onClick={() => onOpenHighlight(group.uid)}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" /> ویرایش
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="حذف یادداشت"
                          title="حذف یادداشت و هایلایت"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => onDeleteHighlight(group.anchor)}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}

      {documentNotes.length > 0 ? (
        <article data-mark-page="__doc" className="rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <StickyNote className="size-4 text-primary" aria-hidden="true" />
            <h3 className="flex-1 text-[13px] font-semibold">یادداشت‌های بدون صفحه</h3>
            <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
              {faNum(documentNotes.length)}
            </span>
          </div>
          <div className="space-y-2 p-2.5">
            {documentNotes.map((note) => (
              <NoteRow
                key={note.uid}
                note={note}
                expanded={expanded.has(note.uid)}
                onToggleExpand={() => toggleExpand(note.uid)}
                {...sharedNoteProps}
              />
            ))}
          </div>
        </article>
      ) : null}
    </div>
  );
}
