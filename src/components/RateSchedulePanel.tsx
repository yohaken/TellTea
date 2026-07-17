"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  const [kind, setKind] = useState<RateKind>("ot");
  const [effectiveFrom, setEffectiveFrom] = useState(todayInputValue());
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const currentByKind = useMemo(() => {
    const todayMs = Date.now();
    const out: Record<RateKind, { rate: number; since: number | null; fromSchedule: boolean }> = {
      ot: { rate: otSettingsFallback, since: null, fromSchedule: false },
      bakerySales: { rate: 0, since: null, fromSchedule: false },
    };
    for (const k of KINDS) {
      const hit = resolveRateForDate(entries, k, todayMs);
      if (hit) {
        out[k] = { rate: hit.rate, since: hit.effectiveFrom, fromSchedule: true };
      } else if (k === "ot") {
        out.ot = { rate: otSettingsFallback, since: null, fromSchedule: false };
      }
    }
    return out;
  }, [entries, otSettingsFallback]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!isOwner || !actorId) return;
    setBusy(true);
    try {
      await addRateScheduleEntry({
        kind,
        effectiveFromInput: effectiveFrom,
        rate: Number(rate),
        note: note.trim() || undefined,
        createdBy: actorId,
      });
      setRate("");
      setNote("");
      setEffectiveFrom(todayInputValue());
    } catch (err) {
      onError((err as Error).message || "บันทึกเรทไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

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
        <h2 className="bonus-rate-schedule-title">ตารางเรทตามวัน</h2>
        <p className="muted bonus-rate-schedule-hint">
          เรทใหม่ใช้กับรายการที่บันทึกหลังวันเริ่มใช้เท่านั้น — แถวชง/ผลิตที่มีเรทติดอยู่แล้วไม่ถูกแก้
        </p>
      </header>

      <div className="bonus-rate-current">
        {KINDS.map((k) => {
          const cur = currentByKind[k];
          return (
            <div key={k} className="bonus-rate-current-item">
              <span className="bonus-rate-current-label">{RATE_KIND_LABELS[k]}</span>
              <strong className="bonus-rate-current-val">
                {formatPlainNumber(cur.rate)}
              </strong>
              <span className="muted bonus-rate-current-since">
                {cur.fromSchedule && cur.since != null
                  ? `ตั้งแต่ ${formatDateShort(cur.since)}`
                  : k === "ot"
                    ? "จากตั้งค่า (ยังไม่มีในตาราง)"
                    : "ใช้เรทสินค้า (ยังไม่มีในตาราง)"}
              </span>
            </div>
          );
        })}
      </div>

      {isOwner ? (
        <form className="bonus-rate-add-form" onSubmit={(e) => void onAdd(e)}>
          <div className="field">
            <label htmlFor="rate-kind">ชนิด</label>
            <select
              id="rate-kind"
              className="ot-slim-input"
              value={kind}
              onChange={(e) => setKind(e.target.value as RateKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {RATE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rate-from">วันเริ่มใช้</label>
            <input
              id="rate-from"
              type="date"
              className="ot-slim-input"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="rate-value">เรท (บาท)</label>
            <input
              id="rate-value"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              className="ot-slim-input"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="เช่น 0.6"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="rate-note">หมายเหตุ (ถ้ามี)</label>
            <input
              id="rate-note"
              type="text"
              className="ot-slim-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="เช่น ปรับปี 2026"
            />
          </div>
          <button type="submit" className="primary-btn" disabled={busy || !actorId}>
            {busy ? "กำลังบันทึก..." : "เพิ่มช่วงเรท"}
          </button>
        </form>
      ) : null}

      {loading ? <p className="empty">กำลังโหลดตารางเรท...</p> : null}

      {!loading && !history.length ? (
        <p className="muted bonus-rate-empty">ยังไม่มีประวัติเรท — เจ้าของเพิ่มวันเริ่มใช้ด้านบนได้</p>
      ) : null}

      {!loading && history.length ? (
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
                  <td>{RATE_KIND_LABELS[row.kind]}</td>
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
      ) : null}
    </section>
  );
}
