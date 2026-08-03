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
  labelCashDepositRound,
  labelCashDepositStatus,
  listCashDeposits,
  subscribeCashDepositsPage,
  suggestedNetBankTransfer,
  sumBankTransferAmounts,
  sumBankTransferFees,
  sumCashDepositDays,
  updateCashDeposit,
  verifyCashDeposit,
} from "@/lib/cash-deposits";
import {
  extractCashBankSlipFromPhotos,
  labelCashFillSource,
} from "@/lib/cash-deposits-ai";
import {
  type PhotoUploadProgress,
  uploadEvidencePhotos,
} from "@/lib/photo-upload";
import { subscribePosSessionsRecent } from "@/lib/pos-sales-report";
import {
  deriveRemitStatus,
  fillDayCashFromSessions,
  groupSessionsBySalesDay,
  linkedSessionIdsFromDeposits,
  pendingDepositSessionsForCashIn,
  sessionCounterLabel,
  sessionRemitAmount,
  sumSessionRemits,
} from "@/lib/pos-session-remit";
import { posSessionCode } from "@/lib/pos-sales-report";
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

function writeOpenPref(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
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
  note: string;
  bankTransfers: CashDepositBankTransfer[];
  days: CashDepositDayLine[];
  aiReason: string;
};

type PhotoPreviewState = {
  urls: string[];
  title: string;
  /** When set, viewer can delete individual photos */
  editTarget?: { kind: "bank"; transferId: string };
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

function sourceBadge(source: CashFillSource | undefined) {
  const label = labelCashFillSource(source);
  if (!label) return null;
  return (
    <span
      className={
        source === "ai" ? "cash-in-src is-ai" : "cash-in-src is-staff"
      }
      title={source === "ai" ? "อ่านจากสลิปด้วย AI" : "ใส่โดยพนักงาน"}
    >
      {label}
    </span>
  );
}

/**
 * Compact cash-in table on /ledger/ — no popup form.
 * Multiple bank-transfer slips per round (each with own amount + fee).
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
  const [ownerNote, setOwnerNote] = useState("");
  const [editNote, setEditNote] = useState("");
  const [imagePreview, setImagePreview] = useState<PhotoPreviewState | null>(null);
  const [uploadProgress, setUploadProgress] = useState<PhotoUploadProgress | null>(null);
  const uploadCancelRef = useRef(false);
  const bankPhotoRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<{ kind: "bank"; transferId: string } | null>(
    null,
  );

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
      })),
    );
    setEditNote(selected.note || "");
    setOwnerNote(selected.ownerNote || "");
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
  const workingBank = sumBankTransferAmounts(workingTransfers);
  const workingFee = sumBankTransferFees(workingTransfers);
  const expected = sumCashDepositDays(workingDays);
  /** มัดรวมบิล → ยอดที่ควรโอนเข้าบัญชีหลังหักคชจ. (ไม่ต้องเบิกคชจ.) */
  const netBankTarget = suggestedNetBankTransfer(expected, workingFee);
  const remainingToTransfer =
    Math.round((netBankTarget - workingBank) * 100) / 100;
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

  /** ใส่ยอดสลิปโอนใบเดียว = มัดรวมบิล − คชจ. */
  function fillNetBankFromBundle() {
    if (!expected) {
      setError("ยังไม่มีบิลในมัด");
      return;
    }
    if (workingTransfers.length !== 1) {
      setError("ใช้ได้เมื่อมีสลิปเดียว");
      return;
    }
    const only = workingTransfers[0]!;
    const net = suggestedNetBankTransfer(expected, only.fee);
    patchTransfer(only.id, { amount: net });
    setError(null);
    setAiHint(`โอน ฿${formatPlainNumber(net)}`);
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
    if (!prev?.editTarget) return;
    const nextUrls = prev.urls.filter((_, i) => i !== index);
    setTransferSlipUrls(prev.editTarget.transferId, nextUrls);
    if (!nextUrls.length) {
      setImagePreview(null);
      setAiHint("ลบรูปแล้ว");
      return;
    }
    setImagePreview({ ...prev, urls: nextUrls });
  }

  function clearSlipUrls(target: { kind: "bank"; transferId: string }) {
    if (!window.confirm("ลบรูปสลิปนี้?")) return;
    setTransferSlipUrls(target.transferId, []);
    setImagePreview((prev) => {
      if (!prev?.editTarget) return prev;
      if (prev.editTarget.transferId === target.transferId) return null;
      return prev;
    });
    setAiHint("ลบรูปแล้ว");
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
      const days = workingDays.map((d) => ({
        ...d,
        date: cashDepositDayKey(d.date),
        cashAmount: Number(d.cashAmount) || 0,
        drawerCloseAmount: Number(d.drawerCloseAmount) || 0,
        cashAmountSource: d.cashAmountSource || ("" as CashFillSource),
        drawerCloseAmountSource: d.drawerCloseAmountSource || ("" as CashFillSource),
        dateSource: d.dateSource || ("" as CashFillSource),
        note: (d.note || "").trim().slice(0, 200),
        slipUrls: [...d.slipUrls],
        sessionIds: [...(d.sessionIds || [])],
      }));
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
    if (readOnly || !selected || !isOwner) return;
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

  const linkedSessionIds = useMemo(
    () => linkedSessionIdsFromDeposits(entries),
    [entries],
  );
  /** Saved deposits + bills already in the open bundle — ไม่โชว์ซ้ำในคิวรอ */
  const blockedSessionIds = useMemo(() => {
    const ids = new Set(linkedSessionIds);
    for (const id of workingSessionIds) ids.add(id);
    return ids;
  }, [linkedSessionIds, workingSessionIds]);
  const pendingDepositSessions = useMemo(
    () => pendingDepositSessionsForCashIn(posSessions, blockedSessionIds),
    [posSessions, blockedSessionIds],
  );
  const pendingDepositSum = useMemo(
    () => sumSessionRemits(pendingDepositSessions),
    [pendingDepositSessions],
  );
  /** บิลที่อยู่ในมัดรวมตอนนี้ — แสดงรายการชัดๆ */
  const bundledBills = useMemo(() => {
    const rows: {
      session: PosSession | null;
      sessionId: string;
      dayId: string;
      date: number;
      remit: number;
    }[] = [];
    const byId = new Map(posSessions.map((s) => [s.id, s]));
    for (const day of workingDays) {
      for (const sid of day.sessionIds || []) {
        const id = String(sid || "").trim();
        if (!id) continue;
        const session = byId.get(id) || null;
        rows.push({
          session,
          sessionId: id,
          dayId: day.id,
          date: day.date || session?.date || session?.openedAt || 0,
          remit: session ? sessionRemitAmount(session) || 0 : 0,
        });
      }
    }
    rows.sort((a, b) => {
      if (a.date !== b.date) return b.date - a.date;
      return a.sessionId.localeCompare(b.sessionId);
    });
    return rows;
  }, [workingDays, posSessions]);

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
    const days = groups.map(({ date, sessions: daySessions }) => {
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
        note: filled.note,
        slipKind: "shift" as const,
        shiftLabel: "รอบขาย",
      };
    });
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
      note: `มัดรวมบิลรอโอน ${sessions.length} ใบ`,
      bankTransfers: [bankRow],
      days,
      aiReason: "",
    });
    setAiHint(`${sessions.length} บิล · ฿${formatPlainNumber(bundleTotal)}`);
    if (!open) {
      setOpen(true);
      writeOpenPref(true);
    }
  }

  function refreshBankAmountForBundle(nextDays: CashDepositDayLine[]) {
    const bundle = sumCashDepositDays(nextDays);
    if (workingTransfers.length !== 1) return;
    const only = workingTransfers[0]!;
    const prevSuggested = suggestedNetBankTransfer(expected, only.fee);
    const amountLooksAuto =
      !(Number(only.amount) > 0) ||
      Math.abs((Number(only.amount) || 0) - prevSuggested) < 0.005 ||
      only.amountSource !== "staff";
    if (!amountLooksAuto) return;
    const net = suggestedNetBankTransfer(bundle, only.fee);
    patchTransfer(only.id, { amount: net });
  }

  function mergeSessionsIntoDays(
    baseDays: CashDepositDayLine[],
    sessions: PosSession[],
  ): { days: CashDepositDayLine[]; added: number; skipped: number } {
    let days = baseDays.map((d) => ({
      ...d,
      sessionIds: [...(d.sessionIds || [])],
      slipUrls: [...(d.slipUrls || [])],
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
      if (have.has(session.id) || linkedSessionIds.has(session.id)) {
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
        existing.note = filled.note;
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
        note: filled.note,
        slipKind: "shift",
        shiftLabel: "รอบขาย",
      });
      have.add(session.id);
      added += 1;
    }
    days = [...days].sort((a, b) => a.date - b.date);
    return { days, added, skipped };
  }

  function queueSessionIntoWorking(session: PosSession) {
    if (workingSessionIds.has(session.id) || linkedSessionIds.has(session.id)) {
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
    setDays(nextDays);
    refreshBankAmountForBundle(nextDays);
    setError(null);
    setAiHint(
      `+${posSessionCode(session.id)} · ${workingSessionIds.size + added} บิล`,
    );
  }

  function queueAllPendingIntoWorking() {
    if (!pendingDepositSessions.length) return;
    if (!editingRound) {
      startDraftFromSessions(pendingDepositSessions);
      return;
    }
    const { days: nextDays, added, skipped } = mergeSessionsIntoDays(
      workingDays,
      pendingDepositSessions,
    );
    if (!added) {
      setError("ครบแล้ว");
      return;
    }
    setDays(nextDays);
    refreshBankAmountForBundle(nextDays);
    setError(null);
    setAiHint(
      `+${added}` + (skipped ? ` · ซ้ำ ${skipped}` : "") + ` · รวม ${workingSessionIds.size + added}`,
    );
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
        note: filled.note,
      });
    }
    if (!nextDays.length) {
      setError("มัดรวมต้องมีอย่างน้อย 1 บิล");
      return;
    }
    setDays(nextDays);
    refreshBankAmountForBundle(nextDays);
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
      return `${bundledBillCount} บิล · ฿${formatPlainNumber(expected)}`;
    }
    if (pendingDepositSessions.length) {
      return `รอ ${pendingDepositSessions.length} · ฿${formatPlainNumber(pendingDepositSum)}`;
    }
    if (loading && !entries.length) return "…";
    if (pendingCount > 0) return `รอตรวจ ${pendingCount}`;
    return "กดบิลเพื่อใส่";
  })();

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
              aria-label="บิลรอใส่"
            >
              <header className="cash-in-pending-head">
                <div>
                  <strong>รอใส่</strong>
                  <span className="muted cash-in-pending-sum">
                    {" "}
                    {pendingDepositSessions.length} · ฿
                    {formatPlainNumber(pendingDepositSum)}
                  </span>
                </div>
                {pendingDepositSessions.length > 1 ? (
                  <button
                    type="button"
                    className="ghost-btn cash-in-compact-btn"
                    disabled={busy || readOnly}
                    title="ใส่ทุกใบ"
                    onClick={queueAllPendingIntoWorking}
                  >
                    ทุกใบ
                  </button>
                ) : null}
              </header>
              <ul className="cash-in-pending-list">
                {pendingDepositSessions.slice(0, 20).map((s) => {
                  const remit = sessionRemitAmount(s) || 0;
                  const handoff = deriveRemitStatus(s);
                  const opener = (s.openedByName || "").trim();
                  const billNo = posSessionCode(s.id);
                  const statusShort =
                    handoff === "handed"
                      ? "ส่งแล้ว"
                      : handoff === "mismatch"
                        ? "ไม่ตรง"
                        : "";
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="cash-in-bill-card is-tap"
                        disabled={busy || readOnly}
                        title={`ใส่บิล ${billNo}`}
                        onClick={() => queueSessionIntoWorking(s)}
                      >
                        <span className="cash-in-bill-amt">
                          ฿{formatPlainNumber(remit)}
                        </span>
                        <span className="cash-in-bill-meta">
                          <span>{formatCashDayShort(s.date || s.openedAt || 0)}</span>
                          <span>·</span>
                          <span>{sessionCounterLabel(s)}</span>
                          <span>·</span>
                          <span>{billNo}</span>
                          {opener ? (
                            <>
                              <span>·</span>
                              <span>{opener}</span>
                            </>
                          ) : null}
                          {statusShort ? (
                            <>
                              <span>·</span>
                              <span>{statusShort}</span>
                            </>
                          ) : null}
                        </span>
                        <span className="cash-in-bill-use" aria-hidden>
                          ใส่
                        </span>
                      </button>
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
                <p className="empty">ยังไม่มีมัดรวม · กดบิลด้านบนเพื่อใส่</p>
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

          {/* Edit / draft — bundle first, then bank slip */}
          {editingRound ? (
            <div className="cash-in-round-edit">
              <section
                className="cash-in-bundle-bills"
                aria-label="ในมัด"
              >
                <header className="cash-in-bundle-head">
                  <strong>ในมัด</strong>
                  <span className="muted">
                    {bundledBillCount} · ฿{formatPlainNumber(expected)}
                  </span>
                </header>
                {bundledBills.length ? (
                  <ul className="cash-in-bundle-list">
                    {bundledBills.map((row, idx) => {
                      const billNo = posSessionCode(row.sessionId);
                      return (
                        <li key={row.sessionId} className="cash-in-bundle-row">
                          <div className="cash-in-bundle-main">
                            <span className="cash-in-bill-tag">#{idx + 1}</span>
                            <span className="cash-in-bill-no" title={row.sessionId}>
                              {billNo}
                            </span>
                            <span className="muted">
                              {formatCashDayShort(row.date)}
                              {row.session
                                ? ` · ${sessionCounterLabel(row.session)}`
                                : ""}
                            </span>
                            <span className="cash-in-bundle-amt">
                              ฿{formatPlainNumber(row.remit)}
                            </span>
                            {!readOnly ? (
                              <button
                                type="button"
                                className="ghost-btn danger-text cash-in-compact-btn"
                                disabled={busy || bundledBillCount <= 1}
                                title="เอาออก"
                                onClick={() => removeSessionFromWorking(row.sessionId)}
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="muted cash-in-hint">กดบิลด้านบนเพื่อใส่</p>
                )}
              </section>

              <div className="cash-in-remain" aria-live="polite">
                <p className="cash-in-remain-line">
                  รวม ฿{formatPlainNumber(expected)}
                  {" · "}คชจ. {formatPlainNumber(workingFee)}
                  {" · "}โอน{" "}
                  <strong>{formatPlainNumber(netBankTarget)}</strong>
                  {" · "}เข้าแล้ว {formatPlainNumber(workingBank)}
                  {" · "}เหลือ{" "}
                  <strong
                    className={
                      remainingToTransfer === 0
                        ? "is-ok"
                        : remainingToTransfer > 0
                          ? "is-off"
                          : "is-over"
                    }
                  >
                    {formatPlainNumber(remainingToTransfer)}
                  </strong>
                </p>
                {workingTransfers.length === 1 && expected > 0 ? (
                  <button
                    type="button"
                    className="ghost-btn cash-in-compact-btn"
                    disabled={busy || readOnly}
                    title="ใส่ยอดโอน = รวม − คชจ."
                    onClick={fillNetBankFromBundle}
                  >
                    ใส่ยอด
                  </button>
                ) : null}
              </div>

              <div className="cash-in-round-meta">
                <label className="cash-in-create-field">
                  <span>ใคร</span>
                  <input
                    value={draft ? draft.staffName : editStaff}
                    onChange={(e) => {
                      if (draft) setDraft({ ...draft, staffName: e.target.value });
                      else setEditStaff(e.target.value);
                    }}
                  />
                </label>
                <label className="cash-in-create-field cash-in-note-field">
                  <span>โน้ต</span>
                  <input
                    value={draft ? draft.note : editNote}
                    maxLength={500}
                    placeholder="สั้นๆ"
                    onChange={(e) => {
                      if (draft) setDraft({ ...draft, note: e.target.value });
                      else setEditNote(e.target.value);
                    }}
                  />
                </label>
              </div>

              <div className="sheet-wrap cash-in-panel-table-wrap">
                <table className="sheet-table cash-in-slim cash-in-bank-table is-edit">
                  <thead>
                    <tr>
                      <th className="col-round">#</th>
                      <th className="col-num" title="เข้าบัญชี">
                        เข้าบช.
                      </th>
                      <th className="col-num">คชจ.</th>
                      <th>Ref</th>
                      <th className="col-slip">สลิป</th>
                      <th className="col-slip" aria-label="AI" />
                    </tr>
                  </thead>
                  <tbody>
                    {workingTransfers.map((t, idx) => (
                      <tr key={t.id}>
                        <td className="col-round">
                          <div className="cash-in-bank-idx">
                            <span>{idx + 1}</span>
                            {workingTransfers.length > 1 ? (
                              <button
                                type="button"
                                className="ghost-btn danger-text cash-in-compact-btn"
                                disabled={busy}
                                title="ลบสลิป"
                                onClick={() => removeBankTransfer(t.id)}
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="col-num">
                          <div className="cash-in-cell-stack">
                            {sourceBadge(t.amountSource)}
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              inputMode="decimal"
                              className="cash-in-cell-input is-num"
                              placeholder="0"
                              value={t.amount ? String(t.amount) : ""}
                              onChange={(e) =>
                                patchTransfer(t.id, {
                                  amount: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </div>
                        </td>
                        <td className="col-num">
                          <div className="cash-in-cell-stack">
                            {sourceBadge(t.feeSource)}
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              className="cash-in-cell-input is-num"
                              placeholder="0"
                              value={t.fee ? String(t.fee) : ""}
                              onChange={(e) =>
                                patchTransfer(t.id, {
                                  fee: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </div>
                        </td>
                        <td>
                          <input
                            className="cash-in-cell-input"
                            value={t.bankRef}
                            placeholder="Ref"
                            onChange={(e) =>
                              patchTransfer(t.id, { bankRef: e.target.value })
                            }
                          />
                        </td>
                        <td className="col-slip">
                          <div className="cash-in-slip-actions is-col">
                            <EntryPhotoIndicator
                              imageUrls={t.slipUrls}
                              label={`สลิปโอน ${idx + 1}`}
                              onAdd={
                                t.slipUrls.length === 0
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
                            <div className="cash-in-slip-btn-row">
                              {t.slipUrls.length > 0 &&
                              t.slipUrls.length < CASH_DEPOSIT_BANK_SLIP_MAX ? (
                                <button
                                  type="button"
                                  className="ghost-btn cash-in-compact-btn"
                                  disabled={busy}
                                  onClick={() => openBankPhoto(t.id)}
                                  title="เพิ่มรูป"
                                >
                                  +
                                </button>
                              ) : null}
                              {t.slipUrls.length ? (
                                <button
                                  type="button"
                                  className="ghost-btn danger-text cash-in-compact-btn"
                                  disabled={busy}
                                  onClick={() =>
                                    clearSlipUrls({ kind: "bank", transferId: t.id })
                                  }
                                  title="ลบรูป"
                                >
                                  ลบ
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="col-slip">
                          {t.slipUrls.length ? (
                            <button
                              type="button"
                              className="ghost-btn cash-in-compact-btn"
                              disabled={busy || aiBusy}
                              onClick={() => void runAiBank(t.id, t.slipUrls, true)}
                              title="อ่านสลิป"
                            >
                              AI
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="col-round" colSpan={1}>
                        รวม
                      </td>
                      <td className="col-num">{formatPlainNumber(workingBank)}</td>
                      <td className="col-num">
                        {workingFee ? formatPlainNumber(workingFee) : "0"}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {workingTransfers.length < CASH_DEPOSIT_BANK_TRANSFER_MAX ? (
                <button
                  type="button"
                  className="ghost-btn cash-in-compact-btn"
                  disabled={busy}
                  onClick={addBankTransfer}
                >
                  +สลิป
                </button>
              ) : null}

              {aiHint ? (
                <p className={aiBusy ? "muted cash-in-ai-hint" : "cash-in-ai-hint"}>
                  {aiBusy ? "…" : ""}
                  {aiHint}
                </p>
              ) : null}

              <div className="cash-in-math is-slim" aria-live="polite">
                <span>
                  {bundledBillCount} บิล · รวม ฿{formatPlainNumber(expected)} ·
                  เข้า {formatPlainNumber(workingBank)} · คชจ.{" "}
                  {formatPlainNumber(workingFee)}
                  {bankSlipUrlCount ? ` · รูป ${bankSlipUrlCount}` : ""} ·{" "}
                  <strong className={variance === 0 ? "is-ok" : "is-off"}>
                    {variance === 0
                      ? "ตรง"
                      : `${variance > 0 ? "+" : ""}${formatPlainNumber(variance)}`}
                  </strong>
                </span>
              </div>

              {coverage.issues.length ? (
                <ul className="cash-in-issues">
                  {coverage.issues.slice(0, 3).map((issue, i) => (
                    <li key={`${issue.code}-${i}`}>{issue.message}</li>
                  ))}
                </ul>
              ) : null}

              <div className="cash-in-round-actions">
                <button
                  type="button"
                  className="primary-btn action-in cash-in-compact-btn"
                  disabled={busy || !!coverage.issues.length || !bundledBillCount}
                  onClick={() => void saveWorking()}
                >
                  {busy ? "…" : "บันทึก"}
                </button>
                <button
                  type="button"
                  className="ghost-btn cash-in-compact-btn"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    setSelectedId(null);
                  }}
                >
                  ปิด
                </button>
                {selected && (isOwner || selected.createdBy === actorId) ? (
                  <button
                    type="button"
                    className="ghost-btn danger-text cash-in-compact-btn"
                    disabled={busy}
                    onClick={() => void onDeleteRound()}
                  >
                    ลบ
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
