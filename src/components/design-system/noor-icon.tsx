import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** Exact Figma exports; masks preserve their geometry across theme colors. */
export function NoorIcon({ name, className }: { name: "book" | "previous"; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-5 shrink-0 bg-current", className)} style={{ mask: `url(/icons/noor/${name}.svg) center / contain no-repeat` } as CSSProperties} />;
}
