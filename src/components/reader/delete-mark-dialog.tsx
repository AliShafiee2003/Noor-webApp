"use client";

import { Bookmark, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { faNum } from "@/lib/format";
import { markNoteCount, type PageMark } from "@/lib/reader/marks";

/**
 * تأیید حذف نشانک صفحه‌ای که چند یادداشت دارد.
 * برای ۰ یا ۱ یادداشت، حذف در هوک مستقیم انجام می‌شود و این دیالوگ باز نمی‌شود.
 */
export function DeleteMarkDialog({
  mark,
  pending,
  onConfirm,
  onCancel,
}: {
  mark: PageMark | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const count = mark ? markNoteCount(mark) : 0;
  const pageLabel =
    mark?.pageLabel && mark.pageLabel !== "—" ? `صفحهٔ ${faNum(mark.pageLabel)}` : "این صفحه";
  return (
    <AlertDialog open={!!mark} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Bookmark className="size-4 text-destructive" aria-hidden="true" />
            حذف نشانک این صفحه؟
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 leading-6">
            <span className="block">
              {pageLabel} {faNum(count)} یادداشت دارد. با حذف نشانک صفحه، همهٔ یادداشت‌ها و
              هایلایت‌های دارای یادداشتِ این صفحه هم حذف می‌شوند.
            </span>
            <span className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              این کار بازگشت‌پذیر نیست.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">انصراف</AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11 bg-destructive text-white hover:bg-destructive/90"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "در حال حذف…" : "حذف همه"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
