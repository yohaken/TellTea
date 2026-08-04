/**
 * Unified team tab rows — merge shop roster + staff readiness into one list.
 */
import type { Employee } from "./employees";
import { employeeLinkLabel } from "./employees";
import {
  buildStaffReadinessRows,
  rowStatusLabel,
  type StaffReadinessRow,
} from "./staff-readiness";
import { staffLevelBadgeLabel } from "./permission-levels";
import type { PermissionLevel, StaffMember, StaffPersonalData } from "./types";
import { staffAccountLabel } from "./utils";

export type StaffTeamRow = {
  id: string;
  name: string;
  nickname?: string;
  employee?: Employee;
  member?: StaffMember;
  readiness?: StaffReadinessRow;
  levelLabel: string;
  levelCustomized: boolean;
  accountLabel: string;
  linkLabel: string;
  lastSeenAt?: number;
  monthlySalary?: number;
  active: boolean;
  /** true = มีชื่อในร้าน (employee) */
  hasRoster: boolean;
};

function findMemberForEmployee(
  emp: Employee,
  members: StaffMember[],
): StaffMember | undefined {
  if (emp.linkedStaffId) {
    const byId = members.find((m) => m.id === emp.linkedStaffId && m.role === "staff");
    if (byId) return byId;
  }
  return members.find(
    (m) =>
      m.role === "staff" &&
      (m.employeeId === emp.id ||
        (!!emp.linkedEmail &&
          !!m.email &&
          m.email.toLowerCase() === emp.linkedEmail.toLowerCase())),
  );
}

export function buildStaffTeamRows(
  members: StaffMember[],
  employees: Employee[],
  personalByStaffId: Map<string, StaffPersonalData>,
  levels: PermissionLevel[] = [],
): StaffTeamRow[] {
  const readinessRows = buildStaffReadinessRows(members, employees, personalByStaffId);
  const readinessByStaffId = new Map(
    readinessRows.filter((r) => r.staffId).map((r) => [r.staffId!, r]),
  );
  const readinessByEmpId = new Map(
    readinessRows.filter((r) => r.employeeId).map((r) => [r.employeeId!, r]),
  );

  const coveredStaffIds = new Set<string>();
  const rows: StaffTeamRow[] = [];

  for (const emp of employees) {
    const member = findMemberForEmployee(emp, members);
    if (member) coveredStaffIds.add(member.id);
    const readiness =
      (member ? readinessByStaffId.get(member.id) : undefined) ||
      readinessByEmpId.get(emp.id);
    const levelLabel = member ? staffLevelBadgeLabel(member, levels) : "—";
    rows.push({
      id: `emp-${emp.id}`,
      name: emp.name.trim() || "—",
      nickname: emp.nickname?.trim() || undefined,
      employee: emp,
      member,
      readiness,
      levelLabel,
      levelCustomized: !!member?.permissionsCustomized && !!member.permissionLevelId,
      accountLabel: readiness?.accountLabel || (member ? staffAccountLabel(member) : "—"),
      linkLabel: employeeLinkLabel(emp),
      lastSeenAt: readiness?.lastSeenAt,
      monthlySalary:
        emp.monthlySalary != null && emp.monthlySalary > 0 ? emp.monthlySalary : undefined,
      active: emp.active !== false,
      hasRoster: true,
    });
  }

  // Staff accounts not linked to any employee row
  for (const member of members) {
    if (member.role !== "staff" || coveredStaffIds.has(member.id)) continue;
    const readiness = readinessByStaffId.get(member.id);
    rows.push({
      id: `staff-${member.id}`,
      name: readiness?.rosterName || member.displayName?.trim() || "ยังไม่เชื่อมชื่อ",
      nickname: undefined,
      member,
      readiness,
      levelLabel: staffLevelBadgeLabel(member, levels),
      levelCustomized: !!member.permissionsCustomized && !!member.permissionLevelId,
      accountLabel: readiness?.accountLabel || "—",
      linkLabel: "ยังไม่เชื่อมชื่อร้าน",
      lastSeenAt: readiness?.lastSeenAt,
      active: true,
      hasRoster: false,
    });
  }

  return rows.sort((a, b) => {
    // Active roster first, then inactive, orphans near end of active group
    const rank = (r: StaffTeamRow) => {
      if (!r.active) return 3;
      const s = r.readiness?.status;
      if (s === "awaiting-account" || s === "no-account") return 0;
      if (s === "blocked") return 1;
      if (s === "partial") return 2;
      if (!r.hasRoster) return 2;
      return 2.5;
    };
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name, "th");
  });
}

export function teamReadyLabel(row: StaffTeamRow): string {
  if (!row.active && row.hasRoster) return "ปิด";
  if (!row.readiness) return row.hasRoster ? "รอบัญชี" : "—";
  return rowStatusLabel(row.readiness);
}

export function teamReadyTone(
  row: StaffTeamRow,
): "complete" | "partial" | "blocked" | "awaiting" | "none" | "inactive" {
  if (!row.active && row.hasRoster) return "inactive";
  const s = row.readiness?.status;
  if (s === "complete") return "complete";
  if (s === "partial") return "partial";
  if (s === "blocked") return "blocked";
  if (s === "awaiting-account" || s === "no-account") return "awaiting";
  return "none";
}

export function formatSalaryShort(amount?: number): string {
  if (amount == null || !(amount > 0)) return "—";
  if (amount >= 1000 && amount % 1000 === 0) {
    return `฿${(amount / 1000).toLocaleString("th-TH")}ก`;
  }
  return `฿${amount.toLocaleString("th-TH")}`;
}

export function summarizeStaffTeam(rows: StaffTeamRow[]) {
  const active = rows.filter((r) => r.active);
  const withStaff = active.filter((r) => r.member);
  const complete = withStaff.filter((r) => r.readiness?.status === "complete").length;
  const awaiting = active.filter(
    (r) =>
      !r.member ||
      r.readiness?.status === "awaiting-account" ||
      r.readiness?.status === "no-account",
  ).length;
  const inactive = rows.filter((r) => !r.active).length;
  return {
    total: rows.length,
    active: active.length,
    withAccount: withStaff.length,
    complete,
    awaiting,
    inactive,
  };
}
