"use client";

import { useEffect, useMemo, useState } from "react";
import { PosPrintDocFrame } from "@/components/PosPrintDocFrame";
import {
  buildBohSessionReportPreviewHtml,
} from "@/lib/pos-boh-print-docs";
import type { PosShopSettings } from "@/lib/pos-settings";
import type { PosSale, PosSession } from "@/lib/types";
import { posSessionCode } from "@/lib/pos-sales-report";
import type { ShiftReportKind } from "@/lib/pos-shift-report";

/**
 * BOH preview of X (ระหว่างกะ) / Z (ปิดรอบ + นำส่งเงิน) —
 * same HTML as tablet thermal ShiftReportFormBuilder.
 */
export function PosSessionPrintDocs({
  session,
  sales,
  shop,
}: {
  session: PosSession;
  sales: PosSale[];
  shop: PosShopSettings;
}) {
  const closed = session.status === "closed";
  const [kind, setKind] = useState<ShiftReportKind>(closed ? "close" : "snapshot");

  useEffect(() => {
    setKind(session.status === "closed" ? "close" : "snapshot");
  }, [session.id, session.status]);

  const html = useMemo(
    () => buildBohSessionReportPreviewHtml(session, sales, shop, kind),
    [session, sales, shop, kind],
  );

  const title =
    kind === "close"
      ? `รายงานปิดรอบ · นำส่งเงิน · ${posSessionCode(session.id)}`
      : `Snapshot ระหว่างรอบ · ${posSessionCode(session.id)}`;

  return (
    <section className="pos-session-print-docs" aria-label="เอกสารพิมพ์รอบ">
      <header className="pos-session-print-docs-head">
        <div>
          <h3 className="pos-session-print-docs-title">เอกสารพิมพ์รอบ</h3>
          <p className="muted pos-session-print-docs-sub">
            ฟอร์มเดียวกับเครื่องพิมพ์หน้างาน · รอบ {posSessionCode(session.id)}
            {session.openedByName ? ` · ${session.openedByName}` : ""}
          </p>
        </div>
        <div className="pos-session-print-docs-tabs" role="tablist" aria-label="ชนิดเอกสาร">
          <button
            type="button"
            role="tab"
            aria-selected={kind === "snapshot"}
            className={kind === "snapshot" ? "is-active" : ""}
            onClick={() => setKind("snapshot")}
          >
            X · ระหว่างกะ
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "close"}
            className={kind === "close" ? "is-active" : ""}
            onClick={() => setKind("close")}
            disabled={!closed}
            title={closed ? undefined : "มีหลังปิดกะที่แท็บเล็ต"}
          >
            Z · ปิดรอบ / นำส่ง
          </button>
        </div>
      </header>
      {!closed && kind === "snapshot" ? (
        <p className="muted pos-session-print-docs-hint">
          รอบยังเปิด — เอกสารนี้คือ Snapshot แบบที่หน้าร้านกดพิมพ์ X · ส่วนนำส่งเงินจะครบเมื่อปิดกะ
        </p>
      ) : null}
      {closed && kind === "close" ? (
        <p className="muted pos-session-print-docs-hint">
          รวมบล็อก «ยอดเงินสดที่ต้องนำส่ง» เหมือนสลิป Z ที่แท็บเล็ตพิมพ์ตอนปิดรอบ
        </p>
      ) : null}
      <PosPrintDocFrame html={html} title={title} tall />
    </section>
  );
}
