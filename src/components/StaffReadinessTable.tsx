"use client";

import { useEffect, useState } from "react";
import {
  buildStaffReadinessRows,
  rowStatusLabel,
  summarizeStaffReadiness,
  type StaffReadinessRow,
} from "@/lib/staff-readiness";
import type { Employee } from "@/lib/employees";
import type { PermissionLevel, StaffMember, StaffPersonalData } from "@/lib/types";
import { staffLevelBadgeLabel } from "@/lib/permission-levels";
import { StaffPersonalInfoButton } from "@/components/StaffPersonalInfoModal";
import {
  STAFF_PRESENCE_AGE_TICK_MS,
  STAFF_PRESENCE_ONLINE_MS,
  formatPresenceAge,
  formatPresenceLastLogin,
} from "@/lib/staff-presence";

function actionLabel(row: StaffReadinessRow): string {
  if (row.kind === "roster-only") return "สร้างบัญชี";
  if (!row.checks.roster) return "เชื่อมชื่อ";
  return "แก้ไข";
}

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
          : row.status === "awaiting-account"
            ? "staff-ready-pill is-awaiting"
            : "staff-ready-pill is-none";
  return (
    <span className={cls} title={row.missing.join(" · ") || "ครบแล้ว"}>
      {rowStatusLabel(row)}
    </span>
  );
}

/** คอลัมน์เข้าใช้ล่าสุด — กำลังใช้ / อายุเช่น 5น */
function LastSeenCell({ lastSeenAt, now }: { lastSeenAt?: number; now: number }) {
  if (!lastSeenAt || lastSeenAt <= 0) {
    return (
      <td className="staff-ready-col-seen muted" title="ยังไม่เคยเข้าใช้หลังร้าน">
        —
      </td>
    );
  }
  const online = now - lastSeenAt <= STAFF_PRESENCE_ONLINE_MS;
  const age = formatPresenceAge(lastSeenAt, now);
  const when = formatPresenceLastLogin(lastSeenAt, now);
  return (
    <td
      className={`staff-ready-col-seen${online ? " is-online" : ""}`}
      title={online ? `กำลังใช้งาน · ${when}` : `ใช้งานล่าสุด ${when}`}
    >
      <span className="staff-ready-seen">{online ? "ใช้" : age}</span>
    </td>
  );
}

