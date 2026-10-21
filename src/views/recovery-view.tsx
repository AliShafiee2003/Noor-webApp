"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { P2ETextField } from "@/components/design-system/p2e-field";
import { FeedbackMessage } from "@/components/design-system/feedback-message";
import { useRoute } from "@/lib/hash-router";

/** Figma recovery / 1440: administrator-assisted recovery, no reset request endpoint. */
export function RecoveryView() {
  const { navigate } = useRoute();
  const [username, setUsername] = useState("");
  return (
    <main dir="rtl" className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader><CardTitle role="heading" aria-level={1} className="text-xl leading-7">بازیابی دسترسی</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-inside list-decimal space-y-2 text-sm leading-6 marker:text-muted-foreground">
            <li>نام کاربری خود را آماده کنید.</li>
            <li>با مدیر سامانه تماس بگیرید و درخواست بازنشانی گذرواژه بدهید.</li>
            <li>پس از بررسی هویت، با اطلاعات تازه وارد میزکار شوید.</li>
          </ol>
          <P2ETextField label="نام کاربری" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" dir="ltr" className="text-start" required />
          <FeedbackMessage title="راهنمای پیگیری">از راه ارتباطی معرفی‌شده توسط مدیر سامانه استفاده کنید. گذرواژهٔ فعلی خود را ارسال نکنید.</FeedbackMessage>
          <Button className="w-full" onClick={() => navigate("/login")}>بازگشت به ورود</Button>
        </CardContent>
      </Card>
    </main>
  );
}
