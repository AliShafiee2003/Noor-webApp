"use client";

/**
 * صفحهٔ ورود — فرم ساده + حالت کد دومرحله‌ای ادمین.
 * خطاها فارسی از ApiError.message؛ پس از موفقیت بازگشت به مقصد ذخیره‌شده.
 */
import { useState } from "react";
import { BookOpenText, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { consumePendingDestination, useRoute } from "@/lib/hash-router";
import { useAuthStore } from "@/store/auth";

export function LoginView() {
  const login = useAuthStore((s) => s.login);
  const verifyMfa = useAuthStore((s) => s.verifyMfa);
  const logout = useAuthStore((s) => s.logout);
  const status = useAuthStore((s) => s.status);
  const sessionError = useAuthStore((s) => s.sessionError);
  const fetchSession = useAuthStore((s) => s.fetchSession);
  const { navigate } = useRoute();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goAfterLogin = () => {
    const dest = consumePendingDestination();
    navigate(dest ?? "/home", undefined, { replace: true });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const err = await login(username.trim(), password);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (useAuthStore.getState().status === "authenticated") goAfterLogin();
    // pending_mfa → همان صفحه در حالت کد دومرحله‌ای رندر می‌شود
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const err = await verifyMfa(code.trim());
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    goAfterLogin();
  };

  const handleCancelMfa = async () => {
    setError(null);
    setCode("");
    await logout();
  };

  const mfaMode = status === "pending_mfa";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-primary">
        <BookOpenText className="size-7" aria-hidden="true" />
        <span className="text-lg font-bold text-foreground">میزکار پژوهشی نور</span>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mfaMode ? "تأیید دومرحله‌ای" : "ورود به میزکار"}</CardTitle>
          <CardDescription>
            {mfaMode
              ? "کد شش‌رقمی برنامهٔ تأیید دومرحله‌ای خود را وارد کنید."
              : "با نام کاربری و گذرواژهٔ خود وارد شوید."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessionError ? (
            <div
              role="alert"
              className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <span>{sessionError}</span>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 gap-1 md:min-h-9"
                onClick={() => void fetchSession()}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                تلاش دوباره
              </Button>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
              {error}
            </p>
          ) : null}

          {mfaMode ? (
            <form onSubmit={handleMfa} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="mfa-code">کد تأیید شش‌رقمی</Label>
                <Input
                  id="mfa-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  className="bidi-ltr min-h-11 text-center text-lg tracking-[0.5em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full min-h-11 gap-2" disabled={busy || code.length !== 6}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                تأیید و ورود
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full min-h-11"
                onClick={() => void handleCancelMfa()}
              >
                انصراف و بازگشت به ورود
              </Button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="username">نام کاربری</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bidi-ltr min-h-11"
                  autoComplete="username"
                  dir="ltr"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">گذرواژه</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bidi-ltr min-h-11"
                  autoComplete="current-password"
                  dir="ltr"
                  required
                />
              </div>
              <Button type="submit" className="w-full min-h-11 gap-2" disabled={busy || !username.trim() || !password}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                ورود
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 max-w-sm text-center text-xs leading-6 text-muted-foreground">
        حساب کاربری با دعوت مدیر سامانه ساخته می‌شود. اگر کد دعوت دارید، از نشانی
        ارسالی استفاده کنید.
      </p>
    </div>
  );
}
