"use client";

/**
 * قبول دعوت — code از hash query، نام نمایشی و گذرواژه.
 * مثال نشانی: #/invite?code=XXXX-XXXX
 */
import { useState } from "react";
import { BookOpenText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRoute } from "@/lib/hash-router";
import { useAuthStore } from "@/store/auth";

export function InviteView() {
  const { route, navigate } = useRoute();
  const acceptInvite = useAuthStore((s) => s.acceptInvite);
  const authStatus = useAuthStore((s) => s.status);

  const code = route.query.code ?? "";
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!code) {
      setError("کد دعوت یافت نشد؛ نشانی را کامل از دعوت‌نامهٔ خود وارد کنید.");
      return;
    }
    if (!displayName.trim()) {
      setError("نام نمایشی را وارد کنید.");
      return;
    }
    if (password.length < 8) {
      setError("گذرواژه باید دست‌کم ۸ نویسه باشد.");
      return;
    }
    if (password !== password2) {
      setError("گذرواژه و تکرار آن یکسان نیستند.");
      return;
    }
    setBusy(true);
    const err = await acceptInvite(code, displayName.trim(), password);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    navigate("/home", undefined, { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <BookOpenText className="size-7 text-primary" aria-hidden="true" />
        <span className="text-lg font-bold">میزکار پژوهشی نور</span>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>قبول دعوت</CardTitle>
          <CardDescription>
            با کد دعوت، حساب خود را بسازید. نقش شما از روی دعوت‌نامه تعیین می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {authStatus === "authenticated" ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                هم‌اکنون وارد میزکار شده‌اید. برای استفاده از دعوت، ابتدا از حساب
                فعلی خارج شوید.
              </p>
              <Button className="min-h-11 w-full" onClick={() => navigate("/home")}>
                رفتن به خانه
              </Button>
            </div>
          ) : (
            <>
              {error ? (
                <p
                  role="alert"
                  className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
                >
                  {error}
                </p>
              ) : null}
              {!code ? (
                <p className="mb-4 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
                  در نشانی فعلی کد دعوت دیده نمی‌شود. نشانی کامل دعوت‌نامه باید
                  به شکل{" "}
                  <span className="bidi-ltr inline-block font-medium">#/invite?code=…</span>{" "}
                  باشد.
                </p>
              ) : null}
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="invite-code">کد دعوت</Label>
                  <Input
                    id="invite-code"
                    value={code}
                    readOnly
                    dir="ltr"
                    className="bidi-ltr min-h-11 bg-muted"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="display-name">نام نمایشی</Label>
                  <Input
                    id="display-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="min-h-11"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-password">گذرواژه</Label>
                  <Input
                    id="invite-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bidi-ltr min-h-11"
                    dir="ltr"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-password2">تکرار گذرواژه</Label>
                  <Input
                    id="invite-password2"
                    type="password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    className="bidi-ltr min-h-11"
                    dir="ltr"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full min-h-11 gap-2"
                  disabled={busy || !code}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  ساختن حساب و ورود
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
