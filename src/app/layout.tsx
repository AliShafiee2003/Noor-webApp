import type { Metadata } from "next";
/* قلم‌های محلی (بدون CDN) — مجوزها: docs/fonts/ */
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "@fontsource/amiri/400.css";
import "@fontsource/amiri/700.css";
import "@fontsource/amiri-quran/400.css";
import "@fontsource/scheherazade-new/400.css";
import "@fontsource/scheherazade-new/700.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
/* ریدر موبایل: وزن‌های سنگین اینتر + آیکون‌های MaterialIcons از public/fonts/reader */
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "میزکار پژوهشی نور",
  description:
    "میزکار پژوهشی برای جست‌وجوی دقیق در منابع، مطالعهٔ ساخت‌یافته و تنظیم پژوهش‌های شخصی.",
  applicationName: "میزکار پژوهشی نور",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/reader/MaterialIcons-Regular.otf"
          as="font"
          type="font/otf"
          crossOrigin="anonymous"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=JSON.parse(localStorage.getItem('noor:reader-prefs')||'{}');var f=p.font_family;var l=p.font_latin==='inter'?'"Inter"':'"Source Serif 4"';var a=f==='b-zar'?l+', "B Zar", "Amiri", "Vazirmatn", serif':f==='bahij-greta'?l+', "گرتا", "Amiri", "Vazirmatn", serif':f==='vazirmatn'?l+', "Vazirmatn", "Amiri", Tahoma, sans-serif':f==='scheherazade'?l+', "Scheherazade New", "Amiri", "Vazirmatn", serif':f==='portada'?l+', "Portada ARA", "Amiri", "Vazirmatn", serif':l+', "Amiri", "Scheherazade New", "Vazirmatn", serif';document.documentElement.style.setProperty('--font-arabic',a);if(p.font_quran){document.documentElement.style.setProperty('--font-quran',p.font_quran==='scheherazade-new'?'"Scheherazade New", "Amiri Quran", "Amiri", "Vazirmatn", serif':'"Amiri Quran", "Scheherazade New", "Amiri", "Vazirmatn", serif');}if(p.font_latin){document.documentElement.style.setProperty('--font-latin',p.font_latin==='inter'?'"Inter", "Segoe UI", Arial, sans-serif':'"Source Serif 4", Georgia, "Times New Roman", serif');}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
