"use client";

/**
 * پنل زمینه (READ-05/READ-06): نمایش متن پاورقی، جزئیات ارجاع،
 * پنل آیه (QUR-01/02) و اطلاعات روایت (HAD-08).
 * - در دسکتاپ ستون چپ؛ در موبایل داخل Sheet.
 * - بستن با «بازگشت» — فوکوس به ارجاع برمی‌گردد (مدیریت فوکوس در والد).
 */
import { ArrowRight, BookOpen, Footprints, Landmark, LibraryBig, Link2Off, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { faNum } from "@/lib/format";
import type { AyahCitation } from "@/lib/types";

export interface FootnotePanelData {
  kind: "footnote" | "link" | "verse" | "hadith";
  /** پاورقی */
  uid?: string;
  label?: string;
  text?: string;
  /** ارجاع حل‌نشده (REL-10) */
  originalAddress?: string;
  /** پنل آیه — نقل‌شده از کتاب، جدا از متن معیار (QUR-01/02) */
  verse?: {
    citation: AyahCitation;
    quotedText?: string | null;
    inHadith?: string | null;
    hasParent?: boolean;
  };
  /** اطلاعات روایت — نمایشی (HAD-08) */
  hadith?: {
    localUid: string;
    revayatIndex?: string | null;
    blockCount?: number;
  };
}

/** عنوان استناد: سوره/آیه یا بازه، با ارقام فارسی */
function citationTitle(cit: AyahCitation): string {
  const sure = cit.sure ? faNum(cit.sure) : null;
  const ayaFrom = cit.aya_from ? faNum(cit.aya_from) : null;
  const ayaTo = cit.aya_to ? faNum(cit.aya_to) : null;
  const aya = cit.aya ? faNum(cit.aya) : null;
  if (ayaFrom && ayaTo) return `سورهٔ ${sure ?? "—"}، آیهٔ ${ayaFrom} تا ${ayaTo}`;
  if (aya) return `سورهٔ ${sure ?? "—"}، آیهٔ ${aya}`;
  if (ayaFrom) return `سورهٔ ${sure ?? "—"}، از آیهٔ ${ayaFrom}`;
  return cit.address || "استناد قرآنی";
}

export function FootnotePanel({
  data,
  onBack,
  onHadithLookup,
}: {
  data: FootnotePanelData | null;
  onBack: () => void;
  /** §۴۷: پرس‌وجوی میان‌کتابی روایت — والد دیالوگ را با شناسهٔ محلی باز می‌کند */
  onHadithLookup?: (localUid: string) => void;
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
            جزئیات ارجاع‌ها، آیه‌ها و روایت‌ها نیز همین‌جا نمایش داده می‌شود.
          </p>
        </div>
      </div>
    );
  }

  if (data.kind === "verse" && data.verse) {
    const cit = data.verse.citation;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1.5 px-2 md:min-h-8"
            onClick={onBack}
            aria-label="بازگشت به متن"
          >
            <ArrowRight className="size-4" aria-hidden="true" />
            بازگشت
          </Button>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Landmark className="size-4 text-primary" aria-hidden="true" />
            پنل آیه
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            <dl className="space-y-2 rounded-xl border border-border bg-surface p-3 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">نشانی:</dt>
                <dd className="font-medium">{citationTitle(cit)}</dd>
              </div>
              {cit.sure ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">شمارهٔ سوره:</dt>
                  <dd className="bidi-ltr">{faNum(cit.sure)}</dd>
                </div>
              ) : null}
              {cit.aya ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">شمارهٔ آیه:</dt>
                  <dd className="bidi-ltr">{faNum(cit.aya)}</dd>
                </div>
              ) : null}
              {data.verse.inHadith ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">درون روایت:</dt>
                  <dd className="bidi-ltr">{data.verse.inHadith}</dd>
                </div>
              ) : null}
            </dl>

            {data.verse.quotedText ? (
              <figure className="rounded-xl border border-ayah/30 bg-ayah-soft px-4 py-3">
                <figcaption className="mb-1.5 text-xs font-medium text-muted-foreground">
                  متن نقل‌شده در این کتاب:
                </figcaption>
                <blockquote lang="ar" dir="rtl" className="text-[15px] leading-9">
                  {data.verse.quotedText}
                </blockquote>
              </figure>
            ) : null}

            <p className="flex items-start gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-xs leading-6 text-muted-foreground">
              <BookOpen className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              این نقلِ کتاب است و با متن معیار قرآن یکسان فرض نمی‌شود؛ مطالعهٔ متن معیار از
              مصدر آن انجام شود.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (data.kind === "hadith" && data.hadith) {
    const h = data.hadith;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1.5 px-2 md:min-h-8"
            onClick={onBack}
            aria-label="بازگشت به متن"
          >
            <ArrowRight className="size-4" aria-hidden="true" />
            بازگشت
          </Button>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <ScrollText className="size-4 text-primary" aria-hidden="true" />
            اطلاعات روایت
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            <dl className="space-y-2 rounded-xl border border-border bg-surface p-3 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">شمارهٔ روایت (RevayatIndex):</dt>
                <dd className="font-semibold text-primary">
                  {h.revayatIndex ? faNum(h.revayatIndex) : "ثبت نشده"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">شناسهٔ محلی سند:</dt>
                <dd className="bidi-ltr text-muted-foreground">{h.localUid}</dd>
              </div>
              {typeof h.blockCount === "number" ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">بخش‌های این روایت در صفحه:</dt>
                  <dd>{faNum(String(h.blockCount))}</dd>
                </div>
              ) : null}
            </dl>
            {onHadithLookup && h.localUid ? (
              <Button
                variant="outline"
                className="min-h-11 w-full gap-2"
                onClick={() => onHadithLookup(h.localUid)}
              >
                <LibraryBig className="size-4" aria-hidden="true" />
                این روایت در کدام کتاب‌ها آمده است؟
              </Button>
            ) : null}
            <p className="rounded-xl border border-border bg-muted px-3 py-2.5 text-xs leading-6 text-muted-foreground">
              شمارهٔ روایت، شناسهٔ درون‌منبع است و فقط برای پیگیری در همین کتاب کاربرد دارد؛
              شناسهٔ محلی به هیچ کتاب دیگر تعمیم نمی‌یابد.
            </p>
          </div>
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
