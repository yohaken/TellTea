"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { PermissionPicker } from "@/components/PermissionPicker";
import { PermissionLevelSelect } from "@/components/PermissionLevelSelect";
import { PermissionLevelsPanel } from "@/components/PermissionLevelsPanel";
import { useAuth } from "@/lib/auth";
import {
  addEmployee,
  deleteEmployee,
  employeesForLink,
  listEmployeesWithPay,
  migrateAllLegacyEmployeePay,
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
  type StaffPermissions,
} from "@/lib/permissions";
import {
  defaultAssignableLevelId,
  ensurePermissionLevelSeeds,
  findLevel,
  isOwnerSystemLevel,
  permissionsMatchLevel,
} from "@/lib/permission-levels";
import {
  PERM_PREVIEW_CHECKLIST,
  previewFromLevel,
  previewFromMember,
} from "@/lib/perm-preview";
import { staffHomeHref } from "@/lib/nav-menu";
import { staffAccountLabel } from "@/lib/utils";
import { mapFirestoreError } from "@/lib/firestore-errors";
import { StaffTeamMiniTable } from "@/components/StaffTeamMiniTable";
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
      <Suspense
        fallback={
          <p className="muted" style={{ textAlign: "left" }}>
            กำลังโหลด...
          </p>
        }
      >
        <StaffView />
      </Suspense>
    </AuthGate>
  );
}

function useAccountFocusParam() {
  const searchParams = useSearchParams();
  return searchParams.get("account")?.trim() || "";
}

