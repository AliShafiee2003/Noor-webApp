"use client";

/**
 * گروه‌بندی مواضع بر اساس اثر/جلد (SEARCH-14):
 * - هر گروه: اثر → اسناد (جلدها) با شمار تطبیق تأییدشدهٔ هر سطح؛
 * - جمع گروه‌ها با مجموع مواضع برابر است (بدون دوبارشماری — TECH-11/§۴۶)؛
 * - تک‌اثر بودن نتایج → فهرست ساده (گروه‌بندی نویز ایجاد نمی‌کند).
 */
import { ChevronDown, LibraryBig } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ResultCard } from "@/components/search/result-card";
import { faNum } from "@/lib/format";
import type { SearchResultItem } from "@/lib/types";

interface DocGroup {
  docUid: string;
  docLabel: string;
  items: SearchResultItem[];
}

interface WorkGroup {
  workUid: string;
  workTitle: string;
  docs: DocGroup[];
  /** ترتیب اولین موضع در فهرست تخت — برای پایداری ترتیب گروه‌ها */
  firstIndex: number;
}

function buildGroups(items: SearchResultItem[]): WorkGroup[] {
  const groups: WorkGroup[] = [];
  const byWork = new Map<string, WorkGroup>();
  const byDoc = new Map<string, DocGroup>();

  items.forEach((item, idx) => {
    const workUid = item.work?.uid ?? "unknown";
    const docUid = item.document?.uid ?? "unknown";
    let wg = byWork.get(workUid);
    if (!wg) {
      wg = {
        workUid,
        workTitle: item.work?.title ?? "منبع بدون عنوان",
        docs: [],
        firstIndex: idx,
      };
      byWork.set(workUid, wg);
      groups.push(wg);
    }
    let dg = byDoc.get(docUid);
    if (!dg) {
      dg = { docUid, docLabel: item.document?.label ?? "بدون جلد", items: [] };
      byDoc.set(docUid, dg);
      wg.docs.push(dg);
    }
    dg.items.push(item);
  });

  return groups;
}

function GroupBody({
  items,
  releaseUid,
  onOpenSplit,
  splitActiveUid,
}: {
  items: SearchResultItem[];
  releaseUid: string | null;
  onOpenSplit?: (r: SearchResultItem) => void;
  splitActiveUid?: string | null;
}) {
  return (
    <ul className="space-y-3">
      {items.map((item, idx) => (
        <li key={item.passage_uid + "-g-" + idx}>
          <ResultCard
            result={item}
            releaseUid={releaseUid}
            onOpenSplit={onOpenSplit}
            splitActive={!!splitActiveUid && splitActiveUid === item.passage_uid}
          />
        </li>
      ))}
    </ul>
  );
}

export function GroupedPositions({
  items,
  releaseUid,
  onOpenSplit,
  splitActiveUid,
}: {
  items: SearchResultItem[];
  releaseUid: string | null;
  onOpenSplit?: (r: SearchResultItem) => void;
  splitActiveUid?: string | null;
}) {
  const groups = buildGroups(items);
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  if (groups.length <= 1) {
    // تک‌اثر یا خالی: گروه‌بندی معنا ندارد
    return (
      <GroupBody
        items={items}
        releaseUid={releaseUid}
        onOpenSplit={onOpenSplit}
        splitActiveUid={splitActiveUid}
      />
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const total = g.docs.reduce((n, d) => n + d.items.length, 0);
        const isClosed = closed[g.workUid] ?? false;
        const singleDoc = g.docs.length === 1;
        return (
          <Collapsible
            key={g.workUid}
            open={!isClosed}
            onOpenChange={(o) => setClosed((s) => ({ ...s, [g.workUid]: !o }))}
          >
            <div className="quiet-card overflow-hidden rounded-xl border border-border bg-surface/60">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-start transition-colors hover:bg-accent/60"
                  aria-expanded={!isClosed}
                >
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${isClosed ? "-rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                  <LibraryBig className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {g.workTitle}
                  </span>
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {faNum(total)} موضع تأییدشده
                    {g.docs.length > 1 ? ` در ${faNum(g.docs.length)} جلد` : ""}
                  </Badge>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-4 border-t border-border px-3 py-3">
                  {g.docs.map((d) => (
                    <section key={d.docUid} aria-label={`${g.workTitle} — ${d.docLabel}`}>
                      <div className="mb-2 flex items-center gap-2">
                        <h4 className="text-xs font-medium text-muted-foreground">
                          {g.workTitle} · {d.docLabel}
                        </h4>
                        <span className="text-[11px] text-muted-foreground/80">
                          {faNum(d.items.length)} موضع
                        </span>
                      </div>
                      <GroupBody
                        items={d.items}
                        releaseUid={releaseUid}
                        onOpenSplit={onOpenSplit}
                        splitActiveUid={splitActiveUid}
                      />
                    </section>
                  ))}
                  {singleDoc ? null : null}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}
