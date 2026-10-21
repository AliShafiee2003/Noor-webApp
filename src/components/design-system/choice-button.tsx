import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Content-sized choice with the same semantic states as other Noor controls. */
export function ChoiceButton({ selected, className, ...props }: Omit<ComponentProps<typeof Button>, "variant"> & { selected: boolean }) {
  return <Button type="button" variant={selected ? "default" : "outline"} aria-pressed={selected} className={cn("h-auto min-h-11 min-w-0 whitespace-normal px-3 py-2 text-center text-sm leading-5", className)} {...props} />;
}
