"use client";

import { useEffect, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  formatOpsAt,
  subscribeNposOpsLogs,
  type NposOpsEvent,
  type NposOpsLogDoc,
} from "@/lib/npos-ops-log";

function levelClass(level: string): string {
  if (level === "error") return "npos-pill npos-pill--off";
  if (level === "warn") return "npos-pill";
  return "npos-pill npos-pill--on";
}

function EventRow({ ev }: { ev: NposOpsEvent }) {
  return (
    <li className="npos-ops-event">
      <div className="npos-device-row">
        <span className={levelClass(ev.level)}>{ev.level}</span>
        <strong>
          [{ev.cat}] {ev.msg}
        </strong>
      </div>
      <p className="muted npos-diagnose-id">
        {formatOpsAt(ev.at)}
        {ev.vn ? ` · v${ev.vn}` : ""}
        {ev.vc ? ` (${ev.vc})` : ""}
      </p>
      {ev.detail ? <p className="muted npos-diagnose-id">{ev.detail}</p> : null}
    </li>
  );
}

export function NposOpsLogPanel({ onError }: { onError: (msg: string | null) => void }) {
  const [docs, setDocs] = useState<NposOpsLogDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    return subscribeNposOpsLogs(
      (next) => {
        setDocs(next);
        setLoading(false);
        onError(null);
      },
      (err) => {
        setLoading(false);
        onError(err.message);
      },
    );
  }, [onError]);

  const flat = useMemo(() => {
    const rows: { key: string; installId: string; ev: NposOpsEvent }[] = [];
    for (const d of docs) {
      for (const ev of d.events.slice(0, 30)) {
        rows.push({ key: `${d.id}-${ev.at}-${ev.msg}`, installId: d.installId, ev });
      }
    }
    rows.sort((a, b) => b.ev.at - a.ev.at);
    return rows.slice(0, 80);
  }, [docs]);

  const errorCount = flat.filter((r) => r.ev.level === "error").length;

  return (
    <SettingsFold
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <ScrollText size={16} aria-hidden />
          ไทม์ไลน์ nPos (ops log)
        </span>
      }
      hint={
        loading
          ? "กำลังโหลดไทม์ไลน์…"
          : flat.length
            ? `${flat.length} รายการล่าสุด${errorCount ? ` · error ${errorCount}` : ""} · สำหรับแก้เวอร์ชันถัดไป`
            : "ยังไม่มี log — เปิดแอปแล้วใช้งาน/เทส จะส่งมาเอง"
      }
      defaultOpen={false}
      className="npos-ops-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : flat.length === 0 ? (
        <p className="muted">ยังไม่มีเหตุการณ์จากเครื่อง native</p>
      ) : (
        <ul className="npos-diagnose-list">
          {flat.map((row) => (
            <li key={row.key} className="npos-diagnose-card">
              <p className="muted npos-diagnose-id">เครื่อง {row.installId.slice(-8)}</p>
              <EventRow ev={row.ev} />
            </li>
          ))}
        </ul>
      )}
    </SettingsFold>
  );
}
