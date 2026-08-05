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
  assertCashDepositDaysNposLinked,
  buildCashDepositOccupancy,
  CASH_DEPOSIT_BANK_SLIP_MAX,
  CASH_DEPOSIT_BANK_TRANSFER_MAX,
  CASH_DEPOSIT_DAY_MAX,
  CASH_DEPOSIT_LIVE_MAX,
  CASH_DEPOSIT_PAGE_SIZE,
  cashDepositDayKey,
  cashDepositVariance,
  type CashDeposit,
  type CashDepositBankTransfer,
  type CashDepositDayLine,
  type CashDepositStatus,
  type CashFillSource,
  coerceBankTransfers,
  deleteCashDeposit,
  emptyCashDepositBankTransfer,
  emptyCashDepositDay,
  flattenBankTransferUrls,
  formatCashDayShort,
  cashDepositBankSlipUrls,
  deriveCashDepositTransferUiState,
  labelCashDepositRound,
  labelCashDepositTransferUiState,
  listCashDeposits,
  normalizeSessionNotes,
  subscribeCashDepositsPage,
  suggestedNetBankTransfer,
  sumBankTransferAmounts,
  sumBankTransferFees,
  sumCashDepositDays,
  updateCashDeposit,
  type CashDepositTransferUiState,
} from "@/lib/cash-deposits";
import { extractCashBankSlipFromPhotos } from "@/lib/cash-deposits-ai";
import {
  type PhotoUploadProgress,
  uploadEvidencePhotos,
} from "@/lib/photo-upload";
import { subscribePosSessionsRecent } from "@/lib/pos-sales-report";
import {
  deriveRemitStatus,
  fillDayCashFromSessions,
  groupSessionsBySalesDay,
  pendingDepositSessionsForCashIn,
  sessionCounterLabel,
  sessionRemitAmount,
  sumSessionRemits,
} from "@/lib/pos-session-remit";
import { posSessionCode, posSessionDurationMs } from "@/lib/pos-sales-report";
import type { PosSession } from "@/lib/types";
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

/** POS mid-shift / close notes that affect cash — shown under pending remit cards. */
function formatSessionSystemNotes(session: PosSession): string {
  const parts: string[] = [];
  for (const drop of session.cashDropNotes || []) {
    const amt = Number(drop.amount) || 0;
    if (!(amt > 0)) continue;
    const reason = String(drop.reason || "").trim();
    parts.push(
      reason
        ? `ถอน ฿${formatPlainNumber(amt)} ${reason}`
        : `ถอน ฿${formatPlainNumber(amt)}`,
    );
  }
  const disc = String(session.discrepancyNote || "").trim();
  if (disc) parts.push(disc);
  return parts.join(" · ").slice(0, 240);
}

function collectSessionNotesFromDays(
  days: CashDepositDayLine[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const day of days) {
    const notes = day.sessionNotes || {};
    for (const [id, note] of Object.entries(notes)) {
      const key = String(id || "").trim();
      const text = String(note || "").trim();
      if (key && text) out[key] = text.slice(0, 200);
    }
  }
  return out;
}

