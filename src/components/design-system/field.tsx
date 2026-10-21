"use client";

import { useId, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Noor/Control/Field: accessible label, bounded input, hint/error variants. */
export function Field({ label, hint, error, id, ...props }: ComponentProps<typeof Input> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const message = error ?? hint;
  const describedBy = [props["aria-describedby"], message ? `${inputId}-hint` : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-2 text-start">
      <Label htmlFor={inputId}>{label}</Label>
      <Input {...props} id={inputId} aria-invalid={Boolean(error) || props["aria-invalid"]} aria-describedby={describedBy} />
      {message ? <p id={`${inputId}-hint`} className={`text-xs leading-5 ${error ? "text-destructive" : "text-muted-foreground"}`}>{message}</p> : null}
    </div>
  );
}
