/**
 * حلقهٔ انیمیشن با پشتیبان تایمر.
 * برخی میزبان‌ها (پنجرهٔ پنهان/بدون پینت، like embedded webview) هرگز callback
 * requestAnimationFrame را اجرا نمی‌کنند؛ اگر تا ۱۲۰ms فریمی نرسد به setTimeout ۱۶ms
 * سوئیچ می‌شود. در مرورگر واقعی rAF همیشه زودتر می‌رسد و رفتار عوض نمی‌شود.
 * step(now) → true یعنی ادامه بده، false یعنی تمام.
 * خروجی: تابع لغو.
 */
export function frameLoop(step: (now: number) => boolean): () => void {
  let stopped = false;
  let rafId = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let mode: "raf" | "timer" = "raf";
  let lastFrame = performance.now();

  const tick = (now: number) => {
    if (stopped || mode !== "raf") return;
    lastFrame = now;
    if (step(now)) rafId = requestAnimationFrame(tick);
    else stopped = true;
  };
  rafId = requestAnimationFrame(tick);

  const watchdog = setInterval(() => {
    if (stopped) {
      clearInterval(watchdog);
      return;
    }
    if (mode === "raf" && performance.now() - lastFrame > 120) {
      mode = "timer";
      cancelAnimationFrame(rafId);
      clearInterval(watchdog);
      const loop = () => {
        if (stopped) return;
        if (step(performance.now())) timer = setTimeout(loop, 16);
        else stopped = true;
      };
      loop();
    }
  }, 120);

  return () => {
    stopped = true;
    clearInterval(watchdog);
    cancelAnimationFrame(rafId);
    if (timer) clearTimeout(timer);
  };
}
