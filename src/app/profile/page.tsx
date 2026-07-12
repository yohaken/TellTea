"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { UserCircle } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  linkEmployeeProfile,
  listEmployeesForProfile,
  type Employee,
} from "@/lib/employees";
import { needsProfileSetup } from "@/lib/profile";
import { updateStaffProfile } from "@/lib/staff";
import { saveCachedStaff } from "@/lib/cache";

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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const email = user?.email || staff?.email || "";
  const isOwner = staff?.role === "owner";
  const selected = employees.find((e) => e.id === employeeId);

  useEffect(() => {
    if (!email) return;
    setLoading(true);
    void listEmployeesForProfile(email)
      .then((rows) => {
        setEmployees(rows);
        if (staff?.employeeId && rows.some((r) => r.id === staff.employeeId)) {
          setEmployeeId(staff.employeeId);
        } else if (rows.length === 1) {
          setEmployeeId(rows[0]!.id);
        }
      })
      .catch((err) => setError((err as Error).message || "โหลดรายชื่อไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [email, staff?.employeeId]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!staff || !email) return;
    if (!employeeId || !selected) {
      setError("เลือกชื่อในรายชื่อร้าน");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await linkEmployeeProfile(employeeId, email, selected.name);
      const updated = await updateStaffProfile(email, {
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
          บัญชีเจ้าของใช้ชื่อจาก Google: <strong>{staff?.displayName || email}</strong>
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
        เลือกชื่อของคุณจากรายชื่อร้าน — ใช้ในโบนัส · ผลิต · OT · เช็ค
        {needsProfileSetup(staff) ? " · ข้ามได้แล้วตั้งทีหลัง" : ""}
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {saved ? <p className="ok-text">บันทึกแล้ว — กำลังกลับ...</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        employees.length ? (
          <form className="form-card entry-form" onSubmit={(e) => void onSave(e)}>
            <div className="field">
              <label htmlFor="profile-email">บัญชี Google</label>
              <input id="profile-email" value={email} readOnly />
            </div>
            <div className="field">
              <label htmlFor="profile-name">ชื่อในรายชื่อร้าน</label>
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
                    {emp.linkedEmail && emp.linkedEmail !== email ? " (มีคนใช้แล้ว)" : ""}
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
                {busy ? "กำลังบันทึก..." : "บันทึกโปรไฟล์"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => router.back()}
              >
                ภายหลัง
              </button>
            </div>
          </form>
        ) : (
          <div className="form-card entry-form">
            <p className="muted" style={{ textAlign: "left", margin: 0 }}>
              ยังไม่มีชื่อในรายชื่อร้าน — ให้เจ้าของเพิ่มที่{" "}
              <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>{" "}
              ก่อน แล้วกลับมาเลือกชื่อ
            </p>
            <button type="button" className="ghost-btn" style={{ marginTop: "0.75rem" }} onClick={() => router.back()}>
              ใช้งานต่อก่อน
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
