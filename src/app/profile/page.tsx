"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { IdCard, UserCircle } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { PhotoAttachField } from "@/components/PhotoAttachField";
import { PersonalDataConsentField } from "@/components/PersonalDataConsentField";
import { useAuth } from "@/lib/auth";
import {
  linkEmployeeProfile,
  listEmployeesForProfile,
  type Employee,
} from "@/lib/employees";
import { needsPersonalProfileSetup, needsRosterLink } from "@/lib/profile";
import { updateStaffProfile } from "@/lib/staff";
import { saveCachedStaff } from "@/lib/cache";
import { formatPhoneDisplay, staffAccountLabel } from "@/lib/utils";

export default function ProfilePage() {
  return (
    <AuthGate>
      <ProfileView />
    </AuthGate>
  );
}

function ProfileView() {
  const { user, staff, refreshStaff } = useAuth();
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState(staff?.employeeId || "");
  const [legalFirstName, setLegalFirstName] = useState(staff?.legalFirstName || "");
  const [legalLastName, setLegalLastName] = useState(staff?.legalLastName || "");
  const [idCardPhotoUrl, setIdCardPhotoUrl] = useState(staff?.idCardPhotoUrl || "");
  const [consent, setConsent] = useState(!!staff?.personalDataConsentAt);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const accountLabel = staff ? staffAccountLabel(staff) : "";
  const isOwner = staff?.role === "owner";
  const selected = employees.find((e) => e.id === employeeId);
  const showPersonal = !isOwner;
  const showRoster = !isOwner;

  useEffect(() => {
    if (!staff) return;
    setLegalFirstName(staff.legalFirstName || "");
    setLegalLastName(staff.legalLastName || "");
    setIdCardPhotoUrl(staff.idCardPhotoUrl || "");
    setConsent(!!staff.personalDataConsentAt);
    setEmployeeId(staff.employeeId || "");
  }, [staff]);

  useEffect(() => {
    if (!staff || isOwner) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void listEmployeesForProfile(staff)
      .then((rows) => {
        setEmployees(rows);
        if (staff.employeeId && rows.some((r) => r.id === staff.employeeId)) {
          setEmployeeId(staff.employeeId);
        } else if (rows.length === 1) {
          setEmployeeId(rows[0]!.id);
        }
      })
      .catch((err) => setError((err as Error).message || "โหลดรายชื่อไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [staff, isOwner]);

  async function onSavePersonal(e: FormEvent) {
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
    if (!consent && !staff.personalDataConsentAt) {
      setError("ต้องยินยอมการเก็บข้อมูลส่วนตัวก่อนบันทึก");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await updateStaffProfile(staff.id, {
        legalFirstName: legalFirstName.trim(),
        legalLastName: legalLastName.trim(),
        idCardPhotoUrl,
        personalProfileComplete: true,
        personalDataConsentAt: staff.personalDataConsentAt || Date.now(),
      });
      saveCachedStaff(updated);
      await refreshStaff();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveRoster(e: FormEvent) {
    e.preventDefault();
    if (!staff) return;
    if (!employeeId || !selected) {
      setError("เลือกชื่อในรายชื่อร้าน");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await linkEmployeeProfile(
        employeeId,
        staff.id,
        selected.name,
        staff.email,
        staff.phone,
      );
      const updated = await updateStaffProfile(staff.id, {
        displayName: selected.name,
        employeeId,
        profileComplete: true,
        profileSnoozeUntil: null,
      });
      saveCachedStaff(updated);
      await refreshStaff();
      setSaved(true);
      setTimeout(() => router.replace("/ledger/"), 600);
    } catch (err) {
      setError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (isOwner) {
    return (
      <div>
        <h1 className="panel-title">โปรไฟล์</h1>
        <p className="muted" style={{ textAlign: "left" }}>
          บัญชีเจ้าของใช้ชื่อจาก Google: <strong>{staff?.displayName || accountLabel}</strong>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="panel-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <UserCircle size={20} aria-hidden />
        โปรไฟล์พนักงาน
      </h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        ใช้งานได้ทันทีหลังล็อกอิน — กรอกข้อมูลส่วนตัวให้ครบเมื่อสะดวก
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {saved ? <p className="ok-text">บันทึกแล้ว</p> : null}

      {showPersonal ? (
        <section className="staff-hub-section" style={{ marginBottom: "1.25rem" }}>
          <h2 className="panel-title" style={{ fontSize: "1.05rem", display: "flex", gap: "0.35rem", alignItems: "center" }}>
            <IdCard size={18} aria-hidden />
            ข้อมูลส่วนตัว
            {needsPersonalProfileSetup(staff) ? (
              <span className="profile-badge-warn">ยังไม่ครบ</span>
            ) : (
              <span className="profile-badge-ok">ครบแล้ว ✓</span>
            )}
          </h2>
          <p className="muted" style={{ textAlign: "left", marginBottom: "0.65rem", fontSize: "0.85rem" }}>
            ตามบัตรประชาชน — ชื่อจริง นามสกุล และรูปถ่ายบัตร
          </p>
          <form className="form-card entry-form" onSubmit={(e) => void onSavePersonal(e)}>
            <div className="field">
              <label htmlFor="legal-first">ชื่อจริง</label>
              <input
                id="legal-first"
                value={legalFirstName}
                onChange={(e) => setLegalFirstName(e.target.value)}
                placeholder="ตามบัตร ปชช."
                required
              />
            </div>
            <div className="field">
              <label htmlFor="legal-last">นามสกุล</label>
              <input
                id="legal-last"
                value={legalLastName}
                onChange={(e) => setLegalLastName(e.target.value)}
                placeholder="ตามบัตร ปชช."
                required
              />
            </div>
            <PhotoAttachField
              label="รูปบัตรประชาชน"
              value={idCardPhotoUrl}
              onChange={setIdCardPhotoUrl}
              onError={setError}
            />
            <PersonalDataConsentField
              checked={consent}
              onChange={setConsent}
              disabled={busy || !!staff?.personalDataConsentAt}
            />
            <button
              type="submit"
              className="primary-btn"
              disabled={busy || (!consent && !staff?.personalDataConsentAt)}
            >
              {busy ? "กำลังบันทึก..." : "บันทึกข้อมูลส่วนตัว"}
            </button>
          </form>
        </section>
      ) : null}

      {showRoster ? (
        <section className="staff-hub-section">
          <h2 className="panel-title" style={{ fontSize: "1.05rem" }}>
            ชื่อในรายชื่อร้าน
            {needsRosterLink(staff) ? (
              <span className="profile-badge-warn" style={{ marginLeft: "0.35rem" }}>ยังไม่เลือก</span>
            ) : (
              <span className="profile-badge-ok" style={{ marginLeft: "0.35rem" }}>✓</span>
            )}
          </h2>
          <p className="muted" style={{ textAlign: "left", marginBottom: "0.65rem", fontSize: "0.85rem" }}>
            ใช้ในโบนัส · ผลิต · OT · เช็ค — เลือกทีหลังได้
          </p>
          <div className="field" style={{ marginBottom: "0.75rem" }}>
            <label htmlFor="profile-account">บัญชีที่ล็อกอิน</label>
            <input
              id="profile-account"
              value={
                user?.phoneNumber ? formatPhoneDisplay(user.phoneNumber) : accountLabel
              }
              readOnly
            />
          </div>
          {loading ? <p className="empty">กำลังโหลด...</p> : null}
          {!loading && employees.length ? (
            <form className="form-card entry-form" onSubmit={(e) => void onSaveRoster(e)}>
              <div className="field">
                <label htmlFor="profile-name">ชื่อในร้าน</label>
                <select
                  id="profile-name"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  required
                >
                  <option value="">— เลือกชื่อ —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                      {emp.linkedStaffId && emp.linkedStaffId !== staff?.id ? " (มีคนใช้แล้ว)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              {selected ? (
                <p className="muted check-hint">
                  จะบันทึกเป็น <strong>{selected.name}</strong> ในระบบโบนัสและรายงาน
                </p>
              ) : null}
              <div className="btn-row">
                <button type="submit" className="primary-btn" disabled={busy}>
                  {busy ? "กำลังบันทึก..." : "บันทึกชื่อในร้าน"}
                </button>
                <button type="button" className="ghost-btn" disabled={busy} onClick={() => router.back()}>
                  กลับ
                </button>
              </div>
            </form>
          ) : null}
          {!loading && !employees.length ? (
            <div className="form-card entry-form">
              <p className="muted" style={{ textAlign: "left", margin: 0 }}>
                ยังไม่มีชื่อในรายชื่อร้าน — ให้เจ้าของเพิ่มที่{" "}
                <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
              </p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
