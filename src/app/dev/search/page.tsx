import { notFound } from "next/navigation";
import { SearchPreview } from "@/components/design-system/search-preview";

export default function SearchPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <SearchPreview />;
}
