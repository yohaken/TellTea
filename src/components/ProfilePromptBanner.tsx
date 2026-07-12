"use client";

import Link from "next/link";
import { UserCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { needsPersonalProfileSetup, needsRosterLink, profileSnoozeUntilNow } from "@/lib/profile";
import { updateStaffProfile } from "@/lib/staff";
import { usePathname } from "next/navigation";

/** แบนเนอร์เลือกชื่อในร้าน — ข้อมูลส่วนตัวใช้ PersonalProfileModal แทน */
export function ProfilePromptBanner() {
  const { staff, refreshStaff } = useAuth();
  const pathname = usePathname();

  if (
    !staff ||
    staff.role === "owner" ||
    pathname.startsWith("/profile") ||
    needsPersonalProfileSetup(staff)
  ) {
    return null;
  }

  if (!needsRosterLink(staff)) return null;

  async function snoozeRoster() {
    if (!staff) return;
    await updateStaffProfile(staff.id, { profileSnoozeUntil: profileSnoozeUntilNow() });
    await refreshStaff();
  }

  return (
    <div className="profile-prompt-banner" role="status">
      <UserCircle size={18} aria-hidden />
      <div className="profile-prompt-copy">
        <strong>เลือกชื่อในร้าน</strong>
        <span>เชื่อมกับรายชื่อผลิต / ชง / โบนัส — ตั้งทีหลังได้</span>
      </div>
      <div className="profile-prompt-actions">
        <Link href="/profile/" className="primary-btn profile-prompt-btn">
          เลือกชื่อ
        </Link>
        <button type="button" className="ghost-btn profile-prompt-btn" onClick={() => void snoozeRoster()}>
          ภายหลัง
        </button>
      </div>
    </div>
  );
}
