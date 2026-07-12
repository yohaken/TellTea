"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  addChecklistItem,
  deleteAllChecklistRecords,
  deleteChecklistItem,
  listChecklistItems,
  updateChecklistItem,
  type ChecklistItem,
} from "@/lib/checklist";

export function ChecklistSetup({
  onReload,
  onError,
}: {
  onReload?: () => void;
  onError: (msg: string) => void;
}) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [name, setName] = useState("");
  const [groupLabel, setGroupLabel] = useState("ทั่วไป");
  const [busy, setBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);

  async function reload() {
    setItems(await listChecklistItems());
  }

  useEffect(() => {
    void reload().catch((err) => onError((err as Error).message));
  }, [onError]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await addChecklistItem(name, groupLabel);
      setName("");
      await reload();
      onReload?.();
    } catch (err) {
      onError((err as Error).message || "เพิ่มไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(item: ChecklistItem) {
    try {
      await updateChecklistItem(item.id, { active: !item.active });
      await reload();
      onReload?.();
    } catch (err) {
      onError((err as Error).message || "อัปเดตไม่สำเร็จ");
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("ลบรายการนี้?")) return;
    try {
      await deleteChecklistItem(id);
      await reload();
      onReload?.();
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  async function onClearAllRecords() {
    if (
      !window.confirm(
        "ลบบันทึกความพร้อมทั้งหมด? (รวมข้อมูลที่เคย import จาก CSV) — ไม่สามารถย้อนกลับ",
      )
    ) {
      return;
    }
    if (!window.confirm("ยืนยันอีกครั้ง — ลบทุกรอบที่บันทึกไว้")) return;
    setClearBusy(true);
    setClearMsg(null);
    try {
      const n = await deleteAllChecklistRecords();
      setClearMsg(n ? `ลบแล้ว ${n} แถว` : "ไม่มีบันทึกให้ลบ");
    } catch (err) {
      onError((err as Error).message || "ลบบันทึกไม่สำเร็จ");
    } finally {
      setClearBusy(false);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of items) {
      const list = map.get(item.groupLabel) || [];
      list.push(item);
      map.set(item.groupLabel, list);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <section className="owner-settings-section">
      <h2 className="owner-settings-title">SmartCheck SOP</h2>
      <p className="muted owner-settings-hint">
        ปรับแต่งรายการตรวจ — พนักงานจะเห็นรายการที่เปิดใช้งานเท่านั้น
      </p>

      <form className="form-card entry-form" onSubmit={(e) => void onAdd(e)}>
        <h3 className="panel-title" style={{ fontSize: "1rem" }}>เพิ่มรายการ</h3>
        <div className="stock-form-grid">
          <div className="field">
            <label htmlFor="setup-name">ชื่อรายการ</label>
            <input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="setup-group">กลุ่ม</label>
            <input id="setup-group" value={groupLabel} onChange={(e) => setGroupLabel(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>
          <Plus size={16} aria-hidden /> {busy ? "กำลังเพิ่ม..." : "เพิ่มรายการ"}
        </button>
      </form>

      {groups.map(([group, groupItems]) => (
        <section key={group} className="check-setup-group">
          <h3 className="check-group-title">{group}</h3>
          <ul className="check-setup-list">
            {groupItems.map((item) => (
              <li key={item.id} className={item.active ? "list-row" : "list-row is-muted"}>
                <span>{item.name}</span>
                <div className="check-setup-actions">
                  <button type="button" className="ghost-btn" onClick={() => void toggleActive(item)}>
                    {item.active ? "ปิด" : "เปิด"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn icon-btn"
                    aria-label="ลบ"
                    onClick={() => void onDelete(item.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="form-card entry-form check-danger-zone">
        <h3 className="panel-title" style={{ fontSize: "1rem" }}>เริ่มใหม่</h3>
        <p className="muted check-hint">
          ลบบันทึกความพร้อมทั้งหมด (รวมข้อมูลเก่าจาก CSV) — รายการตรวจด้านบนยังอยู่
        </p>
        <button
          type="button"
          className="ghost-btn check-clear-records-btn"
          disabled={clearBusy}
          onClick={() => void onClearAllRecords()}
        >
          {clearBusy ? "กำลังลบ..." : "ลบบันทึกทั้งหมด"}
        </button>
        {clearMsg ? <p className="muted check-import-preview">{clearMsg}</p> : null}
      </section>
    </section>
  );
}
