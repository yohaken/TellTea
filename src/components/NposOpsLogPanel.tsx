"use client";

import { useEffect, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  subscribeNposOpsLogs,
  type NposOpsEvent,
  type NposOpsLogDoc,
} from "@/lib/npos-ops-log";

function shortTime(ts: number): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm} ${hh}:${mi}`;
  } catch {
    return "—";
  }
}

function levelMark(level: string): string {
  if (level === "error") return "E";
  if (level === "warn") return "W";
  return "I";
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
      for (const ev of d.events.slice(0, 40)) {
        rows.push({ key: `${d.id}-${ev.at}-${ev.msg}`, installId: d.installId, ev });
      }
    }
    rows.sort((a, b) => b.ev.at - a.ev.at);
    return rows.slice(0, 100);
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
          ? "กำลังโหลด…"
          : flat.length
            ? `${flat.length} แถว${errorCount ? ` · E${errorCount}` : ""}`
            : "ยังไม่มี log"
      }
      defaultOpen={false}
      className="npos-ops-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : flat.length === 0 ? (
        <p className="muted">ยังไม่มีเหตุการณ์</p>
      ) : (
        <div className="npos-ops-table-wrap">
          <table className="npos-ops-table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>L</th>
                <th>cat</th>
                <th>ข้อความ</th>
                <th>เครื่อง</th>
              </tr>
            </thead>
            <tbody>
              {flat.map((row) => {
                const ev = row.ev;
                const tip = [ev.detail, ev.vn ? `v${ev.vn}` : "", ev.vc ? `(${ev.vc})` : ""]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <tr
                    key={row.key}
                    className={
                      ev.level === "error"
                        ? "npos-ops-row npos-ops-row--error"
                        : ev.level === "warn"
                          ? "npos-ops-row npos-ops-row--warn"
                          : "npos-ops-row"
                    }
                    title={tip || undefined}
                  >
                    <td className="npos-ops-time">{shortTime(ev.at)}</td>
                    <td className="npos-ops-lvl">{levelMark(ev.level)}</td>
                    <td className="npos-ops-cat">{ev.cat}</td>
                    <td className="npos-ops-msg">{ev.msg}</td>
                    <td className="npos-ops-dev">{row.installId.slice(-6)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SettingsFold>
  );
}
