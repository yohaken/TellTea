"use client";

import Link from "next/link";
import { UserCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { needsProfileSetup, profileSnoozeUntilNow } from "@/lib/profile";
import { updateStaffProfile } from "@/lib/staff";
import { usePathname } from "next/navigation";

export function ProfilePromptBanner() {
  const { staff, refreshStaff } = useAuth();
  const pathname = usePathname();

  if (!needsProfileSetup(staff) || pathname.startsWith("/profile")) {
    return null;
  }

  async function snooze() {
    if (!staff) return;
    await updateStaffProfile(staff.id, { profileSnoozeUntil: profileSnoozeUntilNow() });
    await refreshStaff();
  }

  return (
    <div className="profile-prompt-banner" role="status">
      <UserCircle size={18} aria-hidden />
      <div className="profile-prompt-copy">
        <strong>ตั้งโปรไฟล์พนักงาน</strong>
        <span>เชื่อมบัญชีกับชื่อในร้าน — ใช้งานได้ก่อน ตั้งทีหลังได้</span>
      </div>
      <div className="profile-prompt-actions">
        <Link href="/profile/" className="primary-btn profile-prompt-btn">
          ตั้งเลย
        </Link>
        <button type="button" className="ghost-btn profile-prompt-btn" onClick={() => void snooze()}>
          ภายหลัง
        </button>
      </div>
    </div>
  );
}
