"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { listStaff, removeStaff, upsertStaff } from "@/lib/staff";
import type { StaffMember, StaffRole } from "@/lib/types";
import {
  DEFAULT_STAFF_PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  can,
  normalizePermissions,
  type StaffPermissions,
} from "@/lib/permissions";
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
  const [perms, setPerms] = useState<StaffPermissions>({ ...DEFAULT_STAFF_PERMISSIONS });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);

  async function reload() {
    setMembers(await listStaff());
  }

  useEffect(() => {
    if (staff && !can(staff, "staffManage")) {
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
      await upsertStaff(email, role, role === "owner" ? undefined : perms);
      setEmail("");
      setRole("staff");
      setPerms({ ...DEFAULT_STAFF_PERMISSIONS });
      await reload();
      await refreshStaff();
    } catch (err) {
      setError((err as Error).message || "บันทึกพนักงานไม่สำเร็จ");
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
      <h1 className="panel-title">พนักงาน</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        เพิ่มอีเมล Google และกำหนดว่าใครเห็นหน้า/ฟังก์ชันไหน — แถบล่างจะตามสิทธิ์
      </p>
      {error ? <p className="error-text">{error}</p> : null}

      <form className="form-card entry-form" onSubmit={(e) => void onSubmit(e)}>
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
            {PERMISSION_KEYS.map((key) => (
              <label key={key} className="check-row">
                <input
                  type="checkbox"
                  checked={perms[key]}
                  onChange={(e) =>
                    setPerms((p) => ({ ...p, [key]: e.target.checked }))
                  }
                />
                {PERMISSION_LABELS[key]}
              </label>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ textAlign: "left", margin: 0 }}>
            เจ้าของใช้ได้ทุกหน้าโดยอัตโนมัติ
          </p>
        )}
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "เพิ่ม / อัปเดต"}
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
                  <div className="muted">{member.role === "owner" ? "เจ้าของ" : "พนักงาน"}</div>
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
    <div>
      {PERMISSION_KEYS.map((key) => (
        <label key={key} className="check-row">
          <input
            type="checkbox"
            checked={perms[key]}
            onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.checked }))}
          />
          {PERMISSION_LABELS[key]}
        </label>
      ))}
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
