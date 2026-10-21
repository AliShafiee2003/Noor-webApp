import { notFound } from "next/navigation";

export default function SearchMobilePreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="flex min-h-screen justify-center bg-canvas p-4"><iframe title="فرم جست‌وجوی موبایل" src="/dev/search" className="h-[900px] w-[390px] max-w-full border border-border" /></main>;
}
