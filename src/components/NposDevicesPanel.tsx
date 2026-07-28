"use client";

import { useEffect, useMemo, useState } from "react";
import { Radio } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { PosConfirmDialog } from "@/components/PosConfirmDialog";
import {
  dedupeByStableKey,
  foldByDeviceClass,
  looksLikeEmulatorHint,
  nposDeviceClassLabel,
  preferOnlineRows,
  resolveNposDeviceClass,
  shortStableKey,
  type NposDeviceClass,
} from "@/lib/npos-device-class";
import {
  bundledNposSystemRelease,
  fetchNposSystemRelease,
  nposVersionMatch,
  type NposSystemRelease,
} from "@/lib/npos-apk-release";
import {
  isPosDeviceOnline,
  posClientVersionLabel,
  posDeviceEquipment,
  posDeviceLabel,
  clearNposDeviceCaptures,
  clearNposExclusiveSeat,
  getNposStoreClaimStatus,
  purgeNposDevDevices,
  NPOS_SHOP_KEEP_PAIRING_CODE,
  requestNposScreenCapture,
  setNposCaptureInterval,
  setNposDeviceBlocked,
  setNposDeviceStoreClaimed,
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
 * Shop-facing: drop emulator / deviceClass=dev from buckets used in UI.
 */
function prepareNposDevices(
  devices: PosDevice[],
  now: number,
): {
  shop: Row[];
  blocked: Row[];
  ghostCount: number;
  hiddenDevCount: number;
} {
  const rows: Row[] = devices.map((d) => {
    const resolved = withResolvedStableKey(d);
    return {
      ...resolved,
      deviceClass: resolveNposDeviceClass({
        ...resolved,
        // Old docs without isEmulator often came from AVD testing — treat SDK hints as dev.
        isEmulator:
          resolved.isEmulator === true || looksLikeEmulatorHint(resolved.deviceHint),
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
  // Blocked shop tablets stay; blocked emulators stay hidden with other dev rows.
  const blockedShop = buckets.blocked.filter(
    (d) => !(d.isEmulator || looksLikeEmulatorHint(d.deviceHint)),
  );
  return {
    shop: buckets.shop,
    blocked: blockedShop,
    ghostCount: ghosts.length,
    hiddenDevCount: buckets.dev.length + (buckets.blocked.length - blockedShop.length),
  };
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
  systemRelease,
  onBlock,
  onUnblock,
  onCapture,
  onClearCaptures,
  onInterval,
  onGrantClaim,
  onRevokeClaim,
}: {
  d: Row;
  now: number;
  busy: boolean;
  capture?: CaptureUrls;
  systemRelease: NposSystemRelease;
  onBlock: () => void;
  onUnblock: () => void;
  onCapture: () => void;
  onClearCaptures: () => void;
  onInterval: (mins: number) => void;
  onGrantClaim: () => void;
  onRevokeClaim: () => void;
}) {
  const online = isPosDeviceOnline(d.lastSeenAt, now);
  const machine = shortStableKey(d.stableKey, d.id);
  const versionLabel = posClientVersionLabel(d);
  const clientCode = d.nativeShellBuild || d.appBuild || 0;
  const match = nposVersionMatch(clientCode, systemRelease.versionCode);
  const matchHint =
    match === "ok" ? "ตรงระบบ" : match === "behind" ? "เก่ากว่าระบบ" : match === "ahead" ? "ใหม่กว่าระบบ" : "";
  const equip = posDeviceEquipment(d);
  const capturePending =
    d.captureRequestAt > 0 && d.captureRequestAt > (d.lastCaptureAckAt || 0);
  const hasCapture = !!(capture?.primaryUrl || capture?.secondaryUrl);
  return (
    <li className="npos-diagnose-card npos-device-slim-card">
      <div className="npos-device-row">
        <strong>{posDeviceLabel(d)}</strong>
        <span className={online ? "npos-pill npos-pill--on" : "npos-pill npos-pill--off"}>
          {online ? "ออน" : "ออฟ"}
        </span>
      </div>
      <p className="muted npos-diagnose-id">
        รหัส {d.pairingCode} · เครื่อง {machine} · ระบบ {systemRelease.label} · nPos{" "}
        {match === "ok" ? "✓ " : ""}
        {versionLabel}
        {matchHint ? ` · ${matchHint}` : ""} · {d.deviceHint || "android"}
        {" · "}
        {d.storeClaimed
          ? `เคลม${d.storeClaimMethod ? ` (${d.storeClaimMethod})` : ""}`
          : d.storeClaimMethod === "revoked"
            ? `ถูกเตะ${d.storeClaimRevokeReason ? ` · ${d.storeClaimRevokeReason}` : ""}`
            : "ยังไม่เคลม"}
        {" · เห็น "}
        {formatSeen(d.lastSeenAt)}
      </p>
      <p className="muted npos-diagnose-id" title={equip.title}>
        อุปกรณ์ {equip.short}
        {d.printerLabel ? ` · ${d.printerLabel}` : ""}
        {" · จอลูกค้า "}
        {d.customerDisplay || "—"} · แคป{" "}
        {d.lastCaptureAt ? formatSeen(d.lastCaptureAt) : "ยังไม่มี"}
        {capturePending ? " · รอแคป…" : ""}
        {" · "}
        {d.permissionsStatus
          ? d.permissionsStatus
          : d.permissionsOk
            ? "สิทธิ์ครบ"
            : "ยังไม่รายงานสิทธิ์"}
      </p>
      <NposCaptureGallery
        primaryUrl={capture?.primaryUrl}
        secondaryUrl={capture?.secondaryUrl}
        caption={
          capture?.at
            ? `แตะรูปเพื่อดูเต็มความละเอียด · ${formatSeen(capture.at)}`
            : undefined
        }
        emptyHint={
          capturePending
            ? "รอเครื่องแคปและอัปโหลด (~1 นาที)…"
            : "ยังไม่มีภาพ — กด «สั่งแคปจอ» แล้วรอเครื่องออนไลน์"
        }
      />
      <div className="npos-device-actions npos-device-actions--text">
        <button
          type="button"
          className="npos-slim-text-btn"
          disabled={busy || !online}
          onClick={onCapture}
        >
          สั่งแคปจอ
        </button>
        <button
          type="button"
          className="npos-slim-text-btn npos-slim-text-btn--danger"
          disabled={busy || !hasCapture}
          onClick={onClearCaptures}
        >
          ล้างภาพแคป
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
        {d.storeClaimed ? (
          <button type="button" className="npos-slim-text-btn" disabled={busy} onClick={onRevokeClaim}>
            เตะเครื่อง
          </button>
        ) : (
          <button type="button" className="npos-slim-text-btn" disabled={busy} onClick={onGrantClaim}>
            ให้ seat
          </button>
        )}
        {d.deviceClass === "blocked" ? (
          <button type="button" className="npos-slim-text-btn" disabled={busy} onClick={onUnblock}>
            ปลดบล็อก
          </button>
        ) : (
          <button type="button" className="npos-slim-text-btn" disabled={busy} onClick={onBlock}>
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
  systemRelease,
  onBlock,
  onUnblock,
  onCapture,
  onClearCaptures,
  onInterval,
  onGrantClaim,
  onRevokeClaim,
}: {
  cls: NposDeviceClass;
  rows: Row[];
  now: number;
  busyId: string | null;
  captures: Record<string, CaptureUrls>;
  systemRelease: NposSystemRelease;
  onBlock: (d: Row) => void;
  onUnblock: (d: Row) => void;
  onCapture: (d: Row) => void;
  onClearCaptures: (d: Row) => void;
  onInterval: (d: Row, mins: number) => void;
  onGrantClaim: (d: Row) => void;
  onRevokeClaim: (d: Row) => void;
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
            systemRelease={systemRelease}
            onBlock={() => onBlock(d)}
            onUnblock={() => onUnblock(d)}
            onCapture={() => onCapture(d)}
            onClearCaptures={() => onClearCaptures(d)}
            onInterval={(mins) => onInterval(d, mins)}
            onGrantClaim={() => onGrantClaim(d)}
            onRevokeClaim={() => onRevokeClaim(d)}
          />
        ))}
      </ul>
    </section>
  );
}

type ConfirmKind = "clearCaptures" | "revoke" | "clearSeat" | "purgeDev";

export function NposDevicesPanel({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [captures, setCaptures] = useState<Record<string, CaptureUrls>>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeSeatId, setActiveSeatId] = useState("");
  const [systemRelease, setSystemRelease] = useState<NposSystemRelease>(() =>
    bundledNposSystemRelease(),
  );
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; device?: Row } | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void fetchNposSystemRelease(ac.signal).then(setSystemRelease);
    return () => ac.abort();
  }, []);

  useEffect(() => {
    void getNposStoreClaimStatus()
      .then((s) => setActiveSeatId(s.activeSeatInstallId || ""))
      .catch(() => setActiveSeatId(""));
  }, [devices]);

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
  const total = buckets.shop.length + buckets.blocked.length;
  const onlineShop = buckets.shop.filter((d) => isPosDeviceOnline(d.lastSeenAt, now)).length;
  const tableRows = buckets.shop;

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

  function clearCaptures(d: Row) {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนล้างภาพแคป");
      return;
    }
    setConfirm({ kind: "clearCaptures", device: d });
  }

  function revokeClaim(d: Row) {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนเตะเครื่อง");
      return;
    }
    setConfirm({ kind: "revoke", device: d });
  }

  function clearAllSeats() {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนเคลียร์ seat");
      return;
    }
    setConfirm({ kind: "clearSeat" });
  }

  function purgeDev() {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนลบเครื่องพัฒนา");
      return;
    }
    setConfirm({ kind: "purgeDev" });
  }

  async function runConfirmedAction() {
    if (!confirm || !actorId) return;
    const kind = confirm.kind;
    const d = confirm.device;
    setConfirm(null);
    if (kind === "clearCaptures" && d) {
      setBusyId(d.id);
      try {
        const n = await clearNposDeviceCaptures(d.id, actorId);
        setCaptures((prev) => {
          const next = { ...prev };
          delete next[d.id];
          return next;
        });
        onError(null);
        window.alert(n > 0 ? `ลบแล้ว ${n} ชุด` : "ไม่มีภาพให้ลบ");
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
      return;
    }
    if (kind === "revoke" && d) {
      setBusyId(d.id);
      try {
        await setNposDeviceStoreClaimed(d.id, false, { isEmulator: d.isEmulator });
        const s = await getNposStoreClaimStatus();
        setActiveSeatId(s.activeSeatInstallId || "");
        onError(null);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
      return;
    }
    if (kind === "clearSeat") {
      setBusyId("__clear_seat__");
      try {
        await clearNposExclusiveSeat();
        setActiveSeatId("");
        onError(null);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
      return;
    }
    if (kind === "purgeDev") {
      setBusyId("__purge_dev__");
      try {
        const r = await purgeNposDevDevices({
          keepPairingCode: NPOS_SHOP_KEEP_PAIRING_CODE,
        });
        onError(null);
        window.alert(
          [
            `เก็บเฉพาะ ${r.keepPairingCode}`,
            `เครื่องเหลือ ${r.shopKept}`,
            `ลบเครื่อง ${r.deletedDevices}`,
            `รอบ ${r.deletedSessions}`,
            `บิล ${r.deletedSales}`,
            `ops ${r.deletedOps}`,
            `diagnose ${r.deletedDiagnose}`,
            `แคป ${r.deletedShots}`,
          ].join(" · "),
        );
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    }
  }

  async function grantClaim(d: Row) {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนให้ seat");
      return;
    }
    setBusyId(d.id);
    try {
      await setNposDeviceStoreClaimed(d.id, true, { isEmulator: d.isEmulator });
      setActiveSeatId(d.id);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const confirmTitle =
    confirm?.kind === "clearCaptures" && confirm.device
      ? `ล้างภาพแคป · ${posDeviceLabel(confirm.device)}?`
      : confirm?.kind === "revoke" && confirm.device
        ? `เตะเครื่อง ${posDeviceLabel(confirm.device)}?`
        : confirm?.kind === "clearSeat"
          ? "เคลียร์ seat + เตะทุกเครื่อง?"
          : confirm?.kind === "purgeDev"
            ? `เก็บเฉพาะเครื่อง ${NPOS_SHOP_KEEP_PAIRING_CODE}?`
            : "";
  const confirmMessage =
    confirm?.kind === "clearCaptures"
      ? "ลบจากที่เก็บและไทม์ไลน์ — กู้คืนไม่ได้"
      : confirm?.kind === "revoke"
        ? "เครื่องจะเด้งไปใส่รหัสใหม่ (กะไม่ปิดอัตโนมัติ)"
        : confirm?.kind === "clearSeat"
          ? "แท็บเล็ตจะเด้งใส่รหัสใหม่ (กะไม่ปิด)"
          : confirm?.kind === "purgeDev"
            ? `ลบทุกเครื่อง/รอบ/บิล/log ที่ไม่ใช่รหัส ${NPOS_SHOP_KEEP_PAIRING_CODE} — โฟกัส nPos emp หน้าร้าน`
            : undefined;

  return (
    <>
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
            ? `ออน ${onlineShop} · หน้าร้าน ${buckets.shop.length} · บล็อก ${buckets.blocked.length}${
                buckets.hiddenDevCount ? ` · ซ่อน dev ${buckets.hiddenDevCount}` : ""
              }${buckets.ghostCount ? ` · ซ่อนซ้ำ ${buckets.ghostCount}` : ""} · ระบบ ${systemRelease.label}`
            : "ยังไม่มีเครื่องหน้าร้าน — เปิดแอป nPos แล้วจะลงทะเบียนเอง"
      }
      defaultOpen={false}
      className="npos-devices-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : (
        <>
          <div className="npos-seat-slim">
            <div className="npos-slim-filters">
              <p className="muted npos-slim-empty" style={{ margin: 0 }}>
                ตารางเทคนิค · เทียบเวอร์ชันระบบ vs nPos · ยอดขายดูที่รอบการขาย nPos
                {activeSeatId ? ` · seat ${activeSeatId.slice(-6).toUpperCase()}` : " · seat ว่าง"}
                {buckets.hiddenDevCount
                  ? ` · มี emulator/dev ${buckets.hiddenDevCount} รายการซ่อนอยู่`
                  : ""}
              </p>
              <button
                type="button"
                className="npos-slim-text-btn"
                disabled={busyId === "__clear_seat__"}
                onClick={() => void clearAllSeats()}
              >
                เคลียร์ seat ทั้งหมด
              </button>
              <button
                type="button"
                className="npos-slim-text-btn npos-slim-text-btn--danger"
                disabled={busyId === "__purge_dev__"}
                onClick={() => void purgeDev()}
              >
                เก็บเฉพาะ {NPOS_SHOP_KEEP_PAIRING_CODE}
              </button>
            </div>
            {total === 0 ? (
              <p className="muted npos-slim-empty">ยังไม่มีเครื่องหน้าร้าน</p>
            ) : null}
            {total > 0 ? (
            <div className="npos-slim-scroll" role="table" aria-label="เครื่อง nPos">
              <div className="npos-slim-row npos-slim-row--head npos-slim-row--device" role="row">
                <span role="columnheader">เครื่อง</span>
                <span role="columnheader">สถานะ</span>
                <span role="columnheader" className="npos-slim-num">
                  ค้าง
                </span>
                <span role="columnheader">เชื่อม</span>
                <span role="columnheader" className="npos-slim-num">
                  เวอร์ชันระบบ
                </span>
                <span role="columnheader" className="npos-slim-num">
                  เวอร์ชัน nPos
                </span>
                <span role="columnheader">อุปกรณ์</span>
                <span role="columnheader">แอ็กชัน</span>
              </div>
              {tableRows.map((d) => {
                const online = isPosDeviceOnline(d.lastSeenAt, now);
                const isSeat = activeSeatId === d.id || (d.storeClaimed && !activeSeatId);
                let status = "ว่าง";
                if (d.deviceClass === "blocked") status = "บล็อก";
                else if (d.storeClaimMethod === "revoked" && !d.storeClaimed) status = "ถูกเตะ";
                else if (isSeat && online) status = "seat · ออน";
                else if (isSeat && !online) status = "seat · หลุด";
                else if (d.storeClaimed) status = "เคลม";
                const canKick = d.storeClaimed || activeSeatId === d.id;
                const pending = d.syncPendingCount || 0;
                const failed = d.syncFailedCount || 0;
                let pendingCell = "—";
                if (failed > 0) pendingCell = `⚠${pending}+${failed}`;
                else if (pending > 0) pendingCell = String(pending);
                const versionLabel = posClientVersionLabel(d);
                const clientCode = d.nativeShellBuild || d.appBuild || 0;
                const match = nposVersionMatch(clientCode, systemRelease.versionCode);
                const matchClass =
                  match === "behind"
                    ? "npos-slim-warn"
                    : match === "ok"
                      ? "npos-slim-ver-ok"
                      : "";
                const equip = posDeviceEquipment(d);
                return (
                  <div
                    key={`slim-${d.id}`}
                    className={`npos-slim-row npos-slim-row--device ${isSeat ? "is-selected" : ""}`}
                    role="row"
                  >
                    <span role="cell" className="npos-slim-ellipsis" title={posDeviceLabel(d)}>
                      {posDeviceLabel(d)}
                      <span className="muted"> · {d.pairingCode}</span>
                    </span>
                    <span role="cell">{status}</span>
                    <span
                      role="cell"
                      className={`npos-slim-num ${failed > 0 ? "npos-slim-warn" : ""}`}
                    >
                      {pendingCell}
                    </span>
                    <span role="cell" className="npos-slim-status">
                      <i aria-hidden className={online ? "is-live" : ""} />
                      {online ? "ออน" : "หลุด"}
                    </span>
                    <span
                      role="cell"
                      className="npos-slim-num npos-slim-ellipsis"
                      title={`เวอร์ชันระบบ ${systemRelease.label}`}
                    >
                      {systemRelease.label}
                    </span>
                    <span
                      role="cell"
                      className={`npos-slim-num npos-slim-ellipsis ${matchClass}`}
                      title={`${versionLabel}${
                        match === "behind"
                          ? " · เก่ากว่าระบบ"
                          : match === "ahead"
                            ? " · ใหม่กว่าระบบ"
                            : match === "ok"
                              ? " · ตรงระบบ"
                              : ""
                      }`}
                    >
                      {match === "ok" ? (
                        <span className="npos-slim-ver-check" aria-label="เวอร์ชันตรง">
                          ✓
                        </span>
                      ) : null}
                      {versionLabel}
                    </span>
                    <span
                      role="cell"
                      className="npos-slim-equip npos-slim-ellipsis"
                      title={equip.title}
                    >
                      {equip.short}
                    </span>
                    <span role="cell">
                      {canKick ? (
                        <button
                          type="button"
                          className="npos-slim-text-btn npos-slim-text-btn--danger"
                          disabled={busyId === d.id}
                          onClick={() => void revokeClaim(d)}
                        >
                          เตะ
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="npos-slim-text-btn"
                          disabled={busyId === d.id || d.deviceClass === "blocked"}
                          onClick={() => void grantClaim(d)}
                        >
                          ให้ seat
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
              {tableRows.length === 0 ? (
                <p className="muted npos-slim-empty">ยังไม่มีเครื่องหน้าร้าน</p>
              ) : null}
            </div>
            ) : null}
          </div>
          <ClassSection
            cls="shop"
            rows={buckets.shop}
            now={now}
            busyId={busyId}
            captures={capturesForUi}
            systemRelease={systemRelease}
            onBlock={block}
            onUnblock={unblock}
            onCapture={capture}
            onClearCaptures={clearCaptures}
            onInterval={setIntervalMins}
            onGrantClaim={grantClaim}
            onRevokeClaim={revokeClaim}
          />
          <ClassSection
            cls="blocked"
            rows={buckets.blocked}
            now={now}
            busyId={busyId}
            captures={capturesForUi}
            systemRelease={systemRelease}
            onBlock={block}
            onUnblock={unblock}
            onCapture={capture}
            onClearCaptures={clearCaptures}
            onInterval={setIntervalMins}
            onGrantClaim={grantClaim}
            onRevokeClaim={revokeClaim}
          />
        </>
      )}
    </SettingsFold>
    <PosConfirmDialog
      open={confirm !== null}
      title={confirmTitle}
      message={confirmMessage}
      confirmLabel={
        confirm?.kind === "clearCaptures"
          ? "ล้างภาพ"
          : confirm?.kind === "revoke"
            ? "เตะเครื่อง"
            : confirm?.kind === "purgeDev"
              ? `เก็บ ${NPOS_SHOP_KEEP_PAIRING_CODE}`
              : "เคลียร์ seat"
      }
      destructive
      onCancel={() => setConfirm(null)}
      onConfirm={() => void runConfirmedAction()}
    />
    </>
  );
}
