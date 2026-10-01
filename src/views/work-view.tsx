"use client";

/**
 * صفحهٔ اثر — مشخصات کتاب + اسناد (جلد/مدخل جدا) با پوشش صریح هر سند.
 * دادهٔ null همیشه «ثبت نشده» نمایش داده می‌شود (حدس ممنوع — LIB-09).
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api";
import { HashLink, useRoute } from "@/lib/hash-router";
import { faNum } from "@/lib/format";
import {
  coverageKeys,
  coverageLabels,
  documentKindLabel,
  languageLabel,
} from "@/lib/labels";
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

function DocumentCard({
  doc,
  onOpen,
}: {
  doc: WorkDetail["documents"][number];
  onOpen: (uid: string) => void;
}) {
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
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {doc.pages_count !== null && doc.pages_count !== undefined ? (
                <>
                  {faNum(doc.pages_count)} صفحه
                  {doc.language ? ` · ${languageLabel(doc.language)}` : ""}
                </>
              ) : doc.language ? (
                languageLabel(doc.language)
              ) : (
                "شمار صفحه‌ها: ثبت نشده"
              )}
            </p>
          </div>
          <Button className="min-h-11 gap-2" onClick={() => onOpen(doc.uid)}>
            <BookOpen className="size-4" aria-hidden="true" />
            بازکردن مطالعه
          </Button>
        </div>

        <div
          className="mt-4 flex flex-wrap gap-1.5"
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
      </CardContent>
    </Card>
  );
}

export function WorkView({ uid }: { uid: string }) {
  const { navigate } = useRoute();

  const workQuery = useQuery<WorkDetail>({
    queryKey: ["work", uid],
    queryFn: () => api.get<WorkDetail>(`/works/${encodeURIComponent(uid)}`),
  });

  const work = workQuery.data;

  const grouped = (() => {
    const volumes: WorkDetail["documents"] = [];
    const intros: WorkDetail["documents"] = [];
    const others: WorkDetail["documents"] = [];
    for (const doc of work?.documents ?? []) {
      if (doc.kind === "volume") volumes.push(doc);
      else if (doc.kind === "intro" || doc.kind === "introduction") intros.push(doc);
      else others.push(doc);
    }
    return { volumes, intros, others };
  })();

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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">مشخصات اثر</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/70 p-4 pt-2">
              <SpecRow label="مؤلف" value={work.author ?? <UnknownValue />} />
              <SpecRow label="ناشر" value={work.publisher ?? <UnknownValue />} />
              <SpecRow label="سال" value={work.year ?? <UnknownValue />} />
              <SpecRow
                label="زبان"
                value={work.language ? languageLabel(work.language) : <UnknownValue />}
              />
              <SpecRow
                label="مجلدات"
                value={
                  work.volumes_count !== null && work.volumes_count !== undefined ? (
                    faNum(work.volumes_count)
                  ) : (
                    <UnknownValue />
                  )
                }
              />
              <SpecRow
                label="اسناد"
                value={
                  work.documents_count !== null &&
                  work.documents_count !== undefined ? (
                    faNum(work.documents_count)
                  ) : (
                    <UnknownValue />
                  )
                }
              />
              <SpecRow
                label="وضعیت انتشار"
                value={work.published ? "منتشر شده" : "منتشر نشده"}
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
              {grouped.volumes.length > 0 ? (
                <section aria-labelledby="volumes-title" className="space-y-3">
                  <h2 id="volumes-title" className="text-base font-semibold">
                    جلدها
                  </h2>
                  {grouped.volumes.map((doc) => (
                    <DocumentCard
                      key={doc.uid}
                      doc={doc}
                      onOpen={(documentUid) => navigate(`/read/${documentUid}`)}
                    />
                  ))}
                </section>
              ) : null}
              {grouped.intros.length > 0 ? (
                <section aria-labelledby="intros-title" className="space-y-3">
                  <h2 id="intros-title" className="text-base font-semibold">
                    مدخل‌ها
                  </h2>
                  {grouped.intros.map((doc) => (
                    <DocumentCard
                      key={doc.uid}
                      doc={doc}
                      onOpen={(documentUid) => navigate(`/read/${documentUid}`)}
                    />
                  ))}
                </section>
              ) : null}
              {grouped.others.length > 0 ? (
                <section aria-labelledby="others-title" className="space-y-3">
                  <h2 id="others-title" className="text-base font-semibold">
                    اسناد دیگر
                  </h2>
                  {grouped.others.map((doc) => (
                    <DocumentCard
                      key={doc.uid}
                      doc={doc}
                      onOpen={(documentUid) => navigate(`/read/${documentUid}`)}
                    />
                  ))}
                </section>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
