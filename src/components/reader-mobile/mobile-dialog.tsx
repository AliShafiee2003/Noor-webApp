/**
 * دیالوگ‌های ریدر موبایل — پورت numberDialog/confirmDialog/dialog پروتوتایپ (:1189-1211).
 * پرش به صفحه، پرش به درصد و تأیید قفل مطالعه.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { faNum } from "@/lib/format";

export type MobileDialogState =
  | {
      kind: "number";
      title: string;
      hint: string;
      max: number;
      init?: number;
      onOk: (v: number) => void;
    }
  | { kind: "confirm"; title: string; text: string; onOk: () => void };

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** ارقام لاتین/عربیِ تایپ‌شده همیشه فارسی نمایش داده می‌شوند */
function toFaDigits(raw: string): string {
  return raw
    .replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)])
    .replace(/[٠-٩]/g, (d) => FA_DIGITS[d.charCodeAt(0) - 0x0660]);
}

function parseFaNumber(raw: string): number | null {
  const latin = raw
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\d]/g, "");
  if (!latin) return null;
  const n = Number.parseInt(latin, 10);
  return Number.isFinite(n) ? n : null;
}

function NumberBody({
  title,
  hint,
  max,
  init,
  onOk,
  onClose,
}: {
  title: string;
  hint: string;
  max: number;
  init?: number;
  onOk: (v: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(init != null ? faNum(init) : "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 280);
    return () => window.clearTimeout(t);
  }, []);

  const ok = () => {
    const v = parseFaNumber(value);
    if (v == null) return;
    onOk(clamp(v, 1, max));
  };

  return (
    <>
      <h4>{title}</h4>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder={hint}
        value={value}
        onChange={(e) => setValue(toFaDigits(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") ok();
        }}
      />
      <div className="acts">
        <button className="fbtn" onClick={ok}>
          تأیید
        </button>
        <button className="tbtn" onClick={onClose}>
          لغو
        </button>
      </div>
    </>
  );
}

export function MobileDialog({
  state,
  onClose,
}: {
  state: MobileDialogState | null;
  onClose: () => void;
}) {
  return (
    <section id="rm-dialog" className={"rm-pop" + (state ? " on" : "")} aria-hidden={!state}>
      {state ? (
        state.kind === "number" ? (
          <NumberBody
            key={`num-${state.title}-${state.init ?? 0}`}
            title={state.title}
            hint={state.hint}
            max={state.max}
            init={state.init}
            onOk={(v) => {
              onClose();
              state.onOk(v);
            }}
            onClose={onClose}
          />
        ) : (
          <>
            <h4>{state.title}</h4>
            <p>{state.text}</p>
            <div className="acts">
              <button
                className="fbtn"
                onClick={() => {
                  onClose();
                  state.onOk();
                }}
              >
                تأیید
              </button>
              <button className="tbtn" onClick={onClose}>
                لغو
              </button>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}
