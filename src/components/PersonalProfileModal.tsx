"use client";

import { useEffect, useState, type FormEvent } from "react";
import { IdCard } from "lucide-react";
import { usePathname } from "next/navigation";
import { PhotoAttachField } from "@/components/PhotoAttachField";
import { PersonalDataConsentField } from "@/components/PersonalDataConsentField";
import { useAuth } from "@/lib/auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { needsPersonalProfileSetup } from "@/lib/profile";
import { updateStaffProfile } from "@/lib/staff";
import { saveStaffPersonal } from "@/lib/staff-personal";
import { saveCachedStaff } from "@/lib/cache";

/** Modal reel — กรอกข้อมูลส่วนตัวครั้งแรก ปิดไม่ได้จนกว่าจะบันทึกครบ */
export function PersonalProfileModal() {
  const { staff, refreshStaff } = useAuth();
  const pathname = usePathname();
  const open =
    !!staff &&
    staff.role === "staff" &&
    needsPersonalProfileSetup(staff) &&
    !pathname.startsWith("/profile");

  const [legalFirstName, setLegalFirstName] = useState("");
  const [legalLastName, setLegalLastName] = useState("");
  const [idCardPhotoUrl, setIdCardPhotoUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!staff) return;
    setLegalFirstName(staff.personal?.legalFirstName || "");
    setLegalLastName(staff.personal?.legalLastName || "");
    setIdCardPhotoUrl(staff.personal?.idCardPhotoUrl || "");
    setConsent(!!staff.personal?.personalDataConsentAt);
  }, [staff]);

  if (!open) return null;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!staff) return;
    if (!legalFirstName.trim() || !legalLastName.trim()) {
      setError("ใส่ชื่อจริงและนามสกุล");
      return;
    }
    if (!idCardPhotoUrl.trim()) {
      setError("ถ่ายหรือแนบรูปบัตรประชาชน");
      return;
    }
    if (!consent) {
      setError("ต้องยินยอมการเก็บข้อมูลส่วนตัวก่อนบันทึก");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const personal = await saveStaffPersonal(staff.id, {
        legalFirstName: legalFirstName.trim(),
        legalLastName: legalLastName.trim(),
        idCardPhotoUrl,
        personalDataConsentAt: Date.now(),
      });
      const updated = await updateStaffProfile(staff.id, {
        personalProfileComplete: true,
      });
      const merged = { ...updated, personal };
      saveCachedStaff(merged);
      await refreshStaff();
    } catch (err) {
      setError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop profile-modal-backdrop"
      role="presentation"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="modal-card profile-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="profile-modal-head">
          <IdCard size={22} aria-hidden />
          <div>
            <h2 id="profile-modal-title" className="panel-title">
              กรอกข้อมูลส่วนตัว
            </h2>
            <p className="muted profile-modal-sub">
              ใช้งานได้ก่อน — กรอกให้ครบเพื่อปิดหน้าต่างนี้
            </p>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <form className="form-card entry-form profile-modal-form" onSubmit={(e) => void onSave(e)}>
          <div className="field">
            <label htmlFor="modal-legal-first">ชื่อจริง</label>
            <input
              id="modal-legal-first"
              value={legalFirstName}
              onChange={(e) => setLegalFirstName(e.target.value)}
              placeholder="ตามบัตร ปชช."
              autoComplete="given-name"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="modal-legal-last">นามสกุล</label>
            <input
              id="modal-legal-last"
              value={legalLastName}
              onChange={(e) => setLegalLastName(e.target.value)}
              placeholder="ตามบัตร ปชช."
              autoComplete="family-name"
              required
            />
          </div>
          <PhotoAttachField
            label="รูปบัตรประชาชน"
            value={idCardPhotoUrl}
            onChange={setIdCardPhotoUrl}
            onError={setError}
            storageFolder="staff-id"
            storageSlotKey="id-card"
          />
          <p className="muted form-hint-inline">
            ถ่ายด้วยกล้องหรือแนบจากคลังรูปได้
          </p>
          <PersonalDataConsentField checked={consent} onChange={setConsent} disabled={busy} />
          <button type="submit" className="primary-btn" disabled={busy || !consent}>
            {busy ? "กำลังบันทึก..." : "บันทึกและปิด"}
          </button>
        </form>
      </div>
    </div>
  );
}
