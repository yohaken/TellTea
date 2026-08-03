"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Lightbulb, StickyNote } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  countPendingSuggestions,
  createStaffSuggestion,
  formatSuggestionWhen,
  subscribeStaffSuggestions,
  SUGGESTION_STATUS_LABELS,
  updateStaffSuggestionStatus,
  type StaffSuggestion,
  type SuggestionStatus,
} from "@/lib/staff-suggestions";
import {
  STAFF_UTILITY_CATALOG,
  type StaffUtilitySlot,
} from "@/lib/staff-utility";
import { cn } from "@/lib/utils";

const OWNER_STATUS_ACTIONS: SuggestionStatus[] = ["accepted", "later", "done"];

type Props = {
  /** หน้าโมดูลเต็ม — ไม่ใช้กรอบ modal */
  embedded?: boolean;
  /** แท็บเริ่มต้น */
  initialSlot?: StaffUtilitySlot;
};

/**
 * เนื้อหายูทิลิตี้ — ใช้ทั้งแผงไอคอนพนักงาน และหน้าโมดูลหลังร้าน `/utility/`
 */
export function StaffUtilityPanel({
  embedded = false,
  initialSlot = "suggestions",
}: Props) {
  const { staff, actorId, status, isPermPreview, permPreview } = useAuth();
  const isOwner = staff?.role === "owner";
  const [slot, setSlot] = useState<StaffUtilitySlot>(initialSlot);
  const [suggestions, setSuggestions] = useState<StaffSuggestion[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const ready = status === "ready" && !!staff;
  const myEmployeeId = staff?.employeeId || "";
  /** พรีวิว: อ่านข้อเสนอด้วย staff id ของคนที่สวม — ไม่ใช้ actor เจ้าของ */
  const suggestionActorId = isPermPreview
    ? permPreview?.memberId || ""
    : actorId;

  useEffect(() => {
    if (!ready || !suggestionActorId) {
      setSuggestions([]);
      return;
    }
    return subscribeStaffSuggestions({
      isOwner,
      actorId: suggestionActorId,
      onRows: setSuggestions,
      onError: (err) => setError(err.message),
    });
  }, [ready, isOwner, suggestionActorId]);

  const pendingSuggestionCount = useMemo(
    () => (isOwner ? countPendingSuggestions(suggestions) : 0),
    [isOwner, suggestions],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || isPermPreview) return;
    setBusy(true);
    setError(null);
    try {
      await createStaffSuggestion({
        title,
        body,
        createdBy: actorId,
        createdByName: staff?.displayName || actorId,
        employeeId: myEmployeeId,
      });
      setTitle("");
      setBody("");
    } catch (err) {
      setError((err as Error).message || "ส่งไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onOwnerStatus(id: string, next: SuggestionStatus) {
    if (statusBusyId || isPermPreview) return;
    setStatusBusyId(id);
    setError(null);
    try {
      await updateStaffSuggestionStatus(id, next);
    } catch (err) {
      setError((err as Error).message || "อัปเดตไม่สำเร็จ");
    } finally {
      setStatusBusyId(null);
    }
  }

  if (!ready) {
    return <p className="muted">กำลังโหลด…</p>;
  }

  return (
    <div className={cn("staff-utility-panel-inner", embedded && "is-embedded")}>
      <div className="staff-utility-tabs" role="tablist" aria-label="หมวดยูทิลิตี้">
        {(Object.keys(STAFF_UTILITY_CATALOG) as StaffUtilitySlot[]).map((key) => {
          const meta = STAFF_UTILITY_CATALOG[key];
          const badge =
            key === "suggestions" && isOwner && pendingSuggestionCount > 0
              ? pendingSuggestionCount
              : 0;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={slot === key}
              className={cn(
                "staff-utility-tab",
                slot === key && "is-active",
                badge > 0 && "has-badge",
              )}
              onClick={() => setSlot(key)}
            >
              {key === "suggestions" ? (
                <Lightbulb size={14} aria-hidden />
              ) : (
                <StickyNote size={14} aria-hidden />
              )}
              <span>{meta.label}</span>
              {badge > 0 ? (
                <span className="staff-utility-tab-badge">{badge > 9 ? "9+" : badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {error ? <p className="error-text staff-utility-error">{error}</p> : null}

      {slot === "suggestions" ? (
        <div className="staff-utility-body">
          {!isOwner ? (
            <form className="staff-utility-form" onSubmit={(e) => void onSubmit(e)}>
              {isPermPreview ? (
                <p className="muted staff-utility-owner-hint">
                  พรีวิวมุมพนักงาน — ดูข้อเสนอ/โนตได้ · ส่งของจริงไม่ได้จนกว่าจะออกจากมุมมอง
                </p>
              ) : null}
              <label>
                <span>อยากให้ร้านทำอะไร</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  placeholder="หัวข้อสั้นๆ"
                  required
                  disabled={isPermPreview}
                />
              </label>
              <label>
                <span>รายละเอียด (ถ้ามี)</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="เช่น ซื้อพัดลม / ปรับขั้นตอนปิดร้าน"
                  disabled={isPermPreview}
                />
              </label>
              <button
                type="submit"
                className="primary-btn"
                disabled={busy || isPermPreview || !title.trim()}
              >
                {busy ? "กำลังส่ง…" : isPermPreview ? "พรีวิว · ส่งไม่ได้" : "ส่งข้อเสนอ"}
              </button>
            </form>
          ) : (
            <p className="muted staff-utility-owner-hint">
              ข้อเสนอจากพนักงาน · กดสถานะสั้นๆ ได้เลย
            </p>
          )}

          <ul className="staff-utility-list">
            {suggestions.length === 0 ? (
              <li className="muted staff-utility-empty">ยังไม่มีข้อเสนอ</li>
            ) : (
              suggestions.map((row) => (
                <li key={row.id} className="staff-utility-item">
                  <div className="staff-utility-item-top">
                    <strong>{row.title}</strong>
                    <span className={cn("staff-utility-status", `is-${row.status}`)}>
                      {SUGGESTION_STATUS_LABELS[row.status]}
                    </span>
                  </div>
                  {row.body ? <p>{row.body}</p> : null}
                  <p className="muted staff-utility-meta">
                    {isOwner ? `${row.createdByName || "—"} · ` : null}
                    {formatSuggestionWhen(row.createdAt)}
                    {row.ownerNote ? ` · ${row.ownerNote}` : null}
                  </p>
                  {isOwner ? (
                    <div className="staff-utility-actions">
                      {OWNER_STATUS_ACTIONS.map((st) => (
                        <button
                          key={st}
                          type="button"
                          className={cn(
                            "ghost-btn staff-utility-status-btn",
                            row.status === st && "is-current",
                          )}
                          disabled={statusBusyId === row.id || row.status === st}
                          onClick={() => void onOwnerStatus(row.id, st)}
                        >
                          {SUGGESTION_STATUS_LABELS[st]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : (
        <div className="staff-utility-body staff-utility-tasks-scaffold">
          <p>กระดานโนต — พนักงานใส่ความคืบ · เจ้าของพิมพ์ได้</p>
          <p className="muted">ยกเลิกระบบ checklist งานมอบหมายแล้ว · ใช้หน้ากระดานแทน</p>
          <Link href="/tasks/" className="primary-btn staff-utility-tasks-link">
            เปิดกระดานโนต
          </Link>
        </div>
      )}
    </div>
  );
}
