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
  addCalendarDays,
  addCashDeposit,
  analyzeCashDepositDays,
  buildCashDepositOccupancy,
  buildCashDepositRoundDays,
  CASH_DEPOSIT_BANK_SLIP_MAX,
  CASH_DEPOSIT_BANK_TRANSFER_MAX,
  CASH_DEPOSIT_DAY_MAX,
  CASH_DEPOSIT_DAY_SLIP_MAX,
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
  sumBankTransferAmounts,
  sumBankTransferFees,
  sumCashDepositDays,
  updateCashDeposit,
  verifyCashDeposit,
} from "@/lib/cash-deposits";
import {
  extractCashBankSlipFromPhotos,
  extractCashDaySlipFromPhotos,
  labelCashFillSource,
} from "@/lib/cash-deposits-ai";
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
  note: string;
  bankTransfers: CashDepositBankTransfer[];
  days: CashDepositDayLine[];
  aiReason: string;
};

type PhotoPreviewState = {
  urls: string[];
  title: string;
  /** When set, viewer can delete individual photos */
  editTarget?:
    | { kind: "day"; dayId: string }
    | { kind: "bank"; transferId: string };
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
  const [editNote, setEditNote] = useState("");
  const [imagePreview, setImagePreview] = useState<PhotoPreviewState | null>(null);
  const [uploadProgress, setUploadProgress] = useState<PhotoUploadProgress | null>(null);
  const uploadCancelRef = useRef(false);
  const dayPhotoRef = useRef<HTMLInputElement>(null);
  const bankPhotoRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<
    | { kind: "day"; dayId: string }
    | { kind: "bank"; transferId: string }
    | null
  >(null);

  const [editStaff, setEditStaff] = useState("");
  const [editBankTransfers, setEditBankTransfers] = useState<CashDepositBankTransfer[]>([
    emptyCashDepositBankTransfer(),
  ]);
  const [editDays, setEditDays] = useState<CashDepositDayLine[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const lastAiKeyRef = useRef("");

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
    setEditDays(selected.days.map((d) => ({ ...d, slipUrls: [...d.slipUrls] })));
    setEditNote(selected.note || "");
    setOwnerNote(selected.ownerNote || "");
  }, [selected, draft, staffName]);

  const occupancy = useMemo(
    () => buildCashDepositOccupancy(entries, selected?.id),
    [entries, selected?.id],
  );

  const workingDays = draft?.days ?? editDays;
  const workingTransfers = draft?.bankTransfers ?? editBankTransfers;
  const workingBank = sumBankTransferAmounts(workingTransfers);
  const workingFee = sumBankTransferFees(workingTransfers);
  const expected = sumCashDepositDays(workingDays);
  const remainingToTransfer =
    Math.round((expected - workingBank) * 100) / 100;
  const variance = cashDepositVariance(workingBank, expected, workingFee);
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
      note: "",
      bankTransfers: [emptyCashDepositBankTransfer(endMs)],
      days: buildCashDepositRoundDays(endMs, n),
      aiReason: "",
    });
    setAiHint(null);
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
    const apply = (rows: CashDepositBankTransfer[]) =>
      rows.map((t) => {
        if (t.id !== transferId) return t;
        const next: CashDepositBankTransfer = { ...t, ...patch };
        if (!fromAi) {
          if (patch.amount != null) next.amountSource = "staff";
          if (patch.fee != null) next.feeSource = "staff";
        }
        return next;
      });
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

  function patchDay(
    dayId: string,
    patch: Partial<CashDepositDayLine>,
    opts?: { fromAi?: boolean },
  ) {
    const fromAi = !!opts?.fromAi;
    const apply = (days: CashDepositDayLine[]) =>
      days.map((d) => {
        if (d.id !== dayId) return d;
        const next: CashDepositDayLine = {
          ...d,
          ...patch,
          date: patch.date != null ? cashDepositDayKey(patch.date) : d.date,
        };
        if (!fromAi) {
          if (patch.cashAmount != null) next.cashAmountSource = "staff";
          if (patch.date != null) next.dateSource = "staff";
        }
        return next;
      });
    if (draft) setDraft({ ...draft, days: apply(draft.days) });
    else setEditDays((prev) => apply(prev));
  }

  function openDayPhoto(dayId: string) {
    photoTargetRef.current = { kind: "day", dayId };
    dayPhotoRef.current?.click();
  }

  function openBankPhoto(transferId: string) {
    photoTargetRef.current = { kind: "bank", transferId };
    bankPhotoRef.current?.click();
  }

  function addDay(where: "start" | "end" = "end") {
    if (workingDays.length >= CASH_DEPOSIT_DAY_MAX) {
      setError(`รอบหนึ่งมีได้สูงสุด ${CASH_DEPOSIT_DAY_MAX} วัน`);
      return;
    }
    setError(null);
    const sorted = [...workingDays].sort((a, b) => a.date - b.date);
    const fallback = cashDepositDayKey(
      draft?.transferDate ?? selected?.transferDate ?? Date.now(),
    );
    const anchor =
      where === "end"
        ? sorted[sorted.length - 1]?.date || fallback
        : sorted[0]?.date || fallback;
    const date = addCalendarDays(anchor, where === "end" ? 1 : -1);
    const day = emptyCashDepositDay(date);
    setDays(where === "end" ? [...workingDays, day] : [day, ...workingDays]);
  }

  function removeDay(dayId: string) {
    if (workingDays.length <= 1) {
      setError("รอบต้องมีอย่างน้อย 1 วัน");
      return;
    }
    setError(null);
    setDays(workingDays.filter((d) => d.id !== dayId));
    setImagePreview((prev) =>
      prev?.editTarget?.kind === "day" && prev.editTarget.dayId === dayId
        ? null
        : prev,
    );
  }

  function setTransferSlipUrls(transferId: string, slipUrls: string[]) {
    const apply = (rows: CashDepositBankTransfer[]) =>
      rows.map((t) => (t.id === transferId ? { ...t, slipUrls } : t));
    if (draft) setDraft({ ...draft, bankTransfers: apply(draft.bankTransfers) });
    else setEditBankTransfers((prev) => apply(prev));
  }

  function setDaySlipUrls(dayId: string, slipUrls: string[]) {
    const apply = (days: CashDepositDayLine[]) =>
      days.map((d) => (d.id === dayId ? { ...d, slipUrls } : d));
    if (draft) setDraft({ ...draft, days: apply(draft.days) });
    else setEditDays((prev) => apply(prev));
  }

  function removePreviewPhotoAt(index: number) {
    const prev = imagePreview;
    if (!prev?.editTarget) return;
    const nextUrls = prev.urls.filter((_, i) => i !== index);
    if (prev.editTarget.kind === "bank") {
      setTransferSlipUrls(prev.editTarget.transferId, nextUrls);
    } else {
      setDaySlipUrls(prev.editTarget.dayId, nextUrls);
    }
    if (!nextUrls.length) {
      setImagePreview(null);
      setAiHint("ลบรูปแล้ว — กด + เพื่อถ่าย/แนบใหม่");
      return;
    }
    setImagePreview({ ...prev, urls: nextUrls });
  }

  function clearSlipUrls(
    target: { kind: "day"; dayId: string } | { kind: "bank"; transferId: string },
  ) {
    if (!window.confirm("ลบรูปทั้งหมดของแถวนี้? แล้วถ่าย/แนบใหม่ได้")) return;
    if (target.kind === "bank") setTransferSlipUrls(target.transferId, []);
    else setDaySlipUrls(target.dayId, []);
    setImagePreview((prev) => {
      if (!prev?.editTarget) return prev;
      if (
        target.kind === "bank" &&
        prev.editTarget.kind === "bank" &&
        prev.editTarget.transferId === target.transferId
      ) {
        return null;
      }
      if (
        target.kind === "day" &&
        prev.editTarget.kind === "day" &&
        prev.editTarget.dayId === target.dayId
      ) {
        return null;
      }
      return prev;
    });
    setAiHint("ลบรูปแล้ว — กด + เพื่อถ่าย/แนบใหม่");
  }

  async function runAiBank(transferId: string, refs: string[], force = false) {
    const key = `bank:${transferId}:${refs.slice(0, 2).join("|")}`;
    if (!force && lastAiKeyRef.current === key) return;
    lastAiKeyRef.current = key;
    setAiBusy(true);
    setAiHint("AI กำลังอ่านสลิปโอน…");
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
      setAiHint(
        result.reason
          ? `AI อ่านสลิปโอนแล้ว · ${result.reason}`
          : "AI อ่านสลิปโอนแล้ว — แก้ได้ถ้าผิด",
      );
    } catch (err) {
      setAiHint((err as Error).message || "AI อ่านสลิปโอนไม่สำเร็จ — กรอกเองได้");
    } finally {
      setAiBusy(false);
    }
  }

  async function runAiDay(dayId: string, refs: string[], force = false) {
    const key = `day:${dayId}:${refs.slice(0, 2).join("|")}`;
    if (!force && lastAiKeyRef.current === key) return;
    lastAiKeyRef.current = key;
    setAiBusy(true);
    setAiHint("AI กำลังอ่านสลิปเงินสด…");
    try {
      const result = await extractCashDaySlipFromPhotos(refs.slice(0, 2));
      const patch: Partial<CashDepositDayLine> = {
        slipKind: result.slipKind,
        shiftLabel: result.shiftLabel || undefined,
      };
      if (result.cashAmount != null) {
        patch.cashAmount = result.cashAmount;
        patch.cashAmountSource = "ai";
      }
      // drawerCloseAmount ignored — Expected/Actual รวมเงินทอนเริ่มต้น งงง่าย ไม่ใช้เทียบโอน
      if (result.date) {
        try {
          patch.date = parseDateInput(result.date);
          patch.dateSource = "ai";
        } catch {
          /* ignore bad date */
        }
      }
      patchDay(dayId, patch, { fromAi: true });
      setAiHint(
        result.reason
          ? `AI ใส่วันนี้แล้ว · ${result.reason}`
          : "AI ใส่วันนี้แล้ว — แก้/ถ่ายใหม่ได้",
      );
    } catch (err) {
      setAiHint((err as Error).message || "AI อ่านสลิปวันไม่สำเร็จ — กรอกเองได้");
    } finally {
      setAiBusy(false);
    }
  }

  async function onPhotoFiles(files: FileList | null) {
    const target = photoTargetRef.current;
    photoTargetRef.current = null;
    if (!target || !files?.length) return;
    const batch = Array.from(files).slice(
      0,
      target.kind === "bank" ? CASH_DEPOSIT_BANK_SLIP_MAX : CASH_DEPOSIT_DAY_SLIP_MAX,
    );
    uploadCancelRef.current = false;
    setUploadProgress(null);
    setBusy(true);
    try {
      const urls = await uploadEvidencePhotos(batch, {
        folder: "cash-deposits",
        slotKey:
          target.kind === "bank"
            ? `bank-${target.transferId}`
            : `day-${target.dayId}`,
        cancelRef: uploadCancelRef,
        onProgress: setUploadProgress,
      });
      if (!urls.length) throw new Error("อัปโหลดรูปไม่สำเร็จ");
      if (target.kind === "bank") {
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
      } else {
        const dayId = target.dayId;
        let nextDayUrls: string[] = [];
        const merge = (days: CashDepositDayLine[]) =>
          days.map((d) => {
            if (d.id !== dayId) return d;
            nextDayUrls = [...d.slipUrls, ...urls].slice(0, CASH_DEPOSIT_DAY_SLIP_MAX);
            return { ...d, slipUrls: nextDayUrls };
          });
        if (draft) setDraft({ ...draft, days: merge(draft.days) });
        else setEditDays((prev) => merge(prev));
        void runAiDay(dayId, nextDayUrls);
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
      }));
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
            สลิปโอนหลายใบได้ · เข้าบช.สุทธิต่อใบ · ดูคงเหลือใต้ตารางโอน
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
              <span>วัน</span>
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
              title="สร้างรอบ"
            >
              +รอบ
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
                        <th className="col-num">ยอดขายเงินสด</th>
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

          {/* Edit / draft round — bank transfers + day table */}
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
                <label className="cash-in-create-field cash-in-note-field">
                  <span>โน้ตรอบ</span>
                  <input
                    value={draft ? draft.note : editNote}
                    maxLength={500}
                    placeholder="ข้อความถึงเจ้าของ / หมายเหตุทั้งรอบ"
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
                      <th className="col-num" title="ยอดเงินที่เข้าบัญชีจริงในสลิปนี้">
                        เข้าบช.สุทธิ
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
                                className="ghost-btn danger-text cash-in-ai-reread"
                                disabled={busy}
                                title="ลบสลิปโอนนี้"
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
                                  className="ghost-btn cash-in-ai-reread"
                                  disabled={busy}
                                  onClick={() => openBankPhoto(t.id)}
                                  title="ถ่าย/แนบรูปเพิ่ม หรือใส่ใหม่หลังลบ"
                                >
                                  +
                                </button>
                              ) : null}
                              {t.slipUrls.length ? (
                                <button
                                  type="button"
                                  className="ghost-btn danger-text cash-in-ai-reread"
                                  disabled={busy}
                                  onClick={() =>
                                    clearSlipUrls({ kind: "bank", transferId: t.id })
                                  }
                                  title="ลบรูปทั้งหมดของสลิปนี้"
                                >
                                  ลบรูป
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="col-slip">
                          {t.slipUrls.length ? (
                            <button
                              type="button"
                              className="ghost-btn cash-in-ai-reread"
                              disabled={busy || aiBusy}
                              onClick={() => void runAiBank(t.id, t.slipUrls, true)}
                              title="ให้อ่านสลิปโอนใหม่"
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
                  className="ghost-btn cash-in-add-transfer"
                  disabled={busy}
                  onClick={addBankTransfer}
                >
                  + สลิปโอน
                </button>
              ) : null}

              <p className="cash-in-remain" aria-live="polite">
                ต้องโอน (Σยอดขายเงินสด) {formatPlainNumber(expected)} · โอนแล้ว
                (Σเข้าบช.สุทธิ) {formatPlainNumber(workingBank)} · คงเหลือ{" "}
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
                {workingFee
                  ? ` · Σคชจ. ${formatPlainNumber(workingFee)}`
                  : ""}
              </p>

              {aiHint ? (
                <p className={aiBusy ? "muted cash-in-ai-hint" : "cash-in-ai-hint"}>
                  {aiBusy ? "…" : ""}
                  {aiHint}
                </p>
              ) : null}

              <div className="sheet-wrap cash-in-panel-table-wrap">
                <table className="sheet-table cash-in-slim is-edit">
                  <thead>
                    <tr>
                      <th className="col-round">#</th>
                      <th className="col-date">วัน</th>
                      <th
                        className="col-num"
                        title="จากบิล POS: ยอดขายตามการชำระเงิน → เงินสด"
                      >
                        ยอดขายเงินสด
                      </th>
                      <th className="col-note">โน้ตวัน</th>
                      <th className="col-slip">สลิป</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workingDays.map((day, dayIdx) => (
                      <tr key={day.id}>
                        <td className="col-round">
                          <div className="cash-in-bank-idx">
                            <span>{dayIdx + 1}</span>
                            {workingDays.length > 1 ? (
                              <button
                                type="button"
                                className="ghost-btn danger-text cash-in-ai-reread"
                                disabled={busy}
                                title="ลบวันนี้จากรอบ"
                                onClick={() => removeDay(day.id)}
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
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
                          <div className="cash-in-cell-stack">
                            {sourceBadge(day.cashAmountSource)}
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
                          </div>
                        </td>
                        <td className="col-note">
                          <input
                            className="cash-in-cell-input"
                            value={day.note || ""}
                            maxLength={200}
                            placeholder="โน้ต"
                            title="ข้อความพนักงานสำหรับวันนี้"
                            onChange={(e) =>
                              patchDay(day.id, { note: e.target.value })
                            }
                          />
                        </td>
                        <td className="col-slip">
                          <div className="cash-in-slip-actions is-col">
                            <EntryPhotoIndicator
                              imageUrls={day.slipUrls}
                              label={formatCashDayShort(day.date)}
                              onAdd={
                                day.slipUrls.length === 0
                                  ? () => openDayPhoto(day.id)
                                  : undefined
                              }
                              onView={(urls) =>
                                setImagePreview({
                                  urls,
                                  title: formatCashDayShort(day.date),
                                  editTarget: { kind: "day", dayId: day.id },
                                })
                              }
                            />
                            <div className="cash-in-slip-btn-row">
                              {day.slipUrls.length > 0 &&
                              day.slipUrls.length < CASH_DEPOSIT_DAY_SLIP_MAX ? (
                                <button
                                  type="button"
                                  className="ghost-btn cash-in-ai-reread"
                                  disabled={busy}
                                  onClick={() => openDayPhoto(day.id)}
                                  title="ถ่าย/แนบรูปเพิ่ม หรือใส่ใหม่หลังลบ"
                                >
                                  +
                                </button>
                              ) : null}
                              {day.slipUrls.length ? (
                                <>
                                  <button
                                    type="button"
                                    className="ghost-btn danger-text cash-in-ai-reread"
                                    disabled={busy}
                                    onClick={() =>
                                      clearSlipUrls({ kind: "day", dayId: day.id })
                                    }
                                    title="ลบรูปทั้งหมดของวันนี้"
                                  >
                                    ลบรูป
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost-btn cash-in-ai-reread"
                                    disabled={busy || aiBusy}
                                    onClick={() =>
                                      void runAiDay(day.id, day.slipUrls, true)
                                    }
                                    title="ให้อ่านสลิปใหม่"
                                  >
                                    AI
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="col-round" colSpan={2}>
                        รวม {workingDays.length} วัน
                      </td>
                      <td className="col-num">{formatPlainNumber(expected)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {workingDays.length < CASH_DEPOSIT_DAY_MAX ? (
                <div className="cash-in-day-add-bar">
                  <button
                    type="button"
                    className="ghost-btn cash-in-add-transfer"
                    disabled={busy}
                    onClick={() => addDay("start")}
                  >
                    + วันก่อนหน้า
                  </button>
                  <button
                    type="button"
                    className="ghost-btn cash-in-add-transfer"
                    disabled={busy}
                    onClick={() => addDay("end")}
                  >
                    + วันถัดไป
                  </button>
                </div>
              ) : null}

              <div className="cash-in-math is-slim" aria-live="polite">
                <span>
                  Σยอดขายเงินสด {formatPlainNumber(expected)} · Σเข้าบช.สุทธิ{" "}
                  {formatPlainNumber(workingBank)}
                  {workingFee
                    ? ` · Σคชจ. ${formatPlainNumber(workingFee)}`
                    : " · Σคชจ. 0"}
                  {bankSlipUrlCount
                    ? ` · สลิปโอน ${bankSlipUrlCount} รูป`
                    : ""}{" "}
                  · ผลเทียบ{" "}
                  <strong className={variance === 0 ? "is-ok" : "is-off"}>
                    {variance === 0
                      ? "ตรง"
                      : `${variance > 0 ? "+" : ""}${formatPlainNumber(variance)}`}
                  </strong>
                </span>
                <span className="muted cash-in-math-formula">
                  (Σเข้าบช.สุทธิ + Σคชจ) − Σยอดขายเงินสด
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
