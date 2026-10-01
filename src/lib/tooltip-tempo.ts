"use client";

/**
 * ریتم هوشمند تولتیپ (درخواست کاربر — UX پاورقی و آیکون‌ها):
 * - اولین هاور: تولتیپ با ۳ ثانیه تأخیر می‌آید تا هاور تصادفی مزاحم مطالعه نشود.
 * - به‌محض اینکه کاربر یک بار تولتیپ را دیده (یا بلافاصله بعد از اولین تلاش
 *   روی عنصر دیگری هم هاور کرد) یعنی دنبال چیزی می‌گردد → تولتیپ‌ها از آن پس
 *   بی‌درنگ باز می‌شوند.
 * وضعیت در سطح ماژول (کل نشانهٔ خواندن) نگه داشته می‌شود و با
 * useSyncExternalStore بین همهٔ کامپوننت‌ها همگام است.
 */

const SLOW_DELAY_MS = 3000;
const FAST_DELAY_MS = 0;

let fastMode = false;
let hoverGestures = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** وضعیت فعلی — برای استفادهٔ خارج از رندر */
export function isTooltipFast(): boolean {
  return fastMode;
}

/**
 * ثبت یک حرکت هاور روی هر عنصر هوشمند (پاورقی/آیکون نقشی).
 * هاور دوم به بعد یعنی کاربر فعالانه می‌گردد → حالت سریع.
 */
export function registerTooltipHover(): void {
  hoverGestures += 1;
  if (!fastMode && hoverGestures >= 2) {
    fastMode = true;
    emit();
  }
}

/** وقتی یک تولتیپ/پاپ‌آپ واقعاً باز شد، کاربر نیتش را نشان داده است. */
export function notifyTooltipOpened(): void {
  if (!fastMode) {
    fastMode = true;
    emit();
  }
}

/** مقدار تأخیر پیشنهادی برای delayDuration رادیکس */
export function currentTooltipDelay(): number {
  return fastMode ? FAST_DELAY_MS : SLOW_DELAY_MS;
}

/** هوک ری‌اکت: تأخیر فعلی + ثبت‌کنندهٔ هاور */
import { useCallback, useSyncExternalStore } from "react";

export function useTooltipDelay(): number {
  const fast = useSyncExternalStore(subscribe, isTooltipFast, () => false);
  return fast ? FAST_DELAY_MS : SLOW_DELAY_MS;
}

export function useTooltipTempo(): {
  delay: number;
  onHoverEnter: () => void;
  onOpened: () => void;
} {
  const delay = useTooltipDelay();
  const onHoverEnter = useCallback(() => registerTooltipHover(), []);
  const onOpened = useCallback(() => notifyTooltipOpened(), []);
  return { delay, onHoverEnter, onOpened };
}
