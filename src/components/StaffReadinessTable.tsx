"use client";

import {
  buildStaffReadinessRows,
  statusLabel,
  summarizeStaffReadiness,
  type StaffReadinessRow,
} from "@/lib/staff-readiness";
import type { Employee } from "@/lib/employees";
import type { StaffMember, StaffPersonalData } from "@/lib/types";

function CheckCell({ ok, title }: { ok: boolean; title: string }) {
  return (
    <td className="staff-ready-col-check" title={title}>
      <span className={ok ? "staff-ready-ok" : "staff-ready-miss"} aria-label={ok ? "ครบ" : "ยังไม่ครบ"}>
        {ok ? "✓" : "—"}
      </span>
    </td>
  );
}

function StatusPill({ row }: { row: StaffReadinessRow }) {
  const cls =
    row.status === "complete"
      ? "staff-ready-pill is-complete"
      : row.status === "partial"
        ? "staff-ready-pill is-partial"
        : row.status === "blocked"
          ? "staff-ready-pill is-blocked"
          : "staff-ready-pill is-none";
  return (
    <span className={cls} title={row.missing.join(" · ") || "ครบแล้ว"}>
      {statusLabel(row.status)}
    </span>
  );
}

export function StaffReadinessTable({
  members,
  employees,
  personalByStaffId,
  ownerView = false,
}: {
  members: StaffMember[];
  employees: Employee[];
  personalByStaffId: Map<string, StaffPersonalData>;
  /** เจ้าของเห็นรายละเอียด PDPA/บัตรจาก staffPersonal */
  ownerView?: boolean;
}) {
  const rows = buildStaffReadinessRows(members, employees, personalByStaffId);
  const summary = summarizeStaffReadiness(rows);

  if (!rows.length) {
    return (
      <section className="staff-hub-section staff-readiness-section">
        <h2 className="panel-title" style={{ fontSize: "1.05rem" }}>
          สรุปความพร้อมพนักงาน
        </h2>
        <p className="muted" style={{ textAlign: "left", margin: 0 }}>
          ยังไม่มีพนักงานในระบบ — เพิ่มชื่อและบัญชีด้านล่าง
        </p>
      </section>
    );
  }

  return (
    <section className="staff-hub-section staff-readiness-section">
      <h2 className="panel-title" style={{ fontSize: "1.05rem" }}>
        สรุปความพร้อมพนักงาน
      </h2>
      <p className="staff-readiness-summary muted">
        พนักงาน {summary.totalStaff} คน · ครบ {summary.complete} · ยังไม่ครบ {summary.partial}
        {summary.blocked ? ` · ล็อกอินไม่ได้ ${summary.blocked}` : ""}
        {summary.rosterOnly ? ` · มีชื่อแต่ยังไม่มีบัญชี ${summary.rosterOnly}` : ""}
      </p>

      <div className="sheet-wrap staff-readiness-wrap">
        <table className="sheet-table staff-readiness-table">
          <thead>
            <tr>
              <th className="staff-ready-col-name">ชื่อในร้าน</th>
              <th className="staff-ready-col-account">บัญชี</th>
              <th className="staff-ready-col-check-h">เข้า</th>
              <th className="staff-ready-col-check-h">ส่วนตัว</th>
              <th className="staff-ready-col-check-h">PDPA</th>
              <th className="staff-ready-col-check-h">ร้าน</th>
              <th className="staff-ready-col-status">สรุป</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const personalOk =
                row.checks.legalFirstName &&
                row.checks.legalLastName &&
                row.checks.idCard;
              const personalTitle = row.missing
                .filter((m) => ["ชื่อจริง", "นามสกุล", "รูปบัตร"].includes(m))
                .join(", ");
              return (
                <tr key={row.id} className={row.status === "complete" ? "staff-ready-row-complete" : ""}>
                  <td className="staff-ready-col-name">
                    <strong>{row.rosterName}</strong>
                    {row.kind === "roster-only" ? (
                      <span className="staff-ready-tag">ยังไม่มีบัญชี</span>
                    ) : null}
                  </td>
                  <td className="staff-ready-col-account muted">{row.accountLabel}</td>
                  <CheckCell ok={row.checks.login} title={row.checks.login ? "ล็อกอินได้" : "ไม่มีอีเมล/เบอร์"} />
                  <CheckCell
                    ok={personalOk}
                    title={personalOk ? "ข้อมูลส่วนตัวครบ" : personalTitle || "ยังไม่ครบ"}
                  />
                  <CheckCell ok={row.checks.pdpa} title={row.checks.pdpa ? "ยินยอมแล้ว" : "ยังไม่ยินยอม PDPA"} />
                  <CheckCell ok={row.checks.roster} title={row.checks.roster ? "เชื่อมชื่อร้านแล้ว" : "ยังไม่เชื่อมชื่อร้าน"} />
                  <td className="staff-ready-col-status">
                    <StatusPill row={row} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted staff-readiness-legend" style={{ textAlign: "left", fontSize: "0.8rem", marginTop: "0.5rem" }}>
        เข้า = อีเมล/เบอร์ · ส่วนตัว = ชื่อจริง+นามสกุล+บัตร ปชช. · ร้าน = ชื่อในรายชื่อโบนัส/ผลิต
        {!ownerView ? " · สถานะส่วนตัวอิงจากธงในระบบ (รายละเอียดบัตรเห็นได้เฉพาะเจ้าของ)" : ""}
      </p>
    </section>
  );
}
