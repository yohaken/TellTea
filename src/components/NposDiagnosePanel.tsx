"use client";

import { useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  formatDiagnoseAt,
  subscribeNposDiagnoseReports,
  type NposDiagnoseReport,
} from "@/lib/npos-diagnose";

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
          : reports.length
            ? `${reports.length} เครื่อง · ส่งจากแอป nPos-telltea`
            : "ยังไม่มีรายงาน — เปิดแอป → ตรวจจอ/ฮาร์ดแวร์ → ส่งผลกลับ"
      }
      defaultOpen={false}
      className="npos-diagnose-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : reports.length === 0 ? (
        <p className="muted">ยังไม่มีข้อมูลตรวจเครื่อง</p>
      ) : (
        <ul className="npos-diagnose-list">
          {reports.map((r) => (
            <li key={r.id} className="npos-diagnose-card">
              <details>
                <summary>
                  <strong>{r.summary || "รายงาน"}</strong>
                  <span className="muted">
                    {" "}
                    · v{r.versionName || "?"} ({r.versionCode || "?"}) ·{" "}
                    {formatDiagnoseAt(r.reportedAt)}
                  </span>
                </summary>
                <p className="muted npos-diagnose-id">installId: {r.installId}</p>
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
          ))}
        </ul>
      )}
    </SettingsFold>
  );
}
