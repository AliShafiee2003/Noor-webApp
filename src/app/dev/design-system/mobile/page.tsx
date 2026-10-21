import { notFound } from "next/navigation";

/** A real 390px browsing viewport for responsive component review. */
export default function MobileDesignSystemPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="flex min-h-screen justify-center bg-canvas p-4"><iframe title="پیش‌نمایش موبایل نور" src="/dev/design-system" className="h-[900px] w-[390px] max-w-full border border-border" /></main>;
}
