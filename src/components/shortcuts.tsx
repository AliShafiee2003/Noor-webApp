"use client";

/**
 * میان‌برهای صفحه‌کلید — WORK-08/09:
 * راهنمای قابل مشاهده، امکان غیرفعال‌سازی، و اجرا نشدن داخل ورودی‌ها.
 * ترجیح در حساب ذخیره می‌شود (PUT /workspace/prefs.shortcuts_enabled).
 */

import { useCallback, useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { faNum } from "@/lib/format";

/** تشخیص ورودی متنی — میان‌برها داخل آن‌ها اجرا نمی‌شوند (WORK-09) */
export function isTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["/"], label: "تمرکز روی جست‌وجوی سریع" },
  { keys: ["?"], label: "نمایش همین راهنما" },
  { keys: ["g", "h"], label: "خانه" },
  { keys: ["g", "l"], label: "کتابخانه" },
  { keys: ["g", "s"], label: "جست‌وجو در منابع" },
  { keys: ["g", "r"], label: "پژوهش‌های من" },
  { keys: ["g", "t"], label: "موضوعات" },
  { keys: ["←", "→"], label: "صفحهٔ قبل/بعد در کتاب‌خوان" },
  { keys: ["Esc"], label: "بستن گفت‌وگوها و پنل‌ها" },
];

/** دریافت وضعیت فعال‌بودن میان‌برها از ترجیحات حساب */
export function useShortcutsEnabled(): {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
} {
  const wsQuery = useQuery({
    queryKey: ["workspace-shortcuts"],
    queryFn: () =>
      api.get<{ prefs?: { shortcuts_enabled?: boolean } }>("/workspace"),
    staleTime: 30_000,
  });
  const enabled = wsQuery.data?.prefs?.shortcuts_enabled !== false;
  const setEnabled = useCallback((v: boolean) => {
    void api.put("/workspace/prefs", { shortcuts_enabled: v });
  }, []);
  return { enabled, setEnabled };
}

/** گوش‌دادن سراسری به میان‌برها */
export function useGlobalShortcuts(
  enabled: boolean,
  opts: { onOpenHelp: () => void; onFocusSearch: () => void },
): void {
  const seqRef = useState<{ key: string; at: number } | null>(null);
  void seqRef;
  useEffect(() => {
    if (!enabled) return;
    let pending: { key: string; at: number } | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextInput(e.target)) return;
      // g → حرف مسیر (دنبالهٔ دومه)
      if (pending && Date.now() - pending.at < 1200) {
        const seq = pending.key + e.key.toLowerCase();
        pending = null;
        const map: Record<string, string> = {
          "gh": "/home",
          "gl": "/library",
          "gs": "/search",
          "gr": "/research",
          "gt": "/topics",
        };
        if (map[seq]) {
          e.preventDefault();
          window.location.hash = "#" + map[seq];
          return;
        }
      }
      if (e.key === "g") {
        pending = { key: "g", at: Date.now() };
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        opts.onFocusSearch();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        opts.onOpenHelp();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, opts]);
}

/** دکمه + گفت‌وگوی راهنمای میان‌برها */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const { enabled, setEnabled } = useShortcutsEnabled();

  useGlobalShortcuts(enabled, {
    onOpenHelp: () => setOpen(true),
    onFocusSearch: () => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="جستوجوی سریع در منابع"], input[placeholder*="جستوجوی سریع"]',
      );
      input?.focus();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="hidden min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          aria-label="راهنمای میان‌برهای صفحه‌کلید"
          title="میان‌برهای صفحه‌کلید (؟)"
        >
          <Keyboard className="size-4" aria-hidden="true" />
          <kbd className="rounded border border-border bg-muted px-1 font-sans text-[10px]" dir="ltr">
            ?
          </kbd>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-base">میان‌برهای صفحه‌کلید</DialogTitle>
          <DialogDescription className="text-xs leading-5">
            میان‌برها داخل ورودی‌های متنی اجرا نمی‌شوند؛ حروف مسیر باید پشت‌سرهم و با فاصلهٔ کم فشرده شوند.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 py-2">
          {SHORTCUTS.map((s, i) => (
            <li key={s.keys.join()} className="flex items-center justify-between gap-3 text-sm">
              <span>{s.label}</span>
              <span className="flex shrink-0 gap-1" dir="ltr">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-7 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-sans text-xs"
                  >
                    {k === "/" ? "/" : k === "?" ? "?" : k}
                  </kbd>
                ))}
                <span className="sr-only">{faNum(i + 1)}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <Label htmlFor="shortcuts-enabled" className="cursor-pointer text-sm">
            فعال‌بودن میان‌برها
          </Label>
          <Switch
            id="shortcuts-enabled"
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked === true)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
