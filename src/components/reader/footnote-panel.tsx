"use client";

/**
 * پنل زمینه (READ-05/READ-06): نمایش متن پاورقی و جزئیات ارجاع.
 * - در دسکتاپ ستون چپ؛ در موبایل داخل Sheet.
 * - بستن با «بازگشت» — فوکوس به ارجاع برمی‌گردد (مدیریت فوکوس در والد).
 */
import { ArrowRight, Footprints, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FootnotePanelData {
  kind: "footnote" | "link";
  /** پاورقی */
  uid?: string;
  label?: string;
  text?: string;
  /** ارجاع حل‌نشده (REL-10) */
  originalAddress?: string;
}

export function FootnotePanel({
  data,
  onBack,
}: {
  data: FootnotePanelData | null;
  onBack: () => void;
}) {
  if (!data) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Footprints className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">زمینه</h2>
        </div>
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-center text-xs leading-6 text-muted-foreground">
            برای نمایش پاورقی، روی نشانهٔ آن در متن بزنید.
            <br />
            جزئیات ارجاع‌های متن نیز همین‌جا نمایش داده می‌شود.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 gap-1.5 px-2 md:min-h-8"
          onClick={onBack}
          aria-label="بازگشت به متن و ارجاع"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
          بازگشت
        </Button>
        <h2 className="text-sm font-semibold">
          {data.kind === "footnote" ? `پاورقی ${data.label ?? ""}` : "ارجاع"}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {data.kind === "footnote" ? (
          <div className="space-y-3">
            {data.label ? (
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                شمارهٔ {data.label}
              </span>
            ) : null}
            <p
              lang="ar"
              dir="rtl"
              className="whitespace-pre-wrap text-sm leading-8 text-foreground"
            >
              {data.text}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-match bg-match/25 px-3 py-3">
              <Link2Off className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden="true" />
              <p className="text-[13px] leading-6 text-foreground">
                مقصد این ارجاع در مجموعهٔ موجود قابل حل نیست؛ نشانی اصلی حفظ شده است.
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">نشانی اصلی:</p>
              <p
                className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] leading-6"
                dir="rtl"
              >
                {data.originalAddress}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
