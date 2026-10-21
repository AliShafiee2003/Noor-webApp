import type { ReactNode } from "react";
import { Loader2, CheckCircle2, CircleAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const states = {
  info: { icon: Info, border: "border-border" },
  success: { icon: CheckCircle2, border: "border-success" },
  error: { icon: CircleAlert, border: "border-destructive" },
  working: { icon: Loader2, border: "border-border" },
};

/** Noor/Control/Feedback: status expressed by text and icon, never color alone. */
export function FeedbackMessage({ title, children, state = "info" }: {
  title: string;
  children: ReactNode;
  state?: keyof typeof states;
}) {
  const { icon: Icon, border } = states[state];
  return (
    <div role={state === "error" ? "alert" : "status"} className={cn("flex min-w-0 items-start gap-3 rounded-lg border bg-surface p-4 text-start", border)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", state === "working" && "animate-spin")} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm leading-5 font-medium">{title}</p>
        <div className="break-words text-sm leading-6 text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
