"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor, RefreshCw, ExternalLink, Copy, Check } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { POS_BUILD, posVersionLabel } from "@/lib/pos-version";
import { POS_APK_DOWNLOAD_URL, POS_APK_INSTALL_PAGE_URL, POS_ENTRY_URL } from "@/lib/pos-url";
import {
  savePosNativeRelease,
  subscribePosNativeReleaseAdmin,
  type PosNativeRelease,
} from "@/lib/pos-native-release";
import { POS_NATIVE_UPDATE_STATUS_LABEL } from "@/lib/pos-native-version";
import {
  isPosDeviceOnline,
  posDeviceLabel,
  requestPosDeviceReload,
  requestPosDevicesReload,
  savePosDeviceLabel,
  subscribePosDevices,
  type PosDevice,
} from "@/lib/pos-devices";

function formatLastSeen(ts: number): string {
  if (!ts) return "ยังไม่เคยออนไลน์";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "เมื่อสักครู่";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาทีที่แล้ว`;
  return new Date(ts).toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shellKindLabel(kind: PosDevice["shellKind"]): string {
  if (kind === "native") return "APK";
  if (kind === "pwa") return "PWA";
  if (kind === "browser") return "เบราว์เซอร์";
  return "";
}

export function PosDeviceSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftLabels, setDraftLabels] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [copiedApk, setCopiedApk] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [nativeRelease, setNativeRelease] = useState<PosNativeRelease | null>(null);
  const [nativeReleaseLoading, setNativeReleaseLoading] = useState(true);
  const [nativeReleaseBusy, setNativeReleaseBusy] = useState(false);
  const [draftShellBuild, setDraftShellBuild] = useState("");
  const [draftApkUrl, setDraftApkUrl] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const nativeReleaseHydrated = useRef(false);

  useEffect(() => {
    const unsub = subscribePosNativeReleaseAdmin(
      (release) => {
        setNativeRelease(release);
        if (!nativeReleaseHydrated.current) {
          setDraftShellBuild(release.latestShellBuild ? String(release.latestShellBuild) : "");
          setDraftApkUrl(release.apkUrl || POS_APK_DOWNLOAD_URL);
          setDraftNotes(release.notes || "");
          nativeReleaseHydrated.current = true;
        }
        setNativeReleaseLoading(false);
      },
      (err) => {
        onError(err.message || "โหลดตั้งค่าปล่อย APK ไม่สำเร็จ");
        setNativeReleaseLoading(false);
      },
    );
    return unsub;
  }, [onError]);

  useEffect(() => {
    const unsub = subscribePosDevices(
      (list) => {
        setDevices(list);
        setLoading(false);
      },
      (err) => {
        onError(err.message || "โหลดเครื่อง POS ไม่สำเร็จ");
        setLoading(false);
      },
    );
    return unsub;
  }, [onError]);

  useEffect(() => {
    setDraftLabels((prev) => {
      const next = { ...prev };
      for (const d of devices) {
        if (!(d.id in next)) next[d.id] = d.label;
      }
      return next;
    });
  }, [devices]);

  async function saveLabel(deviceId: string) {
    if (!actorId) return;
    setBusyId(deviceId);
    onError(null);
    try {
      await savePosDeviceLabel(deviceId, draftLabels[deviceId] ?? "", actorId);
    } catch (err) {
      onError((err as Error).message || "บันทึกชื่อเครื่องไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function copyPosUrl() {
    onError(null);
    try {
      await navigator.clipboard.writeText(POS_ENTRY_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onError("คัดลอกลิงก์ไม่ได้ — คัดลอกด้วยมือจากกล่องด้านล่าง");
    }
  }

  async function copyApkInstallUrl() {
    onError(null);
    try {
      await navigator.clipboard.writeText(POS_APK_INSTALL_PAGE_URL);
      setCopiedApk(true);
      window.setTimeout(() => setCopiedApk(false), 2000);
    } catch {
      onError("คัดลอกลิงก์ไม่ได้ — คัดลอกด้วยมือจากกล่องด้านล่าง");
    }
  }

  async function forceReload(deviceId: string) {
    if (!actorId) return;
    setBusyId(deviceId);
    onError(null);
    try {
      await requestPosDeviceReload(deviceId, actorId);
    } catch (err) {
      onError((err as Error).message || "สั่งรีเฟรชไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function forceReloadStale() {
    if (!actorId) return;
    const staleOnline = devices.filter(
      (d) => isPosDeviceOnline(d.lastSeenAt) && d.appBuild > 0 && d.appBuild < POS_BUILD,
    );
    if (!staleOnline.length) {
      onError("ไม่มีเครื่องออนไลน์ที่ค้างเวอร์ชัน");
      return;
    }
    setBusyId("__all__");
    onError(null);
    try {
      const n = await requestPosDevicesReload(
        staleOnline.map((d) => d.id),
        actorId,
      );
      onError(null);
      setUpdateMsg(`สั่งอัปเดต ${n} เครื่อง — รีเฟรชอัตโนมัติเมื่อตะกร้าว่าง (พนักงานไม่ต้องกด)`);
      window.setTimeout(() => setUpdateMsg(null), 6000);
    } catch (err) {
      onError((err as Error).message || "สั่งอัปเดตทุกเครื่องไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function saveNativeRelease() {
    if (!actorId) return;
    const build = Math.floor(Number(draftShellBuild));
    if (!Number.isFinite(build) || build < 0) {
      onError("เลข APK ต้องเป็นจำนวนเต็ม ≥ 0");
      return;
    }
    const apkUrl = draftApkUrl.trim();
    if (build > 0 && !apkUrl) {
      onError("ใส่ลิงก์ไฟล์ .apk ด้วยเมื่อปล่อยเวอร์ชันใหม่");
      return;
    }
    setNativeReleaseBusy(true);
    onError(null);
    try {
      await savePosNativeRelease(
        { latestShellBuild: build, apkUrl, notes: draftNotes },
        actorId,
      );
      setUpdateMsg(
        build > 0
          ? `ปล่อย APK ${build} แล้ว — เครื่อง native จะรายงานสถานะอัปเดตที่รายการด้านล่าง`
          : "ล้างปล่อย APK แล้ว",
      );
      window.setTimeout(() => setUpdateMsg(null), 6000);
    } catch (err) {
      onError((err as Error).message || "บันทึกปล่อย APK ไม่สำเร็จ");
    } finally {
      setNativeReleaseBusy(false);
    }
  }

  const onlineCount = devices.filter((d) => isPosDeviceOnline(d.lastSeenAt)).length;
  const staleCount = devices.filter(
    (d) => isPosDeviceOnline(d.lastSeenAt) && d.appBuild > 0 && d.appBuild < POS_BUILD,
  ).length;
  const nativeUpdateCount = devices.filter(
    (d) =>
      isPosDeviceOnline(d.lastSeenAt) &&
      d.shellKind === "native" &&
      (d.updateStatus === "available" ||
        d.updateStatus === "downloading" ||
        d.updateStatus === "installing" ||
        d.updateStatus === "failed"),
  ).length;

  return (
    <section className="settings-card">
      <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <Monitor size={18} aria-hidden />
        เครื่อง POS
      </h2>
      <p className="muted settings-card-lead">
        ตัวตนเครื่อง POS (ไม่ใช่บัญชี Google) · {posVersionLabel()} · รายงานทุก 60 วินาที
        — โหมดอัปเดตอยู่กลุ่ม «อัปเดต» · ส่งลิงก์ให้หน้าร้านได้ที่การ์ด «ลิงก์ / โน้ตหน้าร้าน»
      </p>

      {!nativeReleaseLoading ? (
        <div className="pos-native-release-box">
          <p className="pos-install-label">ปล่อยอัปเดต APK (เครื่อง native)</p>
          <p className="muted settings-card-lead" style={{ marginTop: 0 }}>
            ตั้งเลขเปลือก + ลิงก์ไฟล์ .apk — แท็บเล็ตที่เปิดจาก APK จะรายงานสถานะที่รายการเครื่อง
            (ติดตั้งอัตโนมัติในแอปยังเป็นเฟสถัดไป · ตอนนี้เห็นว่าเครื่องไหนค้างเวอร์ชัน)
            {nativeRelease?.updatedAt
              ? ` · ปล่อยล่าสุด ${formatLastSeen(nativeRelease.updatedAt)}`
              : ""}
          </p>
          <div className="pos-native-release-fields">
            <label className="pos-device-label-field">
              <span>เลข APK ล่าสุด</span>
              <input
                type="number"
                min={0}
                step={1}
                value={draftShellBuild}
                disabled={nativeReleaseBusy}
                placeholder="เช่น 1"
                onChange={(e) => setDraftShellBuild(e.target.value)}
              />
            </label>
            <label className="pos-device-label-field">
              <span>ลิงก์ไฟล์ .apk</span>
              <input
                type="url"
                value={draftApkUrl}
                disabled={nativeReleaseBusy}
                placeholder="https://…/app-release.apk"
                onChange={(e) => setDraftApkUrl(e.target.value)}
              />
            </label>
            <label className="pos-device-label-field">
              <span>หมายเหตุ (ไม่บังคับ)</span>
              <input
                type="text"
                value={draftNotes}
                disabled={nativeReleaseBusy}
                placeholder="เช่น แก้พิมพ์เงียบ"
                onChange={(e) => setDraftNotes(e.target.value)}
              />
            </label>
          </div>
          <div className="pos-device-actions">
            <button
              type="button"
              className="primary-btn"
              disabled={nativeReleaseBusy}
              onClick={() => void saveNativeRelease()}
            >
              บันทึกปล่อย APK
            </button>
          </div>
        </div>
      ) : null}

      <div className="pos-install-box">
        <p className="pos-install-label">ลิงก์ดาวน์โหลดแอป (APK) — เปิดบน Chrome แท็บเล็ต</p>
        <code className="pos-install-url">{POS_APK_INSTALL_PAGE_URL}</code>
        <div className="pos-device-actions">
          <a
            href={POS_APK_INSTALL_PAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="primary-btn pos-install-btn"
          >
            <ExternalLink size={15} aria-hidden />
            เปิดหน้าดาวน์โหลด
          </a>
          <button type="button" className="ghost-btn" onClick={() => void copyApkInstallUrl()}>
            {copiedApk ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            {copiedApk ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
          </button>
        </div>
        <ol className="pos-install-steps">
          <li>บนแท็บเล็ตเปิด Chrome → ใส่ลิงก์ด้านบน (หรือสแกน QR ที่คุณสร้างเอง)</li>
          <li>กด <strong>ดาวน์โหลดไฟล์ติดตั้ง</strong> → อนุญาตติดตั้ง → เปิดไอคอน TellTea POS</li>
          <li>ไฟล์ตรง: <code>{POS_APK_DOWNLOAD_URL}</code></li>
        </ol>
      </div>

      <div className="pos-install-box">
        <p className="pos-install-label">ลิงก์เว็บ POS (สำรอง / ยังไม่ลง APK)</p>
        <code className="pos-install-url">{POS_ENTRY_URL}</code>
        <div className="pos-device-actions">
          <a href={POS_ENTRY_URL} target="_blank" rel="noopener noreferrer" className="ghost-btn pos-install-btn">
            <ExternalLink size={15} aria-hidden />
            ทดสอบเปิดหน้า POS
          </a>
          <button type="button" className="ghost-btn" onClick={() => void copyPosUrl()}>
            {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์เว็บ"}
          </button>
        </div>
      </div>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && devices.length === 0 ? (
        <p className="muted settings-card-lead">
          ยังไม่มีเครื่องลงทะเบียน — กด <strong>ทดสอบเปิดหน้า POS</strong> ด้านบนก่อน
          แล้วกลับมาดูรายการเครื่องที่นี่
        </p>
      ) : null}

      {!loading && devices.length > 0 ? (
        <p className="muted settings-card-lead">
          ออนไลน์ {onlineCount}/{devices.length} เครื่อง · ออนไลน์ = เห็นสัญญาณภายใน 3 นาที
          {staleCount > 0 ? ` · ค้างเว็บ ${staleCount} เครื่อง` : ""}
          {nativeUpdateCount > 0 ? ` · รอ/ติดอัปเดต APK ${nativeUpdateCount} เครื่อง` : ""}
        </p>
      ) : null}

      {!loading && staleCount > 0 ? (
        <button
          type="button"
          className="ghost-btn pos-device-reload-all"
          disabled={busyId === "__all__"}
          onClick={() => void forceReloadStale()}
        >
          <RefreshCw size={14} aria-hidden />
          อัปเดตเครื่องที่ค้าง ({staleCount})
        </button>
      ) : null}

      {updateMsg ? <p className="ok-text settings-card-lead">{updateMsg}</p> : null}

      {!loading && devices.length > 0 ? (
        <ul className="pos-device-list">
          {devices.map((device) => {
            const online = isPosDeviceOnline(device.lastSeenAt);
            const busy = busyId === device.id;
            const buildBehind = device.appBuild > 0 && device.appBuild < POS_BUILD;

            return (
              <li key={device.id} className="pos-device-card">
                <div className="pos-device-card-head">
                  <div>
                    <strong>{posDeviceLabel(device)}</strong>
                    <span className="pos-device-code">รหัส {device.pairingCode}</span>
                  </div>
                  <span className={`pos-lite-pill ${online ? "pos-lite-pill--ok" : "pos-lite-pill--warn"}`}>
                    {online ? "ออนไลน์" : "ออฟไลน์"}
                  </span>
                </div>

                <p className="muted pos-device-meta">
                  เห็นล่าสุด {formatLastSeen(device.lastSeenAt)}
                  {device.appBuild ? ` · POS ${device.appBuild}` : ""}
                  {buildBehind ? " · รออัปเดตเว็บ" : ""}
                </p>

                {device.shellKind || device.nativeShellBuild > 0 || device.updateStatus ? (
                  <p
                    className={`muted pos-device-meta ${
                      device.updateStatus === "failed" || device.updateStatus === "available"
                        ? "pos-device-sync-alert"
                        : ""
                    }`}
                  >
                    {shellKindLabel(device.shellKind)
                      ? `โหมด ${shellKindLabel(device.shellKind)}`
                      : "โหมด —"}
                    {device.nativeShellBuild > 0 ? ` · APK ${device.nativeShellBuild}` : ""}
                    {device.updateStatus
                      ? ` · ${POS_NATIVE_UPDATE_STATUS_LABEL[device.updateStatus] || device.updateStatus}`
                      : ""}
                    {device.updateStatus === "available" && device.updateTargetBuild > 0
                      ? ` → ${device.updateTargetBuild}`
                      : ""}
                    {device.updateError ? ` — ${device.updateError}` : ""}
                  </p>
                ) : null}

                {device.deviceHint ? (
                  <p className="muted pos-device-meta">
                    รุ่น {device.deviceHint}
                    {device.screenSize ? ` · จอ ${device.screenSize}` : ""}
                    {device.shellKind === "native"
                      ? " · APK"
                      : device.standalone
                        ? " · เต็มจอ"
                        : " · ในเบราว์เซอร์"}
                  </p>
                ) : null}

                {device.printerLabel ? (
                  <p className={`muted pos-device-meta ${device.printerReady ? "" : "pos-device-sync-alert"}`}>
                    พิมพ์: {device.printerLabel}
                  </p>
                ) : null}

                {device.syncStuckAt > 0 || device.syncFailedCount > 0 ? (
                  <p className="pos-device-sync-alert">
                    {device.syncStuckAt > 0
                      ? `บิลค้างส่ง ${device.syncPendingCount} · ค้างนานตั้งแต่ ${formatLastSeen(device.syncStuckAt)}`
                      : null}
                    {device.syncFailedCount > 0
                      ? ` · ส่งไม่สำเร็จ ${device.syncFailedCount} บิล`
                      : null}
                    {device.syncLastError ? ` — ${device.syncLastError}` : ""}
                  </p>
                ) : device.syncPendingCount > 0 ? (
                  <p className="muted pos-device-meta">รอส่ง {device.syncPendingCount} บิล</p>
                ) : null}

                <label className="pos-device-label-field">
                  <span>ชื่อเครื่อง</span>
                  <input
                    type="text"
                    value={draftLabels[device.id] ?? ""}
                    placeholder="เช่น แท็บเล็ตหน้าร้าน"
                    disabled={busy}
                    onChange={(e) =>
                      setDraftLabels((prev) => ({ ...prev, [device.id]: e.target.value }))
                    }
                  />
                </label>

                <div className="pos-device-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => void saveLabel(device.id)}
                  >
                    บันทึกชื่อ
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy || !online}
                    onClick={() => void forceReload(device.id)}
                    title={online ? "รีเฟรชหน้า POS บนแท็บเล็ต" : "เครื่องออฟไลน์ — รีเฟรชไม่ได้"}
                  >
                    <RefreshCw size={14} aria-hidden />
                    รีเฟรชเครื่อง
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
