"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { PermissionPicker } from "@/components/PermissionPicker";
import { useAuth } from "@/lib/auth";
import {
  addEmployee,
  deleteEmployee,
  listEmployees,
  updateEmployee,
  type Employee,
} from "@/lib/employees";
import { listStaff, removeStaff, updateStaffProfile, upsertStaff } from "@/lib/staff";
import type { StaffMember, StaffRole } from "@/lib/types";
import {
  DEFAULT_STAFF_PERMISSIONS,
  can,
  normalizePermissions,
  type StaffPermissions,
} from "@/lib/permissions";
import { normalizeEmail, formatPlainNumber } from "@/lib/utils";
import { Trash2 } from "lucide-react";

export default function StaffPage() {
  return (
    <AuthGate>
      <StaffView />
    </AuthGate>
  );
}

function StaffView() {
  const { staff, refreshStaff } = useAuth();
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [empName, setEmpName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [perms, setPerms] = useState<StaffPermissions>({ ...DEFAULT_STAFF_PERMISSIONS });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);

  async function reload() {
    const [emps, staffList] = await Promise.all([listEmployees(), listStaff()]);
    setEmployees(emps);
    setMembers(staffList);
  }

  useEffect(() => {
    if (staff && !can(staff, "staffManage")) {
      router.replace("/ledger/");
      return;
    }
    void reload().catch((err) => setError(err.message || "โหลดพนักงานไม่สำเร็จ"));
  }, [staff, router]);

  async function onAddEmployee(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addEmployee(empName);
      setEmpName("");
      await reload();
    } catch (err) {
      setError((err as Error).message || "เพิ่มชื่อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitAccount(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await upsertStaff(email, role, role === "owner" ? undefined : perms);
      setEmail("");
      setRole("staff");
      setPerms({ ...DEFAULT_STAFF_PERMISSIONS });
      await reload();
      await refreshStaff();
    } catch (err) {
      setError((err as Error).message || "บันทึกบัญชีไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteEmployee(emp: Employee) {
    const msg = emp.linkedEmail
      ? `ลบ "${emp.name}"? บัญชี ${emp.linkedEmail} จะต้องตั้งโปรไฟล์ใหม่`
      : `ลบ "${emp.name}" จากรายชื่อร้าน?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setError(null);
    try {
      if (emp.linkedEmail) {
        await updateStaffProfile(emp.linkedEmail, {
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
      await upsertStaff(member.email, member.role, next, member.displayName);
      await reload();
      await refreshStaff();
      setEditingEmail(null);
    } catch (err) {
      setError((err as Error).message || "บันทึกสิทธิ์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!can(staff, "staffManage")) return null;

  return (
    <div>
      <h1 className="panel-title">ศูนย์รวมพนักงาน</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        เพิ่มชื่อพนักงานที่นี่ที่เดียว — รายชื่อจะไปโชว์ในหมวดผลิต, OT และหมวดอื่นที่เชื่อมต่อ
      </p>
      {error ? <p className="error-text">{error}</p> : null}

      <section className="staff-hub-section">
        <h2 className="panel-title" style={{ fontSize: "1.05rem" }}>รายชื่อพนักงานร้าน</h2>
        <p className="muted" style={{ textAlign: "left", marginBottom: "0.65rem", fontSize: "0.85rem" }}>
          ใช้เลือกตอนกรอกผลิต / OT · พนักงานเชื่อมบัญชีเองที่หน้าโปรไฟล์
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
                onReload={reload}
                onDelete={() => void onDeleteEmployee(emp)}
              />
            ))
          )}
        </div>
      </section>

      <section className="staff-hub-section" style={{ marginTop: "1.5rem" }}>
        <h2 className="panel-title" style={{ fontSize: "1.05rem" }}>บัญชีเข้าใช้ระบบ</h2>
        <p className="muted" style={{ textAlign: "left", marginBottom: "0.65rem", fontSize: "0.85rem" }}>
          อีเมล Google ที่ล็อกอินได้ + สิทธิ์หน้าจอ
        </p>
        <form className="form-card entry-form" onSubmit={(e) => void onSubmitAccount(e)}>
          <div className="field">
            <label htmlFor="email">อีเมล Google</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@gmail.com"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="role">บทบาท</label>
            <select
              id="role"
              value={role}
              onChange={(e) => {
                const next = e.target.value as StaffRole;
                setRole(next);
                setPerms(normalizePermissions(null, next));
              }}
            >
              <option value="staff">พนักงาน</option>
              <option value="owner">เจ้าของ</option>
            </select>
          </div>
          {role === "staff" ? (
            <div className="field">
              <span className="field-label">สิทธิ์การใช้งาน</span>
              <PermissionPicker value={perms} onChange={setPerms} disabled={busy} />
            </div>
          ) : (
            <p className="muted" style={{ textAlign: "left", margin: 0 }}>
              เจ้าของใช้ได้ทุกหน้าโดยอัตโนมัติ
            </p>
          )}
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "เพิ่ม / อัปเดตบัญชี"}
          </button>
        </form>

        <div className="list-card" style={{ marginTop: "1rem" }}>
          {members.map((member) => {
            const isSelf = normalizeEmail(member.email) === normalizeEmail(staff!.email);
            const editing = editingEmail === member.email;
            const memberPerms = normalizePermissions(member.permissions, member.role);
            return (
              <div key={member.email} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.55rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
                  <div>
                    <strong>{member.email}</strong>
                    <div className="muted">
                      {member.role === "owner" ? "เจ้าของ" : "พนักงาน"}
                      {member.displayName ? ` · ${member.displayName}` : " · ยังไม่ตั้งโปรไฟล์"}
                      {member.profileComplete ? " ✓" : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.35rem" }}>
                    {member.role === "staff" ? (
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setEditingEmail(editing ? null : member.email)}
                      >
                        {editing ? "ปิด" : "สิทธิ์"}
                      </button>
                    ) : null}
                    {!isSelf ? (
                      <button
                        type="button"
                        className="danger-btn"
                        onClick={() =>
                          void removeStaff(member.email)
                            .then(reload)
                            .catch((err) => setError(err.message || "ลบไม่สำเร็จ"))
                        }
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
  const [rate, setRate] = useState(emp.unitRate != null ? String(emp.unitRate) : "");

  useEffect(() => {
    setRate(emp.unitRate != null ? String(emp.unitRate) : "");
  }, [emp.unitRate]);

  async function saveRate() {
    const n = rate.trim() === "" ? null : Number(rate);
    if (n != null && (!Number.isFinite(n) || n < 0)) {
      onError("เรทไม่ถูกต้อง");
      return;
    }
    try {
      await updateEmployee(emp.id, { unitRate: n ?? undefined });
      await onReload();
    } catch (err) {
      onError((err as Error).message || "บันทึกเรทไม่สำเร็จ");
    }
  }

  return (
    <div className="employee-roster-row">
      <div className="employee-roster-main">
        <strong>{emp.name}</strong>
        <div className="muted employee-roster-meta">
          {emp.active ? "ใช้งาน" : "ปิดใช้"}
          {emp.linkedEmail ? ` · เชื่อม ${emp.linkedEmail}` : " · ยังไม่มีบัญชีเชื่อม"}
          {emp.unitRate != null ? ` · เรท ${formatPlainNumber(emp.unitRate)}` : ""}
        </div>
        <div className="employee-roster-rate">
          <label htmlFor={`rate-${emp.id}`}>เรท/ค่า (ลบได้)</label>
          <div className="employee-roster-rate-row">
            <input
              id={`rate-${emp.id}`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={rate}
              placeholder="—"
              onChange={(e) => setRate(e.target.value)}
            />
            <button type="button" className="ghost-btn" disabled={busy} onClick={() => void saveRate()}>
              บันทึก
            </button>
            {rate ? (
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => {
                  setRate("");
                  void updateEmployee(emp.id, { unitRate: undefined })
                    .then(onReload)
                    .catch((err) => onError(err.message || "ลบเรทไม่สำเร็จ"));
                }}
              >
                ลบเรท
              </button>
            ) : null}
          </div>
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
