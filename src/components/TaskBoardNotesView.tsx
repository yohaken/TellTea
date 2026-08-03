"use client";

/**
 * กระดานโนตงาน — ตารางกว้าง · พนักงาน/เจ้าของโพสต์ข้อความความคืบได้
 */
import { useEffect, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import {
  canDeleteTaskBoardNote,
  createTaskBoardNote,
  deleteTaskBoardNote,
  subscribeTaskBoardNotes,
  TASK_BOARD_NOTE_MAX,
  type TaskBoardAuthorRole,
  type TaskBoardNote,
} from "@/lib/task-board-notes";
import { formatDateTimeShortBe } from "@/lib/utils";

type Props = {
  actorId: string;
  authorName: string;
  authorRole: TaskBoardAuthorRole;
  employeeId?: string;
  isOwner: boolean;
  /** พรีวิวสิทธิ์ — อ่านได้อย่างเดียว */
  readOnly?: boolean;
};

export function TaskBoardNotesView({
  actorId,
  authorName,
  authorRole,
  employeeId = "",
  isOwner,
  readOnly = false,
}: Props) {
  const [rows, setRows] = useState<TaskBoardNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeTaskBoardNotes({
      onRows: (next) => {
        setRows(next);
        setLoaded(true);
        setError(null);
      },
      onError: (err) => {
        setError(err.message);
        setLoaded(true);
      },
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || readOnly) return;
    setBusy(true);
    setError(null);
    try {
      await createTaskBoardNote({
        text,
        createdBy: actorId,
        createdByName: authorName,
        authorRole,
        employeeId,
      });
      setText("");
    } catch (err) {
      setError((err as Error).message || "โพสต์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(note: TaskBoardNote) {
    if (readOnly) return;
    if (!canDeleteTaskBoardNote(note, { actorId, isOwner })) return;
    if (!window.confirm("ลบโนตนี้?")) return;
    setDeletingId(note.id);
    setError(null);
    try {
      await deleteTaskBoardNote(note.id);
    } catch (err) {
      setError((err as Error).message || "ลบไม่สำเร็จ");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="task-board-view">
      <form className="task-board-compose" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="task-board-text">
          ข้อความความคืบ
        </label>
        <textarea
          id="task-board-text"
          className="task-board-input"
          value={text}
          maxLength={TASK_BOARD_NOTE_MAX}
          rows={2}
          placeholder={
            isOwner
              ? "พิมพ์ข้อความถึงพนักงาน…"
              : "ใส่ข้อความแสดงความคืบหน้า…"
          }
          disabled={busy || readOnly}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="task-board-compose-bar">
          <span className="muted task-board-compose-meta">
            {readOnly
              ? "โหมดดูอย่างเดียว"
              : `${text.trim().length}/${TASK_BOARD_NOTE_MAX}`}
          </span>
          <button
            type="submit"
            className="primary-btn task-board-send"
            disabled={busy || readOnly || !text.trim()}
          >
            <Send size={14} aria-hidden />
            {busy ? "กำลังส่ง…" : "ส่ง"}
          </button>
        </div>
      </form>

      {error ? <p className="error-text">{error}</p> : null}

      {!loaded ? (
        <p className="muted task-board-status">กำลังโหลดกระดาน…</p>
      ) : (
        <div className="sheet-wrap sheet-bleed task-board-sheet">
          <table className="sheet-table sheet-table--dense task-board-table">
            <thead>
              <tr>
                <th className="tb-col-when" scope="col">
                  เวลา
                </th>
                <th className="tb-col-who" scope="col">
                  จาก
                </th>
                <th className="tb-col-text" scope="col">
                  ข้อความ
                </th>
                <th className="tb-col-act" scope="col">
                  <span className="sr-only">ลบ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="task-board-empty">
                    ยังไม่มีโนต — เริ่มพิมพ์ความคืบด้านบน
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const canDelete = canDeleteTaskBoardNote(row, {
                    actorId,
                    isOwner,
                  });
                  return (
                    <tr
                      key={row.id}
                      className={
                        row.authorRole === "owner"
                          ? "task-board-row is-owner"
                          : "task-board-row is-staff"
                      }
                    >
                      <td className="tb-col-when">
                        {row.createdAt
                          ? formatDateTimeShortBe(row.createdAt)
                          : "—"}
                      </td>
                      <td
                        className="tb-col-who"
                        title={row.createdByName || undefined}
                      >
                        <span
                          className={
                            row.authorRole === "owner"
                              ? "task-board-role is-owner"
                              : "task-board-role is-staff"
                          }
                        >
                          {row.authorRole === "owner" ? "เจ้าของ" : "พนักงาน"}
                        </span>
                        <span className="task-board-name">
                          {row.createdByName || "—"}
                        </span>
                      </td>
                      <td className="tb-col-text">
                        <span className="task-board-text">{row.text}</span>
                      </td>
                      <td className="tb-col-act">
                        {canDelete && !readOnly ? (
                          <button
                            type="button"
                            className="ghost-btn task-board-del"
                            title="ลบโนต"
                            aria-label="ลบโนต"
                            disabled={deletingId === row.id}
                            onClick={() => void onDelete(row)}
                          >
                            ×
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
