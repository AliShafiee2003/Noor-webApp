"use client";
import type { ReaderData } from "@/components/reader-mobile/use-reader-data";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";

export function SharedReaderStatus({ rd }: { rd: ReaderData }) {
  if (!rd.sharedUid) return null;
  const data = rd.sharedQuery.data;
  return <section aria-label="محتوای اشتراکی" className="border-b border-border bg-surface px-4 py-2 text-sm text-foreground">
    {rd.sharedQuery.isPending ? <p role="status">در حال دریافت محتوای اشتراکی…</p> :
      rd.sharedQuery.isError ? <p role="alert">{errorMessage(rd.sharedQuery.error, "این اشتراک در دسترس نیست یا منقضی شده است.")}</p> : data ? <>
        <p>{data.kind === "highlight" ? "هایلایت اشتراکی" : "یادداشت اشتراکی"} از {data.owner_name} — فقط خواندنی</p>
        {data.kind === "note" && <p dir="auto" className="max-h-36 overflow-auto whitespace-pre-wrap">{data.payload}</p>}
      </> : null}
    <Button size="sm" variant="ghost" onClick={rd.clearShared}>بستن اشتراک</Button>
  </section>;
}
