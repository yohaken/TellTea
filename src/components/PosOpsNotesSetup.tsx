"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  defaultPosOpsNoteItems,
  newPosOpsNoteDraft,
  savePosOpsNotes,
  subscribePosOpsNotesAdmin,
  type PosOpsNoteItem,
} from "@/lib/pos-ops-notes";

/**
 * ช่องส่งลิงก์/โน้ตไปเครื่อง POS
 * — ไม่ใช้แชร์รหัสอีเมลร้าน: เครื่องอ่านด้วยตัวตน POS อัตโนมัติ
 */
export function PosOpsNotesSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [items, setItems] = useState<PosOpsNoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    const unsub = subscribePosOpsNotesAdmin(
      (notes) => {
        if (!hydrated.current) {
          setItems(notes.items.length ? notes.items : defaultPosOpsNoteItems());
          hydrated.current = true;
        }
        setLoading(false);
      },
      (err) => {
        onError(err.message || "โหลดลิงก์หน้าร้านไม่สำเร็จ");
        setLoading(false);
      },
    );
    return unsub;
  }, [onError]);

  function updateItem(id: string, patch: Partial<PosOpsNoteItem>) {
    setItems((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addItem() {
    setItems((prev) => [...prev, newPosOpsNoteDraft({ sortOrder: prev.length })]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((row) => row.id !== id));
  }

  async function save() {
    if (!actorId) return;
    const missingTitle = items.some((row) => !row.title.trim());
    if (missingTitle) {
      onError("ใส่ชื่อรายการให้ครบก่อนบันทึก");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await savePosOpsNotes(items, actorId);
      setSavedMsg("บันทึกแล้ว — เครื่อง POS อ่านได้ที่เมนู «ลิงก์จากร้าน»");
      window.setTimeout(() => setSavedMsg(null), 5000);
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <Link2 size={18} aria-hidden />
        ลิงก์ / โน้ตหน้าร้าน
      </h2>
      <p className="muted settings-card-lead">
        ส่งลิงก์ดาวน์โหลดหรือข้อความให้แท็บเล็ต POS อ่านได้ตลอด —{" "}
        <strong>ไม่ต้องแชร์รหัสอีเมลร้าน</strong> เครื่องล็อกอินเองด้วยตัวตน POS
        พนักงานเปิดเมนู «ลิงก์จากร้าน» แล้วกดลิงก์ได้เลย
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <ul className="pos-ops-notes-editor">
          {items.map((item) => (
            <li key={item.id} className="pos-ops-note-edit-row">
              <label className="pos-device-label-field">
                <span>ชื่อ</span>
                <input
                  type="text"
                  value={item.title}
                  disabled={busy}
                  placeholder="เช่น ดาวน์โหลดแอป POS"
                  onChange={(e) => updateItem(item.id, { title: e.target.value })}
                />
              </label>
              <label className="pos-device-label-field">
                <span>ลิงก์ (ถ้ามี)</span>
                <input
                  type="url"
                  value={item.url}
                  disabled={busy}
                  placeholder="https://…"
                  onChange={(e) => updateItem(item.id, { url: e.target.value })}
                />
              </label>
              <label className="pos-device-label-field">
                <span>คำอธิบายสั้นๆ</span>
                <input
                  type="text"
                  value={item.body}
                  disabled={busy}
                  placeholder="วิธีใช้สั้นๆ"
                  onChange={(e) => updateItem(item.id, { body: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => removeItem(item.id)}
                title="ลบรายการ"
              >
                <Trash2 size={14} aria-hidden />
                ลบ
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading ? (
        <div className="pos-device-actions">
          <button type="button" className="ghost-btn" disabled={busy} onClick={addItem}>
            <Plus size={14} aria-hidden />
            เพิ่มรายการ
          </button>
          <button type="button" className="primary-btn" disabled={busy} onClick={() => void save()}>
            บันทึกให้เครื่อง POS
          </button>
        </div>
      ) : null}

      {savedMsg ? <p className="ok-text settings-card-lead">{savedMsg}</p> : null}
    </section>
  );
}
