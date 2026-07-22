"use client";

import { useEffect, useMemo, useState } from "react";
import { Radio } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  dedupeByStableKey,
  foldByDeviceClass,
  nposDeviceClassLabel,
  preferOnlineRows,
  resolveNposDeviceClass,
  shortStableKey,
  type NposDeviceClass,
} from "@/lib/npos-device-class";
import {
  isPosDeviceOnline,
  posDeviceLabel,
  requestNposScreenCapture,
  setNposCaptureInterval,
  setNposDeviceBlocked,
  subscribePosDevicesAdmin,
  withResolvedStableKey,
  type PosDevice,
} from "@/lib/pos-devices";
import { useAuth } from "@/lib/auth";
import { NposCaptureGallery } from "@/components/NposCaptureGallery";
import { subscribeNposDiagnoseReports } from "@/lib/npos-diagnose";
import { resolveNposCaptureDisplayUrl } from "@/lib/npos-capture-media";

function isNposDevice(d: PosDevice): boolean {
  if (d.shellKind === "native") return true;
  return (d.userAgent || "").startsWith("nPos-telltea/");
}

type Row = PosDevice & { deviceClass: NposDeviceClass; sortAt: number };
type CaptureUrls = {
  primaryUrl: string;
  secondaryUrl: string;
  at: number;
  shotId?: string;
};

/**
 * Ghosts = disabled siblings from reinstall (not BO-blocked).
 * Keep newest per physical machine (stableKey / recovered from installId);
 * hide UUID wipe orphans when a keyed machine exists; prefer online.
 */
function prepareNposDevices(
  devices: PosDevice[],
  now: number,
): {
  shop: Row[];
  dev: Row[];
  blocked: Row[];
  ghostCount: number;
} {
  const rows: Row[] = devices.map((d) => {
    const resolved = withResolvedStableKey(d);
    return {
      ...resolved,
      deviceClass: resolveNposDeviceClass({
        ...resolved,
        // Old docs without isEmulator often came from AVD testing — treat SDK hints as dev.
        isEmulator:
          resolved.isEmulator === true ||
          /sdk|emulator|generic|goldfish|ranchu/i.test(resolved.deviceHint || ""),
      }),
      sortAt: resolved.lastSeenAt || 0,
    };
  });

  const ghosts = rows.filter((d) => d.disabled && d.deviceClass !== "blocked");
  const live = rows.filter((d) => d.deviceClass === "blocked" || !d.disabled);
  const deduped = preferOnlineRows(dedupeByStableKey(live), (d) =>
    isPosDeviceOnline(d.lastSeenAt, now),
  );
  const buckets = foldByDeviceClass(deduped);
  return { ...buckets, ghostCount: ghosts.length };
}

function formatSeen(ts: number): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("th-TH");
  } catch {
    return String(ts);
  }
}

