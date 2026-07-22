"use client";

import { useEffect, useMemo, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  dedupeByStableKey,
  foldByDeviceClass,
  nposDeviceClassLabel,
  nposGroupKey,
  shortStableKey,
  type NposDeviceClass,
} from "@/lib/npos-device-class";
import {
  formatDiagnoseAt,
  subscribeNposDiagnoseReports,
  type NposDiagnoseReport,
} from "@/lib/npos-diagnose";

type Row = NposDiagnoseReport & {
  deviceClass: NposDeviceClass;
  sortAt: number;
  priorVersions: number;
};

function ReportCard({ r }: { r: Row }) {
  return (
    <li className="npos-diagnose-card">
      <details>
        <summary>
          <strong>{r.summary || "รายงานล่าสุด"}</strong>
          <span className="muted">
            {" "}
            · v{r.versionName || "?"} ({r.versionCode || "?"}) ·{" "}
            {formatDiagnoseAt(r.reportedAt)}
          </span>
        </summary>
        <p className="muted npos-diagnose-id">
          เครื่อง {shortStableKey(r.stableKey, r.installId)}
          {r.isEmulator ? " · emulator" : ""} · จอลูกค้า {r.customerDisplay || "—"} · installId:{" "}
          {r.installId}
          {r.priorVersions > 0
            ? ` · ซ่อนรายงานเก่า ${r.priorVersions} เวอร์ชัน (install ซ้ำตอนเทส)`
            : ""}
        </p>

        <h4 className="npos-diagnose-sub">จอ (สเปก)</h4>
        {r.displays.length === 0 ? (
          <p className="muted">ไม่พบจอในรายงาน</p>
        ) : (
          <ul className="npos-diagnose-sublist">
            {r.displays.map((d) => (
              <li key={`${r.id}-d-${d.number}-${d.displayId}`}>
                จอ {d.number}: {d.name}
                {d.primary ? " · หลัก" : " · ลูกค้า"} ·{" "}
                {d.widthPx && d.heightPx ? `${d.widthPx}×${d.heightPx}` : "ขนาด?"} ·{" "}
                {d.orientation || "?"}
                {d.densityDpi ? ` · ${d.densityDpi}dpi` : ""}
                {d.rotation ? ` · หมุน ${d.rotation}°` : ""}
              </li>
            ))}
          </ul>
        )}

        {(r.latestPrimaryUrl || r.latestSecondaryUrl) && (
          <>
            <h4 className="npos-diagnose-sub">
              แคปจอล่าสุด{" "}
              <span className="muted">
                {r.latestCaptureAt ? formatDiagnoseAt(r.latestCaptureAt) : ""}
                {r.latestCaptureReason ? ` · ${r.latestCaptureReason}` : ""}
              </span>
            </h4>
            <div className="npos-capture-thumbs">
              {r.latestPrimaryUrl ? (
                <a href={r.latestPrimaryUrl} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.latestPrimaryUrl} alt="แคปจอหลัก" />
                  <span>จอหลัก</span>
                </a>
              ) : null}
              {r.latestSecondaryUrl ? (
                <a href={r.latestSecondaryUrl} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.latestSecondaryUrl} alt="แคปจอลูกค้า" />
                  <span>จอลูกค้า</span>
                </a>
              ) : (
                <p className="muted">ยังไม่มีภาพจอลูกค้า (อาจมีจอเดียว)</p>
              )}
            </div>
          </>
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

  const { buckets, hidden } = useMemo(() => {
    const rows = reports.map((r) => ({
      ...r,
      sortAt: Math.max(r.reportedAt || 0, r.latestCaptureAt || 0),
    }));
    const kept = dedupeByStableKey(rows);
    const hiddenCount = Math.max(0, reports.length - kept.length);

    const orphanRawCount = reports.filter((r) =>
      nposGroupKey(r.stableKey, r.installId).startsWith("orphan:"),
    ).length;
    const keyedKept = kept.filter(
      (r) => !nposGroupKey(r.stableKey, r.installId).startsWith("orphan:"),
    );

    const enriched: Row[] = kept.map((r) => {
      const group = nposGroupKey(r.stableKey, r.installId);
      let prior = reports.filter(
        (x) => x.id !== r.id && nposGroupKey(x.stableKey, x.installId) === group,
      ).length;
      if (group.startsWith("orphan:") && keyedKept.length === 0) {
        prior = Math.max(0, orphanRawCount - 1);
      } else if (
        !group.startsWith("orphan:") &&
        keyedKept.length > 0 &&
        r.id === keyedKept.sort((a, b) => b.sortAt - a.sortAt)[0]?.id
      ) {
        prior += orphanRawCount;
      }
      return { ...r, priorVersions: prior };
    });

    return {
      buckets: foldByDeviceClass(enriched),
      hidden: hiddenCount,
    };
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
            ? `${total} เครื่อง · สเปกจอ + แคปล่าสุด${
                hidden ? ` · ซ่อนซ้ำ/เก่า ${hidden}` : ""
              }`
            : "ยังไม่มีรายงาน — เปิดแอปแล้วระบบสแกนอัตโนมัติ"
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
