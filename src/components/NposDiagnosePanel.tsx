"use client";

import { useEffect, useMemo, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  dedupeByStableKey,
  foldByDeviceClass,
  nposDeviceClassLabel,
  nposGroupKey,
  preferOnlineRows,
  resolveNposDeviceClass,
  shortStableKey,
  type NposDeviceClass,
} from "@/lib/npos-device-class";
import {
  formatDiagnoseAt,
  subscribeNposDiagnoseReports,
  type NposDiagnoseReport,
} from "@/lib/npos-diagnose";
import {
  isPosDeviceOnline,
  subscribePosDevicesAdmin,
  withResolvedStableKey,
  type PosDevice,
} from "@/lib/pos-devices";
import { NposCaptureGallery } from "@/components/NposCaptureGallery";
import { resolveNposCaptureDisplayUrl } from "@/lib/npos-capture-media";

type Row = NposDiagnoseReport & {
  deviceClass: NposDeviceClass;
  sortAt: number;
  priorVersions: number;
  online: boolean;
};

function isNposDevice(d: PosDevice): boolean {
  if (d.shellKind === "native") return true;
  return (d.userAgent || "").startsWith("nPos-telltea/");
}

/** Live install ids after ghost filter + stableKey dedupe (same as เครื่อง nPos). */
function liveDeviceIds(devices: PosDevice[], now: number): {
  ids: Set<string>;
  groupKeys: Set<string>;
  onlineIds: Set<string>;
} {
  const rows = devices.filter(isNposDevice).map((d) => {
    const resolved = withResolvedStableKey(d);
    return {
      ...resolved,
      deviceClass: resolveNposDeviceClass({
        ...resolved,
        isEmulator:
          resolved.isEmulator === true ||
          /sdk|emulator|generic|goldfish|ranchu/i.test(resolved.deviceHint || ""),
      }),
      sortAt: resolved.lastSeenAt || 0,
    };
  });
  const live = rows.filter((d) => d.deviceClass === "blocked" || !d.disabled);
  const deduped = preferOnlineRows(dedupeByStableKey(live), (d) =>
    isPosDeviceOnline(d.lastSeenAt, now),
  );
  return {
    ids: new Set(deduped.map((d) => d.id)),
    groupKeys: new Set(deduped.map((d) => nposGroupKey(d.stableKey, d.id))),
    onlineIds: new Set(
      deduped.filter((d) => isPosDeviceOnline(d.lastSeenAt, now)).map((d) => d.id),
    ),
  };
}

function ReportCard({ r }: { r: Row }) {
  return (
    <li className="npos-diagnose-card">
      <details>
        <summary>
          <strong>{r.summary || "รายงานล่าสุด"}</strong>
          <span className={r.online ? "npos-pill npos-pill--on" : "npos-pill npos-pill--off"}>
            {r.online ? "ออน" : "ออฟ"}
          </span>
          <span className="muted">
            {" "}
            · v{r.versionName || "?"} ({r.versionCode || "?"}) ·{" "}
            {formatDiagnoseAt(r.reportedAt)}
          </span>
        </summary>
        <p className="muted npos-diagnose-id">
          เครื่อง {shortStableKey(r.stableKey, r.installId)}
          {r.isEmulator ? " · emulator" : ""} · จอลูกค้า {r.customerDisplay || "—"}
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

        <h4 className="npos-diagnose-sub">
          แคปจอล่าสุด{" "}
          <span className="muted">
            {r.latestCaptureAt ? formatDiagnoseAt(r.latestCaptureAt) : ""}
            {r.latestCaptureReason ? ` · ${r.latestCaptureReason}` : ""}
          </span>
        </h4>
        <NposCaptureGallery
          primaryUrl={resolveNposCaptureDisplayUrl({
            shotId: r.latestCaptureId,
            role: "primary",
            storedUrl: r.latestPrimaryUrl,
          })}
          secondaryUrl={resolveNposCaptureDisplayUrl({
            shotId: r.latestCaptureId,
            role: "secondary",
            storedUrl: r.latestSecondaryUrl,
          })}
          emptyHint="ยังไม่มีภาพ — สั่งแคปจาก «เครื่อง nPos» แล้วรอสัญญาณ ~1 นาที · แตะรูปเพื่อซูม"
        />

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
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    setLoading(true);
    const unsubDiag = subscribeNposDiagnoseReports(
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
    const unsubDev = subscribePosDevicesAdmin(
      (all) => setDevices(all.filter(isNposDevice)),
      () => {
        /* devices optional for diagnose list */
      },
    );
    return () => {
      unsubDiag();
      unsubDev();
    };
  }, [onError]);

  const { buckets, hidden } = useMemo(() => {
    const live = liveDeviceIds(devices, now);
    const active = reports.filter((r) => !r.disabled || r.blocked);
    const rows = active.map((r) => ({
      ...r,
      sortAt: Math.max(r.reportedAt || 0, r.latestCaptureAt || 0),
    }));

    let kept = dedupeByStableKey(rows, { liveInstallIds: live.ids });

    // Align with device list: one card per live machine key when devices known.
    if (live.groupKeys.size > 0) {
      kept = kept.filter((r) => live.groupKeys.has(nposGroupKey(r.stableKey, r.installId)));
    }

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
      return {
        ...r,
        priorVersions: prior,
        online: live.onlineIds.has(r.installId) || live.onlineIds.has(r.id),
      };
    });

    return {
      buckets: foldByDeviceClass(enriched),
      hidden: hiddenCount,
    };
  }, [reports, devices, now]);

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
            ? `${total} เครื่อง · สเปกจอ + แคปล่าสุด · ยึด id เครื่อง${
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
