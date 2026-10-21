"use client";

/**
 * منوی «دریافت خروجی» نتایج جست‌وجو — PRD §۷-الف-۱
 * خروجی گرفتن از «نتایج تأییدشدهٔ همین جست‌وجو» با همهٔ فیلترها، در سه قالب
 * CSV (اکسل فارسی) / XLSX / Markdown. فایل از مسیر BFF هم‌مبدأ می‌آید و با
 * نام فارسی (از Content-Disposition) دانلود می‌شود. اگر خروجی به سقف
 * ۵۰۰۰ ردیف خورد («جزئی»)، گزینهٔ دریافت بخش بعدی با offset همان پاسخ ظاهر
 * می‌شود (X-Export-Offset-Next).
 */
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { getCsrfToken } from "@/lib/api";
import { faNum } from "@/lib/format";
import type { SearchRequest } from "@/lib/types";

type ExportFormat = "csv" | "xlsx" | "markdown";

interface ExportMenuProps {
  /** پارامترهای جست‌وجوی کنونی — همان شیءِ buildSearchRequest نما */
  request: SearchRequest;
  disabled?: boolean;
  /** مجموع تطبیق‌های تأییدشده (§۴۷) — فقط برای نمایش راهنما */
  totalVerified?: number | null;
}

/** گزینه‌های منو — برچسب فارسی + قالب */
const FORMATS: Array<{ format: ExportFormat; label: string }> = [
  { format: "csv", label: "CSV (اکسل فارسی)" },
  { format: "xlsx", label: "اکسل (xlsx)" },
  { format: "markdown", label: "جدول Markdown" },
];

function extOf(format: ExportFormat): string {
  return format === "markdown" ? "md" : format;
}

/** استخراج نام فارسی فایل از Content-Disposition (RFC 5987 اول، سپس لاتین) */
function filenameFromDisposition(disposition: string, format: ExportFormat): string {
  const star = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* نام نامعتبر بود — به جایگزین لاتین می‌رویم */
    }
  }
  const plain = /filename="([^"]+)"/.exec(disposition);
  return plain?.[1] ?? `search-export.${extOf(format)}`;
}

export function ExportMenu({ request, disabled = false, totalVerified }: ExportMenuProps) {
  const { toast } = useToast();
  const [pendingFormat, setPendingFormat] = useState<ExportFormat | null>(null);
  /** بخش بعدیِ خروجی جزئی — از سرصفحه‌های آخرین پاسخ */
  const [followUp, setFollowUp] = useState<{ format: ExportFormat; offset: number } | null>(
    null,
  );

  const runExport = async (format: ExportFormat, offset = 0): Promise<void> => {
    setPendingFormat(format);
    try {
      const csrf = getCsrfToken();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrf) {
        headers["X-Noor-CSRF"] = csrf;
      }
      const resp = await fetch("/api/v1/export/search", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ request, format, offset }),
      });

      if (!resp.ok) {
        let message = "دریافت خروجی ناموفق بود؛ دوباره تلاش کنید.";
        try {
          const data = (await resp.json()) as { error?: { message?: string } | null };
          if (data?.error?.message) message = data.error.message;
        } catch {
          /* بدنهٔ JSON نبود */
        }
        toast({
          variant: "destructive",
          title: "دریافت خروجی ناموفق بود",
          description: message,
        });
        return;
      }

      const partial = resp.headers.get("X-Export-Partial") === "1";
      const rows =
        Number.parseInt(resp.headers.get("X-Export-Rows") ?? "", 10) || 0;
      const offsetNextRaw = Number.parseInt(
        resp.headers.get("X-Export-Offset-Next") ?? "",
        10,
      );
      const offsetNext = Number.isFinite(offsetNextRaw) ? offsetNextRaw : null;

      /* دانلود با نام فارسیِ داخل سرصفحهٔ پاسخ */
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFromDisposition(disposition, format);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      setFollowUp(partial && offsetNext !== null ? { format, offset: offsetNext } : null);
      toast({
        title: `خروجی آماده شد — ${faNum(rows)} ردیف`,
        description: partial
          ? "خروجی جزئی است (سقف ۵۰۰۰ ردیف). برای ادامه، دریافت بخش بعدی را بزنید."
          : undefined,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "دریافت خروجی ناموفق بود",
        description: "ارتباط با کارساز برقرار نشد؛ اتصال خود را بررسی و دوباره تلاش کنید.",
      });
    } finally {
      setPendingFormat(null);
    }
  };

  const busy = pendingFormat !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-9 gap-1.5"
          disabled={disabled || busy}
          aria-label="دریافت خروجی نتایج جست‌وجو"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          دریافت خروجی
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {typeof totalVerified === "number" ? (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            مجموع تأییدشده: {faNum(totalVerified)} موضع
          </DropdownMenuLabel>
        ) : null}
        {followUp ? (
          <>
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => void runExport(followUp.format, followUp.offset)}
            >
              دریافت بخش بعدی (از ردیف {faNum(followUp.offset)})
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {FORMATS.map(({ format, label }) => (
          <DropdownMenuItem
            key={format}
            disabled={busy}
            onSelect={() => void runExport(format)}
          >
            {pendingFormat === format ? (
              <Loader2 className="me-1.5 size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