function DeviceCard({
  d,
  now,
  busy,
  capture,
  onBlock,
  onUnblock,
  onCapture,
  onInterval,
}: {
  d: Row;
  now: number;
  busy: boolean;
  capture?: CaptureUrls;
  onBlock: () => void;
  onUnblock: () => void;
  onCapture: () => void;
  onInterval: (mins: number) => void;
}) {
  const online = isPosDeviceOnline(d.lastSeenAt, now);
  const machine = shortStableKey(d.stableKey, d.id);
  const capturePending =
    d.captureRequestAt > 0 && d.captureRequestAt > (d.lastCaptureAckAt || 0);
  return (
    <li className="npos-diagnose-card">
      <div className="npos-device-row">
        <strong>{posDeviceLabel(d)}</strong>
        <span className={online ? "npos-pill npos-pill--on" : "npos-pill npos-pill--off"}>
          {online ? "ออน" : "ออฟ"}
        </span>
      </div>
      <p className="muted npos-diagnose-id">
        รหัส {d.pairingCode} · เครื่อง {machine} · APK {d.nativeShellBuild || d.appBuild || "—"} ·{" "}
        {d.deviceHint || "android"}
        {d.isEmulator ? " · emulator" : ""}
      </p>
      <p className="muted npos-diagnose-id">
        จอลูกค้า {d.customerDisplay || "—"} · แคปล่าสุด{" "}
        {d.lastCaptureAt ? formatSeen(d.lastCaptureAt) : "ยังไม่มี"}
        {capturePending ? " · รอแคป…" : ""}
      </p>
      <p className="muted npos-diagnose-id">
        สิทธิ์เครื่อง{" "}
        {d.permissionsStatus
          ? d.permissionsStatus
          : d.permissionsOk
            ? "สิทธิ์ครบ"
            : "ยังไม่รายงาน — อัปเดต APK แล้วเปิดแอป"}
      </p>
      <p className="muted npos-diagnose-id">เห็นล่าสุด {formatSeen(d.lastSeenAt)}</p>
      <NposCaptureGallery
        primaryUrl={capture?.primaryUrl}
        secondaryUrl={capture?.secondaryUrl}
        caption={
          capture?.at
            ? `แตะรูปเพื่อดูเต็มจอ · ${formatSeen(capture.at)}`
            : undefined
        }
        emptyHint={
          capturePending
            ? "รอเครื่องแคปและอัปโหลด (~1 นาที)…"
            : "ยังไม่มีภาพ — กด «สั่งแคปจอ» แล้วรอเครื่องออนไลน์"
        }
      />
      <div className="npos-device-actions">
        <button type="button" className="npos-device-btn" disabled={busy || !online} onClick={onCapture}>
          สั่งแคปจอ
        </button>
        <label className="npos-capture-interval">
          ทุก
          <select
            value={String(d.captureIntervalMinutes || 0)}
            disabled={busy}
            onChange={(e) => onInterval(Number(e.target.value))}
          >
            <option value="0">ปิด</option>
            <option value="5">5 นาที</option>
            <option value="10">10 นาที</option>
            <option value="30">30 นาที</option>
          </select>
        </label>
        {d.deviceClass === "blocked" ? (
          <button type="button" className="npos-device-btn" disabled={busy} onClick={onUnblock}>
            ปลดบล็อก
          </button>
        ) : (
          <button type="button" className="npos-device-btn" disabled={busy} onClick={onBlock}>
            บล็อก
          </button>
        )}
      </div>
    </li>
  );
}

function ClassSection({
  cls,
  rows,
  now,
  busyId,
  captures,
  onBlock,
  onUnblock,
  onCapture,
  onInterval,
}: {
  cls: NposDeviceClass;
  rows: Row[];
  now: number;
  busyId: string | null;
  captures: Record<string, CaptureUrls>;
  onBlock: (d: Row) => void;
  onUnblock: (d: Row) => void;
  onCapture: (d: Row) => void;
  onInterval: (d: Row, mins: number) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="npos-class-section">
      <h4 className="npos-class-head">
        {nposDeviceClassLabel(cls)}{" "}
        <span className="muted">({rows.length})</span>
      </h4>
      <ul className="npos-diagnose-list">
        {rows.map((d) => (
          <DeviceCard
            key={d.id}
            d={d}
            now={now}
            busy={busyId === d.id}
            capture={captures[d.id]}
            onBlock={() => onBlock(d)}
            onUnblock={() => onUnblock(d)}
            onCapture={() => onCapture(d)}
            onInterval={(mins) => onInterval(d, mins)}
          />
        ))}
      </ul>
    </section>
  );
}

