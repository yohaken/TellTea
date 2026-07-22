"use client";

import { useEffect, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  foldByDeviceClass,
  nposDeviceClassLabel,
  nposGroupKey,
  shortStableKey,
  type NposDeviceClass,
} from "@/lib/npos-device-class";
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

type FlatRow = {
  key: string;
  installId: string;
  stableKey: string;
  deviceClass: NposDeviceClass;
  groupKey: string;
  sortAt: number;
  ev: NposOpsEvent;
};

function OpsTable({ rows }: { rows: FlatRow[] }) {
  if (rows.length === 0) return null;
  return (
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
          {rows.map((row) => {
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
                <td className="npos-ops-dev" title={row.groupKey}>
                  {shortStableKey(row.stableKey, row.installId)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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

  const buckets = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const d of docs) {
      for (const ev of d.events.slice(0, 40)) {
        rows.push({
          key: `${d.id}-${ev.at}-${ev.msg}`,
          installId: d.installId,
          stableKey: d.stableKey,
          deviceClass: d.deviceClass,
          groupKey: nposGroupKey(d.stableKey, d.installId),
          sortAt: ev.at,
          ev,
        });
      }
    }
    rows.sort((a, b) => b.sortAt - a.sortAt);
    const capped = rows.slice(0, 120);
    return foldByDeviceClass(capped);
  }, [docs]);

  const flatCount =
    buckets.shop.length + buckets.dev.length + buckets.blocked.length;
  const errorCount = [...buckets.shop, ...buckets.dev, ...buckets.blocked].filter(
    (r) => r.ev.level === "error",
  ).length;

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
          : flatCount
            ? `${flatCount} แถว${errorCount ? ` · E${errorCount}` : ""} · คอลัมน์เครื่อง = stableKey (ซ้ำ install ไม่แยกเครื่อง)`
            : "ยังไม่มี log"
      }
      defaultOpen={false}
      className="npos-ops-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : flatCount === 0 ? (
        <p className="muted">ยังไม่มีเหตุการณ์</p>
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
                <OpsTable rows={rows} />
              </section>
            );
          })}
        </>
      )}
    </SettingsFold>
  );
}
