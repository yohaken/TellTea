"use client";

import Link from "next/link";
import { IdCard, UserCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  needsPersonalProfileSetup,
  needsRosterLink,
  profileSnoozeUntilNow,
} from "@/lib/profile";
import { updateStaffProfile } from "@/lib/staff";
import { usePathname } from "next/navigation";

export function ProfilePromptBanner() {
  const { staff, refreshStaff } = useAuth();
  const pathname = usePathname();

  if (!staff || staff.role === "owner" || pathname.startsWith("/profile")) {
    return null;
  }

  const needsPersonal = needsPersonalProfileSetup(staff);
  const needsRoster = !needsPersonal && needsRosterLink(staff);

  if (!needsPersonal && !needsRoster) return null;

  async function snoozeRoster() {
    if (!staff) return;
    await updateStaffProfile(staff.id, { profileSnoozeUntil: profileSnoozeUntilNow() });
    await refreshStaff();
  }

  if (needsPersonal) {
    return (
      <div className="profile-prompt-banner profile-prompt-banner--personal" role="status">
        <IdCard size={18} aria-hidden />
        <div className="profile-prompt-copy">
          <strong>กรอกข้อมูลส่วนตัว</strong>
          <span>ชื่อจริง · นามสกุล · รูปบัตรประชาชน — ใช้งานได้ก่อน แต่ควรกรอกให้ครบ</span>
        </div>
        <div className="profile-prompt-actions">
          <Link href="/profile/" className="primary-btn profile-prompt-btn">
            กรอกเลย
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-prompt-banner" role="status">
      <UserCircle size={18} aria-hidden />
      <div className="profile-prompt-copy">
        <strong>เลือกชื่อในร้าน</strong>
        <span>เชื่อมกับรายชื่อผลิต / OT / โบนัส — ตั้งทีหลังได้</span>
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
