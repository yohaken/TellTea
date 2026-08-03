"use client";

/**
 * โนตกิจการ — แถบบน · ตาราง compact ขอบสุด · พิมพ์แล้วเซฟอัตโนมัติ
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BUSINESS_NOTES_TABS,
  compactBusinessNoteRows,
  createBusinessNoteRow,
  loadBusinessNotes,
  rowsForTab,
  saveBusinessNotes,
  type BusinessNoteRow,
  type BusinessNotesTabId,
} from "@/lib/business-notes";

type Props = { actor: string };

function withTrailingBlank(rows: BusinessNoteRow[]): BusinessNoteRow[] {
  if (rows.length === 0) return [createBusinessNoteRow("")];
  const last = rows[rows.length - 1];
  if (!last.text.trim()) return rows;
  return [...rows, createBusinessNoteRow("")];
}

function serializeTab(rows: BusinessNoteRow[]): string {
  return JSON.stringify(compactBusinessNoteRows(rows));
}

export function BusinessNotesView({ actor }: Props) {
  const [tab, setTab] = useState<BusinessNotesTabId>("general");
  const [byTab, setByTab] = useState<Record<string, BusinessNoteRow[]>>({
    general: [],
  });
  const [savedSig, setSavedSig] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const byTabRef = useRef(byTab);
  byTabRef.current = byTab;

  const draftRows = useMemo(
    () => withTrailingBlank(rowsForTab({ byTab, updatedAt: 0, updatedBy: "" }, tab)),
    [byTab, tab],
  );
  const draftSig = useMemo(() => {
    const sig: Record<string, string> = {};
    for (const [id, rows] of Object.entries(byTab)) {
      sig[id] = serializeTab(rows);
    }
    return JSON.stringify(sig);
  }, [byTab]);

  const refresh = useCallback(async () => {
    try {
      const docData = await loadBusinessNotes();
      setByTab(docData.byTab);
      const sig: Record<string, string> = {};
      for (const [id, rows] of Object.entries(docData.byTab)) {
        sig[id] = serializeTab(rows);
      }
      setSavedSig(JSON.stringify(sig));
      setUpdatedAt(docData.updatedAt);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persist = useCallback(
    async (nextByTab: Record<string, BusinessNoteRow[]>) => {
      setBusy(true);
      setErr("");
      try {
        const saved = await saveBusinessNotes(nextByTab, actor);
        // อัปเดตสถานะเซฟอย่างเดียว — ไม่ทับ draft ตอนพิมพ์อยู่
        const sig: Record<string, string> = {};
        for (const [id, rows] of Object.entries(saved.byTab)) {
          sig[id] = serializeTab(rows);
        }
        setSavedSig(JSON.stringify(sig));
        setUpdatedAt(saved.updatedAt);
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
    if (draftSig === savedSig) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist(byTabRef.current);
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draftSig, savedSig, loaded, persist]);

  useEffect(() => {
    const flush = () => {
      if (!loaded) return;
      const sig: Record<string, string> = {};
      for (const [id, rows] of Object.entries(byTabRef.current)) {
        sig[id] = serializeTab(rows);
      }
      if (JSON.stringify(sig) === savedSig) return;
      void saveBusinessNotes(byTabRef.current, actor);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [actor, loaded, savedSig]);

  const patchRow = (rowId: string, text: string) => {
    setByTab((prev) => {
      const current = rowsForTab(
        { byTab: prev, updatedAt: 0, updatedBy: "" },
        tab,
      );
      const nextRows = withTrailingBlank(
        current.map((r) =>
          r.id === rowId ? { ...r, text, updatedAt: Date.now() } : r,
        ),
      );
      return { ...prev, [tab]: nextRows };
    });
  };

  const removeRow = (rowId: string) => {
    setByTab((prev) => {
      const current = rowsForTab(
        { byTab: prev, updatedAt: 0, updatedBy: "" },
        tab,
      );
      const nextRows = withTrailingBlank(current.filter((r) => r.id !== rowId));
      return { ...prev, [tab]: nextRows };
    });
  };

  if (!loaded) {
    return <p className="muted business-notes-status">กำลังโหลดโนต…</p>;
  }

  return (
    <div className="business-notes-view">
      <nav className="business-notes-tabs" aria-label="แถบโนตกิจการ">
        {BUSINESS_NOTES_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={
              tab === t.id
                ? "business-notes-tab is-active"
                : "business-notes-tab"
            }
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="muted business-notes-status" aria-live="polite">
          {busy ? "กำลังเซฟ…" : err ? "เซฟไม่สำเร็จ" : "เซฟอัตโนมัติ"}
          {updatedAt > 0
            ? ` · ${new Date(updatedAt).toLocaleString("th-TH", {
                dateStyle: "short",
                timeStyle: "short",
              })}`
            : ""}
        </span>
      </nav>

      {err ? <p className="error-text">{err}</p> : null}

      <div className="sheet-wrap sheet-bleed business-notes-sheet">
        <table className="sheet-table sheet-table--dense business-notes-table">
          <thead>
            <tr>
              <th className="bn-col-num" scope="col">
                #
              </th>
              <th className="bn-col-text" scope="col">
                ข้อความ
              </th>
              <th className="bn-col-act" scope="col">
                <span className="sr-only">ลบ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {draftRows.map((row, idx) => {
              const isBlankTail =
                idx === draftRows.length - 1 && !row.text.trim();
              return (
                <tr key={row.id}>
                  <td className="bn-col-num">{idx + 1}</td>
                  <td className="bn-col-text">
                    <input
                      type="text"
                      className="bn-text-input"
                      value={row.text}
                      placeholder={isBlankTail ? "พิมพ์โนต…" : undefined}
                      aria-label={`โนตแถว ${idx + 1}`}
                      onChange={(e) => patchRow(row.id, e.target.value)}
                    />
                  </td>
                  <td className="bn-col-act">
                    {!isBlankTail ? (
                      <button
                        type="button"
                        className="ghost-btn bn-del"
                        title="ลบแถว"
                        aria-label={`ลบแถว ${idx + 1}`}
                        onClick={() => removeRow(row.id)}
                      >
                        ×
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
