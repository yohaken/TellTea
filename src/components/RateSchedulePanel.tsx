"use client";

import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  RATE_KIND_LABELS,
  addRateScheduleEntry,
  deleteRateScheduleEntry,
  listRateHistory,
  rateHistoryLabel,
  resolveRateForDate,
  subscribeRateSchedule,
  type RateKind,
  type RateScheduleEntry,
} from "@/lib/rate-schedule";
import { listProdProducts, type ProdProduct } from "@/lib/production";
import { formatDateShort, formatPlainNumber, todayInputValue } from "@/lib/utils";

type EditTarget = {
  kind: RateKind;
  productId?: string;
  productName?: string;
  currentRate: number | null;
  label: string;
};

type CurrentRow = {
  key: string;
  kind: RateKind;
  productId?: string;
  productName?: string;
  label: string;
  rate: number | null;
  since: number | null;
  fromSchedule: boolean;
  section?: "shop" | "prod";
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
  const [products, setProducts] = useState<ProdProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useBodyScrollLock(!!editTarget);

  useEffect(() => {
    setLoading(true);
    void listProdProducts()
      .then(setProducts)
      .catch((err) => onError((err as Error).message || "โหลดสินค้าไม่สำเร็จ"));

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

  const activeProducts = useMemo(
    () => products.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name, "th")),
    [products],
  );

  const currentRows = useMemo((): CurrentRow[] => {
    const todayMs = Date.now();
    const shop: CurrentRow[] = [
      (() => {
        const hit = resolveRateForDate(entries, "ot", todayMs);
        return {
          key: "ot",
          kind: "ot" as const,
          label: "เรทชง",
          rate: hit ? hit.rate : otSettingsFallback,
          since: hit?.effectiveFrom ?? null,
          fromSchedule: !!hit,
          section: "shop" as const,
        };
      })(),
      (() => {
        const hit = resolveRateForDate(entries, "bakerySales", todayMs);
        return {
          key: "bakerySales",
          kind: "bakerySales" as const,
          label: "เรทขายเบเกอรี่",
          rate: hit ? hit.rate : null,
          since: hit?.effectiveFrom ?? null,
          fromSchedule: !!hit,
          section: "shop" as const,
        };
      })(),
    ];

    const prodRows: CurrentRow[] = activeProducts.map((p) => {
      const hit = resolveRateForDate(entries, "bakeryProd", todayMs, { productId: p.id });
      return {
        key: `bakeryProd:${p.id}`,
        kind: "bakeryProd" as const,
        productId: p.id,
        productName: p.name,
        label: `ผลิต · ${p.name}`,
        rate: hit ? hit.rate : Number(p.prodRate) || 0,
        since: hit?.effectiveFrom ?? null,
        fromSchedule: !!hit,
        section: "prod" as const,
      };
    });

    return [...shop, ...prodRows];
  }, [entries, otSettingsFallback, activeProducts]);

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

  function openEdit(row: CurrentRow) {
    if (!isOwner) return;
    setEditTarget({
      kind: row.kind,
      productId: row.productId,
      productName: row.productName,
      currentRate: row.rate,
      label: row.label,
    });
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
              {currentRows.map((row, idx) => {
                const prev = currentRows[idx - 1];
                const showProdHead = row.section === "prod" && prev?.section !== "prod";
                const rateLabel =
                  row.rate == null ? "—" : formatPlainNumber(row.rate);
                const sinceLabel =
                  row.fromSchedule && row.since != null
                    ? formatDateShort(row.since)
                    : "—";
                return (
                  <Fragment key={row.key}>
                    {showProdHead ? (
                      <tr className="bonus-rate-section-row">
                        <td colSpan={3}>เรทผลิต (แยกสินค้า)</td>
                      </tr>
                    ) : null}
                    <tr>
                      <td>{row.label}</td>
                      <td className="col-out">
                        {isOwner ? (
                          <button
                            type="button"
                            className="bonus-edit-cell"
                            onClick={() => openEdit(row)}
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
                            onClick={() => openEdit(row)}
                            title="แตะเพื่อตั้งวันเริ่มใช้"
                          >
                            {sinceLabel}
                          </button>
                        ) : (
                          sinceLabel
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="muted bonus-rate-schedule-hint">
            {isOwner
              ? "แตะเรทหรือวันเริ่มใช้เพื่อตั้งช่วงใหม่ · แถวชง/ผลิตเก่าไม่เปลี่ยนเรท"
              : "เรทที่ใช้ตอนนี้ · แถวชง/ผลิตที่บันทึกแล้วไม่เปลี่ยนตามตารางนี้"}
          </p>
          {!activeProducts.length ? (
            <p className="muted bonus-rate-empty">
              ยังไม่มีสินค้าผลิต — เพิ่มที่หน้าตั้งค่าก่อน แล้วกลับมาตั้งเรทได้
            </p>
          ) : null}
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
                    <td>{rateHistoryLabel(row)}</td>
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

      {editTarget && isOwner ? (
        <RateScheduleEditModal
          target={editTarget}
          actorId={actorId}
          onClose={() => setEditTarget(null)}
          onError={onError}
        />
      ) : null}
    </section>
  );
}

function RateScheduleEditModal({
  target,
  actorId,
  onClose,
  onError,
}: {
  target: EditTarget;
  actorId: string;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(todayInputValue());
  const [rate, setRate] = useState(
    target.currentRate != null ? String(target.currentRate) : "",
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!actorId) return;
    setBusy(true);
    try {
      await addRateScheduleEntry({
        kind: target.kind,
        productId: target.productId,
        productName: target.productName,
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

  const title =
    target.kind === "bakeryProd"
      ? `ตั้งเรทผลิต — ${target.productName || "สินค้า"}`
      : `ตั้งเรท — ${RATE_KIND_LABELS[target.kind]}`;

  return (
    <div className="modal-backdrop edit-modal is-module-form" onClick={onClose}>
      <form
        className="modal-card module-form-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void onSubmit(e)}
      >
        <h2 className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>
          {title}
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
