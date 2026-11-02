"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { useReaderAnnotations, highlightDeleteMessage } from "@/lib/reader/use-reader-annotations";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-color";
import type { Highlight, HighlightColor } from "@/lib/types";

const drafts = new Map<string, { color: HighlightColor; note: string }>();

export function HighlightSheet({ highlightUid, documentUid, onClose, inline = false }: {
  highlightUid: string;
  documentUid: string;
  onClose: () => void;
  inline?: boolean;
}) {
  const query = useQuery({ queryKey: ["annotations", documentUid],
    queryFn: () => api.get<{ items: Highlight[] }>("/annotations", { document_uid: documentUid }), staleTime: 15_000 });
  const annotation = query.data?.items.find((h) => h.uid === highlightUid);
  const saved = annotation ?? { uid: highlightUid, color: "yellow" as HighlightColor, note: null, text: "" };
  const operations = useReaderAnnotations(documentUid);
  const draftKey = `${documentUid}:${highlightUid}`;
  const [color, setColor] = useState<HighlightColor>(drafts.get(draftKey)?.color ?? saved.color);
  const [note, setNote] = useState(drafts.get(draftKey)?.note ?? saved.note ?? "");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "close" | null>(null);
  const dirty = color !== saved.color || note !== (saved.note ?? "");

  const close = () => {
    if (pending.current) return;
    if (dirty) setConfirm("close");
    else { drafts.delete(draftKey); onClose(); }
  };
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const updated = await operations.update(saved.uid, { color, note: note || null });
      drafts.delete(draftKey);
      setNote(updated.note ?? "");
      setColor(updated.color);
    } catch (err) {
      setError(errorMessage(err, "ذخیره نشد؛ دوباره تلاش کنید."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const remove = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await operations.remove(saved.uid);
      drafts.delete(draftKey);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "حذف نشد؛ دوباره تلاش کنید."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const body = <>
        {inline ? <div className="p-4"><h3 className="font-semibold">هایلایت و یادداشت</h3><p className="text-sm text-muted-foreground">رنگ و یادداشت این بخش از کتاب را ویرایش کنید.</p><Button variant="ghost" onClick={close}>بستن</Button></div> : <SheetHeader>
          <SheetTitle>هایلایت و یادداشت</SheetTitle>
          <SheetDescription>رنگ و یادداشت این بخش از کتاب را ویرایش کنید.</SheetDescription>
        </SheetHeader>}
        <div className="space-y-4 px-4">
          <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted p-3 text-start" dir="auto">{saved.text}</blockquote>
          <fieldset disabled={busy} className="space-y-2">
            <legend className="mb-2 text-sm">رنگ هایلایت</legend>
            <div className="flex flex-wrap gap-2">
              {HIGHLIGHT_COLORS.map((c) => <button key={c.value} type="button" aria-label={c.label} aria-pressed={color === c.value}
                onClick={() => { setColor(c.value); drafts.set(draftKey, { color: c.value, note }); }} className={`flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 ${color === c.value ? "border-foreground" : "border-transparent"}`}>
                <span className={`size-6 rounded-full ${c.dotClass}`} />
              </button>)}
            </div>
            <label htmlFor="rm-highlight-note" className="block text-sm">یادداشت این هایلایت</label>
            <Textarea id="rm-highlight-note" dir="auto" value={note} onChange={(e) => { setNote(e.target.value); drafts.set(draftKey, { color, note: e.target.value }); }} className="min-h-28" />
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {confirm ? <div className="space-y-3 rounded-xl border p-3" role="alertdialog" aria-label={confirm === "delete" ? "تأیید حذف" : "تغییرات ذخیره‌نشده"}>
            <p>{confirm === "delete" ? highlightDeleteMessage({ note: saved.note || note }) : "تغییرات ذخیره‌نشده کنار گذاشته شوند؟"}</p>
            <div className="flex gap-2">
              <Button variant="destructive" disabled={busy} onClick={() => confirm === "delete" ? void remove() : (drafts.delete(draftKey), onClose())}>{confirm === "delete" ? "حذف" : "کنار گذاشتن"}</Button>
              <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>انصراف</Button>
            </div>
          </div> : <div className="flex gap-2">
            <Button disabled={busy || !dirty} onClick={() => void save()}>{busy ? "در حال ذخیره…" : "ذخیره تغییرات"}</Button>
            <Button
              variant="outline"
              disabled={busy}
              className="border-destructive/60 bg-destructive/5 text-destructive hover:bg-destructive/15 hover:text-destructive"
              onClick={() => setConfirm("delete")}
            >
              حذف هایلایت
            </Button>
          </div>}
        </div>
      </>;
  if (!annotation) return <p role="status" className="p-4">هایلایت در دسترس نیست. <Button onClick={onClose}>بستن</Button></p>;
  if (inline) return <section aria-label="هایلایت و یادداشت" className="h-full overflow-y-auto pb-4" dir="rtl">{body}</section>;
  return <Sheet open onOpenChange={(open) => { if (!open) close(); }}>
    <SheetContent ref={contentRef} tabIndex={-1} side="bottom" dir="rtl" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[max(16px,env(safe-area-inset-bottom))]"
      onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }} onCloseAutoFocus={(e) => e.preventDefault()}>
      {body}
    </SheetContent>
  </Sheet>;
}
