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

const DEFAULT_NOTE = `ขั้นตอนดึงยอดเดลิเวอรี่ (ร่าง — จะเติมทีหลัง)

ตอนนี้ใช้ AI คุม Chrome อ่านข้อมูลตรงจาก:
- เว็บ Grab (merchant)
- เมล (Shopee / LINE MAN / อื่น)

ได้ข้อมูลตรงกว่าทางเมล→Drive เดิม

(ใส่ขั้นตอนละเอียดตรงนี้)
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
  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  draftRef.current = draft;
  savedRef.current = saved;

  const refresh = useCallback(async () => {
    try {
      const notes = await loadVatDeliverySourceNotes();
      // มีของเดิมใน Firestore → ใช้ของเดิม · ว่างจริงค่อยใส่ค่าเริ่ม (และเซฟครั้งแรก)
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
    if (!loaded || draft === saved) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist(draft);
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, saved, loaded, persist]);

  // ออกจากหน้า / รีโหลด — เซฟค้างทันที
  useEffect(() => {
    const flush = () => {
      if (!loaded) return;
      if (draftRef.current === savedRef.current) return;
      void saveVatDeliverySourceNotes(draftRef.current, actor);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [loaded, actor]);

  return (
    <section
      className="vat-table-block vat-month-process-notes"
      id="vat-month-process-notes"
      data-ai-context="vat-month-process-notes"
      aria-label="โน้ตขั้นตอนดึงยอดเดลิเวอรี่"
    >
      <h2 className="vat-table-title">โน้ตขั้นตอน · AI / Grab / เมล</h2>
      <p className="muted vat-sales-hint vat-hint-one-line">
        จดขั้นตอนตรงนี้ · เซฟอัตโนมัติ ไม่ต้องกดบันทึก
        {updatedAt
          ? ` · ${new Date(updatedAt).toLocaleString("th-TH")}`
          : ""}
        {busy
          ? " · กำลังบันทึก…"
          : loaded && draft !== saved
            ? " · รอเซฟ"
            : loaded
              ? " · บันทึกแล้ว"
              : ""}
      </p>
      {err ? <p className="error-text">{err}</p> : null}
      <pre
        id="vat-month-process-notes-text"
        className="vat-month-process-notes-mirror"
        data-ai-notes="1"
        hidden
      >
        {draft}
      </pre>
      <textarea
        className="vat-month-process-notes-input"
        value={draft}
        rows={8}
        spellCheck={false}
        aria-label="โน้ตขั้นตอนดึงยอด"
        placeholder={DEFAULT_NOTE}
        onChange={(e) => setDraft(e.target.value)}
      />
    </section>
  );
}
