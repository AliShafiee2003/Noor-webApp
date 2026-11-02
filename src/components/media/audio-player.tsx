"use client";

/**
 * پخش‌کنندهٔ صدای سند (فاز رسانه) — <audio> ساده با Range از مسیر file.
 * تا وقتی فایل صوتی در کاتالوگ نباشد، خطای 404 به پیام «در دسترس نیست» ترجمه می‌شود.
 */
import { useCallback, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { mediaFileUrl } from "@/lib/api";
import { faNum } from "@/lib/format";
import { cn } from "@/lib/utils";

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "۰:۰۰";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${faNum(m)}:${faNum(String(s).padStart(2, "0"))}`;
}

export function AudioPlayer({
  documentUid,
  className,
}: {
  documentUid: string;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  const toggle = useCallback(async () => {
    const el = audioRef.current;
    if (!el || unavailable) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    setLoading(true);
    try {
      await el.play();
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [unavailable]);

  const seek = useCallback((v: number[]) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    el.currentTime = v[0];
    setCurrent(v[0]);
  }, [duration]);

  return (
    <div className={cn("rounded-lg border border-border bg-surface p-3", className)}>
      <audio
        ref={audioRef}
        src={mediaFileUrl(documentUid)}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onError={() => setUnavailable(true)}
      />
      {unavailable ? (
        <p className="text-xs text-muted-foreground" role="status">
          فایل صوتی در دسترس نیست.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            aria-label={playing ? "توقف پخش" : "پخش صدا"}
            title={playing ? "توقف پخش" : "پخش صدا"}
            disabled={loading}
            onClick={() => void toggle()}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : playing ? (
              <Pause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
          </Button>
          <div className="min-w-0 flex-1" dir="ltr">
            <Slider
              value={[Math.min(current, duration || 0)]}
              max={duration || 1}
              step={1}
              onValueChange={seek}
              aria-label="جای پخش"
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground" dir="ltr">
            {fmtTime(current)} / {fmtTime(duration)}
          </span>
        </div>
      )}
    </div>
  );
}
