/**
 * شیت تنظیمات مطالعه — ۴ تب عین پروتوتایپ (buildSettings :1663-1766).
 * تب «متن و قلم» برای PDF مخفی می‌شود (تصمیم کاربر: تایپوگرافی در PDF لازم نیست).
 * اسلایدرها هنگام درگ CSS-vars را زنده تغییر می‌دهند و فقط روی رهاکردن در prefs می‌نویسند.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReaderFullscreen } from "@/lib/reader/use-reader-fullscreen";
import { Mi } from "./mi";
import { RmSlider } from "./rm-slider";
import { MOBILE_FONTS, ALIGN_OPTIONS, DIR_OPTIONS, PROGRESSION_OPTIONS } from "./reading-themes";
import { DARK_PALETTES, LIGHT_PALETTES, type PaletteMode } from "@/lib/palette";
import { QURAN_FONT_OPTIONS, QURAN_FONT_SIZE_DEFAULT, QURAN_LINE_HEIGHT_DEFAULT } from "@/lib/fonts";
import { useWorkspaceStore } from "@/store/workspace";
import type { ReaderThemeTarget } from "@/lib/reader/use-reader-theme";
import type { MobileReaderPrefs, ReaderPrefs } from "@/lib/types";
import { faNum } from "@/lib/format";

type TabId = "typography" | "theme" | "reading" | "screen";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ---------- کنترل‌های پایه ---------- */
function Seg<T extends string>({
  items,
  value,
  onChange,
  compact,
}: {
  items: Array<{ v: T; label?: string; icon?: string; title?: string }>;
  value: T;
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  return (
    <div className={"seg" + (compact ? " compact" : "")}>
      {items.map((it) => (
        <button
          key={it.v}
          className={it.v === value ? "on" : ""}
          title={it.title ?? ""}
          onClick={() => onChange(it.v)}
        >
          {it.icon ? <Mi name={it.icon} /> : null}
          {it.label ?? null}
        </button>
      ))}
    </div>
  );
}

function SwitchTile({
  icon,
  title,
  sub,
  value,
  onChange,
}: {
  icon: string;
  title: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="stile" onClick={() => onChange(!value)}>
      <Mi name={icon} size={22} className="lead" />
      <div className="txt">
        <div className="ttl">{title}</div>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <div className={"sw" + (value ? " on" : "")} />
    </div>
  );
}

function SliderRow({
  title,
  min,
  max,
  step,
  value,
  fmt,
  onPreview,
  onCommit,
}: {
  title: string;
  min: number;
  max: number;
  step: number;
  value: number;
  fmt: (v: number) => string;
  onPreview?: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const [live, setLive] = useState<number | null>(null);
  const v = live ?? value;
  return (
    <div>
      <div className="rm-lsr-head">
        <span className="rm-t-sm">{title}</span>
        <span className="rm-lbl-sm">{fmt(v)}</span>
      </div>
      <RmSlider
        min={min}
        max={max}
        step={step}
        value={v}
        tip={fmt}
        className="pri-fill"
        onInput={(x) => {
          setLive(x);
          onPreview?.(x);
        }}
        onCommit={(x) => {
          setLive(null);
          onCommit(x);
        }}
      />
    </div>
  );
}

const ALIGN_ITEMS = [
  { v: "auto", icon: "format_textdirection_r_to_l", title: "خودکار" },
  { v: "right", icon: "format_align_right", title: "راست" },
  { v: "center", icon: "format_align_center", title: "وسط" },
  { v: "left", icon: "format_align_left", title: "چپ" },
  { v: "justify", icon: "format_align_justify", title: "هم‌تراز" },
] as const;

const DIR_LABELS: Record<string, string> = { auto: "خودکار", rtl: "راست به چپ", ltr: "چپ به راست" };
const PROG_LABELS: Record<string, string> = { auto: "خودکار", rtl: "راست به چپ", ltr: "چپ به راست" };

export function MobileSettingsSheet({
  open,
  onClose,
  prefs,
  update,
  themeMode,
  palette,
  onSelectTheme,
  isPdf,
  bookDir,
  setBookDirection,
  clearBookDir,
  onPreviewVars,
  onPreviewTapZone,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  prefs: MobileReaderPrefs;
  update: (p: Partial<MobileReaderPrefs>) => void;
  themeMode: PaletteMode;
  palette: string;
  onSelectTheme: (target: ReaderThemeTarget, origin?: { x: number; y: number }) => void;
  isPdf: boolean;
  bookDir: "rtl" | "ltr" | null;
  setBookDirection: (d: "rtl" | "ltr" | null) => void;
  clearBookDir: () => void;
  onPreviewVars: (p: { font_size?: number; line_height?: number; para?: number; margin?: number }) => void;
  onPreviewTapZone?: (tapMode: MobileReaderPrefs["tap_mode"], tapArea: number, hold?: boolean) => void;
  onToast: (msg: string) => void;
}) {
  const tabs = isPdf
    ? (["theme", "reading", "screen"] as const)
    : (["typography", "theme", "reading", "screen"] as const);
  const [tab, setTab] = useState<TabId>("typography");
  const active: TabId = (tabs as readonly TabId[]).includes(tab) ? tab : tabs[0];

  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [ind, setInd] = useState({ right: 0, width: 0 });
  const measure = useCallback(() => {
    const box = tabsRef.current;
    if (!box) return;
    const on = box.querySelector<HTMLElement>(".rm-tab.on");
    if (!on) return;
    const tr = box.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    setInd({ right: tr.right - r.right, width: r.width });
  }, []);
  useEffect(() => {
    const t = window.setTimeout(measure, 0);
    return () => window.clearTimeout(t);
  }, [measure, active, open]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  /* فونت — کارت بازشو */
  const [fontOpen, setFontOpen] = useState(false);
  const curFont = MOBILE_FONTS.find((f) => f.id === prefs.font) ?? MOBILE_FONTS[0];

  /* تب صفحه — تمام‌صفحه */
  const fullscreen = useReaderFullscreen();
  const immersive = fullscreen.active;
  const [previewingTap, setPreviewingTap] = useState(false);
  const toggleImmersive = async () => {
    try { await fullscreen.toggle(); } catch { onToast("نمایش تمام‌صفحه در این مرورگر ممکن نیست"); }
  };
  const saveState = useWorkspaceStore((s) => s.prefsSaveState);
  const rootPrefs = useWorkspaceStore((s) => s.prefs);
  const updateRootPrefs = useWorkspaceStore((s) => s.updatePrefs);

  const swatchClick = (mode: PaletteMode, id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    onSelectTheme({ mode, palette: id }, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };

  return (
    <section className={"rm-pop" + (open ? " on" : "") + (open && previewingTap ? " tap-previewing" : "")} id="rm-settings" aria-hidden={!open} aria-label="تنظیمات مطالعه">
      <div className="rm-sh-head">
        <div className="sp" />
        <div className="rm-tabs" ref={tabsRef}>
          {tabs.map((id) => (
            <button key={id} className={"rm-tab" + (active === id ? " on" : "")} onClick={() => setTab(id)}>
              {id === "typography" ? "متن و قلم" : id === "theme" ? "پالت رنگ" : id === "reading" ? "مطالعه" : "صفحه"}
            </button>
          ))}
          <div className="rm-tab-ind" style={{ right: ind.right, width: ind.width }} />
        </div>
        <button className="ib big" aria-label="بستن تنظیمات" onClick={onClose}>
          <Mi name="close" />
        </button>
      </div>
      <div className="rm-tabs-div" />
      <div className="rm-sh-body" data-tab={active}>
        {/* ── ۱. متن و قلم ── */}
        {!isPdf ? (
          <div className={"rm-pane" + (active === "typography" ? " on" : "")}>
            <div className={"rm-card" + (fontOpen ? " open" : "")}>
              <div className="rm-exp-head" onClick={() => setFontOpen((v) => !v)}>
                <Mi name="font_download_outlined" size={22} />
                <div className="txt">
                  <div className="rm-t-sm">خانواده فونت</div>
                  <div className="sub" style={{ fontFamily: curFont.stack }}>
                    {curFont.fa}
                  </div>
                </div>
                <Mi name="expand_more" size={22} className="rm-exp-chev" />
              </div>
              <div className="rm-exp-body">
                <div className="rm-fontlist">
                  {MOBILE_FONTS.map((f) => (
                    <div
                      key={f.id}
                      className={"rm-fitem" + (f.id === prefs.font ? " on" : "")}
                      style={{ fontFamily: f.stack }}
                      onClick={() => update({ font: f.id })}
                    >
                      {f.fa}
                      {f.id === prefs.font ? <Mi name="check" size={20} /> : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="rm-gap12" />
            <div className="rm-row">
              <span className="rm-t-sm">اندازه فونت</span>
              <span style={{ flex: 1 }} />
              <div className="rm-stepper">
                <button
                  className="ib big"
                  aria-label="کوچک‌ترکردن فونت"
                  onClick={() => update({ font_size: clamp(prefs.font_size - 1, 12, 36) })}
                >
                  <Mi name="remove" />
                </button>
                <b>{faNum(prefs.font_size)}</b>
                <button
                  className="ib big"
                  aria-label="بزرگ‌ترکردن فونت"
                  onClick={() => update({ font_size: clamp(prefs.font_size + 1, 12, 36) })}
                >
                  <Mi name="add" />
                </button>
              </div>
            </div>
            <div className="rm-gap12" />
            <SliderRow
              title="فاصله خطوط"
              min={1.2}
              max={2.4}
              step={0.1}
              value={prefs.line_height}
              fmt={(v) => faNum(v.toFixed(1))}
              onPreview={(v) => onPreviewVars({ line_height: v })}
              onCommit={(v) => update({ line_height: v })}
            />
            <div className="rm-gap12" />
            <SliderRow
              title="فاصله پاراگراف"
              min={0}
              max={1.6}
              step={0.1}
              value={prefs.para}
              fmt={(v) => faNum(v.toFixed(1))}
              onPreview={(v) => onPreviewVars({ para: v })}
              onCommit={(v) => update({ para: v })}
            />
            <div className="rm-gap12" />
            <div className="rm-t-sm">تراز</div>
            <div className="rm-gap4" />
            <Seg
              items={ALIGN_ITEMS.map((a) => ({ ...a }))}
              value={prefs.align}
              onChange={(v) => update({ align: v as MobileReaderPrefs["align"] })}
            />
            <div className="rm-gap12" />
            <div className="rm-t-sm">جهت</div>
            <div className="rm-gap4" />
            <Seg
              items={DIR_OPTIONS.map((v) => ({ v, label: DIR_LABELS[v] }))}
              value={bookDir ?? prefs.dir}
              onChange={(v) => {
                if (bookDir) {
                  setBookDirection(v === "auto" ? null : v);
                } else {
                  update({ dir: v as MobileReaderPrefs["dir"] });
                }
              }}
            />
            {bookDir ? (
              <div className="rm-row" style={{ marginTop: 6, gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--on-surface-var)", flex: 1 }}>
                  جهت اختصاصی این کتاب فعال است.
                </span>
                <button className="tbtn" style={{ fontSize: 12 }} onClick={clearBookDir}>
                  حذف تنظیم اختصاصی
                </button>
              </div>
            ) : null}
            <div className="rm-gap12" />
            <SliderRow
              title="حاشیه‌ها"
              min={0}
              max={48}
              step={4}
              value={prefs.margin}
              fmt={(v) => faNum(Math.round(v))}
              onPreview={(v) => onPreviewVars({ margin: v })}
              onCommit={(v) => update({ margin: v })}
            />
            <div className="rm-divider" style={{ margin: "16px 0 12px" }} />
            <SwitchTile
              icon="auto_awesome"
              title="نشانه‌گذاری نقش‌های معنایی"
              sub="رنگ و نشان برای سند، آیه، بیان مؤلف و راوی"
              value={rootPrefs.semantic_colors === true}
              onChange={(v) => updateRootPrefs({ semantic_colors: v })}
            />
            <div className="rm-gap12" />
            <div className="rm-t-sm">قلم متن قرآنی</div>
            <div className="rm-gap4" />
            <div className="rm-card" role="listbox" aria-label="قلم متن قرآنی">
              <div className="rm-fontlist" style={{ maxHeight: 236 }}>
                {QURAN_FONT_OPTIONS.map((o) => {
                  const selected = (rootPrefs.font_quran ?? "amiri-quran") === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={o.note}
                      className={"rm-fitem" + (selected ? " on" : "")}
                      style={{ width: "100%", textAlign: "start" }}
                      onClick={() =>
                        updateRootPrefs({ font_quran: o.id as ReaderPrefs["font_quran"] })
                      }
                    >
                      {o.label}
                      {selected ? <Mi name="check" size={20} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rm-gap12" />
            <SliderRow
              title="اندازهٔ متن قرآنی"
              min={18}
              max={34}
              step={1}
              value={rootPrefs.quran_font_size ?? QURAN_FONT_SIZE_DEFAULT}
              fmt={(v) => faNum(Math.round(v))}
              onCommit={(v) => updateRootPrefs({ quran_font_size: Math.round(v) })}
            />
            <div className="rm-gap12" />
            <SliderRow
              title="فاصلهٔ سطر قرآنی"
              min={1.6}
              max={2.8}
              step={0.1}
              value={rootPrefs.quran_line_height ?? QURAN_LINE_HEIGHT_DEFAULT}
              fmt={(v) => faNum(v.toFixed(1))}
              onCommit={(v) => updateRootPrefs({ quran_line_height: Number(v.toFixed(1)) })}
            />
          </div>
        ) : null}

        {/* ── ۲. پالت رنگ (۶ تم استاندارد پروتوتایپ — ۲ ردیف ۳تایی دایره‌ای مینیمال) ── */}
        <div className={"rm-pane" + (active === "theme" ? " on" : "")}>
          <div className="rm-t-sm" style={{ marginBottom: 14 }}>
            تم
          </div>
          {(
            [
              ["light", LIGHT_PALETTES],
              ["dark", DARK_PALETTES],
            ] as const
          ).map(([m, list]) => (
            <div key={m} className="rm-swatches">
              {list.map((p) => {
                const sel = themeMode === m && palette === p.id;
                return (
                  <div
                    key={`${m}-${p.id}`}
                    className="rm-swatch"
                    role="button"
                    tabIndex={0}
                    aria-pressed={sel}
                    title={p.name}
                    aria-label={"تم " + p.name}
                    style={{
                      background: p.bg,
                      color: p.text,
                      border: `${sel ? 3 : 1.5}px solid ${sel ? "var(--primary)" : p.sec + "59"}`,
                      boxShadow: sel ? "0 2px 10px 2px color-mix(in srgb,var(--primary) 35%,transparent)" : undefined,
                    }}
                    onClick={(e) => swatchClick(m, p.id, e.currentTarget)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        swatchClick(m, p.id, e.currentTarget);
                      }
                    }}
                  >
                    {sel ? <Mi name="check_rounded" size={26} /> : "أ"}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── ۳. مطالعه ── */}
        <div className={"rm-pane" + (active === "reading" ? " on" : "")}>
          {!isPdf ? (
            <>
              <div className="rm-t-sm">حالت مطالعه</div>
              <div className="rm-gap4" />
              <Seg
                items={[
                  { v: "pages", label: "صفحه‌بندی" },
                  { v: "scroll", label: "اسکرول پیوسته" },
                ]}
                value={prefs.mode}
                onChange={(v) => update({ mode: v as MobileReaderPrefs["mode"] })}
              />
              <div className="rm-gap12" />
              <div className="rm-t-sm">جهت پیش‌روی صفحات</div>
              <div className="rm-gap4" />
              <Seg
                items={PROGRESSION_OPTIONS.map((v) => ({ v, label: PROG_LABELS[v] }))}
                value={prefs.progression}
                onChange={(v) => update({ progression: v as MobileReaderPrefs["progression"] })}
              />
              <div className="rm-divider" style={{ margin: "16px 0 8px" }} />
            </>
          ) : null}
          <div className="rm-t-sm">ناحیه لمسی نمایش پنل‌ها</div>
          <div className="rm-gap4" />
          <Seg
            items={[
              { v: "center", icon: "crop_landscape", label: "مرکز صفحه" },
              { v: "bottom", icon: "vertical_align_bottom", label: "پایین صفحه" },
            ]}
            value={prefs.tap_mode}
            onChange={(v) => {
              const nextMode = v as MobileReaderPrefs["tap_mode"];
              update({ tap_mode: nextMode });
              onPreviewTapZone?.(nextMode, prefs.tap_area);
            }}
          />
          <div className="rm-gap8" />
          <div className="rm-tap-area-control">
            <SliderRow
              title="مساحت مستطیل لمسی"
              min={0.1}
              max={1}
              step={0.05}
              value={prefs.tap_area}
              fmt={(v) => faNum(Math.round(v * 100)) + "٪"}
              onPreview={(v) => {
                setPreviewingTap(true);
                onPreviewTapZone?.(prefs.tap_mode, v, true);
              }}
              onCommit={(v) => {
                setPreviewingTap(false);
                update({ tap_area: v });
                onPreviewTapZone?.(prefs.tap_mode, v);
              }}
            />
          </div>
        </div>

        {/* ── ۴. صفحه ── */}
        <div className={"rm-pane" + (active === "screen" ? " on" : "")}>
          {fullscreen.supported && <SwitchTile icon="fullscreen" title="نمایش تمام‌صفحه" value={immersive} onChange={() => void toggleImmersive()} />}
          <div className="rm-divider" style={{ margin: "12px 0" }} />
          <SwitchTile
            icon="pin_outlined"
            title="نمایش نشانگر شماره صفحه در پایین"
            sub="نمایش کپسول شماره صفحه شناور در پایین صفحه"
            value={prefs.show_pill}
            onChange={(v) => update({ show_pill: v })}
          />
        </div>
      </div>
      {saveState !== "idle" ? (
        <div
          className="rm-sh-foot"
          style={{
            color: saveState === "error" ? "var(--destructive)" : "var(--on-surface-var)",
          }}
          aria-live="polite"
        >
          <span>
            {saveState === "saving"
              ? "در حال ذخیرهٔ ترجیحات…"
              : saveState === "saved"
                ? "ترجیحات ذخیره شد."
                : "ذخیرهٔ ترجیحات ناموفق بود."}
          </span>
          {saveState === "error" ? (
            <button className="tbtn" style={{ fontSize: 12 }} onClick={() => updateRootPrefs({}, { persist: true })}>
              تلاش دوباره
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
