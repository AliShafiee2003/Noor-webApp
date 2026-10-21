"use client";

/**
 * صفحهٔ ورود — فرم ساده + حالت کد دومرحله‌ای ادمین.
 * خطاها فارسی از ApiError.message؛ پس از موفقیت بازگشت به مقصد ذخیره‌شده.
 */
import { useState } from "react";
import { BookOpenText, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { P2EPasswordField, P2ETextField } from "@/components/design-system/p2e-field";
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
    <div dir="rtl" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-primary">
        <BookOpenText className="size-7" aria-hidden="true" />
        <span className="text-lg font-bold text-foreground">میزکار پژوهشی نور</span>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>{mfaMode ? "تأیید دومرحله‌ای" : "ورود به میزکار"}</CardTitle>
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
              className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <span className="min-w-0 flex-1 basis-40 break-words leading-6">{sessionError}</span>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 gap-1"
                onClick={() => void fetchSession()}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                تلاش دوباره
              </Button>
            </div>
          ) : null}

          {error ? (
            <p id="login-error" role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
              {error}
            </p>
          ) : null}

          {mfaMode ? (
            <form onSubmit={handleMfa} className="space-y-4" aria-describedby={error ? "login-error" : undefined} noValidate>
              <P2ETextField
                label="کد تأیید شش‌رقمی"
                id="mfa-code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[^0-9]/g, "").slice(0, 6))}
                className="bidi-ltr text-center text-lg tracking-[0.5em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={6}
                disabled={busy}
                required
                autoFocus
              />
              <Button type="submit" className="w-full min-h-11 gap-2" loading={busy} disabled={code.length !== 6}>
                تأیید و ورود
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full min-h-11"
                disabled={busy}
                onClick={() => void handleCancelMfa()}
              >
                انصراف و بازگشت به ورود
              </Button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4" aria-describedby={error ? "login-error" : undefined} noValidate>
              <P2ETextField
                label="نام کاربری"
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="نام کاربری خود را وارد کنید"
                className="bidi-ltr placeholder:text-end"
                autoComplete="username"
                dir="ltr"
                disabled={busy}
                required
                autoFocus
              />
              <P2EPasswordField
                label="گذرواژه"
                id="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="گذرواژهٔ خود را وارد کنید"
                className="bidi-ltr placeholder:text-end"
                autoComplete="current-password"
                dir="ltr"
                disabled={busy}
                required
              />
              <Button type="submit" className="w-full min-h-11 gap-2" loading={busy} disabled={!username.trim() || !password}>
                ورود به میزکار
              </Button>
              <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={() => navigate("/recovery")}>
                گذرواژه را فراموش کرده‌اید؟ از مدیر سامانه کد بازنشانی بگیرید.
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 max-w-sm text-justify text-xs leading-6 text-muted-foreground">
        حساب کاربری با دعوت مدیر سامانه ساخته می‌شود. اگر کد دعوت دارید، از نشانی
        ارسالی استفاده کنید.
      </p>
    </div>
  );
}
