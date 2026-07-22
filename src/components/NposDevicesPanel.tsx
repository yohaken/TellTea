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
  setNposDeviceBlocked,
  subscribePosDevicesAdmin,
  withResolvedStableKey,
  type PosDevice,
} from "@/lib/pos-devices";
import { useAuth } from "@/lib/auth";

function isNposDevice(d: PosDevice): boolean {
  if (d.shellKind === "native") return true;
  return (d.userAgent || "").startsWith("nPos-telltea/");
}

type Row = PosDevice & { deviceClass: NposDeviceClass; sortAt: number };

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
  onBlock,
  onUnblock,
}: {
  d: Row;
  now: number;
  busy: boolean;
  onBlock: () => void;
  onUnblock: () => void;
}) {
  const online = isPosDeviceOnline(d.lastSeenAt, now);
  const machine = shortStableKey(d.stableKey, d.id);
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
      <p className="muted npos-diagnose-id">เห็นล่าสุด {formatSeen(d.lastSeenAt)}</p>
      <div className="npos-device-actions">
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
  onBlock,
  onUnblock,
}: {
  cls: NposDeviceClass;
  rows: Row[];
  now: number;
  busyId: string | null;
  onBlock: (d: Row) => void;
  onUnblock: (d: Row) => void;
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
            onBlock={() => onBlock(d)}
            onUnblock={() => onUnblock(d)}
          />
        ))}
      </ul>
    </section>
  );
}

export function NposDevicesPanel({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [devices, setDevices] = useState<PosDevice[]>([]);
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
            onBlock={block}
            onUnblock={unblock}
          />
          <ClassSection
            cls="dev"
            rows={buckets.dev}
            now={now}
            busyId={busyId}
            onBlock={block}
            onUnblock={unblock}
          />
          <ClassSection
            cls="blocked"
            rows={buckets.blocked}
            now={now}
            busyId={busyId}
            onBlock={block}
            onUnblock={unblock}
          />
        </>
      )}
    </SettingsFold>
  );
}
