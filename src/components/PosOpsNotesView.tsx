"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Link2 } from "lucide-react";
import { subscribePosOpsNotes, type PosOpsNoteItem } from "@/lib/pos-ops-notes";
import { POS_APK_INSTALL_PAGE_URL } from "@/lib/pos-url";

/** Only allow install/APK links on the POS host — never shop/BO URLs. */
function isPosInstallUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== "telltea-pos.web.app") return false;
    return u.pathname.startsWith("/install") || u.pathname.startsWith("/downloads");
  } catch {
    return false;
  }
}

/**
 * เครื่อง POS — ลิงก์ติดตั้ง/อัปเดตเท่านั้น (ตัดลิงก์หลังร้าน)
 */
export function PosOpsNotesView() {
  const [items, setItems] = useState<PosOpsNoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribePosOpsNotes(
      (notes) => {
        setItems(notes.items.filter((n) => !n.url || isPosInstallUrl(n.url)));
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
          ติดตั้ง / อัปเดต
        </h1>
        <p className="muted">ลิงก์ APK บนโดเมน POS เท่านั้น · ไม่เปิดเข้าหลังร้าน</p>
      </header>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!loading && !error && items.length === 0 ? (
        <div className="pos-ops-notes-empty">
          <p className="muted">ใช้หน้าติดตั้งสำรองด้านล่าง</p>
          <a className="primary-btn" href={POS_APK_INSTALL_PAGE_URL} rel="noopener noreferrer">
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
              {item.url && isPosInstallUrl(item.url) ? (
                <a className="primary-btn pos-ops-note-open" href={item.url} rel="noopener noreferrer">
                  <ExternalLink size={15} aria-hidden />
                  เปิดหน้าติดตั้ง
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
