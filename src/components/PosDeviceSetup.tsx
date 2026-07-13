"use client";

import { useEffect, useState } from "react";
import { Monitor, RefreshCw, ExternalLink, Copy, Check } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { CLIENT_BUILD } from "@/lib/app-update";
import { POS_ENTRY_URL } from "@/lib/pos-url";
import { appVersionLabel } from "@/lib/version";
import {
  isPosDeviceOnline,
  posDeviceLabel,
  requestPosDeviceReload,
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

export function PosDeviceSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftLabels, setDraftLabels] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

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

  const onlineCount = devices.filter((d) => isPosDeviceOnline(d.lastSeenAt)).length;

  return (
    <section className="settings-card">
      <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <Monitor size={18} aria-hidden />
        เครื่อง POS
      </h2>
      <p className="muted settings-card-lead">
        Phase 0.5 — ติดตั้งแอปบนหน้าจอหลัก (เต็มจอ) · เวอร์ชันแอปหลัก {appVersionLabel()}
      </p>

      <div className="pos-install-box">
        <p className="pos-install-label">ลิงก์ติดตั้งแท็บเล็ต (ใช้ URL นี้เท่านั้น)</p>
        <code className="pos-install-url">{POS_ENTRY_URL}</code>
        <div className="pos-device-actions">
          <a href={POS_ENTRY_URL} target="_blank" rel="noopener noreferrer" className="primary-btn pos-install-btn">
            <ExternalLink size={15} aria-hidden />
            ทดสอบเปิดหน้า POS
          </a>
          <button type="button" className="ghost-btn" onClick={() => void copyPosUrl()}>
            {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
          </button>
        </div>
        <ol className="pos-install-steps">
          <li>เปิดลิงก์บนแท็บเล็ต Android (Chrome)</li>
          <li>กด <strong>ติดตั้งแอปบนหน้าจอหลัก</strong> บนหน้า POS หรือเมนู ⋮ → ติดตั้งแอป</li>
          <li>เปิดจากไอคอน <strong>TellTea POS</strong> — ควรเห็นป้าย &quot;เต็มจอ&quot;</li>
          <li>ทิ้งเปิดไว้ตลอด — เจ้าของดูสถานะออนไลน์ที่นี่</li>
        </ol>
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
        </p>
      ) : null}

      {!loading && devices.length > 0 ? (
        <ul className="pos-device-list">
          {devices.map((device) => {
            const online = isPosDeviceOnline(device.lastSeenAt);
            const busy = busyId === device.id;
            const buildBehind = device.appBuild > 0 && device.appBuild < CLIENT_BUILD;

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
                  {device.appBuild ? ` · v${device.appBuild}` : ""}
                  {buildBehind ? " · รออัปเดต" : ""}
                </p>

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
