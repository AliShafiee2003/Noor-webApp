"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";

function storageKey(documentUid: string): string {
  return `noor:reader:approx-dismissed:${documentUid}`;
}

const subscribeNoop = () => () => {};

/**
 * هشدار شمارهٔ صفحهٔ تخمینی — اولین بار در فرمت صفحه‌ای دیده می‌شود و
 * برای همان کتاب رد می‌شود (کلید localStorage به ازای سند).
 */
export function PageMappingNotice({ documentUid }: { documentUid: string }) {
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(storageKey(documentUid)) === "1";
    } catch {
      return false;
    }
  }, [documentUid]);
  const stored = useSyncExternalStore(subscribeNoop, getSnapshot, () => false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  if (stored || dismissedFor === documentUid) return null;

  const close = () => {
    try {
      window.localStorage.setItem(storageKey(documentUid), "1");
    } catch {
      /* بی‌اهمیت — هشدار در همین نشست بسته می‌ماند */
    }
    setDismissedFor(documentUid);
  };

  return (
    <div className="mx-auto max-w-[760px] px-4 pt-2">
      <div className="flex items-start gap-1.5 rounded-md border border-match bg-match/20 py-1 pe-1 ps-2.5 text-[11px] text-foreground">
        <p className="flex-1 leading-5">
          مرز صفحه‌های چاپی این سند در منبع ثبت نشده و شمارهٔ صفحه تخمینی است؛ پیش از ارجاع با
          نسخهٔ چاپی تطبیق دهید.
        </p>
        <button
          type="button"
          onClick={close}
          aria-label="بستن هشدار شمارهٔ صفحهٔ تخمینی"
          title="بستن هشدار"
          className="-me-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
