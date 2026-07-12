"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PermissionPicker } from "@/components/PermissionPicker";
import { employeesForLink } from "@/lib/employees";
import type { Employee } from "@/lib/employees";
import {
  DEFAULT_STAFF_PERMISSIONS,
  normalizePermissions,
  type StaffPermissions,
} from "@/lib/permissions";
import type { StaffMember } from "@/lib/types";
import type { StaffReadinessRow } from "@/lib/staff-readiness";

export type StaffReadinessEditTarget =
  | { row: StaffReadinessRow; member?: StaffMember }
  | null;

type Props = {
  target: StaffReadinessEditTarget;
  employees: Employee[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: {
    email: string;
    phone: string;
    linkEmployeeId: string;
    permissions: StaffPermissions;
  }) => Promise<void>;
};

export function StaffReadinessEditModal({
  target,
  employees,
  busy,
  onClose,
  onSave,
}: Props) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkEmployeeId, setLinkEmployeeId] = useState("");
  const [perms, setPerms] = useState<StaffPermissions>({ ...DEFAULT_STAFF_PERMISSIONS });

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
      setPerms(normalizePermissions(member.permissions, member.role));
      setLinkEmployeeId(member.employeeId || row.employeeId || "");
    } else {
      setEmail("");
      setPhone("");
      setPerms({ ...DEFAULT_STAFF_PERMISSIONS });
      setLinkEmployeeId(row.employeeId || "");
    }
  }, [row, member]);

  if (!row) return null;

  const title = isCreate
    ? `สร้างบัญชี — ${row.rosterName}`
    : member
      ? `แก้ไขบัญชี — ${row.accountLabel}`
      : "แก้ไขบัญชี";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await onSave({ email, phone, linkEmployeeId, permissions: perms });
  }

  return (
    <div className="modal-backdrop profile-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card profile-modal-card staff-readiness-edit-card"
        role="dialog"
        aria-labelledby="staff-readiness-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="staff-readiness-edit-title" className="panel-title" style={{ fontSize: "1.05rem" }}>
          {title}
        </h2>
        <p className="muted" style={{ textAlign: "left", margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
          {isCreate
            ? "ใส่อีเมลหรือเบอร์โทร แล้วบันทึก — ชื่อในร้านเชื่อมให้แล้ว"
            : row.missing.includes("ชื่อในร้าน")
              ? "เลือกชื่อในร้านเพื่อเชื่อมบัญชีนี้"
              : "แก้ไขบัญชีหรือชื่อที่เชื่อมได้"}
        </p>

        <form className="entry-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="field">
            <label htmlFor="readiness-email">อีเมล Google</label>
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
            <label htmlFor="readiness-phone">เบอร์โทร</label>
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
          <div className="field field-permissions">
            <span className="field-label">สิทธิ์การใช้งาน</span>
            <PermissionPicker value={perms} onChange={setPerms} disabled={busy} />
          </div>
          <div className="btn-row" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
              ยกเลิก
            </button>
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
