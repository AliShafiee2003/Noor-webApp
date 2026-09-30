"use client";

/**
 * Placeholder برای بخش‌هایی که در گام‌های بعدی تکمیل می‌شوند.
 */
import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function ViewPlaceholder({
  icon: Icon = Construction,
  title,
  description,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="max-w-md text-sm leading-7 text-muted-foreground">
            {description ?? "این بخش در گام بعدی تکمیل می‌شود."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