function withSessionNotesOnDays(
  days: CashDepositDayLine[],
  prepNotes: Record<string, string>,
): CashDepositDayLine[] {
  return days.map((day) => {
    const ids = (day.sessionIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    const merged: Record<string, string> = { ...(day.sessionNotes || {}) };
    for (const id of ids) {
      if (Object.prototype.hasOwnProperty.call(prepNotes, id)) {
        const text = String(prepNotes[id] || "").trim().slice(0, 200);
        if (text) merged[id] = text;
        else delete merged[id];
      }
    }
    return {
      ...day,
      sessionNotes: normalizeSessionNotes(merged, ids),
    };
  });
}

function writeOpenPref(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function transferUiClass(state: CashDepositTransferUiState) {
  switch (state) {
    case "transferred":
      return "cash-in-status is-matched";
    case "mismatch":
      return "cash-in-status is-mismatch";
    case "void":
      return "cash-in-status is-void";
    default:
      // awaiting_bank_slip — round docs alone are not a completed transfer
      return "cash-in-status is-pending";
  }
}

/** Local HH:mm for cash-in pending cards (Bangkok wall clock via th-TH). */
function formatCashInHm(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Day + time for open/close on pending cards — e.g. 4/8 00:14 */
function formatCashInDayHm(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const day = `${d.getDate()}/${d.getMonth() + 1}`;
  return `${day} ${formatCashInHm(ts)}`;
}

/** Shift length as hours + minutes — e.g. 7 ชม. 45 นาที */
function formatCashInDurationHm(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} นาที`;
  if (m <= 0) return `${h} ชม.`;
  return `${h} ชม. ${m} นาที`;
}

type DraftRound = {
  key: string;
  transferDate: number;
  dayCount: number;
  staffName: string;
  note: string;
  bankTransfers: CashDepositBankTransfer[];
  days: CashDepositDayLine[];
  aiReason: string;
};

type PhotoTarget = { kind: "bank"; transferId: string };

type PhotoPreviewState = {
  urls: string[];
  title: string;
  /** When set, viewer can delete individual photos */
  editTarget?: PhotoTarget;
};

function cloneTransfers(rows: CashDepositBankTransfer[]): CashDepositBankTransfer[] {
  return rows.map((t) => ({ ...t, slipUrls: [...t.slipUrls] }));
}

function ensureTransfers(
  rows: CashDepositBankTransfer[],
  transferDateMs = 0,
): CashDepositBankTransfer[] {
  if (rows.length) return cloneTransfers(rows);
  return [emptyCashDepositBankTransfer(transferDateMs)];
}

/**
 * Compact cash-in on /ledger/ — tick bills + bank transfer slips.
 * Compare: slip amount vs (bundle − fee); no round-print attach.
 */
export function CashInLedgerPanel({
  actorId,
  isOwner,
  staffName,
  forceOpen = false,
  onForceOpenConsumed,
  readOnly = false,
}: {
  actorId: string;
  isOwner: boolean;
  staffName: string;
  forceOpen?: boolean;
  onForceOpenConsumed?: () => void;
  /** พรีวิวมุมพนักงาน — ดูได้อย่างเดียว */
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CashDeposit[]>([]);
  const [liveLimit, setLiveLimit] = useState(CASH_DEPOSIT_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftRound | null>(null);
  const [busy, setBusy] = useState(false);
  const [editNote, setEditNote] = useState("");
  /** Per pending-bill prep notes (sessionId → text) while bundling for bank transfer. */
  const [prepSessionNotes, setPrepSessionNotes] = useState<Record<string, string>>(
    {},
  );
  const [imagePreview, setImagePreview] = useState<PhotoPreviewState | null>(null);
  const [uploadProgress, setUploadProgress] = useState<PhotoUploadProgress | null>(null);
  const uploadCancelRef = useRef(false);
  const bankPhotoRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<PhotoTarget | null>(null);

  const [editStaff, setEditStaff] = useState("");
  const [editBankTransfers, setEditBankTransfers] = useState<CashDepositBankTransfer[]>([
    emptyCashDepositBankTransfer(),
  ]);
  const [editDays, setEditDays] = useState<CashDepositDayLine[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const lastAiKeyRef = useRef("");
  const [posSessions, setPosSessions] = useState<PosSession[]>([]);

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
    const transfers =
      selected.bankTransfers?.length
        ? cloneTransfers(selected.bankTransfers)
        : coerceBankTransfers(selected);
    setEditBankTransfers(ensureTransfers(transfers, selected.transferDate));
    setEditStaff(selected.staffName || staffName);
    setEditDays(
      selected.days.map((d) => ({
        ...d,
        slipUrls: [...d.slipUrls],
        sessionIds: [...(d.sessionIds || [])],
        sessionActualAmounts: { ...(d.sessionActualAmounts || {}) },
        sessionNotes: { ...(d.sessionNotes || {}) },
      })),
    );
    setEditNote(selected.note || "");
    setPrepSessionNotes(collectSessionNotesFromDays(selected.days));
  }, [selected, draft, staffName]);

  /** Always load nPos rounds while cash-in is mounted — queue "รอบรอฝาก". */
  useEffect(() => {
    return subscribePosSessionsRecent(
      setPosSessions,
      (err) => {
        // Staff without list rights used to fail — rules now allow ledger.
        if (/permission|insufficient/i.test(err.message || "")) {
          setPosSessions([]);
          return;
        }
        setError(err.message || "โหลดรอบ nPos ไม่สำเร็จ");
      },
    );
  }, []);

  const occupancy = useMemo(
    () => buildCashDepositOccupancy(entries, selected?.id),
    [entries, selected?.id],
  );

  const workingDays = draft?.days ?? editDays;
  const workingTransfers = draft?.bankTransfers ?? editBankTransfers;
  const workingNote = draft?.note ?? editNote;
  const workingBank = sumBankTransferAmounts(workingTransfers);
  const workingFee = sumBankTransferFees(workingTransfers);
  const expected = sumCashDepositDays(workingDays);
  /** มัดรวมบิล → ยอดที่ควรโอนเข้าบัญชีหลังหักคชจ. (ไม่ต้องเบิกคชจ.) */
  const netBankTarget = suggestedNetBankTransfer(expected, workingFee);
  const variance = cashDepositVariance(workingBank, expected, workingFee);
  const workingSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of workingDays) {
      for (const id of d.sessionIds || []) {
        const t = String(id || "").trim();
        if (t) ids.add(t);
      }
    }
    return ids;
  }, [workingDays]);
  const bundledBillCount = workingSessionIds.size;
  const bankSlipUrlCount = flattenBankTransferUrls(workingTransfers).length;
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
          allowGaps: true,
        },
      ),
    [workingDays, occupancy, selected?.id],
  );

  const flatRows = useMemo(() => {
    const rows: {
      roundId: string;
      roundLabel: string;
      roundNote: string;
      status: CashDepositStatus;
      transferUi: CashDepositTransferUiState;
      day: CashDepositDayLine;
      bankAmount: number;
      /** Bank e-slips — transfer evidence (not round-print compare photos) */
      bankSlipUrls: string[];
    }[] = [];
    for (const entry of entries) {
      const label = labelCashDepositRound(entry);
      const bankSlipUrls = cashDepositBankSlipUrls(entry);
      const transferUi = deriveCashDepositTransferUiState(entry);
      const roundNote = (entry.note || "").trim();
      for (const day of entry.days) {
        rows.push({
          roundId: entry.id,
          roundLabel: label,
          roundNote,
          status: entry.status,
          transferUi,
          day,
          bankAmount: entry.bankAmount,
          bankSlipUrls,
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

  function setDays(next: CashDepositDayLine[]) {
    const sorted = [...next].sort((a, b) => a.date - b.date);
    if (draft) {
      setDraft({ ...draft, days: sorted, dayCount: sorted.length });
    } else {
      setEditDays(sorted);
    }
  }

  function setTransfers(next: CashDepositBankTransfer[]) {
    if (draft) setDraft({ ...draft, bankTransfers: next });
    else setEditBankTransfers(next);
  }

  function patchWorkingNote(next: string) {
    const note = next.slice(0, 500);
    if (draft) setDraft({ ...draft, note });
    else setEditNote(note);
  }

  function patchSessionPrepNote(sessionId: string, next: string) {
    const id = String(sessionId || "").trim();
    if (!id) return;
    const text = next.slice(0, 200);
    setPrepSessionNotes((prev) => {
      const out = { ...prev };
      if (text.trim()) out[id] = text;
      else delete out[id];
      return out;
    });
    if (!workingSessionIds.has(id)) return;
    const applyNotes = (days: CashDepositDayLine[]) =>
      withSessionNotesOnDays(days, { [id]: text });
    if (draft) {
      setDraft((prev) =>
        prev ? { ...prev, days: applyNotes(prev.days) } : prev,
      );
    } else {
      setEditDays((prev) => applyNotes(prev));
    }
  }

  function patchTransfer(
    transferId: string,
    patch: Partial<CashDepositBankTransfer>,
    opts?: { fromAi?: boolean },
  ) {
    const fromAi = !!opts?.fromAi;
    const apply = (rows: CashDepositBankTransfer[]) => {
      const nextRows = rows.map((t) => {
        if (t.id !== transferId) return t;
        const next: CashDepositBankTransfer = { ...t, ...patch };
        if (!fromAi) {
          if (patch.amount != null) next.amountSource = "staff";
          if (patch.fee != null) next.feeSource = "staff";
        }
        return next;
      });
      // Single-slip bundle: คชจ. เปลี่ยน → ยอดโอนเข้าบช. = มัดรวม − คชจ. (ถ้ายังไม่พิมพ์ยอดเอง)
      if (
        !fromAi &&
        patch.fee != null &&
        patch.amount == null &&
        nextRows.length === 1 &&
        expected > 0
      ) {
        const only = nextRows[0]!;
        const prev = rows[0]!;
        const prevSuggested = suggestedNetBankTransfer(expected, prev.fee);
        const amountLooksAuto =
          !(Number(prev.amount) > 0) ||
          Math.abs((Number(prev.amount) || 0) - prevSuggested) < 0.005;
        if (amountLooksAuto || prev.amountSource !== "staff") {
          only.amount = suggestedNetBankTransfer(expected, only.fee);
          only.amountSource = "staff";
        }
      }
      return nextRows;
    };
    if (draft) setDraft({ ...draft, bankTransfers: apply(draft.bankTransfers) });
    else setEditBankTransfers((prev) => apply(prev));
  }

  function addBankTransfer() {
    if (workingTransfers.length >= CASH_DEPOSIT_BANK_TRANSFER_MAX) {
      setError(`สลิปโอนได้สูงสุด ${CASH_DEPOSIT_BANK_TRANSFER_MAX} ใบ`);
      return;
    }
    setError(null);
    const dateMs = draft?.transferDate ?? selected?.transferDate ?? 0;
    setTransfers([
      ...workingTransfers,
      emptyCashDepositBankTransfer(dateMs),
    ]);
  }

  function removeBankTransfer(transferId: string) {
    if (workingTransfers.length <= 1) return;
    setTransfers(workingTransfers.filter((t) => t.id !== transferId));
  }

  function openBankPhoto(transferId: string) {
    photoTargetRef.current = { kind: "bank", transferId };
    bankPhotoRef.current?.click();
  }

  function setTransferSlipUrls(transferId: string, slipUrls: string[]) {
    const apply = (rows: CashDepositBankTransfer[]) =>
      rows.map((t) => (t.id === transferId ? { ...t, slipUrls } : t));
    if (draft) setDraft({ ...draft, bankTransfers: apply(draft.bankTransfers) });
    else setEditBankTransfers((prev) => apply(prev));
  }

  function removePreviewPhotoAt(index: number) {
    const prev = imagePreview;
    if (!prev?.editTarget || prev.editTarget.kind !== "bank") return;
    const nextUrls = prev.urls.filter((_, i) => i !== index);
    setTransferSlipUrls(prev.editTarget.transferId, nextUrls);
    if (!nextUrls.length) {
      setImagePreview(null);
      setAiHint("ลบรูปแล้ว");
      return;
    }
    setImagePreview({ ...prev, urls: nextUrls });
  }

  async function runAiBank(transferId: string, refs: string[], force = false) {
    const key = `bank:${transferId}:${refs.slice(0, 2).join("|")}`;
    if (!force && lastAiKeyRef.current === key) return;
    lastAiKeyRef.current = key;
    setAiBusy(true);
    setAiHint("อ่านสลิป…");
    try {
      const result = await extractCashBankSlipFromPhotos(refs.slice(0, 2));
      const patch: Partial<CashDepositBankTransfer> = {
        fee: result.transferFee ?? 0,
        feeSource: "ai",
      };
      if (result.bankAmount != null) {
        patch.amount = result.bankAmount;
        patch.amountSource = "ai";
      }
      if (result.bankRef) patch.bankRef = result.bankRef;
      let parsedTransferDate = 0;
      if (result.transferDate) {
        try {
          parsedTransferDate = parseDateInput(result.transferDate);
          patch.transferDate = parsedTransferDate;
        } catch {
          /* ignore bad date */
        }
      }
      const applyRow = (rows: CashDepositBankTransfer[]) =>
        rows.map((t) => (t.id === transferId ? { ...t, ...patch } : t));
      if (draft) {
        setDraft((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            bankTransfers: applyRow(prev.bankTransfers),
            transferDate: parsedTransferDate || prev.transferDate,
            aiReason: result.reason || prev.aiReason,
          };
        });
      } else {
        setEditBankTransfers((prev) => applyRow(prev));
      }
      setAiHint(result.reason ? `อ่านแล้ว · ${result.reason}` : "อ่านแล้ว");
    } catch (err) {
      setAiHint((err as Error).message || "อ่านไม่สำเร็จ · กรอกเอง");
    } finally {
      setAiBusy(false);
    }
  }

  async function onPhotoFiles(files: FileList | null) {
    const target = photoTargetRef.current;
    photoTargetRef.current = null;
    if (!target || !files?.length) return;
    const batch = Array.from(files).slice(0, CASH_DEPOSIT_BANK_SLIP_MAX);
    uploadCancelRef.current = false;
    setUploadProgress(null);
    setBusy(true);
    try {
      const urls = await uploadEvidencePhotos(batch, {
        folder: "cash-deposits",
        slotKey: `bank-${target.transferId}`,
        cancelRef: uploadCancelRef,
        onProgress: setUploadProgress,
      });
      if (!urls.length) throw new Error("อัปโหลดรูปไม่สำเร็จ");
      const transferId = target.transferId;
      let nextUrls: string[] = [];
      const merge = (rows: CashDepositBankTransfer[]) =>
        rows.map((t) => {
          if (t.id !== transferId) return t;
          nextUrls = [...t.slipUrls, ...urls].slice(0, CASH_DEPOSIT_BANK_SLIP_MAX);
          return { ...t, slipUrls: nextUrls };
        });
      if (draft) setDraft({ ...draft, bankTransfers: merge(draft.bankTransfers) });
      else setEditBankTransfers((prev) => merge(prev));
      void runAiBank(transferId, nextUrls);
    } catch (err) {
      if (!uploadCancelRef.current) {
        setError((err as Error).message || "อัปโหลดรูปไม่สำเร็จ");
      }
    } finally {
      setBusy(false);
      setUploadProgress(null);
      if (bankPhotoRef.current) bankPhotoRef.current.value = "";
    }
  }

  async function saveWorking() {
    if (readOnly) {
      setError("พรีวิวมุมพนักงาน — บันทึกไม่ได้");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (coverage.issues.length) throw new Error(coverage.issues[0]!.message);
      if (!(workingBank > 0)) throw new Error("ต้องใส่ยอดโอนธนาคารของรอบ");
      if (!workingTransfers.length) throw new Error("ต้องมีอย่างน้อย 1 สลิปโอนเข้าบัญชี");
      for (const t of workingTransfers) {
        if (!(Number(t.amount) > 0)) {
          throw new Error("ยอดเข้าบัญชีในแต่ละสลิปโอนต้องมากกว่า 0");
        }
      }
      if (!bankSlipUrlCount) {
        throw new Error("ต้องแนบรูปสลิปโอนเข้าบัญชีอย่างน้อย 1 รูป");
      }
      const days = withSessionNotesOnDays(workingDays, prepSessionNotes).map(
        (d) => ({
          ...d,
          date: cashDepositDayKey(d.date),
          cashAmount: Number(d.cashAmount) || 0,
          drawerCloseAmount: Number(d.drawerCloseAmount) || 0,
          cashAmountSource: d.cashAmountSource || ("" as CashFillSource),
          drawerCloseAmountSource:
            d.drawerCloseAmountSource || ("" as CashFillSource),
          dateSource: d.dateSource || ("" as CashFillSource),
          note: (d.note || "").trim().slice(0, 200),
          // Keep prior round-slip photos — staff must not re-attach after UI refresh.
          slipUrls: [...d.slipUrls],
          sessionIds: [...(d.sessionIds || [])],
          sessionActualAmounts: { ...(d.sessionActualAmounts || {}) },
          sessionNotes: { ...(d.sessionNotes || {}) },
        }),
      );
      assertCashDepositDaysNposLinked(days);
      const bankTransfers = workingTransfers.map((t) => ({
        ...t,
        amount: Number(t.amount) || 0,
        fee: Math.max(0, Number(t.fee) || 0),
        bankRef: (t.bankRef || "").trim(),
        slipUrls: [...t.slipUrls],
        amountSource: t.amountSource || ("" as CashFillSource),
        feeSource: t.feeSource || ("" as CashFillSource),
      }));
      const payload = {
        transferDate: draft?.transferDate ?? selected!.transferDate,
        periodStart: coverage.periodStart,
        periodEnd: coverage.periodEnd,
        staffName: (draft?.staffName ?? editStaff).trim() || staffName,
        note: (draft?.note ?? editNote).trim().slice(0, 500),
        bankTransfers,
        days,
      };
      if (draft) {
        await addCashDeposit({ ...payload, createdBy: actorId });
        setDraft(null);
        setSelectedId(null);
        setPrepSessionNotes({});
        setAiHint("โอนแล้ว");
      } else if (selected) {
        await updateCashDeposit(selected.id, payload);
        setSelectedId(null);
        setPrepSessionNotes({});
        setAiHint("อัปเดตแล้ว");
      }
    } catch (err) {
      setError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteRound() {
    if (readOnly) return;
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

  /**
   * คิวติ๊ก: ซ่อนเฉพาะบิลที่ผูกมัดอื่นแล้ว
   * — มัดที่กำลังแก้/ร่าง ยังโชว์ในคิวเป็นติ๊กแล้ว
   */
  const linkedOutsideWorking = useMemo(() => {
    const out = new Set<string>();
    for (const dep of entries) {
      if (String(dep.status || "") === "void") continue;
      if (selected && dep.id === selected.id) continue;
      for (const day of dep.days || []) {
        for (const id of day.sessionIds || []) {
          const t = String(id || "").trim();
          if (t) out.add(t);
        }
      }
    }
    return out;
  }, [entries, selected]);
  const pendingDepositSessions = useMemo(
    () => pendingDepositSessionsForCashIn(posSessions, linkedOutsideWorking),
    [posSessions, linkedOutsideWorking],
  );
  const pendingDepositSum = useMemo(
    () => sumSessionRemits(pendingDepositSessions),
    [pendingDepositSessions],
  );
  const untickedPendingSessions = useMemo(
    () => pendingDepositSessions.filter((s) => !workingSessionIds.has(s.id)),
    [pendingDepositSessions, workingSessionIds],
  );
  const untickedPendingSum = useMemo(
    () => sumSessionRemits(untickedPendingSessions),
    [untickedPendingSessions],
  );
  function startDraftFromSessions(sessions: PosSession[]) {
    if (!sessions.length) {
      setError("ไม่มีรอบรอฝาก");
      return;
    }
    const groups = groupSessionsBySalesDay(sessions);
    if (!groups.length || groups.length > CASH_DEPOSIT_DAY_MAX) {
      setError(`รอบรอฝากต้องอยู่ระหว่าง 1–${CASH_DEPOSIT_DAY_MAX} วัน`);
      return;
    }
    const endMs = groups[groups.length - 1]!.date;
    const days = withSessionNotesOnDays(
      groups.map(({ date, sessions: daySessions }) => {
        const base = emptyCashDepositDay(date);
        const filled = fillDayCashFromSessions(
          base,
          daySessions,
          daySessions.map((s) => s.id),
        );
        return {
          ...base,
          cashAmount: filled.cashAmount,
          cashAmountSource: filled.cashAmountSource,
          sessionIds: filled.sessionIds,
          sessionActualAmounts: filled.sessionActualAmounts,
          sessionNotes: filled.sessionNotes,
          note: filled.note,
          slipKind: "shift" as const,
          shiftLabel: "รอบขาย",
        };
      }),
      prepSessionNotes,
    );
    setError(null);
    setSelectedId(null);
    const bundleTotal = sumSessionRemits(sessions);
    const bankRow = emptyCashDepositBankTransfer(endMs);
    bankRow.amount = suggestedNetBankTransfer(bundleTotal, 0);
    bankRow.amountSource = "staff";
    setDraft({
      key: `draft-pending-${Date.now()}`,
      transferDate: endMs,
      dayCount: days.length,
      staffName: staffName || "",
      note: "",
      bankTransfers: [bankRow],
      days,
      aiReason: "",
    });
    setEditNote("");
    setAiHint(`${sessions.length} บิล · ฿${formatPlainNumber(bundleTotal)}`);
    if (!open) {
      setOpen(true);
      writeOpenPref(true);
    }
  }

  /** Auto-fill เข้าบช. when single slip still looks auto — pure, no setState */
  function withRefreshedBankAmount(
    transfers: CashDepositBankTransfer[],
    nextDays: CashDepositDayLine[],
    prevExpected: number,
  ): CashDepositBankTransfer[] {
    if (transfers.length !== 1) return transfers;
    const only = transfers[0]!;
    const prevSuggested = suggestedNetBankTransfer(prevExpected, only.fee);
    const amountLooksAuto =
      !(Number(only.amount) > 0) ||
      Math.abs((Number(only.amount) || 0) - prevSuggested) < 0.005 ||
      only.amountSource !== "staff";
    if (!amountLooksAuto) return transfers;
    const bundle = sumCashDepositDays(nextDays);
    const net = suggestedNetBankTransfer(bundle, only.fee);
    return [{ ...only, amount: net, amountSource: "staff" }];
  }

  /**
   * Apply day-bundle change in one setState — avoids setDays + patchTransfer
   * racing and wiping the newly ticked bill (needed 2 taps on bill 2+).
   */
  function applyWorkingDays(nextDays: CashDepositDayLine[]) {
    const sorted = [...nextDays].sort((a, b) => a.date - b.date);
    const prevExpected = expected;
    if (draft) {
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          days: sorted,
          dayCount: sorted.length,
          bankTransfers: withRefreshedBankAmount(
            prev.bankTransfers,
            sorted,
            prevExpected,
          ),
        };
      });
      return;
    }
    const nextTransfers = withRefreshedBankAmount(
      editBankTransfers,
      sorted,
      prevExpected,
    );
    setEditDays(sorted);
    if (nextTransfers !== editBankTransfers) {
      setEditBankTransfers(nextTransfers);
    }
  }

  /** @deprecated keep name for gates — delegates to applyWorkingDays */
  function refreshBankAmountForBundle(nextDays: CashDepositDayLine[]) {
    applyWorkingDays(nextDays);
  }

  function mergeSessionsIntoDays(
    baseDays: CashDepositDayLine[],
    sessions: PosSession[],
  ): { days: CashDepositDayLine[]; added: number; skipped: number } {
    let days = baseDays.map((d) => ({
      ...d,
      sessionIds: [...(d.sessionIds || [])],
      slipUrls: [...(d.slipUrls || [])],
      sessionActualAmounts: { ...(d.sessionActualAmounts || {}) },
      sessionNotes: { ...(d.sessionNotes || {}) },
    }));
    const have = new Set<string>();
    for (const d of days) {
      for (const id of d.sessionIds || []) {
        const t = String(id || "").trim();
        if (t) have.add(t);
      }
    }
    let added = 0;
    let skipped = 0;
    for (const session of sessions) {
      if (have.has(session.id) || linkedOutsideWorking.has(session.id)) {
        skipped += 1;
        continue;
      }
      const dayKey = cashDepositDayKey(session.date || session.openedAt || 0);
      const existing = days.find((d) => cashDepositDayKey(d.date) === dayKey);
      if (existing) {
        const ids = [...new Set([...(existing.sessionIds || []), session.id])];
        const matches = posSessions.filter((s) => ids.includes(s.id));
        // include the new session even if not yet in posSessions snapshot
        const pool = matches.some((s) => s.id === session.id)
          ? matches
          : [...matches, session];
        const filled = fillDayCashFromSessions(existing, pool, ids);
        existing.cashAmount = filled.cashAmount;
        existing.cashAmountSource = filled.cashAmountSource;
        existing.sessionIds = filled.sessionIds;
        existing.sessionActualAmounts = filled.sessionActualAmounts;
        existing.sessionNotes = filled.sessionNotes;
        existing.note = filled.note;
        // slipUrls untouched — prior round photos stay embedded
        have.add(session.id);
        added += 1;
        continue;
      }
      if (days.length >= CASH_DEPOSIT_DAY_MAX) {
        skipped += 1;
        continue;
      }
      const base = emptyCashDepositDay(dayKey);
      const filled = fillDayCashFromSessions(base, [session], [session.id]);
      days.push({
        ...base,
        cashAmount: filled.cashAmount,
        cashAmountSource: filled.cashAmountSource,
        sessionIds: filled.sessionIds,
        sessionActualAmounts: filled.sessionActualAmounts,
        sessionNotes: filled.sessionNotes,
        note: filled.note,
        slipKind: "shift",
        shiftLabel: "รอบขาย",
      });
      have.add(session.id);
      added += 1;
    }
    days = withSessionNotesOnDays(
      [...days].sort((a, b) => a.date - b.date),
      prepSessionNotes,
    );
    return { days, added, skipped };
  }

  function queueSessionIntoWorking(session: PosSession) {
    if (workingSessionIds.has(session.id)) return;
    if (linkedOutsideWorking.has(session.id)) {
      setError(`ซ้ำ ${posSessionCode(session.id)}`);
      return;
    }
    if (!editingRound) {
      startDraftFromSessions([session]);
      return;
    }
    const { days: nextDays, added } = mergeSessionsIntoDays(workingDays, [session]);
    if (!added) {
      setError(`ซ้ำ ${posSessionCode(session.id)}`);
      return;
    }
    applyWorkingDays(nextDays);
    setError(null);
    setAiHint(
      `+${posSessionCode(session.id)} · ${workingSessionIds.size + added} บิล`,
    );
  }

  function queueAllPendingIntoWorking() {
    if (!untickedPendingSessions.length) return;
    if (!editingRound) {
      startDraftFromSessions(untickedPendingSessions);
      return;
    }
    const { days: nextDays, added, skipped } = mergeSessionsIntoDays(
      workingDays,
      untickedPendingSessions,
    );
    if (!added) {
      setError("ครบแล้ว");
      return;
    }
    applyWorkingDays(nextDays);
    setError(null);
    setAiHint(
      `+${added}` + (skipped ? ` · ซ้ำ ${skipped}` : "") + ` · รวม ${workingSessionIds.size + added}`,
    );
  }

  function toggleSessionTick(session: PosSession) {
    if (workingSessionIds.has(session.id)) {
      removeSessionFromWorking(session.id);
      return;
    }
    queueSessionIntoWorking(session);
  }

  /** เคลียร์ติ๊กทั้งหมด → กลับคิวว่างเหมือนเดิม */
  function clearAllTicks() {
    setDraft(null);
    setSelectedId(null);
    setEditDays([]);
    setEditBankTransfers([emptyCashDepositBankTransfer()]);
    setEditStaff(staffName || "");
    setEditNote("");
    setPrepSessionNotes({});
    setError(null);
    setAiHint("");
  }

  function removeSessionFromWorking(sessionId: string) {
    const id = String(sessionId || "").trim();
    if (!id) return;
    const nextDays: CashDepositDayLine[] = [];
    for (const day of workingDays) {
      const ids = (day.sessionIds || []).filter((s) => s !== id);
      if (!ids.length) {
        // วันไม่มีบิลเหลือ — ตัดออกจากมัดรวม
        continue;
      }
      if (ids.length === (day.sessionIds || []).length) {
        nextDays.push(day);
        continue;
      }
      const matches = posSessions.filter((s) => ids.includes(s.id));
      const filled = fillDayCashFromSessions(day, matches, ids);
      nextDays.push({
        ...day,
        cashAmount: filled.cashAmount,
        cashAmountSource: filled.cashAmountSource,
        sessionIds: filled.sessionIds,
        sessionActualAmounts: filled.sessionActualAmounts,
        sessionNotes: filled.sessionNotes,
        note: filled.note,
        // keep day slipUrls (shared photos for the sales day)
      });
    }
    if (!nextDays.length) {
      if (draft) {
        setDraft(null);
        setError(null);
        setAiHint("");
        return;
      }
      setError("มัดรวมต้องมีอย่างน้อย 1 บิล");
      return;
    }
    applyWorkingDays(nextDays);
    setError(null);
    setAiHint(`−${posSessionCode(id)}`);
  }

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

  const toggleMeta = (() => {
    if (editingRound && bundledBillCount) {
      return `ติ๊ก ${bundledBillCount} · ฿${formatPlainNumber(expected)}`;
    }
    if (untickedPendingSessions.length) {
      return `รอ ${untickedPendingSessions.length} · ฿${formatPlainNumber(untickedPendingSum)}`;
    }
    if (pendingDepositSessions.length) {
      return `รอ ${pendingDepositSessions.length} · ฿${formatPlainNumber(pendingDepositSum)}`;
    }
    if (loading && !entries.length) return "…";
    return "ติ๊กบิลเพื่อโอน";
  })();
  const primaryTransfer = workingTransfers[0] ?? null;

  return (
    <aside className="cash-in-panel" aria-label="โอนนำเข้า">
      <button
        type="button"
        className="cash-in-panel-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="cash-in-panel-toggle-left">
          <span className="cash-in-panel-title">โอนนำเข้า</span>
          <span
            className={`cash-in-panel-meta${pendingDepositSessions.length ? " is-wait" : ""}`}
          >
            {toggleMeta}
          </span>
        </span>
        {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
      </button>

      {open ? (
        <div className="cash-in-panel-body">
          {pendingDepositSessions.length ? (
            <section
              className="cash-in-pending-rounds"
              aria-label="เงินสดรอนำเข้า"
            >
              <header className="cash-in-pending-head">
                <div className="cash-in-pending-title-block">
                  <strong className="cash-in-pending-title">เงินสดรอนำเข้า</strong>
                  <span className="muted cash-in-pending-sum">
                    {pendingDepositSessions.length} · ฿
                    {formatPlainNumber(pendingDepositSum)}
                    {bundledBillCount ? (
                      <>
                        {" · "}ติ๊ก {bundledBillCount}
                      </>
                    ) : null}
                  </span>
                </div>
                <div className="cash-in-pending-actions">
                  {bundledBillCount >= 1 ? (
                    <button
                      type="button"
                      className="ghost-btn cash-in-compact-btn"
                      disabled={busy || readOnly}
                      title="ล้างติ๊กทั้งหมด"
                      onClick={clearAllTicks}
                    >
                      ล้าง
                    </button>
                  ) : null}
                  {untickedPendingSessions.length > 1 ? (
                    <button
                      type="button"
                      className="ghost-btn cash-in-compact-btn"
                      disabled={busy || readOnly}
                      title="ติ๊กทุกใบ"
                      onClick={queueAllPendingIntoWorking}
                    >
                      ทุกใบ
                    </button>
                  ) : null}
                </div>
              </header>
              <ul className="cash-in-pending-list">
                {pendingDepositSessions.slice(0, 20).map((s) => {
                  const remit = sessionRemitAmount(s) || 0;
                  const handoff = deriveRemitStatus(s);
                  const opener = (s.openedByName || "").trim();
                  const closer = (s.closedByName || "").trim();
                  const openDayHm = formatCashInDayHm(s.openedAt || 0);
                  const closeDayHm = formatCashInDayHm(s.closedAt || 0);
                  const durationLabel = formatCashInDurationHm(
                    posSessionDurationMs(s),
                  );
                  const billNo = posSessionCode(s.id);
                  const ticked = workingSessionIds.has(s.id);
                  const statusShort =
                    handoff === "handed"
                      ? "ส่งแล้ว"
                      : handoff === "mismatch"
                        ? "ไม่ตรง"
                        : "";
                  const titleOpen = opener
                    ? `เปิด ${openDayHm} ${opener}`
                    : `เปิด ${openDayHm}`;
                  const titleClose = closer
                    ? `ปิด ${closeDayHm} ${closer}`
                    : `ปิด ${closeDayHm}`;
                  const systemNotes = formatSessionSystemNotes(s);
                  const staffNote = prepSessionNotes[s.id] || "";
                  const showNoteRow =
                    !readOnly || !!systemNotes.trim() || !!staffNote.trim();
                  return (
                    <li key={s.id} className="cash-in-bill-item">
                      <button
                        type="button"
                        className={[
                          "cash-in-bill-card is-tick",
                          ticked ? "is-on" : "",
                          showNoteRow ? "has-note" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        disabled={busy || readOnly}
                        title={
                          ticked
                            ? `ยกเลิกติ๊ก ${billNo}`
                            : `ติ๊กบิล ${billNo} · ${titleOpen} · ${titleClose} · ${durationLabel}`
                        }
                        aria-pressed={ticked}
                        onClick={() => toggleSessionTick(s)}
                      >
                        <span className="cash-in-bill-check" aria-hidden>
                          {ticked ? "✓" : ""}
                        </span>
                        <span className="cash-in-bill-body">
                          <span className="cash-in-bill-line">
                            <span className="cash-in-bill-amt">
                              ฿{formatPlainNumber(remit)}
                            </span>
                            <span className="cash-in-bill-meta">
                              <span>
                                {formatCashDayShort(s.date || s.openedAt || 0)}
                              </span>
                              <span>·</span>
                              <span>{sessionCounterLabel(s)}</span>
                              <span>·</span>
                              <span>{billNo}</span>
                              {statusShort ? (
                                <>
                                  <span>·</span>
                                  <span>{statusShort}</span>
                                </>
                              ) : null}
                            </span>
                          </span>
                          <span className="cash-in-bill-shift">
                            <span className="cash-in-bill-shift-part is-open">
                              <span className="cash-in-bill-shift-label">เปิด</span>
                              <span className="cash-in-bill-shift-time">{openDayHm}</span>
                              {opener ? (
                                <span className="cash-in-bill-shift-name">{opener}</span>
                              ) : null}
                            </span>
                            <span aria-hidden>·</span>
                            <span className="cash-in-bill-shift-part is-close">
                              <span className="cash-in-bill-shift-label">ปิด</span>
                              <span className="cash-in-bill-shift-time">{closeDayHm}</span>
                              {closer ? (
                                <span className="cash-in-bill-shift-name">{closer}</span>
                              ) : null}
                            </span>
                            <span aria-hidden>·</span>
                            <span
                              className="cash-in-bill-shift-duration"
                              title={`รวมกะ ${durationLabel}`}
                            >
                              {durationLabel}
                            </span>
                          </span>
                        </span>
                      </button>
                      {showNoteRow ? (
                        <div className="cash-in-bill-note">
                          {systemNotes ? (
                            <span
                              className="cash-in-bill-note-system"
                              title={systemNotes}
                            >
                              จากรอบ · {systemNotes}
                            </span>
                          ) : null}
                          {!readOnly ? (
                            <input
                              type="text"
                              className="cash-in-cell-input cash-in-bill-note-input"
                              maxLength={200}
                              placeholder="โน้ตบิลนี้ (ทอนโอนเกิน / ส่งตู้…)"
                              value={staffNote}
                              disabled={busy}
                              aria-label={`โน้ตบิล ${billNo}`}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                patchSessionPrepNote(s.id, e.target.value)
                              }
                            />
                          ) : staffNote ? (
                            <span className="cash-in-bill-note-ro" title={staffNote}>
                              โน้ต · {staffNote}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {pendingDepositSessions.length > 20 ? (
                <p className="muted cash-in-pending-more">
                  +{pendingDepositSessions.length - 20} · กดทุกใบ
                </p>
              ) : null}
            </section>
          ) : editingRound ? null : (
            <p className="muted cash-in-hint">ยังไม่มีบิล · ปิดกะแล้วขึ้นที่นี่</p>
          )}

          {readOnly ? (
            <p className="muted cash-in-hint">พรีวิว · แก้ไม่ได้</p>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}

          {bundledBillCount >= 1 ? (
            <div
              className="cash-in-summary-bar cash-in-remain is-compact"
              aria-live="polite"
            >
              <div className="cash-in-summary-rows">
                <div className="cash-in-summary-pair">
                  <div className="cash-in-summary-row">
                    <span>ยอดรวม</span>
                    <strong title="โอนเงินตามยอดนี้">
                      ฿{formatPlainNumber(expected)}
                    </strong>
                  </div>
                  <div className="cash-in-summary-row is-fee">
                    <span>คชจ.</span>
                    {primaryTransfer && !readOnly ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        className="cash-in-cell-input is-num cash-in-summary-fee"
                        placeholder="0"
                        aria-label="คชจ.โอน"
                        value={
                          primaryTransfer.fee ? String(primaryTransfer.fee) : ""
                        }
                        onChange={(e) =>
                          patchTransfer(primaryTransfer.id, {
                            fee: Number(e.target.value) || 0,
                          })
                        }
                      />
                    ) : (
                      <strong>฿{formatPlainNumber(workingFee)}</strong>
                    )}
                  </div>
                </div>
                <div className="cash-in-summary-status">
                  <span className="cash-in-summary-chip is-net">
                    <span className="cash-in-summary-chip-label">ควรเข้า</span>
                    <strong>฿{formatPlainNumber(netBankTarget)}</strong>
                  </span>
                  <span className="cash-in-summary-chip">
                    <span className="cash-in-summary-chip-label">สลิป</span>
                    <strong>฿{formatPlainNumber(workingBank)}</strong>
                  </span>
                  <span
                    className={[
                      "cash-in-summary-chip is-diff",
                      variance < -0.005
                        ? "is-short"
                        : variance > 0.005
                          ? "is-over"
                          : "is-ok",
                    ].join(" ")}
                    title="ยอดสลิป − ควรเข้า (หลังหักคชจ.)"
                  >
                    <span className="cash-in-summary-chip-label">ส่วนต่าง</span>
                    <strong>
                      {Math.abs(variance) < 0.005
                        ? "ตรง"
                        : variance > 0
                          ? `+${formatPlainNumber(variance)}`
                          : formatPlainNumber(variance)}
                    </strong>
                  </span>
                </div>
              </div>

              <section className="cash-in-summary-slips" aria-label="สลิปโอนเงิน">
                <header className="cash-in-summary-slips-head">
                  <strong>สลิปโอน</strong>
                  <span className="muted">
                    {bankSlipUrlCount
                      ? `${bankSlipUrlCount} รูป · หลายใบได้`
                      : "แนบได้หลายใบ"}
                  </span>
                </header>
                <ul className="cash-in-summary-slip-list">
                  {workingTransfers.map((t, idx) => (
                    <li key={t.id} className="cash-in-summary-slip-row">
                      <span className="cash-in-summary-slip-idx">#{idx + 1}</span>
                      {!readOnly ? (
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          inputMode="decimal"
                          className="cash-in-cell-input is-num cash-in-summary-slip-amt"
                          placeholder="เข้าบช."
                          value={t.amount ? String(t.amount) : ""}
                          onChange={(e) =>
                            patchTransfer(t.id, {
                              amount: Number(e.target.value) || 0,
                            })
                          }
                        />
                      ) : (
                        <strong className="cash-in-summary-slip-amt-ro">
                          ฿{formatPlainNumber(t.amount)}
                        </strong>
                      )}
                      <EntryPhotoIndicator
                        imageUrls={t.slipUrls}
                        label={`สลิปโอน ${idx + 1}`}
                        onAdd={
                          !readOnly && t.slipUrls.length === 0
                            ? () => openBankPhoto(t.id)
                            : undefined
                        }
                        onView={(urls) =>
                          setImagePreview({
                            urls,
                            title: `สลิปโอน #${idx + 1}`,
                            editTarget: { kind: "bank", transferId: t.id },
                          })
                        }
                      />
                      {!readOnly &&
                      t.slipUrls.length > 0 &&
                      t.slipUrls.length < CASH_DEPOSIT_BANK_SLIP_MAX ? (
                        <button
                          type="button"
                          className="ghost-btn cash-in-action-btn"
                          disabled={busy}
                          onClick={() => openBankPhoto(t.id)}
                          title="เพิ่มรูป"
                        >
                          +
                        </button>
                      ) : null}
                      {!readOnly && t.slipUrls.length ? (
                        <button
                          type="button"
                          className="ghost-btn cash-in-action-btn"
                          disabled={busy || aiBusy}
                          onClick={() => void runAiBank(t.id, t.slipUrls, true)}
                          title="อ่านสลิป"
                        >
                          AI
                        </button>
                      ) : null}
                      {!readOnly && workingTransfers.length > 1 ? (
                        <button
                          type="button"
                          className="ghost-btn danger-text cash-in-action-btn"
                          disabled={busy}
                          title="ลบสลิป"
                          onClick={() => removeBankTransfer(t.id)}
                        >
                          ×
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              <label className="cash-in-summary-note" aria-label="โน้ตมัดโอน">
                <span className="cash-in-summary-note-label">โน้ต</span>
                {!readOnly ? (
                  <input
                    type="text"
                    className="cash-in-cell-input cash-in-note-field cash-in-summary-note-input"
                    maxLength={500}
                    placeholder="เช่น ทอนโอนเกิน · ส่งตู้เซฟ · หมายเหตุมัดนี้"
                    value={workingNote}
                    onChange={(e) => patchWorkingNote(e.target.value)}
                    disabled={busy}
                  />
                ) : (
                  <span className="cash-in-summary-note-ro">
                    {workingNote.trim() || "—"}
                  </span>
                )}
              </label>

              {coverage.issues.length ? (
                <ul className="cash-in-issues">
                  {coverage.issues.slice(0, 3).map((issue, i) => (
                    <li key={`${issue.code}-${i}`}>{issue.message}</li>
                  ))}
                </ul>
              ) : null}

              <div className="cash-in-round-actions" aria-label="จัดการมัดโอน">
                {!readOnly &&
                workingTransfers.length < CASH_DEPOSIT_BANK_TRANSFER_MAX ? (
                  <button
                    type="button"
                    className="ghost-btn cash-in-action-btn"
                    disabled={busy}
                    title="เพิ่มสลิปโอน"
                    onClick={addBankTransfer}
                  >
                    +สลิป
                  </button>
                ) : null}
                <button
                  type="button"
                  className="primary-btn action-in cash-in-action-btn"
                  disabled={busy || !!coverage.issues.length || !bundledBillCount}
                  onClick={() => void saveWorking()}
                >
                  {busy ? "…" : "บันทึก"}
                </button>
                <button
                  type="button"
                  className="ghost-btn cash-in-action-btn"
                  disabled={busy}
                  onClick={clearAllTicks}
                  title="ล้างติ๊ก กลับคิวว่าง"
                >
                  ล้าง
                </button>
                {selected && (isOwner || selected.createdBy === actorId) ? (
                  <button
                    type="button"
                    className="ghost-btn danger-text cash-in-action-btn"
                    disabled={busy}
                    onClick={() => void onDeleteRound()}
                  >
                    ลบ
                  </button>
                ) : null}
                {aiHint ? (
                  <span
                    className={
                      aiBusy
                        ? "muted cash-in-ai-hint is-inline"
                        : "cash-in-ai-hint is-inline"
                    }
                    title={aiHint}
                  >
                    {aiBusy ? "…" : ""}
                    {aiHint}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Round chips */}
          {entries.length || draft ? (
            <div className="cash-in-round-chips" role="tablist" aria-label="มัดรวม">
              {draft ? (
                <button
                  type="button"
                  className="cash-in-round-chip is-active is-draft"
                  aria-selected
                >
                  ร่าง {bundledBillCount || draft.dayCount}
                </button>
              ) : null}
              {entries.map((e) => {
                const transferUi = deriveCashDepositTransferUiState(e);
                return (
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
                    <span className={transferUiClass(transferUi)}>
                      {labelCashDepositTransferUiState(transferUi)}
                    </span>
                  </button>
                );
              })}
              {!draft ? (
                <button
                  type="button"
                  className={["cash-in-round-chip", !selectedId ? "is-active" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  aria-selected={!selectedId}
                  onClick={() => setSelectedId(null)}
                >
                  ทั้งหมด
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Overview: all rounds flattened */}
          {!editingRound ? (
            <>
              {loading && !flatRows.length ? (
                <p className="empty">…</p>
              ) : !flatRows.length ? (
                <p className="empty">ยังไม่มีมัดรวม · ติ๊กบิลด้านบนเพื่อโอน</p>
              ) : (
                <div className="sheet-wrap cash-in-panel-table-wrap">
                  <table className="sheet-table cash-in-slim">
                    <thead>
                      <tr>
                        <th className="col-round">มัด</th>
                        <th className="col-date">วัน</th>
                        <th className="col-num" title="ยอดบิล">
                          ยอด
                        </th>
                        <th className="col-note" title="โน้ตมัดโอน">
                          โน้ต
                        </th>
                        <th className="col-slip" title="สลิปโอนเข้าบัญชี">
                          สลิปโอน
                        </th>
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
                          <td className="col-note" title={row.roundNote || undefined}>
                            {row.roundNote ? (
                              <span className="cash-in-round-note">{row.roundNote}</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="col-slip">
                            {row.bankSlipUrls.length ? (
                              <EntryPhotoIndicator
                                imageUrls={row.bankSlipUrls}
                                label="สลิปโอน"
                                onView={(urls) =>
                                  setImagePreview({
                                    urls,
                                    title: `สลิปโอน ${row.roundLabel}`,
                                  })
                                }
                              />
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="col-type">
                            <span className={transferUiClass(row.transferUi)}>
                              {labelCashDepositTransferUiState(row.transferUi)}
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

        </div>
      ) : null}

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
          onRemoveAt={
            imagePreview.editTarget
              ? (index) => removePreviewPhotoAt(index)
              : undefined
          }
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
