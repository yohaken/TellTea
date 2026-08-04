"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import {
  formatSalaryShort,
  buildStaffTeamRows,
  summarizeStaffTeam,
  teamReadyLabel,
  teamReadyTone,
  type StaffTeamRow,
} from "@/lib/staff-team";
import type { Employee } from "@/lib/employees";
import { planEmployeeIdentityPatch, updateEmployee } from "@/lib/employees";
import type { PermissionLevel, StaffMember, StaffPersonalData } from "@/lib/types";
import type { StaffReadinessRow } from "@/lib/staff-readiness";
import { StaffPersonalInfoButton } from "@/components/StaffPersonalInfoModal";
import { PermissionPicker } from "@/components/PermissionPicker";
import { PermissionLevelSelect } from "@/components/PermissionLevelSelect";
import {
  findLevel,
  permissionsMatchLevel,
} from "@/lib/permission-levels";
import {
  normalizePermissions,
  type StaffPermissions,
} from "@/lib/permissions";
import { staffAccountLabel } from "@/lib/utils";
import {
  STAFF_PRESENCE_AGE_TICK_MS,
  STAFF_PRESENCE_ONLINE_MS,
  formatPresenceAge,
  formatPresenceLastLogin,
} from "@/lib/staff-presence";
import { Eye, Trash2 } from "lucide-react";

function accountActionLabel(row: StaffTeamRow): string {
  const r = row.readiness;
  if (!r || r.kind === "roster-only" || !row.member) return "สร้างบัญชี";
  if (!r.checks.roster) return "เชื่อมชื่อ";
  return "แก้บัญชี";
}

function readinessAsEditRow(row: StaffTeamRow): StaffReadinessRow | null {
  if (row.readiness) return row.readiness;
  if (!row.employee) return null;
  return {
    id: `emp-${row.employee.id}`,
    kind: "roster-only",
    employeeId: row.employee.id,
    rosterName: row.employee.name,
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
  };
}

function LastSeenMini({ lastSeenAt, now }: { lastSeenAt?: number; now: number }) {
  if (!lastSeenAt || lastSeenAt <= 0) {
    return <span className="staff-mini-seen is-empty" title="ยังไม่เคยเข้าใช้หลังร้าน">—</span>;
  }
  const online = now - lastSeenAt <= STAFF_PRESENCE_ONLINE_MS;
  const age = formatPresenceAge(lastSeenAt, now);
  const when = formatPresenceLastLogin(lastSeenAt, now);
  return (
    <span
      className={`staff-mini-seen${online ? " is-online" : ""}`}
      title={online ? `กำลังใช้งาน · ${when}` : `ใช้งานล่าสุด ${when}`}
    >
      {online ? "ใช้" : age}
    </span>
  );
}

function ReadyPill({ row }: { row: StaffTeamRow }) {
  const tone = teamReadyTone(row);
  const label = teamReadyLabel(row);
  const title =
    row.readiness?.missing?.join(" · ") ||
    (tone === "complete" ? "ครบแล้ว" : tone === "inactive" ? "ปิดใช้งาน" : label);
  return (
    <span className={`staff-mini-ready is-${tone}`} title={title}>
      {label}
    </span>
  );
}

function CheckDots({ row }: { row: StaffTeamRow }) {
  const c = row.readiness?.checks;
  if (!c) {
    return <span className="muted staff-mini-checks">ยังไม่มีบัญชี</span>;
  }
  const personalOk = c.legalFirstName && c.legalLastName && c.idCard;
  const items: { ok: boolean; label: string }[] = [
    { ok: c.login, label: "เข้า" },
    { ok: personalOk, label: "ตัว" },
    { ok: c.pdpa, label: "PDPA" },
    { ok: c.roster, label: "ร้าน" },
  ];
  return (
    <div className="staff-mini-checks" aria-label="ความพร้อม">
      {items.map((it) => (
        <span
          key={it.label}
          className={it.ok ? "staff-mini-check is-ok" : "staff-mini-check is-miss"}
          title={it.ok ? `${it.label} ครบ` : `${it.label} ยังไม่ครบ`}
        >
          {it.label}
          {it.ok ? "✓" : "—"}
        </span>
      ))}
    </div>
  );
}

