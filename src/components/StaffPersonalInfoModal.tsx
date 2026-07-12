"use client";

import { useState } from "react";
import { personalProfileLabel } from "@/lib/profile";
import { getStaffPersonal } from "@/lib/staff-personal";
import type { StaffMember, StaffPersonalData } from "@/lib/types";
import { staffAccountLabel } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

export function StaffPersonalInfoModal({
  member,
  personal,
  onClose,
}: {
  member: StaffMember;
  personal: StaffPersonalData | null;
  onClose: () => void;
}) {
  useBodyScrollLock(true);
  const legalName = personalProfileLabel({ ...member, personal: personal || undefined });

  return (
    <div className="modal-backdrop profile-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card profile-modal-card staff-personal-info-card"
        role="dialog"
        aria-modal="true"
        aria-label="ข้อมูลส่วนตัวพนักงาน"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="panel-title">ข้อมูลส่วนตัวพนักงาน</h2>
        <p className="muted" style={{ textAlign: "left", margin: "0 0 0.75rem" }}>
          บัญชี: <strong>{staffAccountLabel(member)}</strong>
        </p>
        {legalName ? (
          <p className="muted" style={{ textAlign: "left", margin: "0 0 0.75rem" }}>
            ชื่อ-นามสกุล: <strong>{legalName}</strong>
          </p>
        ) : (
          <p className="muted" style={{ textAlign: "left" }}>ยังไม่กรอกข้อมูลส่วนตัว</p>
        )}
        {personal?.idCardPhotoUrl ? (
          <div className="staff-id-preview-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={personal.idCardPhotoUrl}
              alt="บัตรประชาชน"
              className="staff-id-preview"
            />
          </div>
        ) : (
          <p className="muted">ยังไม่มีรูปบัตรประชาชน</p>
        )}
        {personal?.personalDataConsentAt ? (
          <p className="muted form-hint-inline" style={{ marginTop: "0.65rem" }}>
            ยินยอมเก็บข้อมูลเมื่อ{" "}
            {new Date(personal.personalDataConsentAt).toLocaleString("th-TH", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        ) : null}
        <button type="button" className="primary-btn" style={{ marginTop: "0.75rem" }} onClick={onClose}>
          ปิด
        </button>
      </div>
    </div>
  );
}

export function StaffPersonalInfoButton({ member }: { member: StaffMember }) {
  const [open, setOpen] = useState(false);
  const [personal, setPersonal] = useState<StaffPersonalData | null>(null);
  const [loading, setLoading] = useState(false);

  if (member.role === "owner") return null;

  async function openModal() {
    setOpen(true);
    setLoading(true);
    try {
      setPersonal(await getStaffPersonal(member.id));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="ghost-btn" onClick={() => void openModal()} disabled={loading}>
        {loading ? "โหลด..." : member.personalProfileComplete ? "ดูบัตร ปชช." : "ยังไม่กรอก"}
      </button>
      {open ? (
        <StaffPersonalInfoModal
          member={member}
          personal={personal}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
