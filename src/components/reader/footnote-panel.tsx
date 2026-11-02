"use client";

/**
 * پنل زمینه (READ-05/READ-06): نمایش متن پاورقی، جزئیات ارجاع،
 * پنل آیه (QUR-01/02) و اطلاعات روایت (HAD-08).
 * - در دسکتاپ ستون چپ؛ در موبایل داخل Sheet.
 * - بستن با «بازگشت» — فوکوس به ارجاع برمی‌گردد (مدیریت فوکوس در والد).
 */
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  ClipboardList,
  Footprints,
  FolderOpen,
  Landmark,
  LibraryBig,
  Link2Off,
  RotateCcw,
  ScrollText,
  StickyNote,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HashLink } from "@/lib/hash-router";
import { api, errorMessage } from "@/lib/api";
import { faDate, faNum } from "@/lib/format";
import { displayBookText } from "@/lib/reader/display-text";
import type { AyahCitation, HadithClipSummary } from "@/lib/types";

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

/** برچسب و رنگ نوع فیش — هم‌واژگان پروژه (project-view) */
const KIND_META: Record<HadithClipSummary["kind"], { label: string; className: string }> = {
  original: { label: "نقل‌قول اصل", className: "bg-primary/10 text-primary" },
  as_read: { label: "متن خوانده‌شده", className: "bg-ayah/20 text-foreground" },
  note: { label: "یادداشت", className: "bg-muted text-foreground" },
};

