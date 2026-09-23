"use client";

import { useMemo, useState } from "react";
import {
  PROD_PHOTO_QA_LOOKBACK_DAYS,
  buildOwnerManualFlagPhotoQa,
  scanProdPhotoQaBatch,
  shouldRunProdPhotoConflictAi,
  type ProdPhotoQaBatchReport,
  type ProdPhotoQaScanRow,
} from "@/lib/prod-photo-qa";
import type { ProdPhotoQa, ProdProduct } from "@/lib/production";
import { formatDateShort } from "@/lib/utils";

/**
 * Owner-only: AI retrospective conflict scan + manual flag when AI fails.
 * Results (flagged) persist on entries — staff see red rows / badges on their list.
 */
export function ProdPhotoQaBatchPanel({
  rows,
  products,
  onUpdatePhotoQa,
  onPickEntry,
  className,
}: {
  rows: ProdPhotoQaScanRow[];
  products: Pick<ProdProduct, "id" | "name">[];
  onUpdatePhotoQa: (entryId: string, photoQa: ProdPhotoQa) => Promise<void>;
  onPickEntry?: (entryId: string) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ProdPhotoQaBatchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [manualBusy, setManualBusy] = useState(false);

  const eligible = useMemo(
    () =>
      rows.filter((r) => {
        const urls = r.imageUrls || [];
        if (!urls.length) return false;
        if (!shouldRunProdPhotoConflictAi(r.productName)) return false;
        const s = r.photoQa?.verifyStatus;
        return !s || s === "skipped" || s === "pending";
      }).length,
    [rows],
  );

  const manualCandidates = useMemo(() => {
    const ids = new Set<string>();
    if (report) {
      for (const id of report.flaggedIds) ids.add(id);
      for (const e of report.errors) ids.add(e.entryId);
    }
    for (const r of rows) {
      const s = r.photoQa?.verifyStatus;
      if (s === "pending" || s === "skipped") ids.add(r.entryId);
    }
    return rows.filter((r) => ids.has(r.entryId) && (r.imageUrls || []).length > 0);
  }, [rows, report]);

  async function runScan() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await scanProdPhotoQaBatch(rows, {
        products,
        lookbackDays: PROD_PHOTO_QA_LOOKBACK_DAYS,
        updateEntry: onUpdatePhotoQa,
      });
      setReport(next);
      setOpen(true);
      // Pre-select AI-failed rows so owner can manual-flag in one tap
      const failIds = new Set<string>();
      for (const e of next.errors) failIds.add(e.entryId);
      // pending from this scan counted in skipped
      for (const r of rows) {
        if (next.flaggedIds.includes(r.entryId)) continue;
        // after scan, pending = AI outage holds
      }
      setSelected(failIds);
    } catch (err) {
      setError((err as Error).message || "สแกนขัดแย้งไม่สำเร็จ");
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function flagSelected() {
    if (manualBusy || !selected.size) return;
    const ids = [...selected];
    setManualBusy(true);
    setError(null);
    try {
      let n = 0;
      const flaggedNow: string[] = [];
      for (const id of ids) {
        const row = rows.find((r) => r.entryId === id);
        if (!row) continue;
        if (row.photoQa?.verifyStatus === "flagged") continue;
        const photoQa = buildOwnerManualFlagPhotoQa({
          productId: row.productId,
          productName: row.productName,
          previous: row.photoQa,
          reason: "เจ้าของติดป้ายมือ — รูปไม่ตรงสินค้า",
        });
        await onUpdatePhotoQa(id, photoQa);
        n += 1;
        flaggedNow.push(id);
      }
      setSelected(new Set());
      setOpen(true);
      setReport((prev) =>
        prev
          ? {
              ...prev,
              flagged: prev.flagged + n,
              flaggedIds: [...new Set([...prev.flaggedIds, ...flaggedNow])],
            }
          : {
              windowStart: Date.now() - PROD_PHOTO_QA_LOOKBACK_DAYS * 86400000,
              windowEnd: Date.now(),
              scanned: 0,
              flagged: n,
              ok: 0,
              skipped: 0,
              errors: [],
              flaggedIds: flaggedNow,
            },
      );
    } catch (err) {
      setError((err as Error).message || "ติดป้ายไม่สำเร็จ");
    } finally {
      setManualBusy(false);
    }
  }

  return (
    <div className={["photo-forensics-panel", "prod-photo-qa-panel", className].filter(Boolean).join(" ")}>
      <div className="photo-forensics-bar">
        <button
          type="button"
          className="ghost-btn bulk-status-chip"
          disabled={busy || !eligible}
          onClick={() => void runScan()}
          title={`เจ้าของ · AI ย้อน ${PROD_PHOTO_QA_LOOKBACK_DAYS} วัน · ผลติดธงให้พนักงานเห็นด้วย`}
        >
          {busy ? "กำลังตรวจขัดแย้ง…" : `ขัดแย้ง ${PROD_PHOTO_QA_LOOKBACK_DAYS} วัน`}
        </button>
        <button
          type="button"
          className="ghost-btn bulk-status-chip"
          disabled={manualBusy || !selected.size}
          onClick={() => void flagSelected()}
          title="ติดป้ายมือรายการที่เลือก (เมื่อ AI ไม่ได้ผลหรือตรวจเอง)"
        >
          {manualBusy ? "กำลังติดป้าย…" : `ติดป้ายที่เลือก (${selected.size})`}
        </button>
        {report || manualCandidates.length ? (
          <button
            type="button"
            className="ghost-btn bulk-status-chip"
            onClick={() => setOpen((v) => !v)}
          >
            {report?.flagged
              ? `ธง ${report.flagged}${open ? " ▴" : " ▾"}`
              : `เลือกติดป้าย${open ? " ▴" : " ▾"}`}
          </button>
        ) : (
          <span className="muted photo-forensics-hint">
            เจ้าของสแกน AI · พนักงานเห็นแถบแดง · AI ไม่ได้ผล → เลือกติดป้ายมือ
          </span>
        )}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {open ? (
        <div className="photo-forensics-body">
          {report ? (
            <p className="muted photo-forensics-summary">
              {formatDateShort(report.windowStart)}–{formatDateShort(report.windowEnd)} · สแกน{" "}
              {report.scanned} · AI ติดธง {report.flagged} · ผ่าน {report.ok} · AI ไม่พร้อม{" "}
              {report.skipped}
              {report.errors.length ? ` · ผิดพลาด ${report.errors.length}` : ""}
            </p>
          ) : (
            <p className="muted photo-forensics-summary">
              เลือกรายการด้านล่างแล้วกด «ติดป้ายที่เลือก» — พนักงานจะเห็นแถบแดงทันที
            </p>
          )}
          {manualCandidates.length ? (
            <ul className="photo-forensics-list prod-photo-qa-select-list">
              {manualCandidates.slice(0, 40).map((row) => {
                const held = row.photoQa?.verifyStatus === "flagged";
                const pending = row.photoQa?.verifyStatus === "pending";
                return (
                  <li key={`qa-sel-${row.entryId}`}>
                    <label className="prod-photo-qa-select-row">
                      <input
                        type="checkbox"
                        checked={selected.has(row.entryId)}
                        disabled={held}
                        onChange={() => toggle(row.entryId)}
                      />
                      <button
                        type="button"
                        className="linkish-btn"
                        onClick={() => onPickEntry?.(row.entryId)}
                      >
                        {row.label}
                      </button>
                      <span className="photo-forensics-tag">
                        {held ? "ติดธงแล้ว" : pending ? "AI ไม่พร้อม" : "รอเลือก"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted photo-forensics-hint">ยังไม่มีรายการให้เลือกติดป้าย</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
