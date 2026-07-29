"use client";

import { useEffect, useRef, useState } from "react";
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { useAuth } from "@/lib/auth";
import {
  newStaffNewsDraft,
  saveStaffNews,
  subscribeStaffNews,
  type StaffNewsNote,
} from "@/lib/staff-news";

/**
 * คลังโนต + แจ้งข่าวสาร — เฉพาะเจ้าของร้านกำหนด
 * โนตที่ติ๊ก «แจ้ง» จะลอย popup ให้ทุกคน (รวมเจ้าของ) จนกว่าจะเอาออกจากแจ้ง
 */
export function StaffNewsSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [notes, setNotes] = useState<StaffNewsNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    const unsub = subscribeStaffNews(
      (doc) => {
        if (!hydrated.current) {
          setNotes(doc.notes);
          hydrated.current = true;
        }
        setLoading(false);
      },
      (err) => {
        onError(err.message || "โหลดคลังโนตไม่สำเร็จ");
        setLoading(false);
      },
    );
    return unsub;
  }, [onError]);

  function updateNote(id: string, patch: Partial<StaffNewsNote>) {
    setNotes((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch, updatedAt: Date.now() } : row)),
    );
  }

  function addNote() {
    setNotes((prev) => [
      ...prev,
      newStaffNewsDraft({ sortOrder: prev.length, announced: true, inWarehouse: true }),
    ]);
  }

  function removeFromAnnounce(id: string) {
    setNotes((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, announced: false, updatedAt: Date.now() } : row,
      ),
    );
  }

  function deleteFromWarehouse(id: string) {
    setNotes((prev) =>
      prev
        .map((row) => {
          if (row.id !== id) return row;
          // ลบจากคลัง — ถ้ายังแจ้งอยู่ให้เอาออกจากแจ้งด้วยแล้วทิ้ง
          return { ...row, inWarehouse: false, announced: false };
        })
        .filter((row) => row.inWarehouse || row.announced),
    );
  }

  async function save() {
    if (!actorId) return;
    const missingTitle = notes.some((row) => !row.title.trim());
    if (missingTitle) {
      onError("ใส่หัวข้อโนตให้ครบก่อนบันทึก");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await saveStaffNews(notes, actorId);
      // sync local list with what was persisted (ลบออกทั้งคลัง+แจ้งแล้วหาย)
      setNotes((prev) => prev.filter((n) => n.title.trim() && (n.inWarehouse || n.announced)));
      setSavedMsg("บันทึกแล้ว — โนตที่ติ๊กแจ้งจะลอยให้ทุกคนเห็นทันที");
      window.setTimeout(() => setSavedMsg(null), 5000);
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const announcedCount = notes.filter((n) => n.announced).length;

  return (
    <SettingsFold
      title={
        <>
          <Megaphone size={18} aria-hidden />
          แจ้งข่าวสาร / คลังโนต
        </>
      }
      hint={
        <>
          เฉพาะเจ้าของ · กำลังแจ้ง {announcedCount} รายการ · ปิดได้แต่เปิดรอบใหม่จะลอยอีก
          จนกว่าจะเอาออกจากแจ้ง
        </>
      }
      defaultOpen={false}
    >
      <p className="muted settings-fold-hint" style={{ marginTop: 0 }}>
        <strong>คลังโนต</strong> เก็บข้อความไว้ใช้ภายหลัง · ติ๊ก <strong>แจ้ง</strong> เพื่อลอย popup
        ให้พนักงานและเจ้าของเห็น · กด <strong>เอาออกจากแจ้ง</strong> เมื่อไม่ต้องลอยแล้ว
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && notes.length === 0 ? (
        <p className="muted" style={{ textAlign: "left" }}>
          ยังไม่มีโนต — กดเพิ่มโนตแล้วติ๊กแจ้งเพื่อเริ่มลอยข่าวสาร
        </p>
      ) : null}

      {!loading ? (
        <ul className="staff-news-editor">
          {notes.map((item) => (
            <li key={item.id} className="staff-news-edit-row">
              <label className="pos-device-label-field">
                <span>หัวข้อ</span>
                <input
                  type="text"
                  value={item.title}
                  disabled={busy}
                  placeholder="เช่น ปิดร้านวันจันทร์"
                  onChange={(e) => updateNote(item.id, { title: e.target.value })}
                />
              </label>
              <label className="pos-device-label-field">
                <span>ข้อความ</span>
                <textarea
                  value={item.body}
                  disabled={busy}
                  rows={3}
                  placeholder="รายละเอียดข่าวสาร — พนักงานกดขยายอ่านได้"
                  onChange={(e) => updateNote(item.id, { body: e.target.value })}
                />
              </label>
              <label className="staff-news-announce-toggle">
                <input
                  type="checkbox"
                  checked={item.announced}
                  disabled={busy}
                  onChange={(e) => updateNote(item.id, { announced: e.target.checked })}
                />
                <span>
                  <strong>แจ้ง</strong> — ลอย popup ให้ทุกคนเห็น
                </span>
              </label>
              <div className="staff-news-edit-actions">
                {item.announced ? (
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => removeFromAnnounce(item.id)}
                  >
                    เอาออกจากแจ้ง
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => deleteFromWarehouse(item.id)}
                  title="ลบออกจากคลัง"
                >
                  <Trash2 size={14} aria-hidden />
                  ลบจากคลัง
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading ? (
        <div className="pos-device-actions">
          <button type="button" className="ghost-btn" disabled={busy} onClick={addNote}>
            <Plus size={14} aria-hidden />
            เพิ่มโนต
          </button>
          <button type="button" className="primary-btn" disabled={busy} onClick={() => void save()}>
            บันทึก
          </button>
        </div>
      ) : null}

      {savedMsg ? <p className="ok-text settings-fold-hint">{savedMsg}</p> : null}
    </SettingsFold>
  );
}
