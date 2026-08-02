"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PermissionPicker } from "@/components/PermissionPicker";
import { PermissionLevelSelect } from "@/components/PermissionLevelSelect";
import { employeesForLink } from "@/lib/employees";
import type { Employee } from "@/lib/employees";
import {
  defaultAssignableLevelId,
  findLevel,
  permissionsMatchLevel,
} from "@/lib/permission-levels";
import {
  DEFAULT_STAFF_PERMISSIONS,
  normalizePermissions,
  type StaffPermissions,
} from "@/lib/permissions";
import type { PermissionLevel, StaffMember } from "@/lib/types";
import type { StaffReadinessRow } from "@/lib/staff-readiness";

export type StaffReadinessEditTarget =
  | { row: StaffReadinessRow; member?: StaffMember }
  | null;

type Props = {
  target: StaffReadinessEditTarget;
  employees: Employee[];
  levels: PermissionLevel[];
  busy: boolean;
  hideElevated?: boolean;
  onClose: () => void;
  onSave: (input: {
    email: string;
    phone: string;
    linkEmployeeId: string;
    permissions: StaffPermissions;
    permissionLevelId: string | null;
    permissionsCustomized: boolean;
  }) => Promise<void>;
};

export function StaffReadinessEditModal({
  target,
  employees,
  levels,
  busy,
  hideElevated = false,
  onClose,
  onSave,
}: Props) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkEmployeeId, setLinkEmployeeId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [perms, setPerms] = useState<StaffPermissions>({ ...DEFAULT_STAFF_PERMISSIONS });
  const [showCustomPerms, setShowCustomPerms] = useState(false);

  const row = target?.row;
  const member = target?.member;
  const isCreate = row?.kind === "roster-only";
  const staffId = row?.staffId;
  const linkOptions = employeesForLink(employees, staffId);

  useEffect(() => {
    if (!row) return;
    if (member) {
      setEmail(member.email || "");
      setPhone(member.phone || "");
      const nextPerms = normalizePermissions(member.permissions, member.role);
      setPerms(nextPerms);
      const linked =
        member.permissionLevelId ||
        (member.permissionsCustomized ? "" : defaultAssignableLevelId(levels));
      setLevelId(linked);
      const level = findLevel(levels, linked);
      setShowCustomPerms(
        !!member.permissionsCustomized ||
          (!!level && !permissionsMatchLevel(nextPerms, level)) ||
          !linked,
      );
      setLinkEmployeeId(member.employeeId || row.employeeId || "");
    } else {
      setEmail("");
      setPhone("");
      const def = defaultAssignableLevelId(levels);
      setLevelId(def);
      const level = findLevel(levels, def);
      setPerms(level ? { ...level.permissions } : { ...DEFAULT_STAFF_PERMISSIONS });
      setShowCustomPerms(false);
      setLinkEmployeeId(row.employeeId || "");
    }
  }, [row, member, levels]);

  if (!row) return null;

  const title = isCreate
    ? `สร้างบัญชี — ${row.rosterName}`
    : member
      ? `แก้ไข — ${row.accountLabel}`
      : "แก้ไขบัญชี";

  function applyLevel(nextId: string) {
    setLevelId(nextId);
    const level = findLevel(levels, nextId);
    if (level) {
      setPerms({ ...level.permissions });
      setShowCustomPerms(false);
    } else {
      setShowCustomPerms(true);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const level = findLevel(levels, levelId);
    const customized =
      !level || showCustomPerms || !permissionsMatchLevel(perms, level);
    await onSave({
      email,
      phone,
      linkEmployeeId,
      permissions: perms,
      permissionLevelId: levelId || null,
      permissionsCustomized: customized,
    });
  }

  return (
    <div className="modal-backdrop profile-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card profile-modal-card staff-readiness-edit-card"
        role="dialog"
        aria-labelledby="staff-readiness-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="staff-readiness-edit-title" className="staff-hub-panel-title">
          {title}
        </h2>
        <p className="staff-hub-panel-hint" style={{ marginBottom: "0.65rem" }}>
          {isCreate ? "อีเมลหรือเบอร์ + ลำดับสิทธิ์" : "แก้บัญชี / ชื่อที่เชื่อม / สิทธิ์"}
        </p>

        <form className="entry-form staff-compact-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="staff-compact-form-grid">
            <div className="field">
              <label htmlFor="readiness-email">อีเมล</label>
              <input
                id="readiness-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@gmail.com"
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="readiness-phone">เบอร์</label>
              <input
                id="readiness-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0812345678"
                disabled={busy}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="readiness-link">ชื่อในร้าน</label>
            <select
              id="readiness-link"
              value={linkEmployeeId}
              onChange={(e) => setLinkEmployeeId(e.target.value)}
              disabled={busy}
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
            <label htmlFor="readiness-level">ลำดับสิทธิ์</label>
            <PermissionLevelSelect
              id="readiness-level"
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
              onClick={() => setShowCustomPerms((v) => !v)}
            >
              {showCustomPerms ? "ซ่อนติ๊กสิทธิ์" : "ปรับสิทธิ์รายข้อ"}
            </button>
          </div>
          {showCustomPerms ? (
            <div className="field field-permissions">
              <PermissionPicker
                value={perms}
                onChange={setPerms}
                disabled={busy}
                hideElevated={hideElevated}
                compact
              />
            </div>
          ) : null}
          <div className="btn-row staff-compact-actions" style={{ marginTop: "0.5rem" }}>
            <button type="button" className="ghost-btn staff-btn-sm" onClick={onClose} disabled={busy}>
              ยกเลิก
            </button>
            <button type="submit" className="primary-btn staff-btn-sm" disabled={busy}>
              {busy ? "..." : "บันทึก"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
