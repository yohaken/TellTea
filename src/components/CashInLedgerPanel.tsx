"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { EntryTimestampsMeta } from "@/components/EntryTimestampsMeta";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import {
  addCashDeposit,
  CASH_DEPOSIT_BANK_SLIP_MAX,
  CASH_DEPOSIT_DAY_MAX,
  CASH_DEPOSIT_DAY_SLIP_MAX,
  CASH_DEPOSIT_LIVE_MAX,
  CASH_DEPOSIT_PAGE_SIZE,
  cashDepositVariance,
  type CashDeposit,
  type CashDepositDayLine,
  type CashDepositStatus,
  type CashSlipKind,
  defaultCashPeriodStart,
  deleteCashDeposit,
  emptyCashDepositDay,
  labelCashDepositStatus,
  labelCashSlipKind,
  subscribeCashDepositsPage,
  sumCashDepositDays,
  updateCashDeposit,
  verifyCashDeposit,
} from "@/lib/cash-deposits";
import {
  formatDateShort,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

const OPEN_KEY = "telltea_cash_in_panel_open_v1";

function readOpenPref() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpenPref(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function toDateInput(ms: number) {
  if (!ms) return todayInputValue();
  return todayInputValue(new Date(ms));
}

function statusClass(status: CashDepositStatus) {
  switch (status) {
    case "matched":
      return "cash-in-status is-matched";
    case "mismatch":
      return "cash-in-status is-mismatch";
    case "void":
      return "cash-in-status is-void";
    default:
      return "cash-in-status is-pending";
  }
}

/** Collapsible cash-in reconcile table — sits above daily ledger, default collapsed (≈ weekly). */
export function CashInLedgerPanel({
  actorId,
  isOwner,
  staffName,
  forceOpen = false,
  onForceOpenConsumed,
}: {
  actorId: string;
  isOwner: boolean;
  staffName: string;
  /** Open once (e.g. ?cashIn=1) then clear */
  forceOpen?: boolean;
  onForceOpenConsumed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CashDeposit[]>([]);
  const [liveLimit, setLiveLimit] = useState(CASH_DEPOSIT_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CashDeposit | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    urls: string[];
    title: string;
  } | null>(null);

  useEffect(() => {
    setOpen(readOpenPref());
  }, []);

  useEffect(() => {
    if (!forceOpen) return;
    setOpen(true);
    writeOpenPref(true);
    onForceOpenConsumed?.();
  }, [forceOpen, onForceOpenConsumed]);

  useBodyScrollLock(adding || !!editing || !!imagePreview);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    return subscribeCashDepositsPage(
      liveLimit,
      (page) => {
        setEntries(page.entries);
        setHasMore(page.hasMore && liveLimit < CASH_DEPOSIT_LIVE_MAX);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setError(err.message || "โหลดตารางไม่สำเร็จ");
      },
    );
  }, [open, liveLimit]);

  // Light pending badge even when collapsed
  useEffect(() => {
    if (open) return;
    return subscribeCashDepositsPage(
      20,
      (page) => {
        setEntries(page.entries);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [open]);

  const pendingCount = useMemo(
    () => entries.filter((e) => e.status === "pending").length,
    [entries],
  );

  function toggle() {
    setOpen((v) => {
      const next = !v;
      writeOpenPref(next);
      return next;
    });
  }

  return (
    <aside className="cash-in-panel" aria-label="ตารางเทียบเงินนำเข้า">
      <button
        type="button"
        className="cash-in-panel-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="cash-in-panel-toggle-left">
          <span className="cash-in-panel-title">เทียบเงินนำเข้า</span>
          <span className="cash-in-panel-meta">
            {loading && !entries.length
              ? "…"
              : pendingCount > 0
                ? `รอตรวจ ${pendingCount}`
                : "อาทิตย์ละครั้ง · หุบไว้ได้"}
          </span>
        </span>
        {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
      </button>

      {open ? (
        <div className="cash-in-panel-body">
          <p className="muted cash-in-hint">
            แนบสลิป POS ทีละวันในรอบโอน · รวมยอดเทียบกับสลิปธนาคาร · AI ช่วยอ่านยอดจะต่อทีหลัง
          </p>
          {error ? <p className="error-text">{error}</p> : null}
          {loading && !entries.length ? <p className="empty">กำลังโหลด...</p> : null}
          {!loading && entries.length === 0 ? (
            <p className="empty">ยังไม่มีรอบนำเข้า</p>
          ) : entries.length ? (
            <div className="sheet-wrap cash-in-panel-table-wrap">
              <table className="sheet-table cash-in-table">
                <thead>
                  <tr>
                    <th className="col-date">โอน</th>
                    <th className="col-desc">ช่วง</th>
                    <th className="col-num">สลิป</th>
                    <th className="col-num">ธนาคาร</th>
                    <th className="col-num">±</th>
                    <th className="col-type">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((row) => {
                    const slips = [
                      ...row.bankSlipUrls,
                      ...row.days.flatMap((d) => d.slipUrls),
                    ];
                    return (
                      <tr key={row.id} className={row.status === "void" ? "is-void-row" : undefined}>
                        <td className="col-date">{formatDateShort(row.transferDate)}</td>
                        <td className="col-desc">
                          <div className="desc-with-photo">
                            <button
                              type="button"
                              className="desc-link"
                              title="แตะเพื่อดู/แก้ไข"
                              onClick={() => setEditing(row)}
                            >
                              {formatDateShort(row.periodStart)}–{formatDateShort(row.periodEnd)}
                              <span className="cash-in-staff"> · {row.staffName || "—"}</span>
                            </button>
                            {slips.length ? (
                              <EntryPhotoIndicator
                                imageUrls={slips}
                                label="สลิป"
                                onView={(urls) =>
                                  setImagePreview({ urls, title: `เงินนำเข้า · ${row.staffName}` })
                                }
                              />
                            ) : null}
                          </div>
                        </td>
                        <td className="col-num">{formatPlainNumber(row.expectedCashTotal)}</td>
                        <td className="col-num">{formatPlainNumber(row.bankAmount)}</td>
                        <td
                          className={[
                            "col-num",
                            row.variance === 0 ? "cash-in-var-ok" : "cash-in-var-off",
                          ].join(" ")}
                        >
                          {row.variance === 0
                            ? "0"
                            : `${row.variance > 0 ? "+" : ""}${formatPlainNumber(row.variance)}`}
                        </td>
                        <td className="col-type">
                          <span className={statusClass(row.status)}>
                            {labelCashDepositStatus(row.status)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {!loading && hasMore ? (
            <button
              type="button"
              className="ghost-btn"
              style={{ width: "100%", marginTop: "0.35rem" }}
              onClick={() =>
                setLiveLimit((n) => Math.min(n + CASH_DEPOSIT_PAGE_SIZE, CASH_DEPOSIT_LIVE_MAX))
              }
            >
              โหลดเพิ่ม
            </button>
          ) : null}
          <button
            type="button"
            className="primary-btn action-in cash-in-panel-add"
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
          >
            + บันทึกรอบนำเข้า
          </button>
        </div>
      ) : null}

      {adding && actorId ? (
        <CashDepositFormModal
          mode="add"
          createdBy={actorId}
          defaultStaffName={staffName}
          isOwner={isOwner}
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
          onError={setError}
          onPreview={(urls, title) => setImagePreview({ urls, title })}
        />
      ) : null}

      {editing && actorId ? (
        <CashDepositFormModal
          mode="edit"
          entry={editing}
          createdBy={actorId}
          defaultStaffName={staffName}
          isOwner={isOwner}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onError={setError}
          onPreview={(urls, title) => setImagePreview({ urls, title })}
        />
      ) : null}

      {imagePreview ? (
        <ImagePreviewModal
          urls={imagePreview.urls}
          title={imagePreview.title}
          showCaptureMeta={isOwner}
          onClose={() => setImagePreview(null)}
        />
      ) : null}
    </aside>
  );
}

function CashDepositFormModal({
  mode,
  entry,
  createdBy,
  defaultStaffName,
  isOwner,
  onClose,
  onSaved,
  onError,
  onPreview,
}: {
  mode: "add" | "edit";
  entry?: CashDeposit;
  createdBy: string;
  defaultStaffName: string;
  isOwner: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
  onPreview: (urls: string[], title: string) => void;
}) {
  const [transferDate, setTransferDate] = useState(
    toDateInput(entry?.transferDate || Date.now()),
  );
  const [periodStart, setPeriodStart] = useState(() => {
    if (entry) return toDateInput(entry.periodStart);
    const t = parseDateInput(todayInputValue());
    return toDateInput(defaultCashPeriodStart(t));
  });
  const [periodEnd, setPeriodEnd] = useState(
    toDateInput(entry?.periodEnd || Date.now()),
  );
  const [staffName, setStaffName] = useState(entry?.staffName || defaultStaffName);
  const [bankAmount, setBankAmount] = useState(
    entry ? String(entry.bankAmount) : "",
  );
  const [bankRef, setBankRef] = useState(entry?.bankRef || "");
  const [note, setNote] = useState(entry?.note || "");
  const [bankSlipUrls, setBankSlipUrls] = useState<string[]>(entry?.bankSlipUrls || []);
  const [days, setDays] = useState<CashDepositDayLine[]>(() =>
    entry?.days?.length
      ? entry.days.map((d) => ({ ...d, slipUrls: [...d.slipUrls] }))
      : [emptyCashDepositDay(parseDateInput(periodEnd))],
  );
  const [ownerNote, setOwnerNote] = useState(entry?.ownerNote || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expected = sumCashDepositDays(
    days.map((d) => ({ cashAmount: Number(d.cashAmount) || 0 })),
  );
  const bank = Number(bankAmount) || 0;
  const variance = cashDepositVariance(bank, expected);

  function report(msg: string) {
    setError(msg);
    onError(msg);
  }

  function updateDay(id: string, patch: Partial<CashDepositDayLine>) {
    setDays((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function addDay() {
    if (days.length >= CASH_DEPOSIT_DAY_MAX) {
      report(`สูงสุด ${CASH_DEPOSIT_DAY_MAX} วันต่อรอบ`);
      return;
    }
    const base = days.length
      ? Math.max(...days.map((d) => d.date))
      : parseDateInput(periodStart);
    const next = new Date(base);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    setDays((prev) => [...prev, emptyCashDepositDay(next.getTime())]);
  }

  function removeDay(id: string) {
    setDays((prev) => (prev.length <= 1 ? prev : prev.filter((d) => d.id !== id)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        transferDate: parseDateInput(transferDate),
        periodStart: parseDateInput(periodStart),
        periodEnd: parseDateInput(periodEnd),
        staffName,
        bankAmount: bank,
        bankSlipUrls,
        bankRef,
        note,
        days: days.map((d) => ({
          ...d,
          cashAmount: Number(d.cashAmount) || 0,
        })),
      };
      if (mode === "add") {
        await addCashDeposit({ ...payload, createdBy });
      } else if (entry) {
        await updateCashDeposit(entry.id, payload);
      }
      onSaved();
    } catch (err) {
      report((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(status: Exclude<CashDepositStatus, "pending">) {
    if (!entry || !isOwner) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCashDeposit({
        id: entry.id,
        status,
        ownerNote,
        verifiedBy: createdBy,
      });
      onSaved();
    } catch (err) {
      report((err as Error).message || "บันทึกผลตรวจไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!entry) return;
    if (!window.confirm("ลบรายการเงินนำเข้านี้?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCashDeposit(entry.id);
      onSaved();
    } catch (err) {
      report((err as Error).message || "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop edit-modal is-module-form cash-in-form-modal"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "add" ? "บันทึกเงินนำเข้า" : "รายละเอียดเงินนำเข้า"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">
            {mode === "add" ? "บันทึกเงินนำเข้า" : "เทียบเงินนำเข้า"}
          </h2>
          <button
            type="button"
            className="ghost-btn icon-btn"
            aria-label="ปิด"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <p className="muted form-hint-inline">
          แนบสลิปโอนธนาคาร + สลิปสรุป POS แต่ละวัน (กะหรือรายวันก็ได้) ·
          ระบบคำนวณผลต่างให้อัตโนมัติ
        </p>
        {error ? <p className="error-text">{error}</p> : null}

        <form className="form-card module-entry-form cash-in-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="field-row cash-in-field-row">
            <div className="field">
              <label htmlFor="cash-in-transfer-date">วันที่โอนเข้า บช.</label>
              <input
                id="cash-in-transfer-date"
                type="date"
                value={transferDate}
                onChange={(e) => {
                  setTransferDate(e.target.value);
                  if (mode === "add") {
                    try {
                      const t = parseDateInput(e.target.value);
                      setPeriodStart(toDateInput(defaultCashPeriodStart(t)));
                      setPeriodEnd(e.target.value);
                    } catch {
                      /* ignore */
                    }
                  }
                }}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="cash-in-bank-amount">ยอดโอนธนาคาร</label>
              <input
                id="cash-in-bank-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={bankAmount}
                onChange={(e) => setBankAmount(e.target.value)}
                placeholder="13435"
                required
              />
            </div>
          </div>

          <div className="field-row cash-in-field-row">
            <div className="field">
              <label htmlFor="cash-in-period-start">ช่วงเงินสด เริ่ม</label>
              <input
                id="cash-in-period-start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="cash-in-period-end">ถึง</label>
              <input
                id="cash-in-period-end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="cash-in-staff">พนักงานที่โอน</label>
            <input
              id="cash-in-staff"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="cash-in-bank-ref">เลขอ้างอิงโอน (ถ้ามี)</label>
            <input
              id="cash-in-bank-ref"
              value={bankRef}
              onChange={(e) => setBankRef(e.target.value)}
              placeholder="Transaction ID / Ref"
            />
          </div>

          <PhotoAttachMultiField
            label="สลิปโอนธนาคาร"
            values={bankSlipUrls}
            onChange={setBankSlipUrls}
            onError={report}
            max={CASH_DEPOSIT_BANK_SLIP_MAX}
            storageFolder="cash-deposits"
            storageSlotKey={entry?.id || "new-bank"}
            hint={`หลักฐาน K+ / ธนาคาร · สูงสุด ${CASH_DEPOSIT_BANK_SLIP_MAX} รูป`}
            allowCamera
          />
          {bankSlipUrls.length ? (
            <button
              type="button"
              className="ghost-btn"
              style={{ marginBottom: "0.45rem" }}
              onClick={() => onPreview(bankSlipUrls, "สลิปโอนธนาคาร")}
            >
              ดูสลิปธนาคาร ({bankSlipUrls.length})
            </button>
          ) : null}

          <div className="cash-in-days-head">
            <h3 className="cash-in-days-title">สลิปสรุป POS รายวัน/กะ</h3>
            <button type="button" className="ghost-btn" onClick={addDay} disabled={busy}>
              <Plus size={14} aria-hidden /> เพิ่มวัน
            </button>
          </div>
          <p className="muted cash-in-days-hint">
            ใส่ยอด <strong>เงินสด</strong> จากสลิป (ไม่ใช่ยอดขายรวม) · ถ้าไม่แน่ใจว่าเป็นสลิปกะหรือสรุปรายวัน
            เลือก «ไม่แน่ใจ» ได้
          </p>

          <div className="cash-in-days">
            {days.map((day, idx) => (
              <div key={day.id} className="cash-in-day-card">
                <div className="cash-in-day-top">
                  <strong>วันที่ {idx + 1}</strong>
                  {days.length > 1 ? (
                    <button
                      type="button"
                      className="ghost-btn icon-btn"
                      aria-label="ลบวัน"
                      onClick={() => removeDay(day.id)}
                      disabled={busy}
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>
                <div className="field-row cash-in-field-row">
                  <div className="field">
                    <label htmlFor={`cash-day-date-${day.id}`}>วันที่บนสลิป</label>
                    <input
                      id={`cash-day-date-${day.id}`}
                      type="date"
                      value={toDateInput(day.date)}
                      onChange={(e) =>
                        updateDay(day.id, { date: parseDateInput(e.target.value) })
                      }
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`cash-day-amt-${day.id}`}>เงินสด (บาท)</label>
                    <input
                      id={`cash-day-amt-${day.id}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={day.cashAmount ? String(day.cashAmount) : ""}
                      onChange={(e) =>
                        updateDay(day.id, { cashAmount: Number(e.target.value) || 0 })
                      }
                      required
                    />
                  </div>
                </div>
                <div className="field-row cash-in-field-row">
                  <div className="field">
                    <label htmlFor={`cash-day-kind-${day.id}`}>ชนิดสลิป</label>
                    <select
                      id={`cash-day-kind-${day.id}`}
                      value={day.slipKind}
                      onChange={(e) =>
                        updateDay(day.id, { slipKind: e.target.value as CashSlipKind })
                      }
                    >
                      <option value="unknown">{labelCashSlipKind("unknown")}</option>
                      <option value="daily">{labelCashSlipKind("daily")}</option>
                      <option value="shift">{labelCashSlipKind("shift")}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`cash-day-shift-${day.id}`}>กะ (ถ้ามี)</label>
                    <input
                      id={`cash-day-shift-${day.id}`}
                      value={day.shiftLabel}
                      onChange={(e) => updateDay(day.id, { shiftLabel: e.target.value })}
                      placeholder="เช้า / เย็น"
                    />
                  </div>
                </div>
                <PhotoAttachMultiField
                  label="รูปสลิป POS"
                  values={day.slipUrls}
                  onChange={(urls) => updateDay(day.id, { slipUrls: urls })}
                  onError={report}
                  max={CASH_DEPOSIT_DAY_SLIP_MAX}
                  storageFolder="cash-deposits"
                  storageSlotKey={`${entry?.id || "new"}-${day.id}`}
                  hint={`สูงสุด ${CASH_DEPOSIT_DAY_SLIP_MAX} รูป`}
                  allowCamera
                />
              </div>
            ))}
          </div>

          <div className="field">
            <label htmlFor="cash-in-note">หมายเหตุพนักงาน</label>
            <textarea
              id="cash-in-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="เช่น รวม 9 วัน · มีทอนเงินเปิดลิ้นชักคืน"
            />
          </div>

          <div className="cash-in-math" aria-live="polite">
            <div>
              <span>รวมเงินสดจากสลิป</span>
              <strong>{formatPlainNumber(expected)}</strong>
            </div>
            <div>
              <span>ยอดโอนธนาคาร</span>
              <strong>{formatPlainNumber(bank)}</strong>
            </div>
            <div className={variance === 0 ? "is-ok" : "is-off"}>
              <span>ผลต่าง (ธนาคาร − สลิป)</span>
              <strong>
                {variance === 0
                  ? "0.00"
                  : `${variance > 0 ? "+" : ""}${formatPlainNumber(variance)}`}
              </strong>
            </div>
          </div>

          {entry ? (
            <EntryTimestampsMeta
              entryDate={entry.transferDate}
              createdAt={entry.createdAt}
              updatedAt={entry.updatedAt}
            />
          ) : null}

          <div className="module-form-actions">
            <button type="submit" className="primary-btn action-in" disabled={busy}>
              {busy ? "กำลังบันทึก..." : mode === "add" ? "บันทึกรอบนำเข้า" : "บันทึกการแก้ไข"}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ออก
            </button>
            {entry && (isOwner || entry.createdBy === createdBy) ? (
              <button
                type="button"
                className="ghost-btn danger-text"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                ลบ
              </button>
            ) : null}
          </div>
        </form>

        {entry && isOwner ? (
          <div className="cash-in-verify">
            <h3 className="cash-in-days-title">เจ้าของตรวจ</h3>
            <p className="muted cash-in-days-hint">
              สถานะปัจจุบัน: {labelCashDepositStatus(entry.status)}
              {entry.verifiedAt
                ? ` · ${formatDateShort(entry.verifiedAt)}`
                : ""}
            </p>
            <div className="field">
              <label htmlFor="cash-in-owner-note">โน้ตเจ้าของ</label>
              <textarea
                id="cash-in-owner-note"
                value={ownerNote}
                onChange={(e) => setOwnerNote(e.target.value)}
                rows={2}
                placeholder="เช่น ตรงกับสลิป K+ · หรือขาด 50 จากทอน"
              />
            </div>
            <div className="cash-in-verify-actions">
              <button
                type="button"
                className="primary-btn"
                disabled={busy}
                onClick={() => void onVerify("matched")}
              >
                ยืนยันตรง
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => void onVerify("mismatch")}
              >
                ทำเครื่องหมายไม่ตรง
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => void onVerify("void")}
              >
                ยกเลิกรายการ
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