/** فیش‌های این روایت از همهٔ پرونده‌های کاربر — GET /my/clips */
function HadithClipsSection({
  documentUid,
  localUid,
  onFiche,
}: {
  documentUid: string;
  localUid: string;
  onFiche?: () => void;
}) {
  const query = useQuery({
    queryKey: ["hadith-clips", documentUid, localUid],
    queryFn: ({ signal }) =>
      api.get<{ items: HadithClipSummary[] }>(
        "/my/clips",
        { document_uid: documentUid, local_hadith_uid: localUid },
        signal,
      ),
    staleTime: 15_000,
    retry: false,
  });

  const clips = query.data?.items ?? [];

  return (
    <section aria-label="فیش‌های این روایت" className="space-y-2">
      <div className="flex items-center gap-2">
        <ClipboardList className="size-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">فیش‌های این روایت</h3>
        {!query.isPending && !query.isError ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {faNum(clips.length)} فیش
          </span>
        ) : null}
      </div>

      {query.isPending ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <span className="sr-only">در حال بارگیری فیش‌های این روایت…</span>
        </div>
      ) : query.isError ? (
        <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {errorMessage(query.error, "فهرست فیش‌های این روایت در دسترس نیست.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-9 gap-1.5"
            onClick={() => void query.refetch()}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" /> تلاش دوباره
          </Button>
        </div>
      ) : clips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-3 text-center">
          <p className="text-xs font-medium">از این روایت هنوز فیشی ثبت نکرده‌اید</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            با دکمهٔ «ثبت فیش این روایت» یا انتخاب متنِ روایت، آن را به یک پرونده بیفزایید.
          </p>
          {onFiche ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 min-h-9 gap-1.5"
              onClick={onFiche}
            >
              <ClipboardList className="size-3.5" aria-hidden="true" />
              ثبت فیش این روایت
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-2">
          {clips.map((c) => {
            const meta = KIND_META[c.kind] ?? KIND_META.original;
            return (
              <li
                key={c.uid}
                className="anim-rise quiet-card rounded-xl border border-border bg-surface p-2.5"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <FolderOpen className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{c.project_name || "پرونده"}</span>
                  </span>
                  {c.page_label ? (
                    <span className="text-[11px] text-muted-foreground/80">
                      ص {faNum(c.page_label)}
                    </span>
                  ) : null}
                  {c.updated_at ? (
                    <span className="ms-auto text-[10px] text-muted-foreground/70">
                      {faDate(c.updated_at)}
                    </span>
                  ) : null}
                </div>
                <p
                  lang="ar"
                  dir="rtl"
                  className="mt-1.5 line-clamp-3 font-reader text-[13px] leading-7 text-foreground"
                >
                  {c.quote_original}
                </p>
                {c.note ? (
                  <p className="mt-1 whitespace-pre-wrap border-t border-border/60 pt-1.5 text-[12px] leading-6 text-muted-foreground">
                    {c.note}
                  </p>
                ) : null}
                <div className="mt-1.5">
                  <HashLink
                    to={`/project/${c.project_uid}`}
                    className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                  >
                    <FolderOpen className="size-3" aria-hidden="true" />
                    گشودن پرونده
                  </HashLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function FootnotePanel({
  data,
  onBack,
  onHadithLookup,
  onHadithNote,
  /** RES: ثبت فیش این روایت — والد فیش کامل روایت را به دیالوگ فیش می‌دهد */
  onHadithFiche,
  /** برای «فیش‌های این روایت» — بدون آن بخش فیش‌ها نمایش داده نمی‌شود */
  documentUid,
}: {
  data: FootnotePanelData | null;
  onBack: () => void;
  /** §۴۷: پرس‌وجوی میان‌کتابی روایت — والد دیالوگ را با شناسهٔ محلی باز می‌کند */
  onHadithLookup?: (localUid: string) => void;
  /** RES: ثبت یادداشت روی همین روایت — والد به تب یادداشت‌ها با دامنهٔ روایت می‌رود */
  onHadithNote?: (localUid: string, revayatIndex?: string | null) => void;
  /** RES: ثبت فیش این روایت — با متن کامل روایت در همین صفحه */
  onHadithFiche?: (localUid: string, revayatIndex?: string | null) => void;
  documentUid?: string;
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
    const hasAddress = !!(cit.address?.trim() || cit.sure || cit.aya || cit.aya_from || cit.aya_to);
    const hasMetadata = hasAddress || !!data.verse.inHadith;
    const quotedText = displayBookText(data.verse.quotedText ?? "").trim();
    return (
      <div dir="rtl" className="reader-verse-panel flex h-full min-h-0 flex-col text-right text-foreground">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1.5 px-2 md:min-h-8"
            onClick={onBack}
            aria-label="بازگشت به متن"
            style={{ color: "var(--text)" }}
          >
            <ArrowRight className="size-4" aria-hidden="true" />
            بازگشت
          </Button>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Landmark className="size-4 text-foreground" aria-hidden="true" />
            پنل آیه
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            {hasMetadata ? <dl aria-label="اطلاعات استناد قرآنی" className="space-y-2 rounded-xl border border-border bg-surface p-3 text-[13px]">
              {hasAddress ? <div className="flex items-center justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">نشانی:</dt>
                <dd className="font-medium text-right">{citationTitle(cit)}</dd>
              </div> : null}
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
            </dl> : null}

            {quotedText ? (
              <figure className="rounded-xl border border-ayah/30 bg-ayah-soft px-4 py-3">
                <figcaption className="mb-1.5 text-xs font-medium text-foreground">
                  متن نقل‌شده در این کتاب:
                </figcaption>
                <blockquote lang="ar" dir="rtl" className="whitespace-pre-wrap text-right text-[15px] leading-9 text-foreground">
                  {quotedText}
                </blockquote>
              </figure>
            ) : null}

            <p className="flex items-start gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-xs leading-6 text-foreground">
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
            {onHadithNote && h.localUid ? (
              <Button
                variant="outline"
                className="min-h-11 w-full gap-2"
                onClick={() => onHadithNote(h.localUid, h.revayatIndex ?? null)}
              >
                <StickyNote className="size-4" aria-hidden="true" />
                ثبت یادداشت روی این روایت
              </Button>
            ) : null}
            {onHadithFiche && h.localUid ? (
              <Button
                className="min-h-11 w-full gap-2"
                onClick={() => onHadithFiche(h.localUid, h.revayatIndex ?? null)}
              >
                <ClipboardList className="size-4" aria-hidden="true" />
                ثبت فیش این روایت
              </Button>
            ) : null}
            {documentUid && h.localUid ? (
              <HadithClipsSection
                documentUid={documentUid}
                localUid={h.localUid}
                onFiche={
                  onHadithFiche
                    ? () => onHadithFiche(h.localUid, h.revayatIndex ?? null)
                    : undefined
                }
              />
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
