import type { ComponentProps, ReactNode } from "react";
import { NoorIcon } from "./noor-icon";
import { cn } from "@/lib/utils";

/** Noor/Control/TopicOption: bounded RTL label, optional live-data metadata. */
export function TopicOption({ title, selected, metadata, className, ...props }: Omit<ComponentProps<"button">, "title"> & {
  title: string;
  selected?: boolean;
  metadata?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-start text-sm leading-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected ? "border-primary bg-accent text-selected-foreground" : "hover:bg-accent",
        className,
      )}
      {...props}
    >
      <NoorIcon name="book" />
      <span className="min-w-0 flex-1 break-words font-medium">{title}</span>
      {metadata ? <span className="shrink-0 text-xs">{metadata}</span> : null}
      <NoorIcon name="previous" />
    </button>
  );
}
