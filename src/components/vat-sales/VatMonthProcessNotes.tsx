"use client";

/**
 * โน้ตขั้นตอนปิดงบเดลิเวอรี่ — ด้านบน /vat-sales/
 * เซฟอัตโนมัติ · ไม่หายเมื่อรีโหลด (ไม่ทับด้วยค่าเริ่มถ้ามีของเดิม)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadVatDeliverySourceNotes,
  saveVatDeliverySourceNotes,
} from "@/lib/vat-delivery-source-notes";

const DEFAULT_NOTE = `แคป 3 รูป (GB/SF/LM) → AI คัดแยก → ตรวจพรีวิว

คชจ. ต้องไม่รวม VAT
• แยกไว้แล้ว → ใช้ตามนั้น
• ยังไม่แยก → แยก VAT ออก (×7/107)

ยังไม่เข้างบจนกว่าจะยืนยัน
`;

type Props = { actor: string };

export function VatMonthProcessNotes({ actor }: Props) {
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef("");
  draftRef.current = draft;

  const refresh = useCallback(async () => {
    try {
      const notes = await loadVatDeliverySourceNotes();
      const text = notes.text.trim() ? notes.text : DEFAULT_NOTE;
      setDraft(text);
      setSaved(notes.text.trim() ? notes.text : "");
      setUpdatedAt(notes.updatedAt);
      setErr("");
      // ครั้งแรกที่ยังไม่มีในฐาน — เก็บค่าเริ่มไว้เลยไม่ให้หาย
      if (!notes.text.trim()) {
        const next = await saveVatDeliverySourceNotes(DEFAULT_NOTE, actor);
        setSaved(next.text);
        setUpdatedAt(next.updatedAt);
      }
    } catch (e) {
      setDraft(DEFAULT_NOTE);
      setSaved("");
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [actor]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persist = useCallback(
    async (text: string) => {
      setBusy(true);
      setErr("");
      try {
        const next = await saveVatDeliverySourceNotes(text, actor);
        setSaved(next.text);
        setUpdatedAt(next.updatedAt);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [actor],
  );

  useEffect(() => {
    if (!loaded) return;
    if (draft === saved) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist(draftRef.current);
    }, 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, saved, loaded, persist]);

  useEffect(() => {
    const flush = () => {
      if (!loaded) return;
      if (draftRef.current === saved) return;
      void saveVatDeliverySourceNotes(draftRef.current, actor);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [actor, loaded, saved]);

  if (!loaded) {
    return (
      <section className="vat-table-block vat-month-process-notes">
        <p className="muted">กำลังโหลดโน้ต…</p>
      </section>
    );
  }

  return (
    <section
      className="vat-table-block vat-month-process-notes"
      aria-label="โน้ตขั้นตอนดึงยอด"
    >
      <div className="vat-process-notes-head">
        <h2 className="vat-table-title">โน้ตขั้นตอน</h2>
        <span className="muted vat-process-notes-meta">
          {busy ? "กำลังเซฟ…" : err ? "เซฟไม่สำเร็จ" : "เซฟอัตโนมัติ"}
          {updatedAt > 0
            ? ` · ${new Date(updatedAt).toLocaleString("th-TH")}`
            : ""}
        </span>
      </div>
      {err ? <p className="error-text">{err}</p> : null}
      <textarea
        className="vat-process-notes-area"
        rows={8}
        value={draft}
        placeholder={DEFAULT_NOTE}
        onChange={(e) => setDraft(e.target.value)}
      />
    </section>
  );
}
