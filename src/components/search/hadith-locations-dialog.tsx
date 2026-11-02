"use client";

/**
 * گفت‌وگوی «این روایت در چه کتاب‌هایی آمده؟» — §۴۷/HAD
 * - منبع داده: GET /documents/{uid}/hadiths/{local}/locations
 *   (متن بدنهٔ روایت از مدل سند ساخته می‌شود و با حالت normalized_phrase
 *   به‌صورت پلکانی در کل کتابخانه جست‌وجو می‌شود — گذرها در پاسخ گزارش می‌شوند.)
 * - صداقت نمایش (§۴۷): عنوان «منابع دارای این عبارت» است؛ ادعای یکسانیِ
 *   کامل روایت نمی‌شود و disclaimer سرور عیناً نمایش داده می‌شود.
 * - اگر اثری فقط با گذرِ بخش آغازین پیدا شده باشد، برچسب گذرِ کشفکننده
 *   کنارش می‌آید تا معلوم باشد متن کامل آنجا نیامده است.
 */
import { useQuery } from "@tanstack/react-query";
import {
  BookOpenText,
  ClipboardList,
  FileText,
  LibraryBig,
  Loader2,
  RotateCcw,
  Search,
  StickyNote,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HashLink } from "@/lib/hash-router";
import { api, errorMessage } from "@/lib/api";
import { faNum } from "@/lib/format";
import { readHref as readerHref } from "@/lib/href";
import { HighlightedSnippet } from "@/components/search/result-card";
import type { HadithLocationsResponse } from "@/lib/types";

interface DialogProps {
  documentUid: string;
  localHadithUid: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** RES: ثبت یادداشت روی همین روایت — والد به تب یادداشت‌ها با دامنهٔ روایت می‌رود */
  onNoteRequest?: (localUid: string, revayatIndex: string | null) => void;
}

