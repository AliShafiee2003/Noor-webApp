"use client";

/**
 * مرز خطای روتی — هر استثنای رندر فقط همان view را می‌گیرد و بقیهٔ میزکار
 * سالم می‌ماند. با تغییر مسیر (routeKey) خودش بازیابی می‌شود.
 */
import React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { useRoute } from "@/lib/hash-router";

interface Props {
  children: React.ReactNode;
  /** کلید بازیابی: fullHash مسیر فعال */
  routeKey: string;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[noor] رندر مسیر با خطا متوقف شد:", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <RouteErrorFallback
        onRetry={() => this.setState({ error: null })}
        error={this.state.error}
      />
    );
  }
}

function RouteErrorFallback({
  onRetry,
  error,
}: {
  onRetry: () => void;
  error: Error;
}) {
  const { navigate } = useRoute();
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <Card className="w-full max-w-xl text-center">
        <CardContent className="space-y-4 pt-6">
          <h1 className="text-lg font-semibold">نمایش این صفحه با خطا متوقف شد</h1>
          <p className="text-sm text-muted-foreground">
            مشکل می‌تواند موقت باشد. «تلاش دوباره» همان صفحه را از نو می‌سازد؛
            اگر تکرار شد، به خانه برگردید و در صورت ماندن مشکل با مدیر سامانه
            در تماس باشید.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={onRetry}>تلاش دوباره</Button>
            <Button variant="outline" onClick={() => navigate("/home")}>
              بازگشت به خانه
            </Button>
          </div>
          <details className="pt-2 text-start text-xs text-muted-foreground">
            <summary className="cursor-pointer">جزئیات فنی</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-xs">
{error.message}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
