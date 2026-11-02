/**
 * شیت پانویس/ارجاع موبایل — پورت #foot پروتوتایپ (:534-538) با همان FootnotePanel دسکتاپ.
 * پل توکن shadcn → توکن‌های تم مطالعه در .rm-token-bridge.
 */
"use client";

import { Mi } from "./mi";
import { FootnotePanel, type FootnotePanelData } from "@/components/reader/footnote-panel";

function sheetTitle(data: FootnotePanelData | null): string {
  if (!data) return "پاورقی / ارجاع";
  if (data.kind === "footnote") return `پانویس${data.label ? " " + data.label : ""}`;
  if (data.kind === "verse") return "آیه";
  if (data.kind === "hadith") return "روایت";
  return "ارجاع";
}

export function MobileFootnoteSheet({
  data,
  onClose,
  documentUid,
  onHadithLookup,
  onHadithFiche,
  onHadithNote,
}: {
  data: FootnotePanelData | null;
  onClose: () => void;
  documentUid: string;
  onHadithLookup?: (localUid: string) => void;
  onHadithFiche?: (localUid: string) => void;
  onHadithNote?: (localUid: string, revayatIndex?: string | null) => void;
}) {
  return (
    <section
      id="rm-foot"
      className={"rm-pop" + (data ? " on" : "")}
      aria-hidden={!data}
      aria-label="پاورقی"
    >
      <div className="rm-grab" />
      <div className="row" style={{ padding: "4px 20px 0", flex: "none" }}>
        <b style={{ flex: 1, fontSize: 16 }}>{sheetTitle(data)}</b>
        <button className="ib" aria-label="بستن پاورقی" onClick={onClose}>
          <Mi name="close" />
        </button>
      </div>
      <div
        className="rm-foot-body rm-token-bridge"
        style={{ height: "52vh", minHeight: 180, padding: 0, display: "flex", flexDirection: "column" }}
      >
        {data ? (
          <FootnotePanel
            data={data}
            onBack={onClose}
            documentUid={documentUid}
            onHadithLookup={onHadithLookup}
            onHadithFiche={onHadithFiche}
            onHadithNote={onHadithNote}
          />
        ) : null}
      </div>
    </section>
  );
}
