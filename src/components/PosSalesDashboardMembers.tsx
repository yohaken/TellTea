"use client";

import { useMemo, useState } from "react";
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
  if (netChange > 0)
    return {
      text: `เพิ่มขึ้น ${netChange.toLocaleString("th-TH")}`,
      className: "is-up",
    };
  if (netChange < 0) {
    return {
      text: `ลดลง ${Math.abs(netChange).toLocaleString("th-TH")}`,
      className: "is-down",
    };
  }
  return { text: "ไม่เปลี่ยน", className: "is-flat" };
}

function sharePct(part: number, whole: number): string {
  if (!(whole > 0)) return "0.0%";
  return `${((Math.max(0, part) / whole) * 100).toFixed(1)}%`;
}

/**
 * สมาชิก — สมัคร/สะสม · การซื้อของสมาชิก · แต้ม รวมไว้กล่องเดียว
 * - สะสมไม่นับสมาชิกที่ลบแล้ว · กราฟ: แท่ง = สมัครรายวัน, เส้น = สะสมปลายวัน
 * - แลกแต้มลดยอดก่อนรับเงิน — เงินสด/PP/โอนนับเฉพาะยอดที่รับจริง
 * - แต้มที่ได้คิดจากยอดรับเงินหลังลด
 */
export function PosSalesDashboardMembers({
  members,
  memberBillCount,
  memberSalesTotal,
  totalBills,
  totalSales,
  pointsEarned,
  pointsRedeemed,
  redeemBaht,
  redeemBillCount,
  onOpenMembers,
}: {
  members: PosDashMembersSummary;
  memberBillCount: number;
  memberSalesTotal: number;
  totalBills: number;
  totalSales: number;
  pointsEarned: number;
  pointsRedeemed: number;
  redeemBaht: number;
  redeemBillCount: number;
  onOpenMembers?: () => void;
}) {
  const trend = trendLabel(members.netChange);
  const otherBills = Math.max(0, totalBills - memberBillCount);
  const memberAvg =
    memberBillCount > 0 ? memberSalesTotal / memberBillCount : 0;
  const otherAvg =
    otherBills > 0
      ? Math.max(0, totalSales - memberSalesTotal) / otherBills
      : 0;
  const [showChart, setShowChart] = useState(false);
  const W = 720;
  const H = 150;
  const pad = { top: 10, right: 12, bottom: 34, left: 34 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const chart = useMemo(() => {
    const points = members.byDay;
    const maxSignups = niceMax(Math.max(...points.map((p) => p.signups), 0));
    const maxCum = niceMax(Math.max(...points.map((p) => p.cumulative), 0));
    const n = Math.max(points.length, 1);
    const xAt = (i: number) =>
      pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
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

  const signupPerDay =
    members.byDay.length > 0
      ? members.signupsInRange / members.byDay.length
      : 0;
  const n = (v: number) => v.toLocaleString("th-TH");

  return (
    <article className="pos-dash-card pos-dash-card--members">
      <div className="pos-dash-card-head">
        <h3 className="pos-dash-card-title">
          <Users size={14} aria-hidden /> สมาชิก
        </h3>
        <div className="pos-dash-mem-actions">
          {members.byDay.length > 0 ? (
            <button
              type="button"
              className="npos-slim-text-btn pos-dash-more"
              aria-expanded={showChart}
              onClick={() => setShowChart((v) => !v)}
            >
              {showChart ? "ซ่อนกราฟ" : "กราฟ"}
            </button>
          ) : null}
          {onOpenMembers ? (
            <button
              type="button"
              className="npos-slim-text-btn pos-dash-more"
              onClick={onOpenMembers}
            >
              ดูเพิ่มเติม
            </button>
          ) : null}
        </div>
      </div>

      <div className="pos-dash-mem-grid">
        <section className="pos-dash-mem-col">
          <h4 className="pos-dash-mem-head">สมัคร</h4>
          <dl>
            <div>
              <dt>สมัครใหม่ในช่วง</dt>
              <dd>
                {n(members.signupsInRange)}{" "}
                <small>{signupPerDay.toFixed(1)}/วัน</small>
              </dd>
            </div>
            <div>
              <dt>สมาชิกสะสมปลายช่วง</dt>
              <dd>
                {n(members.cumulativeEnd)}{" "}
                <small className={`pos-dash-member-trend ${trend.className}`}>
                  {trend.text}
                </small>
              </dd>
            </div>
            <div>
              <dt>ต้น → ปลาย</dt>
              <dd>
                {n(members.cumulativeStart)} → {n(members.cumulativeEnd)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="pos-dash-mem-col" aria-label="การซื้อของสมาชิก">
          <h4 className="pos-dash-mem-head">การซื้อของสมาชิก</h4>
          <dl>
            <div>
              <dt>บิลผูกสมาชิก</dt>
              <dd>
                {n(memberBillCount)}{" "}
                <small>{sharePct(memberBillCount, totalBills)}</small>
              </dd>
            </div>
            <div>
              <dt>รับเงินจากสมาชิก</dt>
              <dd>
                {formatPlainNumber(memberSalesTotal)}{" "}
                <small>{sharePct(memberSalesTotal, totalSales)}</small>
              </dd>
            </div>
            <div>
              <dt>฿/บิล vs ทั่วไป</dt>
              <dd>
                {formatPlainNumber(memberAvg)}{" "}
                <small>· {formatPlainNumber(otherAvg)}</small>
              </dd>
            </div>
          </dl>
        </section>

        <section className="pos-dash-mem-col" aria-label="แต้มสมาชิก">
          <h4 className="pos-dash-mem-head">แต้มสมาชิก</h4>
          <dl>
            <div>
              <dt>แต้มที่ได้ · ตัด</dt>
              <dd>
                {pointsEarned > 0 ? "+" : ""}
                {n(pointsEarned)}{" "}
                <small>
                  · {pointsRedeemed > 0 ? "−" : ""}
                  {n(pointsRedeemed)}
                </small>
              </dd>
            </div>
            <div>
              <dt>แลกแต้ม (ส่วนลด)</dt>
              <dd>
                {formatPlainNumber(redeemBaht)}{" "}
                <small>{n(redeemBillCount)} บิล</small>
              </dd>
            </div>
            <div>
              <dt>แต้มสุทธิ</dt>
              <dd>{n(pointsEarned - pointsRedeemed)}</dd>
            </div>
          </dl>
        </section>
      </div>

      {showChart && members.byDay.length > 0 ? (
        <div className="pos-dash-chart-svg-wrap">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="pos-dash-chart-svg"
            role="img"
            aria-label="สมัครรายวัน · สะสม"
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
                  <text
                    x={pad.left - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="pos-dash-chart-axis"
                  >
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
              <path
                d={chart.linePath}
                className="pos-dash-member-line"
                fill="none"
              />
            ) : null}
            {chart.labels.map((row) => (
              <text
                key={row.i}
                x={row.x}
                y={H - 6}
                textAnchor="end"
                transform={`rotate(-40 ${row.x} ${H - 6})`}
                className="pos-dash-chart-axis"
              >
                {row.label}
              </text>
            ))}
          </svg>
        </div>
      ) : null}

    </article>
  );
}