export function StaffReadinessTable({
  members,
  employees,
  levels = [],
  personalByStaffId,
  ownerView = false,
  busy = false,
  onEditRow,
}: {
  members: StaffMember[];
  employees: Employee[];
  levels?: PermissionLevel[];
  personalByStaffId: Map<string, StaffPersonalData>;
  /** เจ้าของเห็นรายละเอียด PDPA/บัตรจาก staffPersonal */
  ownerView?: boolean;
  busy?: boolean;
  onEditRow?: (row: StaffReadinessRow) => void;
}) {
  const rows = buildStaffReadinessRows(members, employees, personalByStaffId);
  const summary = summarizeStaffReadiness(rows);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, STAFF_PRESENCE_AGE_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  if (!rows.length) {
    return (
      <section className="staff-hub-section staff-readiness-section">
        <h2 className="staff-hub-panel-title">ทีม</h2>
        <p className="staff-hub-panel-hint">ยังไม่มีพนักงาน — เพิ่มชื่อด้านล่าง</p>
      </section>
    );
  }

  return (
    <section className="staff-hub-section staff-readiness-section">
      <h2 className="staff-hub-panel-title">ทีม</h2>
      <p className="staff-readiness-summary muted">
        {summary.totalStaff} คน · ครบ {summary.complete} · ค้าง {summary.partial}
        {summary.blocked ? ` · ล็อกอินไม่ได้ ${summary.blocked}` : ""}
        {summary.rosterOnly ? ` · รอบัญชี ${summary.rosterOnly}` : ""}
      </p>

      <div className="sheet-wrap staff-readiness-wrap sheet-bleed">
        <table className="sheet-table staff-readiness-table sheet-table--dense">
          <thead>
            <tr>
              <th className="staff-ready-col-name">ชื่อ</th>
              <th className="staff-ready-col-level">ลำดับ</th>
              <th className="staff-ready-col-account">บัญชี</th>
              <th className="staff-ready-col-check-h">เข้า</th>
              <th className="staff-ready-col-check-h">ตัว</th>
              <th className="staff-ready-col-check-h">PDPA</th>
              <th className="staff-ready-col-check-h">ร้าน</th>
              <th className="staff-ready-col-seen-h">ใช้ล่าสุด</th>
              <th className="staff-ready-col-status">สรุป</th>
              {onEditRow ? <th className="staff-ready-col-action">จัดการ</th> : null}
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
              const member = row.staffId ? members.find((m) => m.id === row.staffId) : undefined;
              const emp = employees.find((e) => e.id === row.employeeId);
              const nick = emp?.nickname?.trim();
              const levelLabel =
                row.kind === "roster-only"
                  ? "—"
                  : staffLevelBadgeLabel(member, levels);
              const customized = !!member?.permissionsCustomized && !!member.permissionLevelId;
              return (
                <tr
                  key={row.id}
                  className={
                    row.status === "complete"
                      ? "staff-ready-row-complete"
                      : row.status === "awaiting-account"
                        ? "staff-ready-row-awaiting"
                        : ""
                  }
                >
                  <td className="staff-ready-col-name">
                    <strong>{row.rosterName}</strong>
                    {nick ? <span className="staff-ready-nick"> · {nick}</span> : null}
                    {row.kind === "roster-only" ? (
                      <span className="staff-ready-tag is-roster">รอบัญชี</span>
                    ) : null}
                  </td>
                  <td className="staff-ready-col-level">
                    <span
                      className={`staff-chip${levelLabel === "—" ? " is-muted" : " is-soft"}`}
                      title={customized ? "ผูกลำดับแต่ปรับสิทธิ์เอง" : levelLabel}
                    >
                      {levelLabel}
                      {customized ? "*" : ""}
                    </span>
                  </td>
                  <td className="staff-ready-col-account muted">{row.accountLabel}</td>
                  <CheckCell ok={row.checks.login} title={row.checks.login ? "ล็อกอินได้" : "ไม่มีอีเมล/เบอร์"} />
                  <CheckCell
                    ok={personalOk}
                    title={personalOk ? "ข้อมูลส่วนตัวครบ" : personalTitle || "ยังไม่ครบ"}
                  />
                  <CheckCell ok={row.checks.pdpa} title={row.checks.pdpa ? "ยินยอมแล้ว" : "ยังไม่ยินยอม PDPA"} />
                  <CheckCell ok={row.checks.roster} title={row.checks.roster ? "เชื่อมชื่อร้านแล้ว" : "ยังไม่เชื่อมชื่อร้าน"} />
                  <LastSeenCell lastSeenAt={row.lastSeenAt} now={now} />
                  <td className="staff-ready-col-status">
                    <StatusPill row={row} />
                  </td>
                  {onEditRow ? (
                    <td className="staff-ready-col-action">
                      <div className="staff-ready-actions">
                        <button
                          type="button"
                          className="ghost-btn staff-ready-edit-btn"
                          disabled={busy}
                          onClick={() => onEditRow(row)}
                        >
                          {actionLabel(row)}
                        </button>
                        {ownerView && member && member.role === "staff" ? (
                          <StaffPersonalInfoButton member={member} />
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted staff-readiness-legend">
        ลำดับ = แม่แบบสิทธิ์ (* ปรับเอง) · เข้า/ตัว/PDPA/ร้าน = ความพร้อมบัญชี ·
        ใช้ล่าสุด = เข้าหลังร้าน (ใช้ = กำลังใช้ ≤5น)
        {!ownerView ? " · บัตรเห็นได้เฉพาะเจ้าของ" : ""}
      </p>
    </section>
  );
}