function MemberPermEditor({
  initial,
  initialLevelId,
  levels,
  busy,
  hideElevated = false,
  onSave,
}: {
  initial: StaffPermissions;
  initialLevelId: string;
  levels: PermissionLevel[];
  busy: boolean;
  hideElevated?: boolean;
  onSave: (next: StaffPermissions, levelId: string, customized: boolean) => void;
}) {
  const [levelId, setLevelId] = useState(initialLevelId);
  const [perms, setPerms] = useState(initial);
  const [showCustom, setShowCustom] = useState(
    !initialLevelId ||
      (() => {
        const level = findLevel(levels, initialLevelId);
        return !level || !permissionsMatchLevel(initial, level);
      })(),
  );

  function applyLevel(nextId: string) {
    setLevelId(nextId);
    const level = findLevel(levels, nextId);
    if (level) {
      setPerms({ ...level.permissions });
      setShowCustom(false);
    } else {
      setShowCustom(true);
    }
  }

  return (
    <div className="permission-editor staff-mini-perm-editor">
      <div className="field" style={{ marginBottom: "0.4rem" }}>
        <label htmlFor={`mini-member-level-${initialLevelId || "x"}`}>ลำดับสิทธิ์</label>
        <PermissionLevelSelect
          id={`mini-member-level-${initialLevelId || "x"}`}
          levels={levels}
          value={levelId}
          onChange={applyLevel}
          disabled={busy}
          hideElevated={hideElevated}
          allowEmpty
        />
      </div>
      <div className="staff-perm-toggle-row">
        <button
          type="button"
          className="ghost-btn staff-btn-sm"
          disabled={busy}
          onClick={() => setShowCustom((v) => !v)}
        >
          {showCustom ? "ซ่อนติ๊ก" : "ปรับรายข้อ"}
        </button>
        <button
          type="button"
          className="primary-btn staff-btn-sm"
          disabled={busy}
          onClick={() => {
            const level = findLevel(levels, levelId);
            const customized =
              !level || showCustom || !permissionsMatchLevel(perms, level);
            onSave(perms, levelId, customized);
          }}
        >
          บันทึกสิทธิ์
        </button>
      </div>
      {showCustom ? (
        <PermissionPicker
          value={perms}
          onChange={setPerms}
          disabled={busy}
          hideElevated={hideElevated}
          compact
        />
      ) : null}
    </div>
  );
}

