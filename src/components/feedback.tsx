"use client";

/**
 * حالت‌های مشترک لیست‌ها: بارگذاری (skeleton)، خالی، خطا — طبق DESIGN.md.
 */
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
        <p className="font-medium text-foreground">{title}</p>
        {hint ? <p className="max-w-md text-sm text-muted-foreground">{hint}</p> : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="font-medium text-foreground">{message}</p>
        {onRetry ? (
          <Button variant="outline" onClick={onRetry} className="min-h-11 gap-2">
            <RotateCcw className="size-4" aria-hidden="true" />
            تلاش دوباره
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
