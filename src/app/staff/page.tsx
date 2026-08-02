"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { PermissionPicker } from "@/components/PermissionPicker";
import { PermissionLevelSelect } from "@/components/PermissionLevelSelect";
import { PermissionLevelsPanel } from "@/components/PermissionLevelsPanel";
import { useAuth } from "@/lib/auth";
import {
  addEmployee,
  deleteEmployee,
  employeeLinkLabel,
  employeesForLink,
  listEmployeesWithPay,
  migrateAllLegacyEmployeePay,
  planEmployeeIdentityPatch,
  updateEmployee,
  type Employee,
} from "@/lib/employees";
import {
  listStaff,
  removeStaffById,
  updateStaffPermissions,
  updateStaffProfile,
  upsertStaffWithLink,
} from "@/lib/staff";
import type { PermissionLevel, StaffMember } from "@/lib/types";
import {
  DEFAULT_STAFF_PERMISSIONS,
  can,
  clampPermissionsForNonOwner,
  normalizePermissions,
  type StaffPermissions,
} from "@/lib/permissions";
import {
  defaultAssignableLevelId,
  ensurePermissionLevelSeeds,
  findLevel,
  permissionsMatchLevel,
} from "@/lib/permission-levels";
import { formatPhoneDisplay, staffAccountLabel } from "@/lib/utils";
import { mapFirestoreError } from "@/lib/firestore-errors";
import { Trash2 } from "lucide-react";
import { StaffPersonalInfoButton } from "@/components/StaffPersonalInfoModal";
import { StaffReadinessTable } from "@/components/StaffReadinessTable";
import {
  StaffReadinessEditModal,
  type StaffReadinessEditTarget,
} from "@/components/StaffReadinessEditModal";
import { listStaffPersonalMap } from "@/lib/staff-personal";
import type { StaffReadinessRow } from "@/lib/staff-readiness";
import type { StaffPersonalData } from "@/lib/types";

type HubTab = "team" | "accounts" | "levels";

export default function StaffPage() {
  return (
    <AuthGate>
      <StaffView />
    </AuthGate>
  );
}

function rosterLinkLabel(emp: Employee): string {
  return employeeLinkLabel(emp);
}

function memberLinkLabel(member: StaffMember, employees: Employee[]): string {
  const emp = member.employeeId
    ? employees.find((e) => e.id === member.employeeId)
    : employees.find((e) => e.linkedStaffId === member.id);
  if (emp) return `→ ${emp.name}`;
  if (member.profileComplete && member.displayName) return `→ ${member.displayName}`;
  return "ยังไม่เชื่อม";
}

