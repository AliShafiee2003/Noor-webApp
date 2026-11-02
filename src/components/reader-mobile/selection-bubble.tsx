"use client";

/**
 * حباب انتخاب متن موبایل — کپی / نشانک / یادداشت / هایلایت.
 * ساختار هندسی و دستگیره‌ها عین پروتوتایپ (:1361-1383)؛ یادداشت و هایلایت
 * چندرنگ از قابلیت‌های نسخهٔ فعلی‌اند.
 */

import type { PointerEvent as ReactPointerEvent } from "react";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-color";
import type { HighlightColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { SelSide, SelUI } from "./use-selection";

export type BubbleAction = "copy" | "bm" | "note" | "highlight";

const ACTIONS: Array<{ act: BubbleAction; label: string; aria: string }> = [
  { act: "copy", label: "کپی", aria: "کپی متن انتخاب‌شده" },
  { act: "bm", label: "نشانک", aria: "نشانک‌کردن این صفحه" },
  { act: "note", label: "یادداشت", aria: "یادداشت روی متن انتخاب‌شده" },
  { act: "highlight", label: "هایلایت", aria: "هایلایت متن انتخاب‌شده" },
];

export function SelectionBubble({
  ui,
  selVisible,
  colorPick,
  onAction,
  onPickColor,
  onBack,
  onHandleDown,
}: {
  ui: SelUI;
  selVisible: boolean;
  colorPick: boolean;
  onAction: (act: BubbleAction) => void;
  onPickColor: (color: HighlightColor) => void;
  onBack: () => void;
  onHandleDown: (which: SelSide, e: ReactPointerEvent<HTMLElement>) => void;
}) {
  if (!selVisible) return null;
  return (
    <>
      {ui.bubble ? (
        <div
          id="rm-selBubble"
          className="show gesture-skip"
          role="toolbar"
          aria-label="عملیات متن انتخاب‌شده"
          onPointerDown={(event) => event.preventDefault()}
          style={{ left: ui.bubble.left, top: ui.bubble.top }}
        >
          {colorPick ? (
            <>
              <button type="button" onClick={onBack} aria-label="بازگشت به عملیات">
                بازگشت
              </button>
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className="rm-swatch"
                  title={`هایلایت ${c.label}`}
                  aria-label={`هایلایت ${c.label}`}
                  onClick={() => onPickColor(c.value)}
                >
                  <span aria-hidden="true" className={cn("size-[18px] rounded-full", c.dotClass)} />
                </button>
              ))}
            </>
          ) : (
            ACTIONS.map((a) => (
              <button key={a.act} type="button" aria-label={a.aria} onClick={() => onAction(a.act)}>
                {a.label}
              </button>
            ))
          )}
        </div>
      ) : null}
      {ui.start ? (
        <button
          type="button"
          id="rm-hStart"
          className="rm-selHandle show gesture-skip"
          aria-label="دستگیرهٔ آغاز انتخاب"
          style={{ left: ui.start.left, top: ui.start.top, borderRadius: ui.start.radius }}
          onPointerDown={(e) => onHandleDown("start", e)}
        />
      ) : null}
      {ui.end ? (
        <button
          type="button"
          id="rm-hEnd"
          className="rm-selHandle show gesture-skip"
          aria-label="دستگیرهٔ پایان انتخاب"
          style={{ left: ui.end.left, top: ui.end.top, borderRadius: ui.end.radius }}
          onPointerDown={(e) => onHandleDown("end", e)}
        />
      ) : null}
    </>
  );
}
