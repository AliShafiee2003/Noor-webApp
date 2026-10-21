"use client";

import { BookOpenText, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReaderDisplay } from "@/lib/types";

/** Figma ReaderPageNavigation: one control shared by toolbar and preferences. */
export function ReadingModeControl({
  value, onValueChange, compact = false, className,
}: {
  value: ReaderDisplay;
  onValueChange: (value: ReaderDisplay) => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label="حالت نمایش" className={cn("flex gap-1 rounded-lg border border-border bg-input-surface p-1", className)}>
      {([
        ["paged", "صفحه‌محور", BookOpenText],
        ["continuous", "پیوسته", ScrollText],
      ] as const).map(([mode, label, Icon]) => (
        <button
          key={mode}
          type="button"
          aria-label={`حالت ${label}`}
          title={label}
          aria-pressed={value === mode}
          onClick={() => onValueChange(mode)}
          className={cn(
            "inline-flex min-h-9 min-w-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-xs leading-5 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            compact && "px-2",
            value === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className={compact ? "sr-only" : undefined}>{label}</span>
        </button>
      ))}
    </div>
  );
}