function StaffView() {
  const { staff, refreshStaff } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<HubTab>("team");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [levels, setLevels] = useState<PermissionLevel[]>([]);
  const [empName, setEmpName] = useState("");
  const [empNickname, setEmpNickname] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkEmployeeId, setLinkEmployeeId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [perms, setPerms] = useState<StaffPermissions>({ ...DEFAULT_STAFF_PERMISSIONS });
  const [showCustomPerms, setShowCustomPerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [personalMap, setPersonalMap] = useState<Map<string, StaffPersonalData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<StaffReadinessEditTarget>(null);

  const linkOptions = employeesForLink(employees);
  const isOwner = staff?.role === "owner";
  const canManageStaff = can(staff, "staffManage");

  const linkedCountByLevelId = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of members) {
      if (!m.permissionLevelId) continue;
      map.set(m.permissionLevelId, (map.get(m.permissionLevelId) || 0) + 1);
    }
    return map;
  }, [members]);

  async function reload(): Promise<{ employeesOk: boolean; staffOk: boolean }> {
    const errors: string[] = [];
    let emps: Employee[] = [];
    let staffList: StaffMember[] = [];
    let employeesOk = true;
    let staffOk = true;

    try {
      try {
        await migrateAllLegacyEmployeePay();
      } catch {
        /* best-effort */
      }
      emps = await listEmployeesWithPay();
    } catch (err) {
      employeesOk = false;
      errors.push(mapFirestoreError(err, "โหลดรายชื่อร้านไม่สำเร็จ"));
    }

    try {
      staffList = await listStaff();
    } catch (err) {
      staffOk = false;
      errors.push(mapFirestoreError(err, "โหลดบัญชีพนักงานไม่สำเร็จ"));
    }

    try {
      const seeded = await ensurePermissionLevelSeeds();
      setLevels(seeded);
      setLevelId((prev) => prev || defaultAssignableLevelId(seeded));
    } catch (err) {
      errors.push(mapFirestoreError(err, "โหลดลำดับสิทธิ์ไม่สำเร็จ"));
    }

    setEmployees(emps);
    setMembers(staffList);

    if (isOwner) {
      try {
        setPersonalMap(await listStaffPersonalMap());
      } catch {
        setPersonalMap(new Map());
      }
    } else {
      setPersonalMap(new Map());
    }

    if (errors.length) setError(errors.join(" · "));
    return { employeesOk, staffOk };
  }

  useEffect(() => {
    if (staff && !canManageStaff) {
      router.replace("/ledger/");
      return;
    }
    if (!staff || !canManageStaff) return;
    setLoading(true);
    void reload()
      .catch((err) => setError(mapFirestoreError(err, "โหลดหน้าพนักงานไม่สำเร็จ")))
      .finally(() => setLoading(false));
  }, [staff, router, canManageStaff]);

  useEffect(() => {
    if (!linkEmployeeId) return;
    if (!linkOptions.some((e) => e.id === linkEmployeeId)) {
      setLinkEmployeeId("");
    }
  }, [linkEmployeeId, linkOptions]);

  function applyLevel(nextId: string) {
    setLevelId(nextId);
    const level = findLevel(levels, nextId);
    if (level) {
      setPerms(
        isOwner ? { ...level.permissions } : clampPermissionsForNonOwner(level.permissions),
      );
      setShowCustomPerms(false);
    } else {
      setShowCustomPerms(true);
    }
  }

  async function onAddEmployee(e: FormEvent) {
    e.preventDefault();
    const name = empName.trim();
    if (!name) {
      setError("ใส่ชื่อพนักงาน");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const nick = empNickname.trim();
      const id = await addEmployee(name, nick || undefined);
      const now = Date.now();
      setEmployees((prev) => {
        if (prev.some((row) => row.id === id)) return prev;
        return [
          ...prev,
          {
            id,
            name,
            ...(nick ? { nickname: nick } : {}),
            active: true,
            createdAt: now,
            updatedAt: now,
          },
        ].sort((a, b) => a.name.localeCompare(b.name, "th"));
      });
      setEmpName("");
      setEmpNickname("");
      setSuccess(`เพิ่ม "${name}" แล้ว`);
      const { employeesOk } = await reload();
      if (employeesOk) setError(null);
    } catch (err) {
      setSuccess(null);
      setError(mapFirestoreError(err, "เพิ่มชื่อไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitAccount(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() && !phone.trim()) {
      setError("ใส่อีเมลหรือเบอร์อย่างน้อยหนึ่งอย่าง");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const linkedName = linkEmployeeId
        ? employees.find((row) => row.id === linkEmployeeId)?.name
        : undefined;
      const safePerms = isOwner ? perms : clampPermissionsForNonOwner(perms);
      const level = findLevel(levels, levelId);
      const customized =
        !level || showCustomPerms || !permissionsMatchLevel(safePerms, level);
      await upsertStaffWithLink({
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        role: "staff",
        permissions: safePerms,
        employeeId: linkEmployeeId || undefined,
        permissionLevelId: levelId || null,
        permissionsCustomized: customized,
      });
      const account = email.trim() || phone.trim();
      setEmail("");
      setPhone("");
      setLinkEmployeeId("");
      const def = defaultAssignableLevelId(levels);
      setLevelId(def);
      const defLevel = findLevel(levels, def);
      setPerms(defLevel ? { ...defLevel.permissions } : { ...DEFAULT_STAFF_PERMISSIONS });
      setShowCustomPerms(false);
      setSuccess(
        linkedName
          ? `สร้าง ${account} · เชื่อม "${linkedName}"`
          : `สร้างบัญชี ${account} แล้ว`,
      );
      const { staffOk } = await reload();
      if (staffOk) setError(null);
      await refreshStaff();
    } catch (err) {
      setSuccess(null);
      setError(mapFirestoreError(err, "บันทึกบัญชีไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteEmployee(emp: Employee) {
    const linked = emp.linkedEmail || emp.linkedPhone || emp.linkedStaffId;
    const msg = linked
      ? `ลบ "${emp.name}"? บัญชีที่เชื่อมต้องตั้งโปรไฟล์ใหม่`
      : `ลบ "${emp.name}" จากรายชื่อ?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setError(null);
    try {
      if (emp.linkedStaffId) {
        await updateStaffProfile(emp.linkedStaffId, {
          employeeId: null,
          profileComplete: false,
          displayName: null,
        });
      }
      await deleteEmployee(emp.id);
      await reload();
    } catch (err) {
      setError((err as Error).message || "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function saveMemberPerms(
    member: StaffMember,
    next: StaffPermissions,
    nextLevelId: string,
    customized: boolean,
  ) {
    setBusy(true);
    setError(null);
    try {
      const safe = isOwner ? next : clampPermissionsForNonOwner(next);
      await updateStaffPermissions(member.id, safe, {
        permissionLevelId: nextLevelId || null,
        permissionsCustomized: customized,
      });
      await reload();
      await refreshStaff();
      setEditingStaffId(null);
    } catch (err) {
      setError((err as Error).message || "บันทึกสิทธิ์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function saveReadinessEdit(input: {
    email: string;
    phone: string;
    linkEmployeeId: string;
    permissions: StaffPermissions;
    permissionLevelId: string | null;
    permissionsCustomized: boolean;
  }) {
    const row = editTarget?.row;
    if (!row) return;
    if (!input.email.trim() && !input.phone.trim()) {
      setError("ใส่อีเมลหรือเบอร์อย่างน้อยหนึ่งอย่าง");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const linkedName = input.linkEmployeeId
        ? employees.find((e) => e.id === input.linkEmployeeId)?.name
        : undefined;
      const safePerms = isOwner
        ? input.permissions
        : clampPermissionsForNonOwner(input.permissions);
      await upsertStaffWithLink({
        email: input.email.trim() || undefined,
        phone: input.phone.trim() || undefined,
        role: "staff",
        permissions: safePerms,
        employeeId: input.linkEmployeeId || row.employeeId || undefined,
        permissionLevelId: input.permissionLevelId,
        permissionsCustomized: input.permissionsCustomized,
      });
      const account = input.email.trim() || input.phone.trim();
      setEditTarget(null);
      setSuccess(
        linkedName ? `บันทึก ${account} · "${linkedName}"` : `บันทึก ${account}`,
      );
      const { staffOk } = await reload();
      if (staffOk) setError(null);
      await refreshStaff();
    } catch (err) {
      setSuccess(null);
      setError(mapFirestoreError(err, "บันทึกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  function openReadinessEdit(row: StaffReadinessRow) {
    const member = row.staffId ? members.find((m) => m.id === row.staffId) : undefined;
    setEditTarget({ row, member });
    setError(null);
  }

  if (!canManageStaff) return null;

  return (
    <div className="staff-hub">
      <header className="staff-hub-head">
        <div>
          <h1 className="staff-hub-title">ทีม / พนักงาน</h1>
          <p className="staff-hub-sub">หลังร้าน · จัดการชื่อ บัญชี และลำดับสิทธิ์</p>
        </div>
        {loading ? <span className="muted staff-hub-loading">โหลด…</span> : null}
      </header>

      <nav className="staff-hub-tabs" aria-label="ส่วนจัดการพนักงาน">
        {(
          [
            ["team", "ทีม"],
            ["accounts", "บัญชี"],
            ["levels", "ลำดับสิทธิ์"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`staff-hub-tab${tab === key ? " is-active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? <p className="error-text staff-hub-msg">{error}</p> : null}
      {success ? (
        <p className="success-text staff-hub-msg" role="status">
          {success}
        </p>
      ) : null}

      <StaffReadinessEditModal
        target={editTarget}
        employees={employees}
        levels={levels}
        busy={busy}
        hideElevated={!isOwner}
        onClose={() => setEditTarget(null)}
        onSave={saveReadinessEdit}
      />

      {tab === "team" ? (
        <>
          <StaffReadinessTable
            members={members}
            employees={employees}
            personalByStaffId={personalMap}
            ownerView={isOwner}
            busy={busy}
            onEditRow={openReadinessEdit}
          />

          <section className="staff-hub-panel">
            <div className="staff-hub-panel-head">
              <div>
                <h2 className="staff-hub-panel-title">รายชื่อร้าน</h2>
                <p className="staff-hub-panel-hint">ใช้ตอนผลิต / ชง / เชื่อมบัญชี</p>
              </div>
            </div>
            <form className="staff-compact-form staff-inline-add" onSubmit={(e) => void onAddEmployee(e)}>
              <input
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                placeholder="ชื่อ"
                required
                aria-label="ชื่อ"
              />
              <input
                value={empNickname}
                onChange={(e) => setEmpNickname(e.target.value)}
                placeholder="ชื่อเล่น"
                maxLength={12}
                aria-label="ชื่อเล่น"
              />
              <button type="submit" className="primary-btn staff-btn-sm" disabled={busy}>
                เพิ่ม
              </button>
            </form>
            <div className="list-card staff-compact-list">
              {employees.length === 0 ? (
                <p className="muted staff-empty">ยังไม่มีรายชื่อ</p>
              ) : (
                employees.map((emp) => (
                  <EmployeeRosterRow
                    key={emp.id}
                    emp={emp}
                    busy={busy}
                    onError={setError}
                    onReload={() => reload().then(() => undefined)}
                    onPatchLocal={(id, patch) => {
                      setEmployees((prev) =>
                        prev
                          .map((row) => (row.id === id ? { ...row, ...patch } : row))
                          .sort((a, b) => a.name.localeCompare(b.name, "th")),
                      );
                    }}
                    onDelete={() => void onDeleteEmployee(emp)}
                  />
                ))
              )}
            </div>
          </section>
        </>
      ) : null}

      {tab === "accounts" ? (
        <section className="staff-hub-panel">
          <div className="staff-hub-panel-head">
            <div>
              <h2 className="staff-hub-panel-title">บัญชีเข้าใช้</h2>
              <p className="staff-hub-panel-hint">อีเมลหรือเบอร์ + ลำดับสิทธิ์ + เชื่อมชื่อ</p>
            </div>
          </div>
          <form className="staff-compact-form" onSubmit={(e) => void onSubmitAccount(e)}>
            <div className="staff-compact-form-grid">
              <div className="field">
                <label htmlFor="email">อีเมล</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="staff@gmail.com"
                />
              </div>
              <div className="field">
                <label htmlFor="phone">เบอร์</label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0812345678"
                />
              </div>
            </div>
            <div className="staff-compact-form-grid">
              <div className="field">
                <label htmlFor="link-employee">ชื่อในร้าน</label>
                <select
                  id="link-employee"
                  value={linkEmployeeId}
                  onChange={(e) => setLinkEmployeeId(e.target.value)}
                >
                  <option value="">— ยังไม่เชื่อม —</option>
                  {linkOptions.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="account-level">ลำดับสิทธิ์</label>
                <PermissionLevelSelect
                  id="account-level"
                  levels={levels}
                  value={levelId}
                  onChange={applyLevel}
                  disabled={busy}
                  hideElevated={!isOwner}
                  allowEmpty
                />
              </div>
            </div>
            <div className="staff-perm-toggle-row">
              <button
                type="button"
                className="ghost-btn staff-btn-sm"
                disabled={busy}
                onClick={() => setShowCustomPerms((v) => !v)}
              >
                {showCustomPerms ? "ซ่อนติ๊กสิทธิ์" : "ปรับสิทธิ์รายข้อ"}
              </button>
              <button type="submit" className="primary-btn staff-btn-sm" disabled={busy}>
                {busy ? "..." : "บันทึกบัญชี"}
              </button>
            </div>
            {showCustomPerms ? (
              <PermissionPicker
                value={perms}
                onChange={setPerms}
                disabled={busy}
                hideElevated={!isOwner}
                compact
              />
            ) : null}
          </form>

          <div className="list-card staff-compact-list" style={{ marginTop: "0.75rem" }}>
            {members.map((member) => {
              const isSelf = member.id === staff!.id;
              const editing = editingStaffId === member.id;
              const memberPerms = normalizePermissions(member.permissions, member.role);
              const level = findLevel(levels, member.permissionLevelId);
              const levelLabel =
                member.role === "owner"
                  ? "เจ้าของ"
                  : level?.name || (member.permissionsCustomized ? "กำหนดเอง" : "—");
              return (
                <div key={member.id} className="staff-account-row">
                  <div className="staff-account-main">
                    <div className="staff-level-name-row">
                      <strong>{staffAccountLabel(member)}</strong>
                      <span className="staff-chip is-soft">{levelLabel}</span>
                      {member.permissionsCustomized ? (
                        <span className="staff-chip is-muted">ปรับเอง</span>
                      ) : null}
                    </div>
                    <div className="muted staff-level-meta">
                      {member.role === "owner" ? "เจ้าของ" : "พนักงาน"}
                      {member.email && member.phone
                        ? ` · ${formatPhoneDisplay(member.phone)}`
                        : ""}
                      {member.role === "staff"
                        ? ` · ${memberLinkLabel(member, employees)}`
                        : member.displayName
                          ? ` · ${member.displayName}`
                          : ""}
                    </div>
                  </div>
                  <div className="staff-level-actions">
                    {isOwner && member.role === "staff" ? (
                      <StaffPersonalInfoButton member={member} />
                    ) : null}
                    {member.role === "staff" ? (
                      <button
                        type="button"
                        className="ghost-btn staff-btn-sm"
                        onClick={() => setEditingStaffId(editing ? null : member.id)}
                      >
                        {editing ? "ปิด" : "สิทธิ์"}
                      </button>
                    ) : null}
                    {!isSelf ? (
                      <button
                        type="button"
                        className="ghost-btn staff-btn-sm is-danger"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`ลบ ${staffAccountLabel(member)}?`)) return;
                          setBusy(true);
                          void removeStaffById(member.id)
                            .then(reload)
                            .then(refreshStaff)
                            .catch((err) => setError(err.message || "ลบไม่สำเร็จ"))
                            .finally(() => setBusy(false));
                        }}
                      >
                        ลบ
                      </button>
                    ) : (
                      <span className="muted">คุณ</span>
                    )}
                  </div>
                  {editing ? (
                    <MemberPermEditor
                      initial={memberPerms}
                      initialLevelId={member.permissionLevelId || ""}
                      levels={levels}
                      busy={busy}
                      hideElevated={!isOwner}
                      onSave={(next, nextLevelId, customized) =>
                        void saveMemberPerms(member, next, nextLevelId, customized)
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {tab === "levels" ? (
        <PermissionLevelsPanel
          levels={levels}
          isOwner={!!isOwner}
          busy={busy}
          setBusy={setBusy}
          onError={setError}
          onSuccess={setSuccess}
          onReload={() => reload().then(() => undefined)}
          linkedCountByLevelId={linkedCountByLevelId}
        />
      ) : null}
    </div>
  );
}

function EmployeeRosterRow({
  emp,
  busy,
  onError,
  onReload,
  onPatchLocal,
  onDelete,
}: {
  emp: Employee;
  busy: boolean;
  onError: (msg: string) => void;
  onReload: () => Promise<void>;
  onPatchLocal: (id: string, patch: Partial<Employee>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
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
    if (!editing) {
      setName(emp.name);
      setNickname(emp.nickname || "");
      setMonthlySalary(
        emp.monthlySalary != null && emp.monthlySalary > 0 ? String(emp.monthlySalary) : "",
      );
      setPayBank(emp.payBank || "");
      setPayAccountNo(emp.payAccountNo || "");
      setPayAccountName(emp.payAccountName || "");
    }
  }, [
    emp.name,
    emp.nickname,
    emp.monthlySalary,
    emp.payBank,
    emp.payAccountNo,
    emp.payAccountName,
    editing,
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
      setEditing(false);
      await onReload();
    } catch (err) {
      onError((err as Error).message || "อัปเดตไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="employee-roster-row">
      <div className="employee-roster-main">
        {editing ? (
          <div className="employee-roster-edit">
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
          </div>
        ) : (
          <>
            <strong>
              {emp.name}
              {emp.nickname ? (
                <span className="employee-roster-nick"> · {emp.nickname}</span>
              ) : null}
            </strong>
            <div className="muted employee-roster-meta">
              {emp.active ? "ใช้" : "ปิด"} · {rosterLinkLabel(emp)}
              {emp.monthlySalary && emp.monthlySalary > 0
                ? ` · ฿${emp.monthlySalary.toLocaleString("th-TH")}`
                : ""}
            </div>
          </>
        )}
      </div>
      <div className="employee-roster-actions">
        {editing ? (
          <>
            <button
              type="button"
              className="primary-btn staff-btn-sm"
              disabled={saving || busy}
              onClick={() => void saveEdit()}
            >
              {saving ? "..." : "บันทึก"}
            </button>
            <button
              type="button"
              className="ghost-btn staff-btn-sm"
              disabled={saving || busy}
              onClick={() => setEditing(false)}
            >
              ยกเลิก
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ghost-btn staff-btn-sm"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            แก้
          </button>
        )}
        <button
          type="button"
          className="ghost-btn staff-btn-sm"
          disabled={busy || editing}
          onClick={() =>
            void updateEmployee(emp.id, { active: !emp.active })
              .then(onReload)
              .catch((err) => onError(err.message || "อัปเดตไม่สำเร็จ"))
          }
        >
          {emp.active ? "ปิด" : "เปิด"}
        </button>
        <button
          type="button"
          className="ghost-btn icon-btn staff-btn-sm"
          aria-label={`ลบ ${emp.name}`}
          disabled={busy || editing}
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
      </div>
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
    <div className="permission-editor">
      <div className="field" style={{ marginBottom: "0.4rem" }}>
        <label htmlFor={`member-level-${initialLevelId || "x"}`}>ลำดับสิทธิ์</label>
        <PermissionLevelSelect
          id={`member-level-${initialLevelId || "x"}`}
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
          บันทึก
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
