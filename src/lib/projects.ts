"use client";

/**
 * منبع مشترک فهرست پرونده‌ها — کلید کش «projects» در همهٔ نماها همین شکل نرمال‌شده را نگه می‌دارد.
 * قرارداد سرور: آرایهٔ خام یا {items} — هر دو به آرایهٔ یکسان تبدیل می‌شود.
 */
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";

/** هر دو شکل پاسخ قرارداد را به آرایهٔ تخت تبدیل می‌کند */
export function normalizeItems<T>(data: T[] | { items?: T[] } | undefined | null): T[] {
  if (Array.isArray(data)) return data;
  return data?.items ?? [];
}

export async function fetchProjects(): Promise<Project[]> {
  return normalizeItems<Project>(await api.get<Project[] | { items?: Project[] }>("/projects"));
}
