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
  clearNposDeviceCaptures,
  getNposStoreClaimStatus,
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
  onClearCaptures,
  onInterval,
  onGrantClaim,
  onRevokeClaim,
}: {
  d: Row;
  now: number;
  busy: boolean;
  capture?: CaptureUrls;
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
  const capturePending =
    d.captureRequestAt > 0 && d.captureRequestAt > (d.lastCaptureAckAt || 0);
  const hasCapture = !!(capture?.primaryUrl || capture?.secondaryUrl);
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
        เคลม/seat{" "}
        {d.storeClaimed
          ? `ถือสิทธิ์${d.storeClaimMethod ? ` (${d.storeClaimMethod})` : ""}`
          : d.storeClaimMethod === "revoked"
            ? `ถูกเตะ${d.storeClaimRevokeReason ? ` · ${d.storeClaimRevokeReason}` : ""}`
            : "ยังไม่เคลม"}
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
            ? `แตะรูปเพื่อดูเต็มความละเอียด · ${formatSeen(capture.at)}`
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
        <button
          type="button"
          className="npos-device-btn npos-device-btn--danger"
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
          <button type="button" className="npos-device-btn" disabled={busy} onClick={onRevokeClaim}>
            เตะเครื่อง
          </button>
        ) : (
          <button type="button" className="npos-device-btn" disabled={busy} onClick={onGrantClaim}>
            ให้ seat
          </button>
        )}
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

export function NposDevicesPanel({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [captures, setCaptures] = useState<Record<string, CaptureUrls>>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeSeatId, setActiveSeatId] = useState("");

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
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

  async function clearCaptures(d: Row) {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนล้างภาพแคป");
      return;
    }
    if (
      !window.confirm(
        `ล้างภาพแคปทั้งหมดของเครื่อง ${posDeviceLabel(d)}?\nลบจากที่เก็บและไทม์ไลน์ — กู้คืนไม่ได้`,
      )
    ) {
      return;
    }
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
  }

  async function revokeClaim(d: Row) {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนเตะเครื่อง");
      return;
    }
    if (!window.confirm(`เตะเครื่อง ${posDeviceLabel(d)}? เครื่องจะเด้งไปใส่รหัสใหม่ (กะไม่ปิดอัตโนมัติ)`)) {
      return;
    }
    setBusyId(d.id);
    try {
      await setNposDeviceStoreClaimed(d.id, false, { isEmulator: d.isEmulator });
      setActiveSeatId("");
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
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
      defaultOpen
      className="npos-devices-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : total === 0 ? (
        <p className="muted">ยังไม่มีเครื่อง native</p>
      ) : (
        <>
          <div className="npos-seat-slim" style={{ marginBottom: "0.75rem", overflowX: "auto" }}>
            <p className="muted" style={{ marginBottom: "0.5rem" }}>
              เตะเครื่อง ≠ บังคับปิดกะ · กะบนเซิร์ฟเวอร์อยู่ต่อให้เครื่องใหม่ resume ·
              ถ้าเข้าไม่ได้เพราะ seat ถูกจอง — กด <strong>เตะ</strong> หรือ «เคลียร์ seat» ที่แผงรหัสร้าน
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th style={{ padding: "0.35rem" }}>เครื่อง</th>
                  <th style={{ padding: "0.35rem" }}>สถานะ</th>
                  <th style={{ padding: "0.35rem" }}>เชื่อม</th>
                  <th style={{ padding: "0.35rem" }}>เวอร์ชัน</th>
                  <th style={{ padding: "0.35rem" }}>แอ็กชัน</th>
                </tr>
              </thead>
              <tbody>
                {[...buckets.shop, ...buckets.dev].map((d) => {
                  const online = isPosDeviceOnline(d.lastSeenAt, now);
                  const isSeat = activeSeatId === d.id || (d.storeClaimed && !activeSeatId);
                  let status = "ว่าง";
                  if (d.deviceClass === "blocked") status = "บล็อก";
                  else if (d.storeClaimMethod === "revoked" && !d.storeClaimed) status = "ถูกเตะ";
                  else if (isSeat && online) status = "ออนไลน์ · seat";
                  else if (isSeat && !online) status = "หลุดเน็ต · seat";
                  else if (d.storeClaimed) status = "เคลม";
                  const canKick = d.storeClaimed || activeSeatId === d.id;
                  return (
                    <tr key={`slim-${d.id}`} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "0.35rem" }}>
                        {posDeviceLabel(d)}
                        <span className="muted"> · {d.pairingCode}</span>
                      </td>
                      <td style={{ padding: "0.35rem" }}>{status}</td>
                      <td style={{ padding: "0.35rem" }}>{online ? "ออน" : "หลุด"}</td>
                      <td style={{ padding: "0.35rem" }}>
                        {d.nativeShellBuild || d.appBuild || "—"}
                      </td>
                      <td style={{ padding: "0.35rem" }}>
                        {canKick ? (
                          <button
                            type="button"
                            className="npos-device-btn"
                            disabled={busyId === d.id}
                            onClick={() => void revokeClaim(d)}
                          >
                            เตะ
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="npos-device-btn"
                            disabled={busyId === d.id || d.deviceClass === "blocked"}
                            onClick={() => void grantClaim(d)}
                          >
                            ให้ seat
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {[...buckets.shop, ...buckets.dev].length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted" style={{ padding: "0.5rem" }}>
                      ยังไม่มีเครื่อง
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <ClassSection
            cls="shop"
            rows={buckets.shop}
            now={now}
            busyId={busyId}
            captures={capturesForUi}
            onBlock={block}
            onUnblock={unblock}
            onCapture={capture}
            onClearCaptures={clearCaptures}
            onInterval={setIntervalMins}
            onGrantClaim={grantClaim}
            onRevokeClaim={revokeClaim}
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
  );
}
