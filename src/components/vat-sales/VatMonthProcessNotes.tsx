"use client";

/**
 * โน้ตขั้นตอนปิดงบเดลิเวอรี่ — ด้านบน /vat-sales/
 * เจ้าของจดวิธี (เช่น AI คุม Chrome อ่าน Grab / เมล) · อยู่ใน DOM ให้ AI อ่านได้
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
  const [draft, setDraft] = useState(DEFAULT_NOTE);
  const [saved, setSaved] = useState(DEFAULT_NOTE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const notes = await loadVatDeliverySourceNotes();
      const text = notes.text.trim() ? notes.text : DEFAULT_NOTE;
      setDraft(text);
      setSaved(text);
      setUpdatedAt(notes.updatedAt);
      setErr("");
    } catch (e) {
      setDraft(DEFAULT_NOTE);
      setSaved(DEFAULT_NOTE);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!loaded || draft === saved) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        setBusy(true);
        setErr("");
        try {
          const next = await saveVatDeliverySourceNotes(draft, actor);
          setSaved(next.text);
          setUpdatedAt(next.updatedAt);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      })();
    }, 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, saved, loaded, actor]);

  return (
    <section
      className="vat-table-block vat-month-process-notes"
      id="vat-month-process-notes"
      data-ai-context="vat-month-process-notes"
      aria-label="โน้ตขั้นตอนดึงยอดเดลิเวอรี่"
    >
      <h2 className="vat-table-title">โน้ตขั้นตอน · AI / Grab / เมล</h2>
      <p className="muted vat-sales-hint vat-hint-one-line">
        จดขั้นตอนตรงนี้ — AI คุม Chrome อ่านเว็บ/เมลได้ข้อมูลตรงกว่า · เซฟอัตโนมัติ
        {updatedAt
          ? ` · ${new Date(updatedAt).toLocaleString("th-TH")}`
          : ""}
        {busy ? " · กำลังบันทึก…" : draft !== saved ? " · รอเซฟ" : ""}
      </p>
      {err ? <p className="error-text">{err}</p> : null}
      {/* ข้อความเต็มใน DOM ให้ agent อ่าน */}
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
