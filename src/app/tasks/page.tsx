"use client";

import { StickyNote } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { TaskBoardNotesView } from "@/components/TaskBoardNotesView";
import { useAuth } from "@/lib/auth";
import { isAppOwnerEmail } from "@/lib/firebase";
import { profileStatusLabel } from "@/lib/profile";

export default function TasksPage() {
  return (
    <AuthGate>
      <TasksBoardPageView />
    </AuthGate>
  );
}

function TasksBoardPageView() {
  const { actorId, staff, user, isPermPreview } = useAuth();
  if (!staff) return null;

  const isOwner =
    !isPermPreview &&
    (staff.role === "owner" || isAppOwnerEmail(user?.email));
  const authorRole = isOwner || staff.role === "owner" ? "owner" : "staff";
  const authorName =
    profileStatusLabel(staff) ||
    staff.displayName ||
    (authorRole === "owner" ? "เจ้าของ" : "พนักงาน");

  return (
    <div className="module-page tasks-page task-board-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <StickyNote size={18} aria-hidden />
          กระดานโนต
        </h1>
        <p className="muted tasks-page-hint">
          {isOwner
            ? "พนักงานใส่ความคืบได้ · เจ้าของพิมพ์ข้อความได้ · แทนระบบ checklist เดิม"
            : "ใส่ข้อความแสดงความคืบหน้า · เจ้าของอ่านและพิมพ์ตอบได้"}
        </p>
      </div>

      <TaskBoardNotesView
        actorId={actorId || staff.id}
        authorName={authorName}
        authorRole={authorRole}
        employeeId={staff.employeeId || ""}
        isOwner={isOwner || staff.role === "owner"}
        readOnly={isPermPreview}
      />
    </div>
  );
}
