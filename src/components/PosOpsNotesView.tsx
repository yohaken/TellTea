"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Link2 } from "lucide-react";
import { subscribePosOpsNotes, type PosOpsNoteItem } from "@/lib/pos-ops-notes";
import { POS_APK_INSTALL_PAGE_URL } from "@/lib/pos-url";

/**
 * เครื่อง POS อ่านลิงก์จากเจ้าของ — ไม่ต้องล็อกอินอีเมล
 */
export function PosOpsNotesView() {
  const [items, setItems] = useState<PosOpsNoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribePosOpsNotes(
      (notes) => {
        setItems(notes.items);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message || "โหลดลิงก์ไม่สำเร็จ");
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return (
    <div className="pos-ops-notes-view">
      <header className="pos-ops-notes-head">
        <h1>
          <Link2 size={22} aria-hidden />
          ลิงก์จากร้าน
        </h1>
        <p className="muted">
          ช่องทางจากเจ้าของ — ดาวน์โหลดแอป / อัปเดต / ลิงก์อื่นๆ โดยไม่ต้องเข้าอีเมล
        </p>
      </header>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!loading && !error && items.length === 0 ? (
        <div className="pos-ops-notes-empty">
          <p className="muted">ยังไม่มีรายการจากหลังบ้าน — ใช้ลิงก์ติดตั้งสำรองด้านล่างได้เลย</p>
          <a className="primary-btn" href={POS_APK_INSTALL_PAGE_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden />
            เปิดหน้าดาวน์โหลด APK
          </a>
        </div>
      ) : null}

      {!loading && items.length > 0 ? (
        <ul className="pos-ops-notes-list">
          {items.map((item) => (
            <li key={item.id} className="pos-ops-note-card">
              <strong>{item.title}</strong>
              {item.body ? <p className="muted">{item.body}</p> : null}
              {item.url ? (
                <a
                  className="primary-btn pos-ops-note-open"
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={15} aria-hidden />
                  เปิดลิงก์
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
