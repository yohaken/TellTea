"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  RATE_KIND_LABELS,
  addRateScheduleEntry,
  deleteRateScheduleEntry,
  listRateHistory,
  resolveRateForDate,
  subscribeRateSchedule,
  type RateKind,
  type RateScheduleEntry,
} from "@/lib/rate-schedule";
import { formatDateShort, formatPlainNumber, todayInputValue } from "@/lib/utils";

const KINDS: RateKind[] = ["ot", "bakerySales"];

const SHORT_LABELS: Record<RateKind, string> = {
  ot: "เรทชง",
  bakerySales: "เรทขายเบเกอรี่",
};

type CurrentRow = {
  kind: RateKind;
  rate: number | null;
  since: number | null;
  fromSchedule: boolean;
};

export function RateSchedulePanel({
  isOwner,
  actorId,
  otSettingsFallback,
  onError,
}: {
  isOwner: boolean;
  actorId: string;
  /** เรทชงจาก meta/otSettings — แสดงเมื่อยังไม่มีในตาราง */
  otSettingsFallback: number;
  onError: (msg: string) => void;
}) {
  const [entries, setEntries] = useState<RateScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [editKind, setEditKind] = useState<RateKind | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useBodyScrollLock(!!editKind);

  useEffect(() => {
    setLoading(true);
    return subscribeRateSchedule(
      (doc) => {
        setEntries(doc.entries);
        setLoading(false);
      },
      (err) => {
        onError(err.message || "โหลดตารางเรทไม่สำเร็จ");
        setLoading(false);
      },
    );
  }, [onError]);

  const history = useMemo(() => listRateHistory(entries), [entries]);

  const currentRows = useMemo((): CurrentRow[] => {
    const todayMs = Date.now();
    return KINDS.map((kind) => {
      const hit = resolveRateForDate(entries, kind, todayMs);
      if (hit) {
        return {
          kind,
          rate: hit.rate,
          since: hit.effectiveFrom,
          fromSchedule: true,
        };
      }
      if (kind === "ot") {
        return {
          kind,
          rate: otSettingsFallback,
          since: null,
          fromSchedule: false,
        };
      }
      return { kind, rate: null, since: null, fromSchedule: false };
    });
  }, [entries, otSettingsFallback]);

  async function onDelete(id: string) {
    if (!isOwner) return;
    if (!window.confirm("ลบช่วงเรทนี้? รายการชง/ผลิตที่บันทึกแล้วจะไม่เปลี่ยน")) return;
    setDeletingId(id);
    try {
      await deleteRateScheduleEntry(id);
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="bonus-rate-schedule">
      <header className="bonus-rate-schedule-head">
        <h2 className="bonus-rate-schedule-title">ตารางเรท</h2>
      </header>

      {loading ? <p className="empty">กำลังโหลดตารางเรท...</p> : null}

      {!loading ? (
        <div className="sheet-wrap bonus-rate-current-wrap">
          <table className="sheet-table bonus-rate-current-table">
            <thead>
              <tr>
                <th>รายการ</th>
                <th className="col-out">เรท</th>
                <th>เริ่มใช้</th>
              </tr>
            </thead>
            <tbody>
              {currentRows.map((row) => {
                const rateLabel =
                  row.rate == null ? "—" : formatPlainNumber(row.rate);
                const sinceLabel =
                  row.fromSchedule && row.since != null
                    ? formatDateShort(row.since)
                    : "—";
                return (
                  <tr key={row.kind}>
                    <td>{SHORT_LABELS[row.kind]}</td>
                    <td className="col-out">
                      {isOwner ? (
                        <button
                          type="button"
                          className="bonus-edit-cell"
                          onClick={() => setEditKind(row.kind)}
                          title="แตะเพื่อตั้งเรทช่วงใหม่"
                        >
                          {rateLabel}
                        </button>
                      ) : (
                        rateLabel
                      )}
                    </td>
                    <td>
                      {isOwner ? (
                        <button
                          type="button"
                          className="bonus-edit-cell"
                          onClick={() => setEditKind(row.kind)}
                          title="แตะเพื่อตั้งวันเริ่มใช้"
                        >
                          {sinceLabel}
                        </button>
                      ) : (
                        sinceLabel
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted bonus-rate-schedule-hint">
            {isOwner
              ? "แตะเรทหรือวันเริ่มใช้เพื่อตั้งช่วงใหม่ · แถวชง/ผลิตเก่าไม่เปลี่ยนเรท"
              : "เรทที่ใช้ตอนนี้ · แถวชง/ผลิตที่บันทึกแล้วไม่เปลี่ยนตามตารางนี้"}
          </p>
        </div>
      ) : null}

      {!loading ? (
        <button
          type="button"
          className="ghost-btn bonus-rate-history-toggle"
          onClick={() => setShowHistory((v) => !v)}
        >
          {showHistory
            ? "ซ่อนประวัติเรท"
            : history.length
              ? `ดูประวัติเรท (${history.length})`
              : "ดูประวัติเรท"}
        </button>
      ) : null}

      {!loading && showHistory ? (
        history.length ? (
          <div className="sheet-wrap bonus-rate-history-wrap">
            <table className="sheet-table bonus-rate-history-table">
              <thead>
                <tr>
                  <th>ชนิด</th>
                  <th>เริ่มใช้</th>
                  <th className="col-out">เรท</th>
                  <th>หมายเหตุ</th>
                  {isOwner ? <th className="col-out" /> : null}
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{SHORT_LABELS[row.kind]}</td>
                    <td>{formatDateShort(row.effectiveFrom)}</td>
                    <td className="col-out">{formatPlainNumber(row.rate)}</td>
                    <td className="muted">{row.note || "—"}</td>
                    {isOwner ? (
                      <td className="col-out">
                        <button
                          type="button"
                          className="ghost-btn bonus-rate-del"
                          disabled={deletingId === row.id}
                          onClick={() => void onDelete(row.id)}
                          title="ลบช่วงนี้"
                        >
                          ลบ
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted bonus-rate-empty">
            ยังไม่มีประวัติเรท
            {isOwner ? " — แตะเรทในตารางเพื่อตั้งช่วงแรก" : ""}
          </p>
        )
      ) : null}

      {editKind && isOwner ? (
        <RateScheduleEditModal
          kind={editKind}
          currentRate={currentRows.find((r) => r.kind === editKind)?.rate ?? null}
          actorId={actorId}
          onClose={() => setEditKind(null)}
          onError={onError}
        />
      ) : null}
    </section>
  );
}

function RateScheduleEditModal({
  kind,
  currentRate,
  actorId,
  onClose,
  onError,
}: {
  kind: RateKind;
  currentRate: number | null;
  actorId: string;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(todayInputValue());
  const [rate, setRate] = useState(
    currentRate != null ? String(currentRate) : "",
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!actorId) return;
    setBusy(true);
    try {
      await addRateScheduleEntry({
        kind,
        effectiveFromInput: effectiveFrom,
        rate: Number(rate),
        note: note.trim() || undefined,
        createdBy: actorId,
      });
      onClose();
    } catch (err) {
      onError((err as Error).message || "บันทึกเรทไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop edit-modal is-module-form" onClick={onClose}>
      <form
        className="modal-card module-form-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void onSubmit(e)}
      >
        <h2 className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>
          ตั้งเรท — {RATE_KIND_LABELS[kind]}
        </h2>

        <div className="field">
          <label htmlFor="rate-edit-value">เรท (บาทต่อหน่วย)</label>
          <input
            id="rate-edit-value"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="rate-edit-from">วันเริ่มใช้</label>
          <input
            id="rate-edit-from"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="rate-edit-note">หมายเหตุ (ถ้ามี)</label>
          <input
            id="rate-edit-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="เช่น ปรับปี 2026"
          />
          <p className="muted form-hint-inline">
            ใช้กับรายการใหม่หลังวันเริ่มใช้ — แถวเก่าในตารางไม่เปลี่ยน
          </p>
        </div>

        <div className="module-form-actions">
          <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          <button type="submit" className="primary-btn" disabled={busy || !actorId}>
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </form>
    </div>
  );
}