export function HadithLocationsDialog({
  documentUid,
  localHadithUid,
  open,
  onOpenChange,
  onNoteRequest,
}: DialogProps) {
  const query = useQuery({
    queryKey: ["hadith-locations", documentUid, localHadithUid],
    queryFn: ({ signal }) =>
      // UIDها ممکن است «#» یا کاراکترهای URL-ناساز داشته باشند (دور ۱۸).
      api.get<HadithLocationsResponse>(
        `/documents/${encodeURIComponent(documentUid)}/hadiths/${encodeURIComponent(localHadithUid)}/locations`,
        undefined,
        signal,
      ),
    enabled: open && !!documentUid && !!localHadithUid,
    staleTime: 60_000,
    retry: false,
  });

  const data = query.data;
  const firstPassWorks = data?.passes?.[0]?.works_added ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <LibraryBig className="size-5 text-primary" aria-hidden="true" />
            این روایت در کدام منابع آمده است؟
          </DialogTitle>
          <DialogDescription>
            جست‌وجوی متن بدنهٔ روایت در کل کتابخانه؛ فهرست زیر «منابع دارای این
            عبارت» است — یکسانیِ کامل روایت بدون بررسی کارشناسی ادعا نمی‌شود.
          </DialogDescription>
        </DialogHeader>

        {query.isPending ? (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
            در حال جست‌وجوی متن روایت در کتابخانه…
          </div>
        ) : query.isError ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {errorMessage(query.error, "جست‌وجوی روایت با خطا روبه‌رو شد.")}
            </p>
            <Button
              variant="outline"
              className="min-h-10 gap-2"
              onClick={() => void query.refetch()}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              تلاش دوباره
            </Button>
          </div>
        ) : data ? (
          <div className="space-y-4">
            {/* شناسنامهٔ روایت */}
            <div className="rounded-xl border border-border bg-reader p-3.5">
              {data.hadith.body_excerpt ? (
                <p
                  lang="ar"
                  dir="rtl"
                  className="font-reader text-[15px] leading-8 text-foreground"
                >
                  {data.hadith.body_excerpt}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  متن بدنهٔ این روایت ثبت نشده است.
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="bg-surface font-normal text-muted-foreground">
                  روایت شمارهٔ {faNum(data.hadith.revayat_index ?? "—")}
                </Badge>
                <span className="bidi-ltr text-[11px] text-muted-foreground/80">
                  {data.hadith.local_uid}
                </span>
                {data.hadith.body_length ? (
                  <span className="text-[11px] text-muted-foreground/80">
                    {faNum(data.hadith.body_length)} نویسه
                  </span>
                ) : null}
                {onNoteRequest ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ms-auto min-h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() =>
                      onNoteRequest(data.hadith.local_uid, data.hadith.revayat_index ?? null)
                    }
                  >
                    <StickyNote className="size-3.5" aria-hidden="true" />
                    ثبت یادداشت روی این روایت
                  </Button>
                ) : null}
              </div>
              {data.query_truncated ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  متن بدنه از سقف جست‌وجوی عبارت بلندتر است؛ با بخش آغازین آن
                  جست‌وجو شد.
                </p>
              ) : null}
            </div>

            {/* یادداشت ویژهٔ سرور (مثلاً بدنهٔ متنی ندارد) */}
            {data.note ? (
              <p className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {data.note}
              </p>
            ) : null}

            {/* شمارش صادقانه */}
            {!data.note && (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                منابع دارای این عبارت: {faNum(data.verified_books)} اثر —{" "}
                {faNum(data.verified_occurrences)} موضع تأییدشده
              </p>
            )}

            {/* گروه‌بندی اثر → جلدها با شاهد */}
            {data.groups.length > 0 ? (
              <ul className="space-y-3">
                {data.groups.map((g, gi) => {
                  const relaxedNote =
                    gi >= firstPassWorks && data.passes && data.passes.length > 1
                      ? (data.passes[1]?.note ?? null)
                      : null;
                  const groupClips = g.documents.reduce(
                    (n, d) => n + (d.my_clips ?? 0),
                    0,
                  );
                  return (
                    <li
                      key={g.work.uid + "-loc-" + gi}
                      className="anim-rise quiet-card rounded-xl border border-border bg-surface p-3.5 transition-shadow hover:shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="flex items-center gap-2 text-sm font-semibold">
                          <span
                            aria-hidden="true"
                            className="flex size-7 items-center justify-center rounded-lg bg-primary/10"
                          >
                            <LibraryBig className="size-4 text-primary" />
                          </span>
                          {g.work.title}
                        </h4>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {groupClips > 0 ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-primary/40 bg-primary/5 font-normal text-primary"
                            >
                              <ClipboardList className="size-3" aria-hidden="true" />
                              {faNum(groupClips)} فیش من
                            </Badge>
                          ) : null}
                          <Badge variant="secondary" className="font-normal">
                            {faNum(
                              g.documents.reduce(
                                (n, d) => n + (d.verified_occurrences ?? 0),
                                0,
                              ),
                            )}{" "}
                            موضع تأییدشده
                          </Badge>
                        </div>
                      </div>
                      {relaxedNote ? (
                        <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground/90">
                          این اثر با جست‌وجوی «{relaxedNote}» پیدا شد؛ یعنی متن
                          کامل بدنه در آن نیامده و بخشی از روایت نقل شده است.
                        </p>
                      ) : null}
                      <ul className="mt-2.5 space-y-2.5">
                        {g.documents.map((d, di) => {
                          const ev = d.evidence?.[0];
                          const pg = ev?.page?.uid ?? null;
                          const docUid = d.document.uid;
                          return (
                            <li
                              key={docUid + "-doc-" + di}
                              className="rounded-lg border border-border/70 bg-background/60 p-2.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                  <FileText className="size-3.5" aria-hidden="true" />
                                  {d.document.label || "جلد"}
                                  <span aria-hidden="true">·</span>
                                  {faNum(d.verified_occurrences ?? 0)} موضع
                                  {d.my_clips ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                      <ClipboardList className="size-3" aria-hidden="true" />
                                      {faNum(d.my_clips)} فیش
                                    </span>
                                  ) : null}
                                </p>
                                {docUid ? (
                                  <HashLink
                                    to={readerHref(docUid)}
                                    query={pg ? { pg } : undefined}
                                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                                  >
                                    <BookOpenText className="size-3.5" aria-hidden="true" />
                                    بازکردن در متن
                                  </HashLink>
                                ) : null}
                              </div>
                              {ev?.snippet ? (
                                <blockquote className="mt-2 border-s-2 border-match/60 ps-2.5">
                                  <HighlightedSnippet
                                    snippet={ev.snippet}
                                    highlight={ev.highlight}
                                  />
                                </blockquote>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            ) : !data.note ? (
              <div className="rounded-xl border border-dashed border-border p-5 text-center">
                <Search className="mx-auto size-6 text-muted-foreground/60" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium">در منابع موجود یافت نشد</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  هیچ منبعی از کتابخانهٔ حاضر، عبارتی از متن این روایت را دربر
                  ندارد؛ این «نبودِ تطبیق» است، نه نبودِ محتوا.
                </p>
              </div>
            ) : null}

            {/* سلب‌مسئولیت عیناً از سرور (§۴۷) */}
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              {data.disclaimer}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
