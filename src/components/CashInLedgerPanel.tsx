"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoUploadProgressModal } from "@/components/PhotoUploadProgressModal";
import {
  addCashDeposit,
  analyzeCashDepositDays,
  buildCashDepositOccupancy,
  buildCashDepositRoundDays,
  CASH_DEPOSIT_BANK_SLIP_MAX,
  CASH_DEPOSIT_DAY_MAX,
  CASH_DEPOSIT_DAY_SLIP_MAX,
  CASH_DEPOSIT_LIVE_MAX,
  CASH_DEPOSIT_PAGE_SIZE,
  cashDepositDayKey,
  cashDepositVariance,
  type CashDeposit,
  type CashDepositDayLine,
  type CashDepositStatus,
  deleteCashDeposit,
  formatCashDayShort,
  labelCashDepositRound,
  labelCashDepositStatus,
  listCashDeposits,
  subscribeCashDepositsPage,
  sumCashDepositDays,
  sumCashDepositDrawerClose,
  updateCashDeposit,
  verifyCashDeposit,
} from "@/lib/cash-deposits";
import {
  type PhotoUploadProgress,
  uploadEvidencePhotos,
} from "@/lib/photo-upload";
import {
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

type DraftRound = {
  key: string;
  transferDate: number;
  dayCount: number;
  staffName: string;
  bankAmount: string;
  bankRef: string;
  bankSlipUrls: string[];
  days: CashDepositDayLine[];
};

/**
 * Compact cash-in table on /ledger/ — no popup form.
 * Create round with N days → slim editable rows (cash + optional drawer close + slip).
 */
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
  forceOpen?: boolean;
  onForceOpenConsumed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CashDeposit[]>([]);
  const [liveLimit, setLiveLimit] = useState(CASH_DEPOSIT_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftRound | null>(null);
  const [createEnd, setCreateEnd] = useState(todayInputValue());
  const [createDays, setCreateDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [ownerNote, setOwnerNote] = useState("");
  const [imagePreview, setImagePreview] = useState<{
    urls: string[];
    title: string;
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<PhotoUploadProgress | null>(null);
  const uploadCancelRef = useRef(false);
  const dayPhotoRef = useRef<HTMLInputElement>(null);
  const bankPhotoRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<
    | { kind: "day"; dayId: string }
    | { kind: "bank" }
    | null
  >(null);

  const [editBankAmount, setEditBankAmount] = useState("");
  const [editBankRef, setEditBankRef] = useState("");
  const [editBankSlips, setEditBankSlips] = useState<string[]>([]);
  const [editStaff, setEditStaff] = useState("");
  const [editDays, setEditDays] = useState<CashDepositDayLine[]>([]);

  useEffect(() => {
    setOpen(readOpenPref());
  }, []);

  useEffect(() => {
    if (!forceOpen) return;
    setOpen(true);
    writeOpenPref(true);
    onForceOpenConsumed?.();
  }, [forceOpen, onForceOpenConsumed]);

  useBodyScrollLock(!!imagePreview || !!uploadProgress);

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

  const selected = useMemo(
    () => (selectedId ? entries.find((e) => e.id === selectedId) || null : null),
    [entries, selectedId],
  );

  useEffect(() => {
    if (!selected || draft) return;
    setEditBankAmount(selected.bankAmount ? String(selected.bankAmount) : "");
    setEditBankRef(selected.bankRef || "");
    setEditBankSlips([...selected.bankSlipUrls]);
    setEditStaff(selected.staffName || staffName);
    setEditDays(selected.days.map((d) => ({ ...d, slipUrls: [...d.slipUrls] })));
    setOwnerNote(selected.ownerNote || "");
  }, [selected, draft, staffName]);

  const occupancy = useMemo(
    () => buildCashDepositOccupancy(entries, selected?.id),
    [entries, selected?.id],
  );

  const workingDays = draft?.days ?? editDays;
  const workingBank = Number(draft ? draft.bankAmount : editBankAmount) || 0;
  const expected = sumCashDepositDays(workingDays);
  const drawerSum = sumCashDepositDrawerClose(workingDays);
  const variance = cashDepositVariance(workingBank, expected);
  const coverage = useMemo(
    () =>
      analyzeCashDepositDays(
        workingDays.map((d) => ({
          date: d.date,
          cashAmount: Number(d.cashAmount) || 0,
        })),
        {
          occupiedByDepositId: occupancy.occupiedByDepositId,
          occupiedMonthCounts: occupancy.occupiedMonthCounts,
          excludeDepositId: selected?.id,
        },
      ),
    [workingDays, occupancy, selected?.id],
  );

  const pendingCount = useMemo(
    () => entries.filter((e) => e.status === "pending").length,
    [entries],
  );

  const flatRows = useMemo(() => {
    const rows: {
      roundId: string;
      roundLabel: string;
      status: CashDepositStatus;
      day: CashDepositDayLine;
      bankAmount: number;
    }[] = [];
    for (const entry of entries) {
      const label = labelCashDepositRound(entry);
      for (const day of entry.days) {
        rows.push({
          roundId: entry.id,
          roundLabel: label,
          status: entry.status,
          day,
          bankAmount: entry.bankAmount,
        });
      }
    }
    rows.sort((a, b) => b.day.date - a.day.date);
    return rows;
  }, [entries]);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      writeOpenPref(next);
      return next;
    });
  }

  function startCreateRound() {
    const n = Math.round(Number(createDays));
    if (!Number.isFinite(n) || n < 1 || n > CASH_DEPOSIT_DAY_MAX) {
      setError(`จำนวนวันต้องอยู่ระหว่าง 1–${CASH_DEPOSIT_DAY_MAX}`);
      return;
    }
    let endMs: number;
    try {
      endMs = parseDateInput(createEnd);
    } catch {
      setError("วันสิ้นสุดรอบไม่ถูกต้อง");
      return;
    }
    setError(null);
    setSelectedId(null);
    setDraft({
      key: `draft-${Date.now()}`,
      transferDate: endMs,
      dayCount: n,
      staffName: staffName || "",
      bankAmount: "",
      bankRef: "",
      bankSlipUrls: [],
      days: buildCashDepositRoundDays(endMs, n),
    });
  }

  function patchDay(dayId: string, patch: Partial<CashDepositDayLine>) {
    const apply = (days: CashDepositDayLine[]) =>
      days.map((d) =>
        d.id === dayId
          ? {
              ...d,
              ...patch,
              date: patch.date != null ? cashDepositDayKey(patch.date) : d.date,
            }
          : d,
      );
    if (draft) setDraft({ ...draft, days: apply(draft.days) });
    else setEditDays((prev) => apply(prev));
  }

  function openDayPhoto(dayId: string) {
    photoTargetRef.current = { kind: "day", dayId };
    dayPhotoRef.current?.click();
  }

  function openBankPhoto() {
    photoTargetRef.current = { kind: "bank" };
    bankPhotoRef.current?.click();
  }

  async function onPhotoFiles(files: FileList | null) {
    const target = photoTargetRef.current;
    photoTargetRef.current = null;
    if (!target || !files?.length) return;
    const batch = Array.from(files).slice(0, CASH_DEPOSIT_DAY_SLIP_MAX);
    uploadCancelRef.current = false;
    setUploadProgress(null);
    setBusy(true);
    try {
      const urls = await uploadEvidencePhotos(batch, {
        folder: "cash-deposits",
        slotKey:
          target.kind === "bank"
            ? `bank-${draft?.key || selectedId || "new"}`
            : `day-${target.dayId}`,
        cancelRef: uploadCancelRef,
        onProgress: setUploadProgress,
      });
      if (!urls.length) throw new Error("อัปโหลดรูปไม่สำเร็จ");
      if (target.kind === "bank") {
        if (draft) {
          setDraft({
            ...draft,
            bankSlipUrls: [...draft.bankSlipUrls, ...urls].slice(
              0,
              CASH_DEPOSIT_BANK_SLIP_MAX,
            ),
          });
        } else {
          setEditBankSlips((prev) =>
            [...prev, ...urls].slice(0, CASH_DEPOSIT_BANK_SLIP_MAX),
          );
        }
      } else {
        const dayId = target.dayId;
        const merge = (days: CashDepositDayLine[]) =>
          days.map((d) =>
            d.id === dayId
              ? {
                  ...d,
                  slipUrls: [...d.slipUrls, ...urls].slice(0, CASH_DEPOSIT_DAY_SLIP_MAX),
                }
              : d,
          );
        if (draft) setDraft({ ...draft, days: merge(draft.days) });
        else setEditDays((prev) => merge(prev));
      }
    } catch (err) {
      if (!uploadCancelRef.current) {
        setError((err as Error).message || "อัปโหลดรูปไม่สำเร็จ");
      }
    } finally {
      setBusy(false);
      setUploadProgress(null);
      if (dayPhotoRef.current) dayPhotoRef.current.value = "";
      if (bankPhotoRef.current) bankPhotoRef.current.value = "";
    }
  }

  async function saveWorking() {
    setBusy(true);
    setError(null);
    try {
      if (coverage.issues.length) throw new Error(coverage.issues[0]!.message);
      if (!(workingBank > 0)) throw new Error("ต้องใส่ยอดโอนธนาคารของรอบ");
      const days = workingDays.map((d) => ({
        ...d,
        date: cashDepositDayKey(d.date),
        cashAmount: Number(d.cashAmount) || 0,
        drawerCloseAmount: Number(d.drawerCloseAmount) || 0,
      }));
      const payload = {
        transferDate: draft?.transferDate ?? selected!.transferDate,
        periodStart: coverage.periodStart,
        periodEnd: coverage.periodEnd,
        staffName: (draft?.staffName ?? editStaff).trim() || staffName,
        bankAmount: workingBank,
        bankSlipUrls: draft?.bankSlipUrls ?? editBankSlips,
        bankRef: draft?.bankRef ?? editBankRef,
        days,
      };
      if (draft) {
        const id = await addCashDeposit({ ...payload, createdBy: actorId });
        setDraft(null);
        setSelectedId(id);
      } else if (selected) {
        await updateCashDeposit(selected.id, payload);
      }
    } catch (err) {
      setError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(status: Exclude<CashDepositStatus, "pending">) {
    if (!selected || !isOwner) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCashDeposit({
        id: selected.id,
        status,
        ownerNote,
        verifiedBy: actorId,
      });
    } catch (err) {
      setError((err as Error).message || "บันทึกผลตรวจไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteRound() {
    if (!selected) return;
    if (!window.confirm("ลบรอบนำเข้านี้ทั้งรอบ?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCashDeposit(selected.id);
      setSelectedId(null);
    } catch (err) {
      setError((err as Error).message || "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const editingRound = !!draft || !!selected;

  const refreshOccupancy = useCallback(async () => {
    try {
      const rows = await listCashDeposits();
      void rows;
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (open) void refreshOccupancy();
  }, [open, refreshOccupancy]);

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
                ? `รอตรวจ ${pendingCount} รอบ`
                : "ตารางรอบ · หุบไว้ได้"}
          </span>
        </span>
        {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
      </button>

      {open ? (
        <div className="cash-in-panel-body">
          <p className="muted cash-in-hint">
            สร้างรอบด้วยจำนวนวันเอง → กรอกในตาราง (เงินสดเป็นหลัก · ปิดลิ้นชักเป็นตัวช่วย) ·
            แนบสลิปทีละวันในแถว
          </p>

          <div className="cash-in-create-bar">
            <label className="cash-in-create-field">
              <span>สิ้นสุดรอบ</span>
              <input
                type="date"
                value={createEnd}
                onChange={(e) => setCreateEnd(e.target.value)}
                disabled={busy || !!draft}
              />
            </label>
            <label className="cash-in-create-field cash-in-create-days">
              <span>กี่วัน</span>
              <input
                type="number"
                min={1}
                max={CASH_DEPOSIT_DAY_MAX}
                inputMode="numeric"
                value={createDays}
                onChange={(e) => setCreateDays(e.target.value)}
                disabled={busy || !!draft}
              />
            </label>
            <button
              type="button"
              className="primary-btn action-in cash-in-create-btn"
              disabled={busy || !!draft}
              onClick={startCreateRound}
            >
              สร้างรอบ
            </button>
          </div>

          {error ? <p className="error-text">{error}</p> : null}

          {/* Round chips */}
          {entries.length || draft ? (
            <div className="cash-in-round-chips" role="tablist" aria-label="เลือกรอบ">
              {draft ? (
                <button
                  type="button"
                  className="cash-in-round-chip is-active is-draft"
                  aria-selected
                >
                  ร่าง {draft.dayCount} วัน
                </button>
              ) : null}
              {entries.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={[
                    "cash-in-round-chip",
                    !draft && selectedId === e.id ? "is-active" : "",
                    e.status === "void" ? "is-void" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-selected={!draft && selectedId === e.id}
                  disabled={!!draft}
                  onClick={() => {
                    setDraft(null);
                    setSelectedId(e.id);
                  }}
                >
                  {labelCashDepositRound(e)}
                  <span className={statusClass(e.status)}>
                    {labelCashDepositStatus(e.status)}
                  </span>
                </button>
              ))}
              {!draft ? (
                <button
                  type="button"
                  className={["cash-in-round-chip", !selectedId ? "is-active" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  aria-selected={!selectedId}
                  onClick={() => setSelectedId(null)}
                >
                  ทุกรอบ
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Overview: all rounds flattened */}
          {!editingRound ? (
            <>
              {loading && !flatRows.length ? (
                <p className="empty">กำลังโหลด...</p>
              ) : !flatRows.length ? (
                <p className="empty">ยังไม่มีรอบ — ใส่จำนวนวันแล้วกดสร้างรอบ</p>
              ) : (
                <div className="sheet-wrap cash-in-panel-table-wrap">
                  <table className="sheet-table cash-in-slim">
                    <thead>
                      <tr>
                        <th className="col-round">รอบ</th>
                        <th className="col-date">วัน</th>
                        <th className="col-num">เงินสด</th>
                        <th className="col-num">ปิดลิ้นชัก</th>
                        <th className="col-slip">สลิป</th>
                        <th className="col-type">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flatRows.map((row) => (
                        <tr
                          key={`${row.roundId}-${row.day.id}`}
                          className={row.status === "void" ? "is-void-row" : undefined}
                        >
                          <td className="col-round">
                            <button
                              type="button"
                              className="desc-link"
                              onClick={() => setSelectedId(row.roundId)}
                            >
                              {row.roundLabel}
                            </button>
                          </td>
                          <td className="col-date">{formatCashDayShort(row.day.date)}</td>
                          <td className="col-num">
                            {row.day.cashAmount
                              ? formatPlainNumber(row.day.cashAmount)
                              : ""}
                          </td>
                          <td className="col-num">
                            {row.day.drawerCloseAmount
                              ? formatPlainNumber(row.day.drawerCloseAmount)
                              : ""}
                          </td>
                          <td className="col-slip">
                            {row.day.slipUrls.length ? (
                              <EntryPhotoIndicator
                                imageUrls={row.day.slipUrls}
                                label="สลิป"
                                onView={(urls) =>
                                  setImagePreview({
                                    urls,
                                    title: formatCashDayShort(row.day.date),
                                  })
                                }
                              />
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="col-type">
                            <span className={statusClass(row.status)}>
                              {labelCashDepositStatus(row.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!loading && hasMore ? (
                <button
                  type="button"
                  className="ghost-btn"
                  style={{ width: "100%", marginTop: "0.35rem" }}
                  onClick={() =>
                    setLiveLimit((n) =>
                      Math.min(n + CASH_DEPOSIT_PAGE_SIZE, CASH_DEPOSIT_LIVE_MAX),
                    )
                  }
                >
                  โหลดเพิ่ม
                </button>
              ) : null}
            </>
          ) : null}

          {/* Edit / draft round — slim table */}
          {editingRound ? (
            <div className="cash-in-round-edit">
              <div className="cash-in-round-meta">
                <label className="cash-in-create-field">
                  <span>พนักงาน</span>
                  <input
                    value={draft ? draft.staffName : editStaff}
                    onChange={(e) => {
                      if (draft) setDraft({ ...draft, staffName: e.target.value });
                      else setEditStaff(e.target.value);
                    }}
                  />
                </label>
                <label className="cash-in-create-field">
                  <span>โอนธนาคาร</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="ยอดสลิปโอน"
                    value={draft ? draft.bankAmount : editBankAmount}
                    onChange={(e) => {
                      if (draft) setDraft({ ...draft, bankAmount: e.target.value });
                      else setEditBankAmount(e.target.value);
                    }}
                  />
                </label>
                <label className="cash-in-create-field">
                  <span>อ้างอิง</span>
                  <input
                    value={draft ? draft.bankRef : editBankRef}
                    onChange={(e) => {
                      if (draft) setDraft({ ...draft, bankRef: e.target.value });
                      else setEditBankRef(e.target.value);
                    }}
                    placeholder="Ref"
                  />
                </label>
                <div className="cash-in-bank-slip-cell">
                  <span className="cash-in-create-field-label">สลิปโอน</span>
                  <EntryPhotoIndicator
                    imageUrls={draft ? draft.bankSlipUrls : editBankSlips}
                    label="สลิปโอน"
                    onAdd={openBankPhoto}
                    onView={(urls) =>
                      setImagePreview({ urls, title: "สลิปโอนธนาคาร" })
                    }
                  />
                </div>
              </div>

              <div className="sheet-wrap cash-in-panel-table-wrap">
                <table className="sheet-table cash-in-slim is-edit">
                  <thead>
                    <tr>
                      <th className="col-round">รอบ</th>
                      <th className="col-date">วัน</th>
                      <th className="col-num">เงินสด</th>
                      <th className="col-num">ปิดลิ้นชัก</th>
                      <th className="col-slip">สลิป</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workingDays.map((day) => (
                      <tr key={day.id}>
                        <td className="col-round">
                          {draft
                            ? `${draft.dayCount}ว`
                            : selected
                              ? labelCashDepositRound(selected)
                              : "—"}
                        </td>
                        <td className="col-date">
                          <input
                            type="date"
                            className="cash-in-cell-input"
                            value={toDateInput(day.date)}
                            onChange={(e) => {
                              try {
                                patchDay(day.id, {
                                  date: parseDateInput(e.target.value),
                                });
                              } catch {
                                /* ignore */
                              }
                            }}
                          />
                        </td>
                        <td className="col-num">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            className="cash-in-cell-input is-num"
                            value={day.cashAmount ? String(day.cashAmount) : ""}
                            placeholder="0"
                            onChange={(e) =>
                              patchDay(day.id, {
                                cashAmount: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="col-num">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            className="cash-in-cell-input is-num"
                            value={
                              day.drawerCloseAmount
                                ? String(day.drawerCloseAmount)
                                : ""
                            }
                            placeholder="—"
                            onChange={(e) =>
                              patchDay(day.id, {
                                drawerCloseAmount: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="col-slip">
                          <EntryPhotoIndicator
                            imageUrls={day.slipUrls}
                            label={formatCashDayShort(day.date)}
                            onAdd={() => openDayPhoto(day.id)}
                            onView={(urls) =>
                              setImagePreview({
                                urls,
                                title: formatCashDayShort(day.date),
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="col-round" colSpan={2}>
                        รวม
                      </td>
                      <td className="col-num">{formatPlainNumber(expected)}</td>
                      <td className="col-num">
                        {drawerSum ? formatPlainNumber(drawerSum) : ""}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="cash-in-math is-slim" aria-live="polite">
                <span>
                  ธนาคาร {formatPlainNumber(workingBank)} · สลิปสด{" "}
                  {formatPlainNumber(expected)} · ผลต่าง{" "}
                  <strong className={variance === 0 ? "is-ok" : "is-off"}>
                    {variance === 0
                      ? "0"
                      : `${variance > 0 ? "+" : ""}${formatPlainNumber(variance)}`}
                  </strong>
                </span>
              </div>

              {coverage.issues.length ? (
                <ul className="cash-in-issues">
                  {coverage.issues.slice(0, 4).map((issue, i) => (
                    <li key={`${issue.code}-${i}`}>{issue.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="cash-in-issues-ok">วันต่อเนื่อง ไม่ซ้ำ</p>
              )}

              <div className="cash-in-round-actions">
                <button
                  type="button"
                  className="primary-btn action-in"
                  disabled={busy || !!coverage.issues.length}
                  onClick={() => void saveWorking()}
                >
                  {busy ? "กำลังบันทึก..." : draft ? "บันทึกรอบ" : "บันทึกการแก้"}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    setSelectedId(null);
                  }}
                >
                  ปิดรอบนี้
                </button>
                {selected && (isOwner || selected.createdBy === actorId) ? (
                  <button
                    type="button"
                    className="ghost-btn danger-text"
                    disabled={busy}
                    onClick={() => void onDeleteRound()}
                  >
                    ลบรอบ
                  </button>
                ) : null}
              </div>

              {selected && isOwner ? (
                <div className="cash-in-verify is-slim">
                  <input
                    className="cash-in-cell-input"
                    value={ownerNote}
                    onChange={(e) => setOwnerNote(e.target.value)}
                    placeholder="โน้ตเจ้าของ"
                  />
                  <div className="cash-in-verify-actions">
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={busy}
                      onClick={() => void onVerify("matched")}
                    >
                      ตรง
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy}
                      onClick={() => void onVerify("mismatch")}
                    >
                      ไม่ตรง
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy}
                      onClick={() => void onVerify("void")}
                    >
                      ยกเลิก
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <input
        ref={dayPhotoRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => void onPhotoFiles(e.target.files)}
      />
      <input
        ref={bankPhotoRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => void onPhotoFiles(e.target.files)}
      />

      {imagePreview ? (
        <ImagePreviewModal
          urls={imagePreview.urls}
          title={imagePreview.title}
          showCaptureMeta={isOwner}
          onClose={() => setImagePreview(null)}
        />
      ) : null}

      {uploadProgress ? (
        <PhotoUploadProgressModal
          progress={uploadProgress}
          onCancel={() => {
            uploadCancelRef.current = true;
          }}
        />
      ) : null}
    </aside>
  );
}