function StaffView() {
  const { realStaff, refreshStaff, startPermPreview, permissionLevels } = useAuth();
  const router = useRouter();
  const focusAccountId = useAccountFocusParam();
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
  const [showPreviewCheck, setShowPreviewCheck] = useState(false);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [showLevels, setShowLevels] = useState(false);

  const linkOptions = employeesForLink(employees);
  const staff = realStaff;
  const isOwner = staff?.role === "owner";
  const canManageStaff = can(staff, "staffManage");

  function beginPreviewFromLevel(level: PermissionLevel) {
    if (!isOwner || isOwnerSystemLevel(level)) return;
    const preview = previewFromLevel(level);
    startPermPreview(preview);
    router.replace(staffHomeHref({
      id: staff!.id,
      role: "staff",
      permissions: preview.permissions,
      createdAt: staff!.createdAt,
    }));
  }

  function beginPreviewFromMember(member: StaffMember) {
    if (!isOwner || member.role !== "staff") return;
    const emp = member.employeeId
      ? employees.find((e) => e.id === member.employeeId)
      : employees.find((e) => e.linkedStaffId === member.id);
    const preview = previewFromMember(
      member,
      undefined,
      permissionLevels,
      emp?.id,
    );
    startPermPreview(preview);
    router.replace(staffHomeHref({
      id: staff!.id,
      role: "staff",
      permissions: preview.permissions,
      createdAt: staff!.createdAt,
    }));
  }

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
    if (!focusAccountId || loading) return;
    if (!members.some((m) => m.id === focusAccountId && m.role === "staff")) return;
    setEditingStaffId(focusAccountId);
    const el = document.getElementById("staff-team");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusAccountId, loading, members]);

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
      setShowCreateAccount(false);
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
          <h1 className="staff-hub-title">ทีม</h1>
          <p className="staff-hub-sub">ชื่อ · บัญชี · ลำดับสิทธิ์</p>
        </div>
        <div className="staff-hub-head-actions">
          {isOwner ? (
            <button
              type="button"
              className="ghost-btn staff-btn-sm"
              onClick={() => setShowPreviewCheck((v) => !v)}
            >
              {showPreviewCheck ? "ซ่อนเช็ค" : "เช็คมุมมอง"}
            </button>
          ) : null}
          {loading ? <span className="muted staff-hub-loading">โหลด…</span> : null}
        </div>
      </header>

      {isOwner && showPreviewCheck ? (
        <section className="staff-hub-panel staff-preview-check">
          <h2 className="staff-hub-panel-title">เช็คมุมมองพนักงาน</h2>
          <p className="staff-hub-panel-hint">
            กด «ดูแบบนี้» ที่ลำดับ หรือ «ดูแบบเขา» ที่บัญชี — เมนูจะเปลี่ยนตามสิทธิ์ · แถบส้มกดออกกลับเจ้าของ
          </p>
          <ol className="staff-preview-check-list">
            {PERM_PREVIEW_CHECKLIST.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>
      ) : null}

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

      <div id="staff-team" className="staff-hub-anchor">
        <StaffTeamMiniTable
          members={members}
          employees={employees}
          levels={levels}
          personalByStaffId={personalMap}
          ownerView={isOwner}
          busy={busy}
          empName={empName}
          empNickname={empNickname}
          onEmpNameChange={setEmpName}
          onEmpNicknameChange={setEmpNickname}
          onAddEmployee={(e) => void onAddEmployee(e)}
          onEditAccount={openReadinessEdit}
          onDeleteEmployee={(emp) => void onDeleteEmployee(emp)}
          onDeleteAccount={(member) => {
            if (!window.confirm(`ลบบัญชี ${staffAccountLabel(member)}?`)) return;
            setBusy(true);
            void removeStaffById(member.id)
              .then(reload)
              .then(refreshStaff)
              .catch((err) => setError(err.message || "ลบไม่สำเร็จ"))
              .finally(() => setBusy(false));
          }}
          onPreviewMember={isOwner ? beginPreviewFromMember : undefined}
          onSaveMemberPerms={(member, next, nextLevelId, customized) =>
            void saveMemberPerms(member, next, nextLevelId, customized)
          }
          selfStaffId={staff?.id || ""}
          focusStaffId={editingStaffId || ""}
          hideElevated={!isOwner}
          onError={setError}
          onReload={() => reload().then(() => undefined)}
          onPatchEmployeeLocal={(id, patch) => {
            setEmployees((prev) =>
              prev
                .map((row) => (row.id === id ? { ...row, ...patch } : row))
                .sort((a, b) => a.name.localeCompare(b.name, "th")),
            );
          }}
        />
      </div>

      <section id="staff-accounts" className="staff-hub-panel staff-hub-anchor">
          <div className="staff-hub-panel-head staff-create-head">
            <div>
              <h2 className="staff-hub-panel-title">บัญชี</h2>
              <p className="staff-hub-panel-hint">แก้/ลบที่ตารางทีม ▾</p>
            </div>
            <button
              type="button"
              className="ghost-btn staff-btn-sm"
              disabled={busy}
              aria-expanded={showCreateAccount}
              onClick={() => setShowCreateAccount((v) => !v)}
            >
              {showCreateAccount ? "ซ่อนฟอร์ม" : "+บัญชี"}
            </button>
          </div>

          {showCreateAccount ? (
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
                  {showCustomPerms ? "ซ่อนติ๊ก" : "ติ๊กสิทธิ์"}
                </button>
                <button type="submit" className="primary-btn staff-btn-sm" disabled={busy}>
                  {busy ? "..." : "สร้าง"}
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
          ) : null}

          {(() => {
            const owner = members.find((m) => m.role === "owner");
            if (!owner) return null;
            return (
              <div className="staff-owner-card muted">
                <strong>{staffAccountLabel(owner)}</strong>
                <span> · เจ้าของ</span>
                {owner.id === staff?.id ? <span> · คุณ</span> : null}
              </div>
            );
          })()}
        </section>

      <section id="staff-levels" className="staff-hub-panel staff-hub-anchor">
        <div className="staff-hub-panel-head staff-create-head">
          <div>
            <h2 className="staff-hub-panel-title">ลำดับสิทธิ์</h2>
            <p className="staff-hub-panel-hint">{levels.length} แม่แบบ</p>
          </div>
          <button
            type="button"
            className="ghost-btn staff-btn-sm"
            disabled={busy}
            aria-expanded={showLevels}
            onClick={() => setShowLevels((v) => !v)}
          >
            {showLevels ? "ซ่อน" : "เปิด"}
          </button>
        </div>
        {showLevels ? (
          <PermissionLevelsPanel
            levels={levels}
            isOwner={!!isOwner}
            busy={busy}
            setBusy={setBusy}
            onError={setError}
            onSuccess={setSuccess}
            onReload={() => reload().then(() => undefined)}
            linkedCountByLevelId={linkedCountByLevelId}
            onPreviewLevel={isOwner ? beginPreviewFromLevel : undefined}
            embedded
          />
        ) : null}
      </section>
    </div>
  );
}

