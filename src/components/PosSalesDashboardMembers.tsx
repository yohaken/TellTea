"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import type { PosDashMembersSummary } from "@/lib/pos-sales-dashboard";
import { formatPlainNumber } from "@/lib/utils";

function niceMax(raw: number): number {
  if (!(raw > 0)) return 4;
  const pad = raw * 1.12;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(pad)));
  const norm = pad / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return Math.max(1, step * mag);
}

function yTicks(max: number, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(Math.round((max * i) / count));
  return out;
}

function trendLabel(netChange: number): { text: string; className: string } {
  if (netChange > 0) return { text: `เพิ่มขึ้น ${netChange.toLocaleString("th-TH")}`, className: "is-up" };
  if (netChange < 0) {
    return {
      text: `ลดลง ${Math.abs(netChange).toLocaleString("th-TH")}`,
      className: "is-down",
    };
  }
  return { text: "ไม่เปลี่ยน", className: "is-flat" };
}

export function PosSalesDashboardMembers({
  members,
  memberBillCount,
  memberSalesTotal,
  onOpenMembers,
}: {
  members: PosDashMembersSummary;
  memberBillCount: number;
  memberSalesTotal: number;
  onOpenMembers?: () => void;
}) {
  const trend = trendLabel(members.netChange);
  const W = 720;
  const H = 200;
  const pad = { top: 14, right: 14, bottom: 42, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const chart = useMemo(() => {
    const points = members.byDay;
    const maxSignups = niceMax(Math.max(...points.map((p) => p.signups), 0));
    const maxCum = niceMax(Math.max(...points.map((p) => p.cumulative), 0));
    const n = Math.max(points.length, 1);
    const xAt = (i: number) => pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const ySignup = (v: number) => pad.top + innerH - (v / maxSignups) * innerH;
    const yCum = (v: number) => pad.top + innerH - (v / maxCum) * innerH;
    const barW = Math.max(3, Math.min(18, (innerW / n) * 0.45));
    const bars = points.map((p, i) => ({
      x: xAt(i) - barW / 2,
      y: ySignup(p.signups),
      h: Math.max(0, pad.top + innerH - ySignup(p.signups)),
      p,
    }));
    let line = "";
    points.forEach((p, i) => {
      const x = xAt(i);
      const y = yCum(p.cumulative);
      line += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    const labelStep = n > 20 ? 2 : 1;
    const labels = points
      .map((p, i) => ({ i, label: p.label, x: xAt(i) }))
      .filter((row) => row.i % labelStep === 0);
    return {
      maxSignups,
      maxCum,
      signupTicks: yTicks(maxSignups),
      bars,
      linePath: line,
      labels,
      barW,
    };
  }, [members.byDay, innerH, innerW, pad.left, pad.top]);

  return (
    <article className="pos-dash-card pos-dash-card--members">
      <div className="pos-dash-card-head">
        <h3 className="pos-dash-card-title">
          <Users size={16} aria-hidden /> สมาชิก
        </h3>
        {onOpenMembers ? (
          <button type="button" className="npos-slim-text-btn pos-dash-more" onClick={onOpenMembers}>
            ดูเพิ่มเติม
          </button>
        ) : null}
      </div>

      <div className="pos-dash-member-stats">
        <div>
          <span className="muted">สมัครใหม่ในช่วง</span>
          <strong>{members.signupsInRange.toLocaleString("th-TH")}</strong>
          <span className="muted">คน</span>
        </div>
        <div>
          <span className="muted">สมาชิกสะสมปลายช่วง</span>
          <strong>{members.cumulativeEnd.toLocaleString("th-TH")}</strong>
          <span className={`pos-dash-member-trend ${trend.className}`}>{trend.text}</span>
        </div>
        <div>
          <span className="muted">ต้นช่วง → ปลายช่วง</span>
          <strong>
            {members.cumulativeStart.toLocaleString("th-TH")} →{" "}
            {members.cumulativeEnd.toLocaleString("th-TH")}
          </strong>
          <span className="muted">ไม่นับที่ลบแล้ว</span>
        </div>
        <div>
          <span className="muted">บิลผูกสมาชิก</span>
          <strong>{memberBillCount.toLocaleString("th-TH")}</strong>
          <span className="muted">รับเงิน {formatPlainNumber(memberSalesTotal)} บาท</span>
        </div>
      </div>

      <h4 className="pos-dash-subhead">สมัครรายวัน · สะสม</h4>
      {members.byDay.length === 0 ? (
        <p className="muted">ยังไม่มีข้อมูลสมาชิกในช่วงนี้</p>
      ) : (
        <div className="pos-dash-chart-svg-wrap">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="pos-dash-chart-svg"
            role="img"
            aria-label="กราฟสมัครสมาชิกรายวันและสะสม"
          >
            {chart.signupTicks.map((t) => {
              const y = pad.top + innerH - (t / chart.maxSignups) * innerH;
              return (
                <g key={t}>
                  <line
                    x1={pad.left}
                    x2={W - pad.right}
                    y1={y}
                    y2={y}
                    className="pos-dash-chart-grid"
                  />
                  <text x={pad.left - 6} y={y + 3} textAnchor="end" className="pos-dash-chart-axis">
                    {t}
                  </text>
                </g>
              );
            })}
            {chart.bars.map((b) => (
              <rect
                key={b.p.dateKey}
                x={b.x}
                y={b.y}
                width={chart.barW}
                height={b.h}
                className="pos-dash-member-bar"
              >
                <title>
                  {b.p.label}: สมัคร {b.p.signups} · สะสม {b.p.cumulative}
                </title>
              </rect>
            ))}
            {chart.linePath ? (
              <path d={chart.linePath} className="pos-dash-member-line" fill="none" />
            ) : null}
            {chart.labels.map((row) => (
              <text
                key={row.i}
                x={row.x}
                y={H - 10}
                textAnchor="end"
                transform={`rotate(-40 ${row.x} ${H - 10})`}
                className="pos-dash-chart-axis"
              >
                {row.label}
              </text>
            ))}
          </svg>
          <p className="muted pos-dash-footnote pos-dash-member-legend">
            แท่ง = สมัครใหม่รายวัน · เส้น = สมาชิกสะสมปลายวัน
          </p>
        </div>
      )}
    </article>
  );
}
