"use client";

/**
 * P2E/Component/Text Field + Password Field با برچسب شناور (M3).
 * تبدیل گره‌های 18562:5888 (Text Field) و 18675:14622 (Password Field) از
 * «P2E Platform — Design System»: کادر دوحاشیه شعاع ۱۶، ارتفاع ۶۰؛ برچسب در حالت
 * آرام وسط کادر است و با فوکوس/مقدار به بالا می‌پرد و کوچک می‌شود؛ حباب متن
 * پشتیبان/خطا با آیکون ۱۸؛ آیکون چشم ۲۴ در جایش ۴۴. استایل فقط با توکن‌های معنایی نور.
 */
import { useId, useState, type ComponentProps } from "react";
import { AlertCircle, Eye, EyeOff, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type P2EFieldProps = {
  label: string;
  hint?: string;
  error?: string;
};

const framelessInput =
  "h-7 py-0 text-base leading-7 border-0 bg-transparent px-0 shadow-none placeholder:text-transparent group-focus-within:placeholder:text-placeholder focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0";

const fieldContainer =
  "group relative min-h-[60px] rounded-2xl border-2 bg-surface px-4 transition-[border-color,box-shadow] duration-200 ease-out focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15";

const floatingLabel =
  "absolute top-1/2 start-4 origin-top-right -translate-y-1/2 scale-100 whitespace-nowrap text-base font-medium leading-5 text-muted-foreground transition-all duration-200 ease-out group-focus-within:top-1 group-focus-within:translate-y-0 group-focus-within:scale-[0.78] group-focus-within:text-foreground group-data-[floated=true]:top-1 group-data-[floated=true]:translate-y-0 group-data-[floated=true]:scale-[0.78] motion-reduce:transition-none";

function SupportingText({
  id,
  tone,
  children,
}: {
  id: string;
  tone: "hint" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      role={tone === "error" ? "alert" : undefined}
      className="flex w-full animate-in items-center gap-2 rounded-xl bg-muted px-2.5 py-2 duration-200 motion-reduce:animate-none"
    >
      {tone === "error" ? (
        <AlertCircle className="size-[18px] shrink-0 text-destructive" aria-hidden="true" />
      ) : (
        <Info className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <p
        className={cn(
          "break-words text-sm font-medium leading-[18px]",
          tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {children}
      </p>
    </div>
  );
}

function focusInput(event: React.MouseEvent<HTMLDivElement>) {
  if (event.target instanceof HTMLElement && event.target.closest("button")) return;
  const input = event.currentTarget.querySelector("input");
  input?.focus();
}

function useFieldIds(id?: string, message?: string) {
  const generated = useId();
  const inputId = id ?? generated;
  const describedBy = message ? `${inputId}-supporting` : undefined;
  return { inputId, describedBy };
}

/** P2E Text Field: برچسب شناور داخل کادر، ورودی بی‌قاب، حباب پشتیبان بیرونِ کادر. */
export function P2ETextField({
  label,
  hint,
  error,
  id,
  ...props
}: ComponentProps<typeof Input> & P2EFieldProps) {
  const message = error ?? hint;
  const { inputId, describedBy } = useFieldIds(id, message);
  const floated = typeof props.value === "string" && props.value.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-2 text-start">
      <div
        className={cn(
          fieldContainer,
          "flex w-full items-center",
          error ? "border-destructive" : "border-border",
        )}
        data-floated={floated || undefined}
        onClick={focusInput}
      >
        <label htmlFor={inputId} className={floatingLabel}>
          {label}
        </label>
        <Input
          {...props}
          id={inputId}
          aria-invalid={Boolean(error) || props["aria-invalid"]}
          aria-describedby={describedBy}
          className={cn("min-w-0 flex-1", framelessInput, props.className)}
        />
      </div>
      {message ? (
        <SupportingText id={`${inputId}-supporting`} tone={error ? "error" : "hint"}>
          {message}
        </SupportingText>
      ) : null}
    </div>
  );
}

/** P2E Password Field: همان بدنه + آیکون چشم ۲۴ در جایش ۴۴ (نمایش/پنهان‌کردن). */
export function P2EPasswordField({
  label,
  hint,
  error,
  id,
  ...props
}: ComponentProps<typeof Input> & P2EFieldProps) {
  const message = error ?? hint;
  const { inputId, describedBy } = useFieldIds(id, message);
  const [visible, setVisible] = useState(false);
  const floated = typeof props.value === "string" && props.value.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-2 text-start">
      <div
        className={cn(
          fieldContainer,
          "flex w-full items-center gap-1",
          error ? "border-destructive" : "border-border",
        )}
        data-floated={floated || undefined}
        onClick={focusInput}
      >
        <label htmlFor={inputId} className={floatingLabel}>
          {label}
        </label>
        <Input
          {...props}
          type={visible ? "text" : "password"}
          id={inputId}
          aria-invalid={Boolean(error) || props["aria-invalid"]}
          aria-describedby={describedBy}
          className={cn("min-w-0 flex-1", framelessInput, props.className)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={props.disabled}
          aria-label={visible ? "پنهان‌کردن گذرواژه" : "نمایش گذرواژه"}
          aria-controls={inputId}
          aria-pressed={visible}
          className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-[color,transform] duration-200 ease-out hover:text-foreground active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
        >
          {visible ? (
            <EyeOff className="size-6 animate-in fade-in duration-150" aria-hidden="true" />
          ) : (
            <Eye className="size-6 animate-in fade-in duration-150" aria-hidden="true" />
          )}
        </button>
      </div>
      {message ? (
        <SupportingText id={`${inputId}-supporting`} tone={error ? "error" : "hint"}>
          {message}
        </SupportingText>
      ) : null}
    </div>
  );
}
