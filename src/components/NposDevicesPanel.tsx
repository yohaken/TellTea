"use client";

import { useEffect, useMemo, useState } from "react";
import { Radio } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  isPosDeviceOnline,
  posDeviceLabel,
  subscribePosDevicesAdmin,
  type PosDevice,
} from "@/lib/pos-devices";

function isNposDevice(d: PosDevice): boolean {
  if (d.shellKind === "native") return true;
  return (d.userAgent || "").startsWith("nPos-telltea/");
}

/**
 * One physical tablet can leave ghost docs after wipe/reinstall (new installId).
 * Keep the newest per stableKey; drop disabled + offline ghosts when an online twin exists.
 */
function dedupeNposDevices(devices: PosDevice[], now: number): PosDevice[] {
  const active = devices.filter((d) => !d.disabled);
  const byKey = new Map<string, PosDevice>();

  for (const d of active) {
    const key = d.stableKey ? `sk:${d.stableKey}` : `id:${d.id}`;
    const prev = byKey.get(key);
    if (!prev || d.lastSeenAt > prev.lastSeenAt) {
      byKey.set(key, d);
    }
  }

  const unique = [...byKey.values()];
  const hasOnline = unique.some((d) => isPosDeviceOnline(d.lastSeenAt, now));
  if (!hasOnline) return unique.sort((a, b) => b.lastSeenAt - a.lastSeenAt);

  // Fold title is "ออนไลน์" — prefer live rows; hide stale offline leftovers from older installs.
  return unique
    .filter((d) => isPosDeviceOnline(d.lastSeenAt, now))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function formatSeen(ts: number): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("th-TH");
  } catch {
    return String(ts);
  }
}

export function NposDevicesPanel({ onError }: { onError: (msg: string | null) => void }) {
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

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

  const visible = useMemo(() => dedupeNposDevices(devices, now), [devices, now]);
  const onlineCount = visible.length;
  const hiddenGhosts = Math.max(0, devices.filter((d) => !d.disabled).length - visible.length);

  return (
    <SettingsFold
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <Radio size={16} aria-hidden />
          เครื่อง nPos (ออนไลน์)
        </span>
      }
      hint={
        loading
          ? "กำลังโหลดรายการเครื่อง…"
          : visible.length
            ? `${onlineCount} ออนไลน์ · จากแอป native${
                hiddenGhosts ? ` · ซ่อนซ้ำ/ออฟ ${hiddenGhosts}` : ""
              }`
            : "ยังไม่มีเครื่อง — เปิดแอป nPos แล้วจะลงทะเบียนเอง"
      }
      defaultOpen={false}
      className="npos-devices-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : visible.length === 0 ? (
        <p className="muted">ยังไม่มีเครื่อง native ออนไลน์</p>
      ) : (
        <ul className="npos-diagnose-list">
          {visible.map((d) => {
            const online = isPosDeviceOnline(d.lastSeenAt, now);
            return (
              <li key={d.id} className="npos-diagnose-card">
                <div className="npos-device-row">
                  <strong>{posDeviceLabel(d)}</strong>
                  <span className={online ? "npos-pill npos-pill--on" : "npos-pill npos-pill--off"}>
                    {online ? "ออน" : "ออฟ"}
                  </span>
                </div>
                <p className="muted npos-diagnose-id">
                  รหัส {d.pairingCode} · APK {d.nativeShellBuild || d.appBuild || "—"} ·{" "}
                  {d.deviceHint || "android"}
                </p>
                <p className="muted npos-diagnose-id">เห็นล่าสุด {formatSeen(d.lastSeenAt)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsFold>
  );
}
