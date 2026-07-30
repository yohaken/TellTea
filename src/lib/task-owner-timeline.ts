/**
 * มินิไทม์ไลน์หลังร้าน — เจ้าของติดตามค้าง + ประวัติส่ง (รวม soft)
 */
import {
  normalizeTaskNudgeKind,
  type TaskOccurrence,
} from "./task-types";
import { getTaskProofImgs, labelCompletedKind } from "./task-weekly-logic";

export type OwnerTimelineRow = {
  id: string;
  title: string;
  nudgeKind: "soft" | "deadline";
  who: string;
  whenMs: number;
  /** ค้าง | พลาด | ตรงเวลา | ส่งช้า | ย้อนหลัง */
  statusLabel: string;
  statusTone: "pending" | "missed" | "done";
  feedback: string;
  proofUrls: string[];
  isOpen: boolean;
};

export const OWNER_TIMELINE_MAX = 14;

export function buildOwnerTaskTimeline(
  occurrences: TaskOccurrence[],
  now = Date.now(),
  max = OWNER_TIMELINE_MAX,
): OwnerTimelineRow[] {
  const open: OwnerTimelineRow[] = [];
  const done: OwnerTimelineRow[] = [];

  for (const o of occurrences) {
    const nudgeKind = normalizeTaskNudgeKind(o.nudgeKind);
    const who = (o.assigneeNames || []).filter(Boolean).join(", ") || "—";
    const feedback = (o.completionNote || "").trim();
    const proofUrls = getTaskProofImgs(o);

    if (o.status === "completed") {
      done.push({
        id: o.id,
        title: (o.title || "").trim() || "งาน",
        nudgeKind,
        who,
        whenMs: Number(o.completedAt) || Number(o.updatedAt) || Number(o.dueDate) || 0,
        statusLabel: labelCompletedKind(o.completedKind || "on_time"),
        statusTone: "done",
        feedback,
        proofUrls,
        isOpen: false,
      });
      continue;
    }

    if (o.status === "missed") {
      open.push({
        id: o.id,
        title: (o.title || "").trim() || "งาน",
        nudgeKind,
        who,
        whenMs: Number(o.dueDate) || 0,
        statusLabel: "พลาด",
        statusTone: "missed",
        feedback: "",
        proofUrls: [],
        isOpen: true,
      });
      continue;
    }

    // pending — เฉพาะที่เปิดส่งแล้ว (ถึง openAt)
    if (now < (o.openAt || 0)) continue;
    open.push({
      id: o.id,
      title: (o.title || "").trim() || "งาน",
      nudgeKind,
      who,
      whenMs: Number(o.dueDate) || 0,
      statusLabel: "ค้าง",
      statusTone: "pending",
      feedback: "",
      proofUrls: [],
      isOpen: true,
    });
  }

  open.sort((a, b) => {
    if (a.statusTone !== b.statusTone) {
      return a.statusTone === "missed" ? -1 : 1;
    }
    if (a.whenMs !== b.whenMs) return a.whenMs - b.whenMs;
    return a.title.localeCompare(b.title, "th");
  });

  done.sort((a, b) => b.whenMs - a.whenMs);

  const openCap = Math.min(open.length, Math.max(4, Math.floor(max / 2)));
  const rest = Math.max(0, max - openCap);
  return [...open.slice(0, openCap), ...done.slice(0, rest)];
}
