"use client";

/**
 * กล่องโน้ต AI — คนไม่ต้องอ่าน · อยู่ใน DOM ให้ local AI อ่าน
 * เนื้อหาจาก Firestore · เจ้าของแก้ได้โดยไม่ deploy โครงใหม่
 */
import { useCallback, useEffect, useState } from "react";
import {
  defaultVatImportAiNotesText,
  loadVatImportAiNotes,
  saveVatImportAiNotes,
} from "@/lib/vat-import-ai-notes";

type Props = { actor: string };

export function VatImportAiScratchpad({ actor }: Props) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const notes = await loadVatImportAiNotes();
      setText(notes.text);
      setDraft(notes.text);
      setUpdatedAt(notes.updatedAt);
      setErr("");
    } catch (e) {
      setText(defaultVatImportAiNotesText());
      setDraft(defaultVatImportAiNotesText());
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSave() {
    setBusy(true);
    setErr("");
    try {
      const saved = await saveVatImportAiNotes(draft, actor);
      setText(saved.text);
      setDraft(saved.text);
      setUpdatedAt(saved.updatedAt);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      className="vat-import-ai-scratch"
      data-ai-context="vat-import-notes"
      aria-label="AI notes for VAT import"
    >
      {/* Full notes always in DOM for agents that read page text */}
      <pre
        id="vat-import-ai-notes"
        className="vat-import-ai-scratch-body"
        data-ai-notes="1"
      >
        {text || defaultVatImportAiNotesText()}
      </pre>

      <details className="vat-import-ai-scratch-edit">
        <summary title="โน้ตสำหรับ AI — คนไม่ต้องอ่าน · เจ้าของแก้ข้อความได้">
          AI
        </summary>
        <p className="muted vat-import-ai-scratch-hint">
          โน้ตสำหรับ local AI เท่านั้น · เก็บในระบบ · แก้ข้อความได้โดยไม่แก้โครงเว็บ
          {updatedAt
            ? ` · อัปเดต ${new Date(updatedAt).toLocaleString("th-TH")}`
            : " · ยังใช้ค่าเริ่ม"}
        </p>
        {err ? <p className="error-text">{err}</p> : null}
        {editing ? (
          <>
            <textarea
              className="vat-import-ai-scratch-input"
              value={draft}
              rows={12}
              spellCheck={false}
              aria-label="แก้โน้ต AI"
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="vat-month-actions vat-month-actions--mini">
              <button
                type="button"
                className="vat-mini-btn vat-mini-btn--primary"
                disabled={busy}
                onClick={() => void onSave()}
              >
                {busy ? "…" : "บันทึกโน้ต AI"}
              </button>
              <button
                type="button"
                className="vat-mini-btn"
                disabled={busy}
                onClick={() => {
                  setDraft(text);
                  setEditing(false);
                }}
              >
                ยกเลิก
              </button>
            </div>
          </>
        ) : (
          <div className="vat-month-actions vat-month-actions--mini">
            <button
              type="button"
              className="vat-mini-btn"
              onClick={() => {
                setDraft(text || defaultVatImportAiNotesText());
                setEditing(true);
              }}
            >
              แก้โน้ต AI
            </button>
            <button
              type="button"
              className="vat-mini-btn"
              onClick={() => void refresh()}
            >
              รีโหลด
            </button>
            <button
              type="button"
              className="vat-mini-btn"
              title="เขียนทับด้วยค่าเริ่มล่าสุดจากโค้ด"
              onClick={() => {
                const d = defaultVatImportAiNotesText();
                setDraft(d);
                setEditing(true);
              }}
            >
              โหลดค่าเริ่ม
            </button>
          </div>
        )}
      </details>
    </aside>
  );
}

