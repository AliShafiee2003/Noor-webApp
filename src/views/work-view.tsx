"use client";

/**
 * صفحهٔ اثر — مشخصات کتاب + اسناد (جلد/مدخل جدا) با پوشش صریح هر سند.
 * دادهٔ null همیشه «ثبت نشده» نمایش داده می‌شود (حدس ممنوع — LIB-09).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AudioPlayer } from "@/components/media/audio-player";
import { ErrorState } from "@/components/feedback";
import { api, errorMessage, mediaFileUrl } from "@/lib/api";
import { HashLink, useRoute } from "@/lib/hash-router";
import { faNum } from "@/lib/format";
import { decoratePathWithSlug, readHref } from "@/lib/href";
import {
  coverageKeys,
  coverageLabels,
  documentFormatLabel,
  documentKindLabel,
  languageLabel,
} from "@/lib/labels";
import { useAuthStore } from "@/store/auth";
import { useToast } from "@/hooks/use-toast";
import type { CoverageState, WorkDetail } from "@/lib/types";

function coverageBadgeClass(state: CoverageState): string {
  switch (state) {
    case "supported":
      return "border-ayah/40 bg-ayah-soft text-foreground";
    case "partial":
      return "border-match bg-match/30 text-foreground";
    case "failed":
      return "border-destructive/40 bg-destructive/10 text-foreground";
    case "absent":
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function UnknownValue() {
  return <span className="text-muted-foreground">ثبت نشده</span>;
}

function SpecRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="w-24 shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

/** جلدِ سند (jpg) با جایگزین متنی در صورت خطا — <img> ساده است چون کوکی نشست لازم است */
function DocumentCover({ uid, label }: { uid: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="flex h-28 w-20 items-center justify-center rounded-md border border-border bg-muted text-center text-[10px] leading-4 text-muted-foreground"
        aria-hidden="true"
      >
        {label}
      </div>
    );
  }
  return (
    <img
      src={mediaFileUrl(uid)}
      alt={`جلد ${label}`}
      loading="lazy"
      className="h-28 w-auto rounded-md border border-border object-cover shadow-xs"
      onError={() => setFailed(true)}
    />
  );
}

