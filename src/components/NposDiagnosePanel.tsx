"use client";

import { useEffect, useMemo, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  dedupeByStableKey,
  foldByDeviceClass,
  nposDeviceClassLabel,
  shortStableKey,
  type NposDeviceClass,
} from "@/lib/npos-device-class";
import {
  formatDiagnoseAt,
  subscribeNposDiagnoseReports,
  type NposDiagnoseReport,
} from "@/lib/npos-diagnose";

type Row = NposDiagnoseReport & { deviceClass: NposDeviceClass; sortAt: number };

function ReportCard({ r }: { r: Row }) {
  return (
    <li className="npos-diagnose-card">
      <details>
        <summary>
          <strong>{r.summary || "รายงาน"}</strong>
          <span className="muted">
            {" "}
            · v{r.versionName || "?"} ({r.versionCode || "?"}) ·{" "}
            {formatDiagnoseAt(r.reportedAt)}
          </span>
        </summary>
        <p className="muted npos-diagnose-id">
          เครื่อง {shortStableKey(r.stableKey, r.installId)}
          {r.isEmulator ? " · emulator" : ""} · installId: {r.installId}
        </p>
        <h4 className="npos-diagnose-sub">จอ</h4>
        {r.displays.length === 0 ? (
          <p className="muted">ไม่พบจอในรายงาน</p>
        ) : (
          <ul className="npos-diagnose-sublist">
            {r.displays.map((d) => (
              <li key={`${r.id}-d-${d.number}-${d.displayId}`}>
                จอ {d.number}: {d.name}
                {d.primary ? " · หลัก" : " · เพิ่ม"} (id={d.displayId})
              </li>
            ))}
          </ul>
        )}
        <h4 className="npos-diagnose-sub">ตัวเชื่อมต่อ</h4>
        {r.hardware.length === 0 ? (
          <p className="muted">ไม่พบอุปกรณ์ในรายงาน</p>
        ) : (
          <ul className="npos-diagnose-sublist">
            {r.hardware.map((h, i) => (
              <li key={`${r.id}-h-${i}`}>
                <strong>[{h.category}]</strong> {h.title}
                {h.detail ? <span className="muted"> — {h.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

export function NposDiagnosePanel({ onError }: { onError: (msg: string | null) => void }) {
  const [reports, setReports] = useState<NposDiagnoseReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    return subscribeNposDiagnoseReports(
      (next) => {
        setReports(next);
        setLoading(false);
        onError(null);
      },
      (err) => {
        setLoading(false);
        onError(err.message);
      },
    );
  }, [onError]);

  const buckets = useMemo(() => {
    const rows: Row[] = reports.map((r) => ({
      ...r,
      sortAt: r.reportedAt || 0,
    }));
    return foldByDeviceClass(dedupeByStableKey(rows));
  }, [reports]);

  const total =
    buckets.shop.length + buckets.dev.length + buckets.blocked.length;

  return (
    <SettingsFold
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <MonitorSmartphone size={16} aria-hidden />
          ตรวจเครื่อง (nPos)
        </span>
      }
      hint={
        loading
          ? "กำลังโหลดรายงานจากแท็บเล็ต…"
          : total
            ? `${total} เครื่อง · พับหน้าร้าน/พัฒนา/บล็อก · กลุ่มตาม stableKey`
            : "ยังไม่มีรายงาน — เปิดแอป → ตรวจจอ/ฮาร์ดแวร์ → ส่งผลกลับ"
      }
      defaultOpen={false}
      className="npos-diagnose-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : total === 0 ? (
        <p className="muted">ยังไม่มีข้อมูลตรวจเครื่อง</p>
      ) : (
        <>
          {(["shop", "dev", "blocked"] as const).map((cls) => {
            const rows = buckets[cls];
            if (!rows.length) return null;
            return (
              <section key={cls} className="npos-class-section">
                <h4 className="npos-class-head">
                  {nposDeviceClassLabel(cls)}{" "}
                  <span className="muted">({rows.length})</span>
                </h4>
                <ul className="npos-diagnose-list">
                  {rows.map((r) => (
                    <ReportCard key={r.id} r={r} />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </SettingsFold>
  );
}
