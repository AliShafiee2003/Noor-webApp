"use client";

import { useState } from "react";
import { Search, BookOpenText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Field } from "./field";
import { FeedbackMessage } from "./feedback-message";
import { TopicOption } from "./topic-option";
import { ReadingModeControl } from "./reading-mode-control";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { HashRouterProvider } from "@/lib/hash-router";
import type { ReaderDisplay, PageRef } from "@/lib/types";

/** Development-only review surface; uses production components with local state. */
export function DesignSystemPreview() {
  const [mode, setMode] = useState<ReaderDisplay>("paged");
  const [topic, setTopic] = useState("علم و معرفت");
  const [page, setPage] = useState("۱۲");
  const [bookmarked, setBookmarked] = useState(false);
  const [notice, setNotice] = useState("");
  const refs: PageRef[] = [{ page_uid: "sample-12", label: "۱۲", serial: 12, ambiguous: false }, { page_uid: "sample-13", label: "۱۳", serial: 13, ambiguous: false }];
  return (
    <HashRouterProvider>
    <main className="min-h-screen bg-canvas text-foreground" dir="rtl">
      <header className="border-b border-border bg-chrome p-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2"><BookOpenText className="size-6 text-primary" /><h1 className="text-lg font-bold">کتابخانهٔ رابط نور — زمرد شب</h1></div>
      </header>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <Card><CardHeader><CardTitle>دکمه‌ها و نشان‌ها</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setNotice("اقدام انجام شد")}>ادامه</Button><Button variant="outline">اقدام دوم</Button><Button variant="ghost">اقدام ساده</Button><Button variant="destructive">حذف</Button><Button disabled>غیرفعال</Button><Button loading>در حال انجام</Button><Button variant="outline" size="icon" aria-label="جست‌وجو"><Search className="size-5" /></Button>
          </div>
          <div className="flex flex-wrap gap-2"><Badge>۳ اثر</Badge><Badge variant="secondary">نشان خنثی</Badge><Badge variant="destructive">خطا</Badge><Badge variant="outline">L1 · عین متن</Badge></div>
        </CardContent></Card>
        <div className="grid gap-6 md:grid-cols-2">
          <Card><CardHeader><CardTitle>نوشتار و انتخاب</CardTitle></CardHeader><CardContent className="space-y-5">
            <Field label="عنوان پرونده" placeholder="عنوان پرونده را وارد کنید" hint="عنوانی کوتاه و روشن انتخاب کنید." />
            <Field label="فیلد دارای خطا" defaultValue="نمونه" error="این مقدار معتبر نیست؛ دوباره بررسی کنید." />
            <Field label="فیلد غیرفعال" disabled defaultValue="مقدار ذخیره‌شده" />
            <Label className="flex items-center gap-2"><Checkbox defaultChecked />انتخاب گزینه</Label>
            <RadioGroup defaultValue="first" className="flex gap-4"><Label className="flex items-center gap-2"><RadioGroupItem value="first" />گزینهٔ اول</Label><Label className="flex items-center gap-2"><RadioGroupItem value="second" />گزینهٔ دوم</Label></RadioGroup>
            <Label className="flex items-center justify-between">نمایش نشانه‌ها<Switch defaultChecked /></Label>
            <div className="space-y-3"><Label>اندازهٔ قلم</Label><Slider defaultValue={[22]} min={16} max={32} step={1} aria-label="اندازهٔ قلم" /></div>
            <Select defaultValue="amiri"><SelectTrigger className="w-full" aria-label="قلم"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="amiri">امیری</SelectItem><SelectItem value="vazirmatn">وزیرمتن</SelectItem></SelectContent></Select>
            <Textarea aria-label="یادداشت" placeholder="یادداشت پژوهشی…" />
          </CardContent></Card>
          <Card><CardHeader><CardTitle>پیام‌ها و گزینه‌های مشترک</CardTitle></CardHeader><CardContent className="space-y-4">
            {(["info", "success", "error", "working"] as const).map(state => <FeedbackMessage key={state} state={state} title={{info:"اطلاع",success:"ذخیره شد",error:"خطا در ذخیره",working:"در حال ذخیره"}[state]}>توضیح وضعیت و قدم بعدی در همین بخش نمایش داده می‌شود.</FeedbackMessage>)}
            <div className="space-y-1">{["علم و معرفت", "فضیلت دانش", "اخلاق و تربیت"].map(title => <TopicOption key={title} title={title} selected={topic === title} onClick={() => setTopic(title)} />)}</div>
          </CardContent></Card>
        </div>
        <Card><CardHeader><CardTitle>زبانه، جدول و پنجره</CardTitle></CardHeader><CardContent className="space-y-5">
          <Tabs defaultValue="one" dir="rtl"><TabsList><TabsTrigger value="one">زمینه</TabsTrigger><TabsTrigger value="two">یادداشت‌ها</TabsTrigger></TabsList><TabsContent value="one">اطلاعات متن و منبع</TabsContent><TabsContent value="two">یادداشت‌های پژوهشی</TabsContent></Tabs>
          <Table><TableHeader><TableRow><TableHead>عنوان</TableHead><TableHead>وضعیت</TableHead><TableHead>عملیات</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>پژوهش علم و معرفت</TableCell><TableCell><Badge variant="secondary">فعال</Badge></TableCell><TableCell><Button size="sm" variant="outline">بازکردن</Button></TableCell></TableRow></TableBody></Table>
          <Dialog><DialogTrigger asChild><Button variant="outline">بازکردن پنجره</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>پژوهش جدید</DialogTitle><DialogDescription>نام پژوهش را وارد کنید.</DialogDescription></DialogHeader><Field label="نام پژوهش" placeholder="عنوان پژوهش" /><DialogFooter><Button>ساخت پژوهش</Button></DialogFooter></DialogContent></Dialog>
        </CardContent></Card>
        <section className="overflow-hidden rounded-xl border border-border">
          <ReaderToolbar workTitle="الکافی" documentLabel="جلد اول" pageLabel={page} display={mode} onDisplayChange={setMode} pageRefs={refs} currentPageUid="sample-12" onJumpToPage={ref => setPage(ref.label)} documentUid="sample" onSearch={q => setNotice(`جست‌وجوی ${q}`)} bookmarked={bookmarked} onToggleBookmark={() => setBookmarked(!bookmarked)} bookmarkPending={false} onCopyAddress={() => setNotice("نشانی کپی شد")} onExportPdf={() => setNotice("خروجی PDF")} studyMode={false} onToggleStudyMode={() => setNotice("مطالعهٔ متمرکز")} settingsTrigger={<Button variant="outline" onClick={() => setNotice("تنظیمات خواندن")}>تنظیمات</Button>} highlightActive={false} onClearHighlight={() => {}} onPrev={() => setPage("۱۲")} onNext={() => setPage("۱۳")} />
          <div className="grid bg-reader xl:grid-cols-[240px_minmax(0,1fr)_240px]">
            <aside className="hidden border-e border-border bg-canvas p-4 xl:block"><h2 className="mb-3 text-sm font-medium">فهرست و نشانک‌ها</h2><TopicOption title="کتاب فضل العلم" selected /></aside>
            <div className="h-[560px] overflow-y-auto p-4 md:p-8"><article className="mx-auto max-w-[760px] rounded-2xl border border-border bg-reader p-4 md:p-8"><h2 className="mb-5 font-reader text-3xl">باب فضل العلم</h2>{Array.from({length:mode === "continuous"?8:1},(_,i)=><div key={i} className="mb-6 space-y-3"><p className="text-sm leading-6 text-muted-foreground">علي بن إبراهيم، عن أبيه، عن ابن أبي عمير، عن جميل بن دراج، عن أبي عبد الله عليه السلام قال:</p><p className="font-reader text-[22px] leading-[1.9]">طَلَبُ الْعِلْمِ فَرِيضَةٌ عَلَى كُلِّ مُسْلِمٍ، أَلَا إِنَّ اللَّهَ يُحِبُّ بُغَاةَ الْعِلْمِ.</p></div>)}</article></div>
            <aside className="hidden border-s border-border bg-canvas p-4 xl:block"><ReadingModeControl value={mode} onValueChange={setMode} /><p className="mt-4 text-sm leading-6 text-muted-foreground">زمینه و یادداشت‌های متن</p></aside>
          </div>
        </section>
        {notice ? <FeedbackMessage title="نتیجهٔ تعامل">{notice}</FeedbackMessage> : null}
      </div>
    </main>
    </HashRouterProvider>
  );
}
