"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Highlight, HighlightColor } from "@/lib/types";

type Items = { items: Highlight[] };
const pending = new Set<string>();
export const highlightDeleteMessage = (h: Pick<Highlight, "note">) =>
  h.note ? "هایلایت و یادداشت آن حذف شوند؟" : "این هایلایت حذف شود؟";

/** All annotation entry points update the same cache; failed writes preserve stored data. */
export function useReaderAnnotations(documentUid: string) {
  const client = useQueryClient();
  const run = useCallback(async <T,>(id: string, task: () => Promise<T>) => {
    const key = `${documentUid}:${id}`;
    if (pending.has(key)) throw new Error("این عملیات در حال انجام است.");
    pending.add(key);
    try { return await task(); } finally { pending.delete(key); }
  }, [documentUid]);
  const put = useCallback((saved: Highlight, temporaryUid?: string) => {
    client.setQueryData<Items>(["annotations", documentUid], (old) => ({
      items: [...(old?.items ?? []).filter((h) => h.uid !== saved.uid && h.uid !== temporaryUid), saved],
    }));
  }, [client, documentUid]);
  const create = useCallback((input: Omit<Highlight, "uid">) => run("create", async () => {
    const temporaryUid = `temp-${crypto.randomUUID()}`;
    put({ ...input, uid: temporaryUid });
    try {
      const saved = await api.post<Highlight>("/annotations", input);
      put(saved, temporaryUid);
      return saved;
    } catch (error) {
      client.setQueryData<Items>(["annotations", documentUid], (old) => ({ items: (old?.items ?? []).filter((h) => h.uid !== temporaryUid) }));
      throw error;
    }
  }), [client, documentUid, put, run]);
  /**
   * ثبت هم‌زمان همهٔ قطعه‌های یک انتخاب (چندپاراگرافی):
   * ابتدا همه در کش می‌آیند تا هایلایت یک‌باره ظاهر شود، بعد POSTها موازی می‌روند.
   */
  const createMany = useCallback((inputs: Omit<Highlight, "uid">[]) => run("create-many", async () => {
    const temps = inputs.map((input) => ({ ...input, uid: `temp-${crypto.randomUUID()}` }));
    client.setQueryData<Items>(["annotations", documentUid], (old) => ({
      items: [...(old?.items ?? []), ...temps],
    }));
    const results = await Promise.allSettled(inputs.map((input) => api.post<Highlight>("/annotations", input)));
    const byTemp = new Map(temps.map((t, i) => [t.uid, results[i]] as const));
    const saved: Highlight[] = [];
    client.setQueryData<Items>(["annotations", documentUid], (old) => ({
      items: (old?.items ?? []).flatMap((h) => {
        const result = byTemp.get(h.uid);
        if (!result) return [h];
        if (result.status === "fulfilled") {
          saved.push(result.value);
          return [result.value];
        }
        return [];
      }),
    }));
    if (!saved.length) throw new Error("ثبت هایلایت ناموفق بود");
    return saved;
  }), [client, documentUid, run]);
  const update = useCallback((uid: string, patch: { color?: HighlightColor; note?: string | null }) => run(uid, async () => {
    const saved = await api.patch<Highlight>(`/annotations/${encodeURIComponent(uid)}`, patch);
    /* سرور همهٔ قطعه‌های گروه را با هم به‌روز می‌کند؛ کش هم همان‌طور هم‌گام شود. */
    client.setQueryData<Items>(["annotations", documentUid], (old) => ({
      items: (old?.items ?? []).map((h) =>
        h.uid === saved.uid || (saved.group_uid && h.group_uid === saved.group_uid)
          ? { ...h, color: saved.color, note: saved.note }
          : h,
      ),
    }));
    return saved;
  }), [client, documentUid, run]);
  const remove = useCallback((uid: string) => run(uid, async () => {
    await api.del(`/annotations/${encodeURIComponent(uid)}`);
    /* حذف یک قطعه = حذف کل گروه؛ ردیف‌های خواهر نباید در کش جا بمانند. */
    client.setQueryData<Items>(["annotations", documentUid], (old) => {
      const group = old?.items.find((h) => h.uid === uid)?.group_uid ?? null;
      return {
        items: (old?.items ?? []).filter(
          (h) => h.uid !== uid && !(group && h.group_uid === group),
        ),
      };
    });
  }), [client, documentUid, run]);
  return { create, createMany, update, remove };
}