function EmployeeEditPanel({
  emp,
  busy,
  onError,
  onReload,
  onPatchLocal,
}: {
  emp: Employee;
  busy: boolean;
  onError: (msg: string) => void;
  onReload: () => Promise<void>;
  onPatchLocal: (id: string, patch: Partial<Employee>) => void;
}) {
  const [name, setName] = useState(emp.name);
  const [nickname, setNickname] = useState(emp.nickname || "");
  const [monthlySalary, setMonthlySalary] = useState(
    emp.monthlySalary != null && emp.monthlySalary > 0 ? String(emp.monthlySalary) : "",
  );
  const [payBank, setPayBank] = useState(emp.payBank || "");
  const [payAccountNo, setPayAccountNo] = useState(emp.payAccountNo || "");
  const [payAccountName, setPayAccountName] = useState(emp.payAccountName || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(emp.name);
    setNickname(emp.nickname || "");
    setMonthlySalary(
      emp.monthlySalary != null && emp.monthlySalary > 0 ? String(emp.monthlySalary) : "",
    );
    setPayBank(emp.payBank || "");
    setPayAccountNo(emp.payAccountNo || "");
    setPayAccountName(emp.payAccountName || "");
  }, [
    emp.id,
    emp.name,
    emp.nickname,
    emp.monthlySalary,
    emp.payBank,
    emp.payAccountNo,
    emp.payAccountName,
  ]);

  async function saveEdit() {
    const nextName = name.trim();
    if (!nextName) {
      onError("ใส่ชื่อพนักงาน");
      return;
    }
    const salaryRaw = monthlySalary.trim();
    const salaryNum = salaryRaw === "" ? 0 : Number(salaryRaw);
    if (salaryRaw !== "" && (!Number.isFinite(salaryNum) || salaryNum < 0)) {
      onError("เงินเดือนไม่ถูกต้อง");
      return;
    }
    setSaving(true);
    onError("");
    const nextNick = nickname.trim();
    const identity = planEmployeeIdentityPatch(emp, {
      name: nextName,
      nickname: nextNick,
    });
    const saveName = identity.name ?? nextName;
    const saveNick = identity.nickname ?? nextNick;
    try {
      await updateEmployee(emp.id, {
        name: saveName,
        nickname: saveNick,
        monthlySalary: salaryNum,
        payBank: payBank.trim(),
        payAccountNo: payAccountNo.trim(),
        payAccountName: payAccountName.trim(),
      });
      onPatchLocal(emp.id, {
        name: saveName,
        nickname: saveNick || undefined,
        monthlySalary: salaryNum > 0 ? salaryNum : undefined,
        payBank: payBank.trim() || undefined,
        payAccountNo: payAccountNo.trim() || undefined,
        payAccountName: payAccountName.trim() || undefined,
        updatedAt: Date.now(),
      });
      await onReload();
    } catch (err) {
      onError((err as Error).message || "อัปเดตไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="staff-mini-edit">
      <label className="field">
        <span>ชื่อ</span>
        <input
          value={name}
          disabled={saving || busy}
          onChange={(e) => setName(e.target.value)}
          placeholder="ชื่อในร้าน"
        />
      </label>
      <label className="field">
        <span>ชื่อเล่น</span>
        <input
          value={nickname}
          disabled={saving || busy}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="สั้นๆ"
          maxLength={12}
        />
      </label>
      <label className="field">
        <span>เงินเดือน</span>
        <input
          type="number"
          min={0}
          step={100}
          inputMode="decimal"
          value={monthlySalary}
          disabled={saving || busy}
          onChange={(e) => setMonthlySalary(e.target.value)}
          placeholder="15000"
        />
      </label>
      <label className="field">
        <span>ธนาคาร</span>
        <input
          value={payBank}
          disabled={saving || busy}
          onChange={(e) => setPayBank(e.target.value)}
        />
      </label>
      <label className="field">
        <span>เลขบัญชี</span>
        <input
          value={payAccountNo}
          disabled={saving || busy}
          onChange={(e) => setPayAccountNo(e.target.value)}
        />
      </label>
      <label className="field">
        <span>ชื่อบัญชี</span>
        <input
          value={payAccountName}
          disabled={saving || busy}
          onChange={(e) => setPayAccountName(e.target.value)}
        />
      </label>
      <div className="staff-mini-edit-actions">
        <button
          type="button"
          className="primary-btn staff-btn-sm"
          disabled={saving || busy}
          onClick={() => void saveEdit()}
        >
          {saving ? "..." : "บันทึกชื่อ/เงิน"}
        </button>
      </div>
    </div>
  );
}

export function StaffTeamMiniTable({
  members,
  employees,
  levels = [],
  personalByStaffId,
  ownerView = false,
  busy = false,
  empName,
  empNickname,
  onEmpNameChange,
  onEmpNicknameChange,
  onAddEmployee,
  onEditAccount,
  onDeleteEmployee,
  onDeleteAccount,
  onPreviewMember,
  onSaveMemberPerms,
  selfStaffId = "",
  focusStaffId = "",
  hideElevated = false,
  onError,
  onReload,
  onPatchEmployeeLocal,
}: {
  members: StaffMember[];
  employees: Employee[];
  levels?: PermissionLevel[];
  personalByStaffId: Map<string, StaffPersonalData>;
  ownerView?: boolean;
  busy?: boolean;
  empName: string;
  empNickname: string;
  onEmpNameChange: (v: string) => void;
  onEmpNicknameChange: (v: string) => void;
  onAddEmployee: (e: FormEvent) => void;
  onEditAccount: (row: StaffReadinessRow) => void;
  onDeleteEmployee: (emp: Employee) => void;
  onDeleteAccount: (member: StaffMember) => void;
  onPreviewMember?: (member: StaffMember) => void;
  onSaveMemberPerms: (
    member: StaffMember,
    next: StaffPermissions,
    levelId: string,
    customized: boolean,
  ) => void;
  selfStaffId?: string;
  /** Deep-link: open this staff row + permission editor */
  focusStaffId?: string;
  hideElevated?: boolean;
  onError: (msg: string) => void;
  onReload: () => Promise<void>;
  onPatchEmployeeLocal: (id: string, patch: Partial<Employee>) => void;
}) {
  const rows = buildStaffTeamRows(members, employees, personalByStaffId, levels);
  const summary = summarizeStaffTeam(rows);
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingPermsId, setEditingPermsId] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, STAFF_PRESENCE_AGE_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!focusStaffId) return;
    const byEmp = employees.find(
      (e) => e.linkedStaffId === focusStaffId || members.some(
        (m) => m.id === focusStaffId && m.employeeId === e.id,
      ),
    );
    setOpenId(byEmp ? `emp-${byEmp.id}` : `staff-${focusStaffId}`);
    setEditingPermsId(focusStaffId);
  }, [focusStaffId, employees, members]);

  function toggle(id: string) {
    setOpenId((prev) => {
      if (prev === id) {
        setEditingPermsId(null);
        return null;
      }
      return id;
    });
  }

  function openAccount(row: StaffTeamRow) {
    const editRow = readinessAsEditRow(row);
    if (editRow) onEditAccount(editRow);
  }

  return (
    <section className="staff-hub-section staff-team-mini-section">
      <div className="staff-hub-panel-head staff-team-mini-head">
        <div>
          <h2 className="staff-hub-panel-title">ทีม</h2>
          <p className="staff-readiness-summary muted">
            {summary.active} คนใช้ · บัญชี {summary.withAccount} · ครบ {summary.complete}
            {summary.awaiting ? ` · รอบัญชี ${summary.awaiting}` : ""}
            {summary.inactive ? ` · ปิด ${summary.inactive}` : ""}
          </p>
        </div>
      </div>

      <form className="staff-compact-form staff-inline-add" onSubmit={onAddEmployee}>
        <input
          value={empName}
          onChange={(e) => onEmpNameChange(e.target.value)}
          placeholder="ชื่อ"
          required
          aria-label="ชื่อ"
        />
        <input
          value={empNickname}
          onChange={(e) => onEmpNicknameChange(e.target.value)}
          placeholder="ชื่อเล่น"
          maxLength={12}
          aria-label="ชื่อเล่น"
        />
        <button type="submit" className="primary-btn staff-btn-sm" disabled={busy}>
          เพิ่ม
        </button>
      </form>

      {!rows.length ? (
        <p className="muted staff-empty">ยังไม่มีพนักงาน — เพิ่มชื่อด้านบน</p>
      ) : (
        <div className="sheet-wrap staff-team-mini-wrap sheet-bleed">
          <table className="sheet-table staff-team-mini-table sheet-table--dense">
            <thead>
              <tr>
                <th className="staff-mini-col-name">ชื่อ</th>
                <th className="staff-mini-col-level">ลำดับ</th>
                <th className="staff-mini-col-account">บัญชี</th>
                <th className="staff-mini-col-ready">พร้อม</th>
                <th className="staff-mini-col-seen">ใช้</th>
                <th className="staff-mini-col-pay">เงิน</th>
                <th className="staff-mini-col-more" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = openId === row.id;
                const colSpan = 7;
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`staff-mini-row${open ? " is-open" : ""}${
                        !row.active ? " is-inactive" : ""
                      }${row.readiness?.status === "complete" && row.active ? " is-complete" : ""}`}
                    >
                      <td className="staff-mini-col-name">
                        <button
                          type="button"
                          className="staff-mini-name-btn"
                          onClick={() => toggle(row.id)}
                          aria-expanded={open}
                        >
                          <strong>{row.name}</strong>
                          {row.nickname ? (
                            <span className="staff-ready-nick"> · {row.nickname}</span>
                          ) : null}
                          {!row.active ? (
                            <span className="staff-ready-tag is-inactive">ปิด</span>
                          ) : null}
                          {!row.member && row.active ? (
                            <span className="staff-ready-tag is-roster">รอบัญชี</span>
                          ) : null}
                        </button>
                      </td>
                      <td className="staff-mini-col-level">
                        <span
                          className={`staff-chip${
                            row.levelLabel === "—" ? " is-muted" : " is-soft"
                          }`}
                          title={
                            row.levelCustomized ? "ผูกลำดับแต่ปรับสิทธิ์เอง" : row.levelLabel
                          }
                        >
                          {row.levelLabel}
                          {row.levelCustomized ? "*" : ""}
                        </span>
                      </td>
                      <td className="staff-mini-col-account muted" title={row.linkLabel}>
                        {row.accountLabel}
                      </td>
                      <td className="staff-mini-col-ready">
                        <ReadyPill row={row} />
                      </td>
                      <td className="staff-mini-col-seen">
                        <LastSeenMini lastSeenAt={row.lastSeenAt} now={now} />
                      </td>
                      <td
                        className="staff-mini-col-pay muted"
                        title={
                          row.monthlySalary
                            ? `฿${row.monthlySalary.toLocaleString("th-TH")}`
                            : "ยังไม่ใส่เงินเดือน"
                        }
                      >
                        {formatSalaryShort(row.monthlySalary)}
                      </td>
                      <td className="staff-mini-col-more">
                        <button
                          type="button"
                          className="ghost-btn staff-btn-sm staff-mini-more-btn"
                          aria-expanded={open}
                          aria-label={open ? "ย่อรายละเอียด" : "รายละเอียด"}
                          onClick={() => toggle(row.id)}
                        >
                          {open ? "▴" : "▾"}
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="staff-mini-detail-row">
                        <td colSpan={colSpan}>
                          <div className="staff-mini-detail">
                            <CheckDots row={row} />
                            <p className="muted staff-mini-link">{row.linkLabel}</p>
                            <div className="staff-mini-detail-actions">
                              <button
                                type="button"
                                className="ghost-btn staff-btn-sm"
                                disabled={busy}
                                onClick={() => openAccount(row)}
                              >
                                {accountActionLabel(row)}
                              </button>
                              {row.member && row.member.role === "staff" ? (
                                <button
                                  type="button"
                                  className="ghost-btn staff-btn-sm"
                                  disabled={busy}
                                  onClick={() =>
                                    setEditingPermsId((prev) =>
                                      prev === row.member!.id ? null : row.member!.id,
                                    )
                                  }
                                >
                                  {editingPermsId === row.member.id ? "ปิดสิทธิ์" : "สิทธิ์"}
                                </button>
                              ) : null}
                              {ownerView && row.member && row.member.role === "staff" && onPreviewMember ? (
                                <button
                                  type="button"
                                  className="ghost-btn staff-btn-sm"
                                  disabled={busy}
                                  title="ดูเมนูตามสิทธิ์บัญชีนี้"
                                  onClick={() => onPreviewMember(row.member!)}
                                >
                                  <Eye size={13} aria-hidden /> ดูแบบเขา
                                </button>
                              ) : null}
                              {ownerView && row.member && row.member.role === "staff" ? (
                                <StaffPersonalInfoButton member={row.member} />
                              ) : null}
                              {row.member &&
                              row.member.role === "staff" &&
                              row.member.id !== selfStaffId ? (
                                <button
                                  type="button"
                                  className="ghost-btn staff-btn-sm is-danger"
                                  disabled={busy}
                                  title={`ลบบัญชี ${staffAccountLabel(row.member)}`}
                                  onClick={() => onDeleteAccount(row.member!)}
                                >
                                  ลบบัญชี
                                </button>
                              ) : null}
                              {row.employee ? (
                                <>
                                  <button
                                    type="button"
                                    className="ghost-btn staff-btn-sm"
                                    disabled={busy}
                                    onClick={() =>
                                      void updateEmployee(row.employee!.id, {
                                        active: !row.employee!.active,
                                      })
                                        .then(onReload)
                                        .catch((err) =>
                                          onError(err.message || "อัปเดตไม่สำเร็จ"),
                                        )
                                    }
                                  >
                                    {row.employee.active ? "ปิดชื่อ" : "เปิดชื่อ"}
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost-btn icon-btn staff-btn-sm"
                                    aria-label={`ลบชื่อ ${row.name}`}
                                    disabled={busy}
                                    onClick={() => onDeleteEmployee(row.employee!)}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              ) : null}
                            </div>
                            {row.member &&
                            row.member.role === "staff" &&
                            editingPermsId === row.member.id ? (
                              <MemberPermEditor
                                key={row.member.id}
                                initial={normalizePermissions(
                                  row.member.permissions,
                                  row.member.role,
                                )}
                                initialLevelId={row.member.permissionLevelId || ""}
                                levels={levels}
                                busy={busy}
                                hideElevated={hideElevated}
                                onSave={(next, nextLevelId, customized) =>
                                  onSaveMemberPerms(
                                    row.member!,
                                    next,
                                    nextLevelId,
                                    customized,
                                  )
                                }
                              />
                            ) : null}
                            {row.employee ? (
                              <EmployeeEditPanel
                                emp={row.employee}
                                busy={busy}
                                onError={onError}
                                onReload={onReload}
                                onPatchLocal={onPatchEmployeeLocal}
                              />
                            ) : (
                              <p className="muted staff-mini-orphan-hint">
                                บัญชียังไม่เชื่อมชื่อร้าน — กดเชื่อมชื่อเพื่อผูก
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted staff-readiness-legend">
        เปิด▾ = บัญชี/สิทธิ์/ชื่อ/เงิน · ลบบัญชี ≠ ลบชื่อ · ใช้ = ≤5น
        {!ownerView ? " · บัตรเห็นได้เฉพาะเจ้าของ" : ""}
      </p>
    </section>
  );
}