function DocumentCard({
  doc,
  onOpen,
}: {
  doc: WorkDetail["documents"][number];
  onOpen: (uid: string) => void;
}) {
  const format = doc.format ?? "text";
  const openable = format === "text" || format === "pdf";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{doc.label}</h3>
              <Badge variant="secondary" className="font-normal">
                {documentKindLabel(doc.kind)}
              </Badge>
              <Badge variant="outline" className="font-normal">
                {documentFormatLabel(format)}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {doc.pages_count !== null && doc.pages_count !== undefined ? (
                <>
                  {faNum(doc.pages_count)} صفحه
                  {doc.language ? ` · ${languageLabel(doc.language)}` : ""}
                </>
              ) : doc.language ? (
                languageLabel(doc.language)
              ) : format === "image" ? (
                "تصویر جلد"
              ) : (
                "شمار صفحه‌ها: ثبت نشده"
              )}
            </p>
            {format === "audio" ? (
              <AudioPlayer documentUid={doc.uid} className="mt-3" />
            ) : null}
          </div>
          {format === "image" ? (
            <DocumentCover uid={doc.uid} label={doc.label} />
          ) : openable ? (
            <Button className="min-h-11 gap-2" onClick={() => onOpen(doc.uid)}>
              <BookOpen className="size-4" aria-hidden="true" />
              {format === "pdf" ? "بازکردن نسخهٔ اسکن‌شده" : "بازکردن مطالعه"}
            </Button>
          ) : null}
        </div>

        {format === "text" ? (
          <>
            <p className="mt-4 text-xs font-medium text-muted-foreground">
              پوشش ثبت‌شده برای این سند
            </p>
            <div
              className="mt-1.5 flex flex-wrap gap-1.5"
              aria-label={`پوشش سند ${doc.label}`}
            >
              {coverageKeys.map(({ key, label }) => {
                const state = doc.coverage?.[key] ?? "absent";
                return (
                  <Badge
                    key={key}
                    variant="outline"
                    className={`font-normal ${coverageBadgeClass(state)}`}
                    title={`${label}: ${coverageLabels[state]}`}
                  >
                    <span aria-hidden="true">{label}: </span>
                    {coverageLabels[state]}
                  </Badge>
                );
              })}
              <Badge
                variant="outline"
                className="border-border bg-muted font-normal text-muted-foreground"
              >
                <span aria-hidden="true">فهرست: </span>
                {coverageLabels[doc.coverage?.toc ?? "absent"]}
              </Badge>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function WorkView({ uid }: { uid: string }) {
  const { navigate } = useRoute();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const togglePublishMutation = useMutation({
    mutationFn: (publish: boolean) =>
      api.post(`/admin/works/${encodeURIComponent(uid)}/${publish ? "publish" : "unpublish"}`),
    onSuccess: (_, publish) => {
      toast({
        title: publish ? "اثر منتشر شد" : "اثر از دسترس خارج شد",
        description: publish
          ? "این کتاب اکنون در کتابخانه و نتایج جست‌وجو در دسترس عموم است."
          : "این کتاب از دسترس عموم خارج شد و تنها برای مدیران قابل مشاهده است.",
      });
      void queryClient.invalidateQueries({ queryKey: ["work", uid] });
      void queryClient.invalidateQueries({ queryKey: ["works"] });
    },
    onError: (err) => {
      toast({
        title: "خطا در تغییر وضعیت انتشار",
        description: errorMessage(err),
        variant: "destructive",
      });
    },
  });

  const workQuery = useQuery<WorkDetail>({
    queryKey: ["work", uid],
    queryFn: () => api.get<WorkDetail>(`/works/${encodeURIComponent(uid)}`),
  });

  const work = workQuery.data;

  /* فاز ۲ (دور ۱۸-فیکس ۱۲): نشانی معنایی — نام اثر در path (کدگشا در نوار)،
     uid در query (w). اثرِ هویت مسیر pathname را نام‌دار می‌کند (بدون رویداد). */
  useEffect(() => {
    if (!work?.title) return;
    decoratePathWithSlug(work.title, "book");
  }, [work?.title, uid]);

  /* گروه‌بندی بر اساس فرمت محتوا (فاز رسانه) — یک اثر می‌تواند هم‌زمان متن، اسکن،
     صدا و جلد داشته باشد؛ ترتیب: متن، اسکن، صوت، جلد، بقیه. */
  const grouped = (() => {
    const text: WorkDetail["documents"] = [];
    const pdf: WorkDetail["documents"] = [];
    const audio: WorkDetail["documents"] = [];
    const image: WorkDetail["documents"] = [];
    const other: WorkDetail["documents"] = [];
    for (const doc of work?.documents ?? []) {
      switch (doc.format ?? "text") {
        case "text":
          text.push(doc);
          break;
        case "pdf":
          pdf.push(doc);
          break;
        case "audio":
          audio.push(doc);
          break;
        case "image":
          image.push(doc);
          break;
        default:
          other.push(doc);
      }
    }
    return { text, pdf, audio, image, other };
  })();
  const readableCount =
    grouped.text.length + grouped.pdf.length + grouped.audio.length;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <HashLink
        to="/library"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-link hover:underline md:min-h-0"
      >
        <ArrowRight className="size-4" aria-hidden="true" />
        بازگشت به کتابخانه
      </HashLink>

      {workQuery.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <span className="sr-only">در حال بارگیری اثر…</span>
        </div>
      ) : workQuery.isError ? (
        <ErrorState
          message={errorMessage(workQuery.error, "بارگیری مشخصات اثر ناموفق بود.")}
          onRetry={() => void workQuery.refetch()}
        />
      ) : work ? (
        <div className="space-y-6">
          <header>
            <h1 className="text-xl font-bold leading-8">{work.title}</h1>
            {work.topics.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {work.topics.map((topic) => (
                  <Badge key={topic} variant="secondary" className="font-normal">
                    {topic}
                  </Badge>
                ))}
              </div>
            ) : null}
          </header>

          {work.published === false ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-destructive/40 bg-destructive/5 p-3.5 text-sm text-destructive">
              <ShieldAlert className="size-5 shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <p className="font-semibold">این اثر از دسترس عموم خارج شده است.</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  کاربران عادی این اثر را در کتابخانه و نتایج جست‌وجو مشاهده نمی‌کنند.
                </p>
              </div>
            </div>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">مشخصات اثر</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/70 p-4 pt-2">
              <SpecRow label="مؤلف" value={work.author ?? <UnknownValue />} />
              <SpecRow label="ناشر" value={work.publisher ?? <UnknownValue />} />
              <SpecRow label="سال چاپ" value={work.year ?? <UnknownValue />} />
              <SpecRow
                label="زبان"
                value={work.language ? languageLabel(work.language) : <UnknownValue />}
              />
              <SpecRow
                label="مجلدات اثر"
                value={
                  work.volumes_count !== null && work.volumes_count !== undefined ? (
                    faNum(work.volumes_count)
                  ) : (
                    <UnknownValue />
                  )
                }
              />
              <SpecRow
                label="اسناد موجود"
                value={
                  work.documents_count !== null &&
                  work.documents_count !== undefined ? (
                    faNum(work.documents_count)
                  ) : work.documents?.length !== undefined ? (
                    faNum(work.documents.length)
                  ) : (
                    <UnknownValue />
                  )
                }
              />
              <SpecRow
                label="وضعیت انتشار"
                value={
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={work.published ?? true ? "secondary" : "destructive"}
                      className="font-normal"
                    >
                      {work.published ?? true ? "منتشر شده" : "از دسترس خارج شده"}
                    </Badge>
                    {isAdmin ? (
                      <Button
                        variant={work.published ?? true ? "outline" : "default"}
                        size="sm"
                        className="min-h-8 text-xs gap-1.5"
                        disabled={togglePublishMutation.isPending}
                        onClick={() =>
                          togglePublishMutation.mutate(!(work.published ?? true))
                        }
                      >
                        {togglePublishMutation.isPending ? (
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                        ) : work.published ?? true ? (
                          <EyeOff className="size-3 text-destructive" aria-hidden="true" />
                        ) : (
                          <Eye className="size-3" aria-hidden="true" />
                        )}
                        {work.published ?? true
                          ? "خروج از دسترسی (غیرفعال‌سازی)"
                          : "انتشار مجدد (فعال‌سازی)"}
                      </Button>
                    ) : null}
                  </div>
                }
              />
            </CardContent>
          </Card>

          {work.documents.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                برای این اثر سندی ثبت نشده است.
              </CardContent>
            </Card>
          ) : (
            <>
              {(
                [
                  ["text", "نسخه‌های متنی"],
                  ["pdf", "نسخه‌های اسکن‌شده"],
                  ["audio", "نسخه‌های صوتی"],
                  ["image", "جلدها"],
                  ["other", "اسناد دیگر"],
                ] as const
              ).map(([key, title]) =>
                grouped[key].length > 0 ? (
                  <section key={key} aria-labelledby={`${key}-title`} className="space-y-3">
                    <h2 id={`${key}-title`} className="text-base font-semibold">
                      {title}
                    </h2>
                    {grouped[key].map((doc) => (
                      <DocumentCard
                        key={doc.uid}
                        doc={doc}
                        onOpen={(documentUid) =>
                          navigate(readHref(documentUid), undefined, { slug: work?.title })
                        }
                      />
                    ))}
                  </section>
                ) : null,
              )}
              {readableCount === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-6 text-center text-sm text-muted-foreground">
                    نسخهٔ قابل مطالعه‌ای برای این اثر ثبت نشده است؛ فقط تصویر جلد در دسترس است.
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
