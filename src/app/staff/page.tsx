"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { listStaff, removeStaff, upsertStaff } from "@/lib/staff";
import type { StaffMember, StaffRole } from "@/lib/types";
import { normalizeEmail } from "@/lib/utils";

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
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setMembers(await listStaff());
  }

  useEffect(() => {
    if (staff && staff.role !== "owner") {
      router.replace("/ledger/");
      return;
    }
    void reload().catch((err) => setError(err.message || "โหลดพนักงานไม่สำเร็จ"));
  }, [staff, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await upsertStaff(email, role);
      setEmail("");
      setRole("staff");
      await reload();
      await refreshStaff();
    } catch (err) {
      setError((err as Error).message || "บันทึกพนักงานไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (staff?.role !== "owner") {
    return null;
  }

  return (
    <div>
      <h1 className="panel-title">พนักงาน</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        เพิ่มอีเมล Google ของพนักงานจัดการร้าน — ให้บันทึกเงินออกและดูยอดคงเหลือได้
      </p>
      {error ? <p className="error-text">{error}</p> : null}

      <form className="form-card" onSubmit={(e) => void onSubmit(e)}>
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
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            <option value="staff">พนักงาน</option>
            <option value="owner">เจ้าของ</option>
          </select>
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "เพิ่ม / อัปเดต"}
        </button>
      </form>

      <div className="list-card" style={{ marginTop: "1rem" }}>
        {members.map((member) => (
          <div key={member.email} className="list-row">
            <div>
              <strong>{member.email}</strong>
              <div className="muted">{member.role === "owner" ? "เจ้าของ" : "พนักงาน"}</div>
            </div>
            {normalizeEmail(member.email) !== normalizeEmail(staff.email) ? (
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
        ))}
      </div>
    </div>
  );
}
