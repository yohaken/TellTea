import type { Employee } from "./employees";
import { getIdCardPhotoUrls } from "./staff-personal";
import type { StaffMember, StaffPersonalData } from "./types";
import { staffAccountLabel } from "./utils";

export type StaffReadinessChecks = {
  login: boolean;
  legalFirstName: boolean;
  legalLastName: boolean;
  idCard: boolean;
  pdpa: boolean;
  roster: boolean;
};

export type StaffReadinessRow = {
  id: string;
  kind: "staff" | "roster-only";
  staffId?: string;
  employeeId?: string;
  rosterName: string;
  accountLabel: string;
  checks: StaffReadinessChecks;
  missing: string[];
  status: "complete" | "partial" | "blocked" | "no-account" | "awaiting-account";
};

function rosterNameForStaff(member: StaffMember, employees: Employee[]): string {
  if (member.displayName?.trim()) return member.displayName.trim();
  const emp = member.employeeId
    ? employees.find((e) => e.id === member.employeeId)
    : employees.find((e) => e.linkedStaffId === member.id);
  return emp?.name || "ยังไม่เชื่อมชื่อ";
}

function assessPersonal(
  member: StaffMember,
  personal: StaffPersonalData | null | undefined,
): Pick<StaffReadinessChecks, "legalFirstName" | "legalLastName" | "idCard" | "pdpa"> {
  const p = personal;
  return {
    legalFirstName: !!p?.legalFirstName?.trim() || !!member.personalProfileComplete,
    legalLastName: !!p?.legalLastName?.trim() || !!member.personalProfileComplete,
    idCard: getIdCardPhotoUrls(p).length > 0 || !!member.personalProfileComplete,
    pdpa: !!p?.personalDataConsentAt || !!member.personalProfileComplete,
  };
}

function buildMissing(checks: StaffReadinessChecks): string[] {
  const missing: string[] = [];
  if (!checks.login) missing.push("บัญชีล็อกอิน");
  if (!checks.legalFirstName) missing.push("ชื่อจริง");
  if (!checks.legalLastName) missing.push("นามสกุล");
  if (!checks.idCard) missing.push("รูปบัตร");
  if (!checks.pdpa) missing.push("PDPA");
  if (!checks.roster) missing.push("ชื่อในร้าน");
  return missing;
}

function resolveStatus(checks: StaffReadinessChecks, kind: StaffReadinessRow["kind"]): StaffReadinessRow["status"] {
  if (kind === "roster-only") return "no-account";
  if (!checks.login) return "blocked";
  const personalOk =
    checks.legalFirstName && checks.legalLastName && checks.idCard && checks.pdpa;
  const allOk = personalOk && checks.roster;
  if (allOk) return "complete";
  return "partial";
}

export function buildStaffReadinessRows(
  members: StaffMember[],
  employees: Employee[],
  personalByStaffId: Map<string, StaffPersonalData>,
): StaffReadinessRow[] {
  const rows: StaffReadinessRow[] = [];
  const linkedEmpIds = new Set<string>();

  for (const member of members) {
    if (member.role !== "staff") continue;

    const personal = personalByStaffId.get(member.id);
    const checks: StaffReadinessChecks = {
      login: !!(member.email?.trim() || member.phone?.trim()),
      ...assessPersonal(member, personal),
      roster: !!(member.profileComplete && member.employeeId?.trim() && member.displayName?.trim()),
    };

    if (member.employeeId) linkedEmpIds.add(member.employeeId);
    const emp = employees.find((e) => e.linkedStaffId === member.id || e.id === member.employeeId);
    if (emp) linkedEmpIds.add(emp.id);

    rows.push({
      id: member.id,
      kind: "staff",
      staffId: member.id,
      employeeId: member.employeeId || emp?.id,
      rosterName: rosterNameForStaff(member, employees),
      accountLabel: staffAccountLabel(member),
      checks,
      missing: buildMissing(checks),
      status: resolveStatus(checks, "staff"),
    });
  }

  for (const emp of employees) {
    if (!emp.active || linkedEmpIds.has(emp.id) || emp.linkedStaffId) continue;
    rows.push({
      id: `emp-${emp.id}`,
      kind: "roster-only",
      employeeId: emp.id,
      rosterName: emp.name,
      accountLabel: "—",
      checks: {
        login: false,
        legalFirstName: false,
        legalLastName: false,
        idCard: false,
        pdpa: false,
        roster: true,
      },
      missing: ["บัญชีล็อกอิน (ขั้นที่ 2)"],
      status: "awaiting-account",
    });
  }

  return rows.sort((a, b) => {
    const rank = (s: StaffReadinessRow["status"]) =>
      s === "awaiting-account" || s === "no-account"
        ? 0
        : s === "blocked"
          ? 1
          : s === "partial"
            ? 2
            : 3;
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    return a.rosterName.localeCompare(b.rosterName, "th");
  });
}

export function summarizeStaffReadiness(rows: StaffReadinessRow[]) {
  const staffRows = rows.filter((r) => r.kind === "staff");
  const rosterOnly = rows.filter((r) => r.status === "awaiting-account" || r.kind === "roster-only");
  return {
    totalStaff: staffRows.length,
    complete: staffRows.filter((r) => r.status === "complete").length,
    partial: staffRows.filter((r) => r.status === "partial").length,
    blocked: staffRows.filter((r) => r.status === "blocked").length,
    rosterOnly: rosterOnly.length,
  };
}

export function statusLabel(status: StaffReadinessRow["status"]): string {
  if (status === "complete") return "ครบ";
  if (status === "partial") return "ยังไม่ครบ";
  if (status === "blocked") return "ล็อกอินไม่ได้";
  if (status === "awaiting-account") return "รอสร้างบัญชี";
  return "ยังไม่มีบัญชี";
}

export function rowStatusLabel(row: StaffReadinessRow): string {
  return statusLabel(row.status);
}
