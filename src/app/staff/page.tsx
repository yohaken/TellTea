"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { PermissionPicker } from "@/components/PermissionPicker";
import { useAuth } from "@/lib/auth";
import {
  addEmployee,
  deleteEmployee,
  employeeLinkLabel,
  employeesForLink,
  listEmployees,
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
import type { StaffMember } from "@/lib/types";
import {
  DEFAULT_STAFF_PERMISSIONS,
  can,
  normalizePermissions,
  type StaffPermissions,
} from "@/lib/permissions";
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
  if (emp) return `→ ${emp.name} ✓`;
  if (member.profileComplete && member.displayName) return `→ ${member.displayName} ✓`;
  return "ยังไม่เชื่อมชื่อ";
}

function StaffView() {
  const { staff, refreshStaff } = useAuth();
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [empName, setEmpName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkEmployeeId, setLinkEmployeeId] = useState("");
  const [perms, setPerms] = useState<StaffPermissions>({ ...DEFAULT_STAFF_PERMISSIONS });
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

  async function reload(): Promise<{ employeesOk: boolean; staffOk: boolean }> {
    const errors: string[] = [];
    let emps: Employee[] = [];
    let staffList: StaffMember[] = [];
    let employeesOk = true;
    let staffOk = true;

    try {
      emps = await listEmployees();
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
      const id = await addEmployee(name);
      const now = Date.now();
      setEmployees((prev) => {
        if (prev.some((e) => e.id === id)) return prev;
        return [...prev, { id, name, active: true, createdAt: now, updatedAt: now }].sort((a, b) =>
          a.name.localeCompare(b.name, "th"),
        );
      });
      setEmpName("");
      setSuccess(`เพิ่ม "${name}" ในรายชื่อร้านแล้ว (ขั้นที่ 1) — ต่อไปสร้างบัญชีขั้นที่ 2`);
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
      setError("ใส่อีเมล Google หรือเบอร์โทรอย่างน้อยหนึ่งอย่าง");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const linkedName = linkEmployeeId
        ? employees.find((e) => e.id === linkEmployeeId)?.name
        : undefined;
      await upsertStaffWithLink({
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        role: "staff",
        permissions: perms,
        employeeId: linkEmployeeId || undefined,
      });
      const account = email.trim() || phone.trim();
      setEmail("");
      setPhone("");
      setLinkEmployeeId("");
      setPerms({ ...DEFAULT_STAFF_PERMISSIONS });
      setSuccess(
        linkedName
          ? `สร้างบัญชี ${account} และเชื่อม "${linkedName}" แล้ว`
          : `สร้างบัญชี ${account} แล้ว — ให้พนักงานเชื่อมชื่อที่โปรไฟล์ได้`,
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
      ? `ลบ "${emp.name}"? บัญชีที่เชื่อมจะต้องตั้งโปรไฟล์ใหม่`
      : `ลบ "${emp.name}" จากรายชื่อร้าน?`;
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

  async function saveMemberPerms(member: StaffMember, next: StaffPermissions) {
    setBusy(true);
    setError(null);
    try {
      await updateStaffPermissions(member.id, next);
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
  }) {
    const row = editTarget?.row;
    if (!row) return;
    if (!input.email.trim() && !input.phone.trim()) {
      setError("ใส่อีเมล Google หรือเบอร์โทรอย่างน้อยหนึ่งอย่าง");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const linkedName = input.linkEmployeeId
        ? employees.find((e) => e.id === input.linkEmployeeId)?.name
        : undefined;
      await upsertStaffWithLink({
        email: input.email.trim() || undefined,
        phone: input.phone.trim() || undefined,
        role: "staff",
        permissions: input.permissions,
        employeeId: input.linkEmployeeId || row.employeeId || undefined,
      });
      const account = input.email.trim() || input.phone.trim();
      setEditTarget(null);
      setSuccess(
        linkedName
          ? `บันทึก ${account} และเชื่อม "${linkedName}" แล้ว`
          : `บันทึกบัญชี ${account} แล้ว`,
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
    <div>
      <h1 className="panel-title">ศูนย์รวมพนักงาน</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        ขั้นที่ 1 เพิ่มชื่อในร้าน · ขั้นที่ 2 สร้างบัญชีและเชื่อมชื่อ (หรือให้พนักงานเชื่อมเองที่โปรไฟล์)
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      {success ? (
        <p className="success-text" role="status">
          {success}
        </p>
      ) : null}
      {loading ? (
        <p className="muted" style={{ textAlign: "left", marginBottom: "1rem" }}>
          กำลังโหลดรายชื่อ...
        </p>
      ) : null}

      {canManageStaff ? (
        <StaffReadinessTable
          members={members}
          employees={employees}
          personalByStaffId={personalMap}
          ownerView={isOwner}
          busy={busy}
          onEditRow={openReadinessEdit}
        />
      ) : null}

      <StaffReadinessEditModal
        target={editTarget}
        employees={employees}
        busy={busy}
        onClose={() => setEditTarget(null)}
        onSave={saveReadinessEdit}
      />

      <section className="staff-hub-section">
        <h2 className="panel-title" style={{ fontSize: "1.05rem" }}>
          ขั้นที่ 1 — รายชื่อพนักงานร้าน
        </h2>
        <p className="muted" style={{ textAlign: "left", marginBottom: "0.65rem", fontSize: "0.85rem" }}>
          ใช้เลือกตอนกรอกผลิต / ชง / เชื่อมบัญชี
        </p>
        <form className="form-card entry-form" onSubmit={(e) => void onAddEmployee(e)}>
          <div className="field">
            <label htmlFor="emp-name">ชื่อ</label>
            <input
              id="emp-name"
              value={empName}
              onChange={(e) => setEmpName(e.target.value)}
              placeholder="เช่น เป้, เตย"
              required
            />
          </div>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "เพิ่มชื่อ"}
          </button>
        </form>
        <div className="list-card" style={{ marginTop: "0.75rem" }}>
          {employees.length === 0 ? (
            <p className="muted" style={{ margin: "0.5rem 0", textAlign: "left" }}>ยังไม่มีรายชื่อ</p>
          ) : (
            employees.map((emp) => (
              <EmployeeRosterRow
                key={emp.id}
                emp={emp}
                busy={busy}
                onError={setError}
                onReload={() => reload().then(() => undefined)}
                onDelete={() => void onDeleteEmployee(emp)}
              />
            ))
          )}
        </div>
      </section>

      <section className="staff-hub-section" style={{ marginTop: "1.5rem" }}>
        <h2 className="panel-title" style={{ fontSize: "1.05rem" }}>
          ขั้นที่ 2 — บัญชีเข้าใช้ระบบ
        </h2>
        <p className="muted" style={{ textAlign: "left", marginBottom: "0.65rem", fontSize: "0.85rem" }}>
          อีเมล Google หรือเบอร์โทร (อย่างน้อยหนึ่งอย่าง) + สิทธิ์หน้าจอ · เลือกชื่อในร้านเพื่อเชื่อมทันที (ไม่บังคับ)
        </p>
        <form className="form-card entry-form" onSubmit={(e) => void onSubmitAccount(e)}>
          <div className="field">
            <label htmlFor="email">อีเมล Google (ถ้ามี)</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@gmail.com"
            />
          </div>
          <div className="field">
            <label htmlFor="phone">เบอร์โทร (ถ้ามี)</label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0812345678"
            />
          </div>
          <div className="field">
            <label htmlFor="link-employee">เชื่อมชื่อในร้าน (แนะนำ)</label>
            <select
              id="link-employee"
              value={linkEmployeeId}
              onChange={(e) => setLinkEmployeeId(e.target.value)}
            >
              <option value="">— ยังไม่เชื่อม / ให้พนักงานตั้งเอง —</option>
              {linkOptions.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-permissions">
            <span className="field-label">สิทธิ์การใช้งาน</span>
            <PermissionPicker value={perms} onChange={setPerms} disabled={busy} />
          </div>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "เพิ่ม / อัปเดตบัญชี"}
          </button>
        </form>

        <div className="list-card" style={{ marginTop: "1rem" }}>
          {members.map((member) => {
            const isSelf = member.id === staff!.id;
            const editing = editingStaffId === member.id;
            const memberPerms = normalizePermissions(member.permissions, member.role);
            return (
              <div key={member.id} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.55rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
                  <div>
                    <strong>{staffAccountLabel(member)}</strong>
                    <div className="muted">
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
                  <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    {isOwner && member.role === "staff" ? (
                      <StaffPersonalInfoButton member={member} />
                    ) : null}
                    {member.role === "staff" ? (
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setEditingStaffId(editing ? null : member.id)}
                      >
                        {editing ? "ปิด" : "สิทธิ์"}
                      </button>
                    ) : null}
                    {!isSelf ? (
                      <button
                        type="button"
                        className="danger-btn"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`ลบบัญชี ${staffAccountLabel(member)}?`)) return;
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
                </div>
                {editing ? (
                  <MemberPermEditor
                    initial={memberPerms}
                    busy={busy}
                    onSave={(next) => void saveMemberPerms(member, next)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function EmployeeRosterRow({
  emp,
  busy,
  onError,
  onReload,
  onDelete,
}: {
  emp: Employee;
  busy: boolean;
  onError: (msg: string) => void;
  onReload: () => Promise<void>;
  onDelete: () => void;
}) {
  return (
    <div className="employee-roster-row">
      <div className="employee-roster-main">
        <strong>{emp.name}</strong>
        <div className="muted employee-roster-meta">
          {emp.active ? "ใช้งาน" : "ปิดใช้"} · {rosterLinkLabel(emp)}
        </div>
      </div>
      <div className="employee-roster-actions">
        <button
          type="button"
          className="ghost-btn"
          disabled={busy}
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
          className="ghost-btn icon-btn"
          aria-label={`ลบ ${emp.name}`}
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function MemberPermEditor({
  initial,
  busy,
  onSave,
}: {
  initial: StaffPermissions;
  busy: boolean;
  onSave: (next: StaffPermissions) => void;
}) {
  const [perms, setPerms] = useState(initial);
  return (
    <div className="permission-editor">
      <PermissionPicker value={perms} onChange={setPerms} disabled={busy} />
      <button
        type="button"
        className="primary-btn"
        style={{ marginTop: "0.5rem" }}
        disabled={busy}
        onClick={() => onSave(perms)}
      >
        บันทึกสิทธิ์
      </button>
    </div>
  );
}