export function NposDevicesPanel({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [captures, setCaptures] = useState<Record<string, CaptureUrls>>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    setLoading(true);
    return subscribePosDevicesAdmin(
      (all) => {
        setDevices(all.filter(isNposDevice));
        setLoading(false);
        onError(null);
      },
      (err) => {
        setLoading(false);
        onError(err.message);
      },
    );
  }, [onError]);

  useEffect(() => {
    return subscribeNposDiagnoseReports((reports) => {
      const next: Record<string, CaptureUrls> = {};
      for (const r of reports) {
        const shotId = r.latestCaptureId || "";
        const primaryUrl = resolveNposCaptureDisplayUrl({
          shotId,
          role: "primary",
          storedUrl: r.latestPrimaryUrl,
        });
        const secondaryUrl = resolveNposCaptureDisplayUrl({
          shotId,
          role: "secondary",
          storedUrl: r.latestSecondaryUrl,
        });
        if (!primaryUrl && !secondaryUrl && !r.latestCaptureAt) continue;
        if (!primaryUrl && !secondaryUrl) continue;
        next[r.installId] = {
          primaryUrl,
          secondaryUrl,
          at: r.latestCaptureAt || 0,
          shotId,
        };
      }
      setCaptures(next);
    });
  }, []);

  /** Prefer diagnose + media proxy; fall back to posDevices fields. */
  const capturesForUi = useMemo(() => {
    const next: Record<string, CaptureUrls> = {};
    for (const d of devices) {
      const fromDiag = captures[d.id];
      const shotId = fromDiag?.shotId || "";
      const primaryUrl = resolveNposCaptureDisplayUrl({
        shotId,
        role: "primary",
        storedUrl: fromDiag?.primaryUrl || d.latestPrimaryUrl,
      });
      const secondaryUrl = resolveNposCaptureDisplayUrl({
        shotId,
        role: "secondary",
        storedUrl: fromDiag?.secondaryUrl || d.latestSecondaryUrl,
      });
      if (!primaryUrl && !secondaryUrl) continue;
      next[d.id] = {
        primaryUrl,
        secondaryUrl,
        at: Math.max(fromDiag?.at || 0, d.lastCaptureAt || 0),
        shotId,
      };
    }
    for (const [id, cap] of Object.entries(captures)) {
      if (next[id]) continue;
      if (!cap.primaryUrl && !cap.secondaryUrl) continue;
      next[id] = cap;
    }
    return next;
  }, [captures, devices]);

  const buckets = useMemo(() => prepareNposDevices(devices, now), [devices, now]);
  const total =
    buckets.shop.length + buckets.dev.length + buckets.blocked.length;
  const onlineShop = buckets.shop.filter((d) => isPosDeviceOnline(d.lastSeenAt, now)).length;
  const onlineDev = buckets.dev.filter((d) => isPosDeviceOnline(d.lastSeenAt, now)).length;

  async function block(d: Row) {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนบล็อกเครื่อง");
      return;
    }
    setBusyId(d.id);
    try {
      await setNposDeviceBlocked(d.id, true, actorId, { isEmulator: d.isEmulator });
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function unblock(d: Row) {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนปลดบล็อก");
      return;
    }
    setBusyId(d.id);
    try {
      await setNposDeviceBlocked(d.id, false, actorId, { isEmulator: d.isEmulator });
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function capture(d: Row) {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนสั่งแคปจอ");
      return;
    }
    setBusyId(d.id);
    try {
      await requestNposScreenCapture(d.id, actorId);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function setIntervalMins(d: Row, mins: number) {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนตั้งช่วงแคป");
      return;
    }
    setBusyId(d.id);
    try {
      await setNposCaptureInterval(d.id, mins, actorId);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsFold
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <Radio size={16} aria-hidden />
          เครื่อง nPos
        </span>
      }
      hint={
        loading
          ? "กำลังโหลดรายการเครื่อง…"
          : total
            ? `ออน ${onlineShop + onlineDev} · หน้าร้าน ${buckets.shop.length} · พัฒนา ${buckets.dev.length} · บล็อก ${buckets.blocked.length}${
                buckets.ghostCount ? ` · ซ่อนซ้ำ ${buckets.ghostCount}` : ""
              }`
            : "ยังไม่มีเครื่อง — เปิดแอป nPos แล้วจะลงทะเบียนเอง"
      }
      defaultOpen={false}
      className="npos-devices-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : total === 0 ? (
        <p className="muted">ยังไม่มีเครื่อง native</p>
      ) : (
        <>
          <ClassSection
            cls="shop"
            rows={buckets.shop}
            now={now}
            busyId={busyId}
            captures={capturesForUi}
            onBlock={block}
            onUnblock={unblock}
            onCapture={capture}
            onInterval={setIntervalMins}
          />
          <ClassSection
            cls="dev"
            rows={buckets.dev}
            now={now}
            busyId={busyId}
            captures={capturesForUi}
            onBlock={block}
            onUnblock={unblock}
            onCapture={capture}
            onInterval={setIntervalMins}
          />
          <ClassSection
            cls="blocked"
            rows={buckets.blocked}
            now={now}
            busyId={busyId}
            captures={capturesForUi}
            onBlock={block}
            onUnblock={unblock}
            onCapture={capture}
            onInterval={setIntervalMins}
          />
        </>
      )}
    </SettingsFold>
  );
}
