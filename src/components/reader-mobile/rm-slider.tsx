/**
 * اسلایدر Material پروتوتایپ (makeSlider :942) — RTL، پر شدن از راست.
 * درگ با pointer capture؛ onInput هنگام جابه‌جایی، onCommit هنگام رهاکردن.
 * مقدار مرجع در ref نگه داشته می‌شود تا رندر مجدد والد وسط درگ پرش ندهد.
 */
"use client";

import { useEffect, useRef } from "react";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function RmSlider({
  min,
  max,
  step,
  value,
  onInput,
  onCommit,
  tip,
  className,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onInput?: (v: number) => void;
  onCommit?: (v: number) => void;
  tip?: (v: number) => string;
  className?: string;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const valueRef = useRef(value);

  const frac = (v: number) => clamp((v - min) / (max - min), 0, 1);
  const setVisual = (v: number) => {
    valueRef.current = v;
    elRef.current?.style.setProperty("--f", String(frac(v)));
    if (tipRef.current && tip) tipRef.current.textContent = tip(v);
  };

  useEffect(() => {
    if (draggingRef.current) return;
    setVisual(value);
  });

  const fromX = (x: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return valueRef.current;
    let v = min + clamp((r.right - x) / r.width, 0, 1) * (max - min);
    if (step) v = Math.round(v / step) * step;
    return clamp(+v.toFixed(4), min, max);
  };

  return (
    <div
      ref={elRef}
      className={`sl acc${className ? " " + className : ""}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* pointerId آزمایشی */
        }
        draggingRef.current = true;
        elRef.current?.classList.add("active");
        const v = fromX(e.clientX);
        setVisual(v);
        onInput?.(v);
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return;
        const v = fromX(e.clientX);
        if (v !== valueRef.current || !step) {
          setVisual(v);
          onInput?.(v);
        }
      }}
      onPointerUp={() => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        elRef.current?.classList.remove("active");
        onCommit?.(valueRef.current);
      }}
      onPointerCancel={() => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        elRef.current?.classList.remove("active");
        onCommit?.(valueRef.current);
      }}
    >
      <div ref={trackRef} className="sl-track">
        <div className="sl-fill" />
        <div className="sl-thumb" />
        <div ref={tipRef} className="sl-tip" />
      </div>
    </div>
  );
}
