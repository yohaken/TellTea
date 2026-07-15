"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Coffee, CheckCircle2, AlertTriangle, LayoutGrid, Lock, Table2, Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { BulkStatusToolbar } from "@/components/BulkStatusToolbar";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useAuth } from "@/lib/auth";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import {
  OT_SHIFTS,
  OT_IMAGE_MAX,
  OT_IMAGE_PAYLOAD_BUDGET,
  addOtEntry,
  assertOtImageUrlsFit,
  bulkUpdateOtEntryStatus,
  computeOtBonus,
  deleteOtEntry,
  getOtSettings,
  getOtImageUrls,
  hasOtQuantities,
  isOtEntryLocked,
  isOtEntryPlanned,
  labelOtShift,
  labelOtStatus,
  otImagePayloadChars,
  subscribeOtEntries,
  updateOtEntry,
  type OtEntry,
  type OtShiftId,
  type OtStatus,
} from "@/lib/ot";
import { friendlyFirestoreWriteError } from "@/lib/receipts";
import {
  buildOtGrid,
  findOtEntryForSlot,
  isFutureLocalDay,
  type OtDayGroup,
  type OtSlotTarget,
} from "@/lib/ot-grid";
import type { StaffMember } from "@/lib/types";
import { ShiftOwnerFlags, ShiftProgressSteps, ShiftTodayBanner } from "@/components/ShiftProgressSteps";
import {
  buildSopDrafts,
  ShiftSopSection,
  sopDraftsComplete,
  type SopDraftItem,
} from "@/components/ShiftSopSection";
import {
  listActiveChecklistItems,
  subscribeChecklistRecords,
  type ChecklistItem,
  type ChecklistRecord,
} from "@/lib/checklist";
import { saveShiftClose } from "@/lib/shift-close";
import {
  computeLiveShiftProgress,
  computeShiftProgress,
  computeShiftQuality,
  closingItemsFromCatalog,
  getCurrentShiftId,
  openingItemsFromCatalog,
  ownerQualityHints,
  hasOtProcessOrderIssue,
  staffProcessOrderHint,
  todayShiftBannerLabel,
} from "@/lib/shift-session";
import {
  formatDateShort,
  formatDateTimeShort,
  formatPlainNumber,
  parseDateInput,
  startOfLocalDay,
  todayInputValue,
} from "@/lib/utils";
import {
  subscribeCheckSessionForShift,
  type CheckSessionSummary,
  type CheckShiftId,
} from "@/lib/checklist";

type TableView = "sheet" | "cards";

/** เย็น → เช้า → ดึก — ให้ตรงตาราง (บน→ล่าง) */
const SHIFT_ORDER: Record<OtShiftId, number> = {
  evening: 0,
  morning: 1,
  late: 2,
};

function sortOtEntries(rows: OtEntry[]) {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return b.date - a.date;
    const sa = SHIFT_ORDER[a.shift] ?? 9;
    const sb = SHIFT_ORDER[b.shift] ?? 9;
    if (sa !== sb) return sa - sb;
    return b.createdAt - a.createdAt;
  });
}

function otQtyCell(n: number) {
  return n ? formatPlainNumber(n) : "—";
}

function otFormulaText(entry: OtEntry, computed: ReturnType<typeof computeOtBonus>) {
  const m = Number(entry.machineCount) || 0;
  const o = Number(entry.otherCups) || 0;
  const c = Number(entry.iceCreamCones) || 0;
  const b = Number(entry.breadSlices) || 0;
  const cl = Number(entry.claimCups) || 0;
  const d = Number(entry.deductQty) || 0;
  const a = Number(entry.addQty) || 0;
  const rate = Number(entry.bonusRate) || 0;
  return (
    `(${m} + ${o} + ${c} + ${b} − ${cl} − ${d} + ${a}) × ${formatPlainNumber(rate)} ÷ ${computed.workerCount} = ฿${formatPlainNumber(computed.bonusPerPerson)}`
  );
}

function draftsFromCheckRecords(
  items: ChecklistItem[],
  records: ChecklistRecord[],
  checkId?: string,
): SopDraftItem[] {
  if (!checkId) return buildSopDrafts(items);
  const byItem = new Map(
    records.filter((r) => r.checkId === checkId).map((r) => [r.itemId, r]),
  );
  return items.map((item) => {
    const hit = byItem.get(item.id);
    if (!hit) {
      return { itemId: item.id, itemName: item.name, status: "pending" as const, remark: "" };
    }
    return {
      itemId: item.id,
      itemName: item.name,
      status: hit.status,
      remark: hit.remark || "",
    };
  });
}

function entryIncludesName(entry: OtEntry, name: string) {
  if (!name.trim()) return false;
  const needle = name.trim().toLowerCase();
  return entry.workerNames.some((w) => {
    const hay = w.trim().toLowerCase();
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}

export default function OtPage() {
  return (
    <AuthGate>
      <OtView />
    </AuthGate>
  );
}

function OtView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [formOpen, setFormOpen] = useState(false);
  const [entries, setEntries] = useState<OtEntry[]>([]);
  const [workers, setWorkers] = useState<Employee[]>([]);
  const [bonusRate, setBonusRate] = useState(0.6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OtEntry | null>(null);
  const [slotDraft, setSlotDraft] = useState<{ date: number; shift: OtShiftId } | null>(null);
  const [checkItems, setCheckItems] = useState<ChecklistItem[]>([]);
  const [checkRecords, setCheckRecords] = useState<ChecklistRecord[]>([]);

  async function reloadCatalog() {
    const [emps, settings, items] = await Promise.all([
      listActiveEmployees(),
      getOtSettings(),
      listActiveChecklistItems(),
    ]);
    setWorkers(emps);
    setBonusRate(settings.bonusRate);
    setCheckItems(items);
  }

  useEffect(() => {
    if (staff && !can(staff, "otBonus")) {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  useEffect(() => {
    if (!can(staff, "otBonus")) return;
    setLoading(true);
    void reloadCatalog()
      .catch((err) => setError((err as Error).message || "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));

    const unsubOt = subscribeOtEntries(
      (rows) => setEntries(rows),
      (err) => setError(err.message || "โหลดรายการไม่สำเร็จ"),
    );
    const unsubCheck = subscribeChecklistRecords(
      (rows) => setCheckRecords(rows),
      (err) => setError(err.message || "โหลด SOP ไม่สำเร็จ"),
    );
    return () => {
      unsubOt();
      unsubCheck();
    };
  }, [staff]);

  const openingItems = useMemo(() => openingItemsFromCatalog(checkItems), [checkItems]);
  const closingItems = useMemo(() => closingItemsFromCatalog(checkItems), [checkItems]);

  const todayShift = getCurrentShiftId();
  const todayMs = startOfLocalDay();
  const todayEntry = useMemo(
    () => findOtEntryForSlot(entries, todayMs, todayShift),
    [entries, todayMs, todayShift],
  );
  const todayProgress = useMemo(
    () =>
      computeShiftProgress({
        entry: todayEntry,
        records: checkRecords,
        openingItems,
        closingItems,
        date: todayMs,
        shift: todayShift,
      }),
    [todayEntry, checkRecords, openingItems, closingItems, todayMs, todayShift],
  );

  useBodyScrollLock(formOpen);

  if (!can(staff, "otBonus")) return null;

  function openAdd() {
    setEditing(null);
    setSlotDraft(null);
    setFormOpen(true);
  }

  function openSlot(target: OtSlotTarget) {
    setEditing(target.entry);
    setSlotDraft(target.entry ? null : { date: target.date, shift: target.shift });
    setFormOpen(true);
  }

  function openEdit(row: OtEntry) {
    openSlot({ date: row.date, shift: row.shift, entry: row });
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setSlotDraft(null);
  }

  return (
    <div className="module-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <Coffee size={18} aria-hidden />
          โบนัสชง
        </h1>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <>
          <ShiftTodayBanner
            shiftLabel={todayShiftBannerLabel(todayShift)}
            progress={todayProgress}
            onOpen={() =>
              openSlot({
                date: todayMs,
                shift: todayShift,
                entry: todayEntry,
              })
            }
          />
          <OtTable
            entries={entries}
            checkRecords={checkRecords}
            openingItems={openingItems}
            closingItems={closingItems}
            staff={staff}
            isOwner={isOwner}
            onEditSlot={openSlot}
            onEdit={openEdit}
            onError={setError}
          />
        </>
      ) : null}

      {formOpen && !loading ? (
        <div className="modal-backdrop edit-modal is-module-form is-ot-form" onClick={closeForm}>
          <div className="modal-card ot-form-card" onClick={(e) => e.stopPropagation()}>
            <OtEntryForm
              key={editing?.id || slotDraft ? `${slotDraft?.date}-${slotDraft?.shift}` : "new"}
              entry={editing}
              slotDraft={slotDraft}
              allEntries={entries}
              checkRecords={checkRecords}
              openingItems={openingItems}
              closingItems={closingItems}
              workers={workers}
              staff={staff}
              isOwner={isOwner}
              bonusRate={bonusRate}
              createdBy={actorId}
              onError={setError}
              onSaved={closeForm}
              onCancelEdit={closeForm}
            />
          </div>
        </div>
      ) : null}

      <ModuleTabDock
        ariaLabel="มุมมองชง"
        formOpen={formOpen}
        onAdd={openAdd}
      />
    </div>
  );
}

function OtEntryForm({
  entry,
  slotDraft,
  allEntries,
  checkRecords,
  openingItems,
  closingItems,
  workers,
  staff,
  isOwner,
  bonusRate,
  createdBy,
  onError,
  onSaved,
  onCancelEdit,
}: {
  entry: OtEntry | null;
  slotDraft: { date: number; shift: OtShiftId } | null;
  allEntries: OtEntry[];
  checkRecords: ChecklistRecord[];
  openingItems: ChecklistItem[];
  closingItems: ChecklistItem[];
  workers: Employee[];
  staff: StaffMember | null;
  isOwner: boolean;
  bonusRate: number;
  createdBy: string;
  onError: (msg: string) => void;
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const slotFixed = !!slotDraft || !!entry;
  const locked = entry ? isOtEntryLocked(entry) : false;
  const plannedEntry = entry ? isOtEntryPlanned(entry) : false;

  const [date, setDate] = useState(
    entry
      ? todayInputValue(new Date(entry.date))
      : slotDraft
        ? todayInputValue(new Date(slotDraft.date))
        : todayInputValue(),
  );
  const [shift, setShift] = useState<OtShiftId>(entry?.shift || slotDraft?.shift || "morning");
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>(() => {
    if (entry?.workerIds?.length) return entry.workerIds;
    if (staff?.employeeId && workers.some((w) => w.id === staff.employeeId)) {
      return [staff.employeeId];
    }
    return [];
  });
  const [machineCount, setMachineCount] = useState(
    entry && hasOtQuantities(entry) ? String(entry.machineCount) : "",
  );
  const [otherCups, setOtherCups] = useState(entry ? String(entry.otherCups || "") : "");
  const [iceCreamCones, setIceCreamCones] = useState(entry ? String(entry.iceCreamCones || "") : "");
  const [breadSlices, setBreadSlices] = useState(entry ? String(entry.breadSlices || "") : "");
  const [claimCups, setClaimCups] = useState(entry ? String(entry.claimCups || "") : "");
  const [deductQty, setDeductQty] = useState(entry ? String(entry.deductQty || "") : "");
  const [deductReason, setDeductReason] = useState(entry?.deductReason || "");
  const [addQty, setAddQty] = useState(entry ? String(entry.addQty || "") : "");
  const [addReason, setAddReason] = useState(entry?.addReason || "");
  const [imageUrls, setImageUrls] = useState<string[]>(() => getOtImageUrls(entry));
  const [formPreview, setFormPreview] = useState<{ urls: string[]; index: number } | null>(null);
  const [formError, setFormError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(() => {
    if (!entry) return false;
    if (isOtEntryLocked(entry)) return true;
    return hasOtQuantities(entry) || isOtEntryPlanned(entry);
  });
  const [openingDrafts, setOpeningDrafts] = useState<SopDraftItem[]>(() =>
    draftsFromCheckRecords(openingItems, checkRecords, entry?.checkIdOpen),
  );
  const [closingDrafts, setClosingDrafts] = useState<SopDraftItem[]>(() =>
    draftsFromCheckRecords(closingItems, checkRecords, entry?.checkIdClose),
  );
  const [busy, setBusy] = useState(false);
  const [checkSession, setCheckSession] = useState<CheckSessionSummary | null>(null);
  const [checkLoading, setCheckLoading] = useState(true);

  const slotDateMs = parseDateInput(date);

  useEffect(() => {
    setCheckLoading(true);
    const unsub = subscribeCheckSessionForShift(
      slotDateMs,
      shift as CheckShiftId,
      (session) => {
        setCheckSession(session);
        setCheckLoading(false);
      },
      () => {
        setCheckSession(null);
        setCheckLoading(false);
      },
    );
    return unsub;
  }, [slotDateMs, shift]);

  const dateMs = parseDateInput(date);
  const slotEntry =
    entry || findOtEntryForSlot(allEntries, dateMs, shift);

  const rate = entry?.bonusRate ?? bonusRate;
  const preview = useMemo(() => {
    const names = workers.filter((w) => selectedWorkers.includes(w.id)).map((w) => w.name);
    return computeOtBonus({
      machineCount: Number(machineCount) || 0,
      otherCups: Number(otherCups) || 0,
      iceCreamCones: Number(iceCreamCones) || 0,
      breadSlices: Number(breadSlices) || 0,
      claimCups: Number(claimCups) || 0,
      deductQty: Number(deductQty) || 0,
      addQty: Number(addQty) || 0,
      bonusRate: rate,
      workerNames: names.length ? names : entry?.workerNames || [],
    });
  }, [
    machineCount,
    otherCups,
    iceCreamCones,
    breadSlices,
    claimCups,
    deductQty,
    addQty,
    rate,
    selectedWorkers,
    workers,
    entry,
  ]);

  const liveProgress = useMemo(
    () =>
      computeLiveShiftProgress({
        workersSet: selectedWorkers.length > 0,
        openingItems,
        closingItems,
        openingDraftsComplete: sopDraftsComplete(openingDrafts),
        closingDraftsComplete: sopDraftsComplete(closingDrafts),
        otComplete: preview.summaryQty > 0,
        quality: slotEntry ? computeShiftProgress({
          entry: slotEntry,
          records: checkRecords,
          openingItems,
          closingItems,
          date: dateMs,
          shift,
        }).quality : null,
      }),
    [
      selectedWorkers,
      openingItems,
      closingItems,
      openingDrafts,
      closingDrafts,
      preview.summaryQty,
      slotEntry,
      checkRecords,
      dateMs,
      shift,
    ],
  );
  const ownerHints = isOwner ? ownerQualityHints(liveProgress.quality) : [];
  const processOrderHint = staffProcessOrderHint(liveProgress.quality);

  const formTitle = locked
    ? "ดูรายการ (จ่ายแล้ว)"
    : detailsOpen
      ? entry && !plannedEntry
        ? "แก้ไขปิดกะ"
        : "ปิดกะ"
      : plannedEntry
        ? "แก้ไขแผนกะ"
        : "วางแผนกะ";

  function toggleWorker(id: string) {
    if (locked) return;
    setSelectedWorkers((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  }

  function reportError(msg: string) {
    setFormError(msg);
    onError(msg);
  }

  function buildPayload(chosen: Employee[]) {
    return {
      date: parseDateInput(date),
      shift,
      workerIds: chosen.map((w) => w.id),
      workerNames: chosen.map((w) => w.name),
      machineCount: Number(machineCount) || 0,
      otherCups: Number(otherCups) || 0,
      iceCreamCones: Number(iceCreamCones) || 0,
      breadSlices: Number(breadSlices) || 0,
      claimCups: Number(claimCups) || 0,
      deductQty: Number(deductQty) || 0,
      deductReason,
      addQty: Number(addQty) || 0,
      addReason,
      bonusRate: rate,
      imageUrls: assertOtImageUrlsFit(imageUrls),
    };
  }

  /** Empty dock-add form must not silently overwrite an existing shift row. */
  function existingSlotConflict(): OtEntry | null {
    if (entry) return null;
    return findOtEntryForSlot(allEntries, parseDateInput(date), shift);
  }

  async function persist(payload: ReturnType<typeof buildPayload>) {
    if (entry) {
      await updateOtEntry(entry.id, payload);
      return;
    }
    const existing = findOtEntryForSlot(allEntries, payload.date, payload.shift);
    if (existing) {
      throw new Error("กะนี้มีรายการแล้ว — แตะช่องในตารางเพื่อแก้ไข อย่าสร้างทับ");
    }
    await addOtEntry({ ...payload, createdBy });
  }

  async function onSavePlan() {
    if (locked || !createdBy) return;
    const chosen = workers.filter((w) => selectedWorkers.includes(w.id));
    if (!chosen.length) {
      reportError("เลือกพนักงานอย่างน้อย 1 คน");
      return;
    }
    const conflict = existingSlotConflict();
    if (conflict) {
      reportError(
        isOtEntryLocked(conflict)
          ? "กะนี้จ่ายแล้ว — เปิดจากตารางเพื่อดู"
          : "กะนี้มีรายการแล้ว — แตะช่องในตารางเพื่อแก้ไข อย่าสร้างทับ",
      );
      return;
    }
    setBusy(true);
    setFormError("");
    onError("");
    try {
      const base = buildPayload(chosen);
      const plannedOnly = !entry || isOtEntryPlanned(entry);
      const payload = plannedOnly
        ? {
            ...base,
            machineCount: 0,
            otherCups: 0,
            iceCreamCones: 0,
            breadSlices: 0,
            claimCups: 0,
            deductQty: 0,
            deductReason: "",
            addQty: 0,
            addReason: "",
            // Keep any photos already attached (e.g. user opened ปิดกะ then กลับแผน).
          }
        : base;
      await persist(payload);
      onSaved();
    } catch (err) {
      reportError(friendlyFirestoreWriteError(err, "บันทึกแผนไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveClose() {
    if (locked || !createdBy) return;
    const chosen = workers.filter((w) => selectedWorkers.includes(w.id));
    if (!chosen.length) {
      reportError("เลือกพนักงานอย่างน้อย 1 คน");
      return;
    }
    if (!checkSession) {
      reportError("ยังไม่เช็ค SmartCheck กะนี้ — ไปหน้าเช็คก่อนปิดกะ");
      return;
    }
    if (preview.summaryQty === 0) {
      reportError("ยังไม่ใส่ยอด — กรอกเครื่องหรือรายการอื่นก่อนปิดกะ");
      return;
    }
    if (liveProgress.missingLabels.length > 0) {
      reportError(`ยังไม่ครบ — เหลือ: ${liveProgress.missingLabels.join(" · ")}`);
      return;
    }
    const conflict = existingSlotConflict();
    if (conflict) {
      reportError(
        isOtEntryLocked(conflict)
          ? "กะนี้จ่ายแล้ว — เปิดจากตารางเพื่อดู"
          : "กะนี้มีรายการแล้ว — แตะช่องในตารางเพื่อแก้ไข อย่าสร้างทับ",
      );
      return;
    }
    const inspector = chosen[0]!;
    const hadPlannedBefore = !!(entry && isOtEntryPlanned(entry));
    setBusy(true);
    setFormError("");
    onError("");
    try {
      assertOtImageUrlsFit(imageUrls);
      await saveShiftClose({
        entry,
        allEntries,
        payload: { ...buildPayload(chosen), createdBy },
        openingDrafts,
        closingDrafts,
        openingItemsCount: openingItems.length,
        closingItemsCount: closingItems.length,
        inspector: { id: inspector.id, name: inspector.name },
        hadPlannedBefore,
        findExistingForSlot: findOtEntryForSlot,
      });
      onSaved();
    } catch (err) {
      reportError(friendlyFirestoreWriteError(err, "บันทึกปิดกะไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={`form-card entry-form module-entry-form ot-entry-form${detailsOpen ? " is-ot-close" : ""}`}
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="entry-toolbar module-form-head ot-form-head">
        <h2 className="panel-title">{formTitle}</h2>
        <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onCancelEdit}>
          <X size={18} />
        </button>
      </div>

      {formError ? <p className="error-text ot-form-error">{formError}</p> : null}

      {detailsOpen ? <ShiftProgressSteps progress={liveProgress} compact /> : null}
      {ownerHints.length ? <ShiftOwnerFlags hints={ownerHints} /> : null}

      <div className="ot-form-body">
        {locked ? (
          <p className="muted form-hint-inline prod-locked-hint">
            <Lock size={14} aria-hidden /> จ่ายโบนัสแล้ว — เรทและยอดล็อก · เปลี่ยนสถานะได้ที่ตาราง
          </p>
        ) : null}

        {!workers.length ? (
          <p className="muted form-hint-inline">
            ยังไม่มีรายชื่อพนักงาน — เพิ่มที่{" "}
            <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
          </p>
        ) : null}

        {slotFixed ? (
          <p className="ot-form-slot-bar">
            {formatDateShort(parseDateInput(date))} · {labelOtShift(shift)}
          </p>
        ) : (
          <div className="stock-form-grid ot-form-date-row">
            <div className="field">
              <label htmlFor="ot-date">วันที่</label>
              <input id="ot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="ot-shift">รอบ</label>
              <select id="ot-shift" value={shift} onChange={(e) => setShift(e.target.value as OtShiftId)} required>
                {OT_SHIFTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="field ot-form-workers">
          <span className="field-label">พนักงาน (สูงสุด 2)</span>
          <div className="suggest-list">
            {workers.map((w) => {
              const on = selectedWorkers.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  className={on ? "suggest-chip is-active" : "suggest-chip"}
                  disabled={locked}
                  onClick={() => toggleWorker(w.id)}
                >
                  {w.name}
                </button>
              );
            })}
          </div>
        </div>

        {!locked && !detailsOpen ? (
          <p className="muted form-hint-inline ot-form-plan-hint">
            วางแผนล่วงหน้าได้ — ใส่แค่ชื่อ · หรือกดปิดกะเพื่อกรอกครบในครั้งเดียว
          </p>
        ) : null}

        {detailsOpen ? (
          <>
            <ShiftSopSection
              title="เช็คเปิดกะ"
              hint="กรอกตอนปิดกะได้ — ติ๊กให้ครบ"
              drafts={openingDrafts}
              disabled={locked}
              onChange={setOpeningDrafts}
              onError={reportError}
            />
            <ShiftSopSection
              title="เช็คปิดกะ"
              hint="เช็คก่อนเลิกกะ"
              drafts={closingDrafts}
              disabled={locked}
              onChange={setClosingDrafts}
              onError={reportError}
            />
          </>
        ) : null}

        {!locked && detailsOpen ? (
          <>
            {checkLoading ? (
              <p className="muted form-hint-inline">กำลังตรวจสอบ SmartCheck...</p>
            ) : checkSession ? (
              processOrderHint ? (
                <div className="check-existing-banner check-existing-banner--warn">
                  <AlertTriangle size={16} aria-hidden />
                  <span>
                    SmartCheck กะนี้บันทึกแล้ว ({formatDateTimeShort(checkSession.submittedAt)}) —{" "}
                    {checkSession.failed ? `${checkSession.failed} ไม่ผ่าน` : "ผ่าน 100%"}
                    <br />
                    <strong>หมายเหตุ:</strong> {processOrderHint}
                  </span>
                </div>
              ) : (
                <div className="check-existing-banner check-existing-banner--ok">
                  <CheckCircle2 size={16} aria-hidden />
                  <span>
                    SmartCheck กะนี้เช็คแล้ว ({formatDateTimeShort(checkSession.submittedAt)}) —{" "}
                    {checkSession.failed ? `${checkSession.failed} ไม่ผ่าน` : "ผ่าน 100%"} · ไม่ต้องเช็คซ้ำ
                  </span>
                </div>
              )
            ) : (
              <div className="check-existing-banner">
                <AlertTriangle size={16} aria-hidden />
                <span>
                  ยังไม่เช็ค SmartCheck กะนี้ —{" "}
                  <Link
                    href={`/check/?date=${encodeURIComponent(date)}&shift=${encodeURIComponent(shift)}`}
                    className="desc-link"
                  >
                    ไปหน้าเช็ค
                  </Link>{" "}
                  ก่อนปิดกะ
                </span>
              </div>
            )}
          </>
        ) : null}

        {!locked && detailsOpen ? (
          <div className="ot-form-details">
            <div className="field">
              <label htmlFor="ot-machine">เครื่อง</label>
              <input
                id="ot-machine"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={machineCount}
                onChange={(e) => setMachineCount(e.target.value)}
              />
            </div>
            <div className="ot-form-qty-grid">
              <div className="field">
                <label htmlFor="ot-other">อื่นๆ</label>
                <input id="ot-other" type="number" min="0" step="1" inputMode="numeric" value={otherCups} onChange={(e) => setOtherCups(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ot-cone">โคน</label>
                <input id="ot-cone" type="number" min="0" step="1" inputMode="numeric" value={iceCreamCones} onChange={(e) => setIceCreamCones(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ot-bread">ขนมปัง</label>
                <input id="ot-bread" type="number" min="0" step="1" inputMode="numeric" value={breadSlices} onChange={(e) => setBreadSlices(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ot-claim">เคลม</label>
                <input id="ot-claim" type="number" min="0" step="1" inputMode="numeric" value={claimCups} onChange={(e) => setClaimCups(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ot-deduct">ลด</label>
                <input id="ot-deduct" type="number" min="0" step="1" inputMode="numeric" value={deductQty} onChange={(e) => setDeductQty(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ot-add">เพิ่ม</label>
                <input id="ot-add" type="number" min="0" step="1" inputMode="numeric" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
              </div>
            </div>
            <div className="stock-form-grid ot-form-reason-row">
              <div className="field">
                <label htmlFor="ot-deduct-reason">สาเหตุลด</label>
                <input id="ot-deduct-reason" value={deductReason} onChange={(e) => setDeductReason(e.target.value)} placeholder="แก้วแตก" />
              </div>
              <div className="field">
                <label htmlFor="ot-add-reason">สาเหตุเพิ่ม</label>
                <input id="ot-add-reason" value={addReason} onChange={(e) => setAddReason(e.target.value)} placeholder="ไม่ปิดฝา" />
              </div>
            </div>
          </div>
        ) : null}

        {locked && detailsOpen ? (
          <div className="ot-form-details ot-form-details-readonly">
            <dl className="ot-card-grid">
              <div className="ot-card-stat">
                <dt>เครื่อง</dt>
                <dd>{formatPlainNumber(Number(machineCount) || 0)}</dd>
              </div>
              <div className="ot-card-stat">
                <dt>อื่นๆ</dt>
                <dd>{formatPlainNumber(Number(otherCups) || 0)}</dd>
              </div>
              <div className="ot-card-stat">
                <dt>โคน</dt>
                <dd>{formatPlainNumber(Number(iceCreamCones) || 0)}</dd>
              </div>
              <div className="ot-card-stat">
                <dt>ขนมปัง</dt>
                <dd>{formatPlainNumber(Number(breadSlices) || 0)}</dd>
              </div>
              <div className="ot-card-stat">
                <dt>เคลม</dt>
                <dd>{formatPlainNumber(Number(claimCups) || 0)}</dd>
              </div>
              <div className="ot-card-stat">
                <dt>ลด</dt>
                <dd>{formatPlainNumber(Number(deductQty) || 0)}</dd>
              </div>
              <div className="ot-card-stat">
                <dt>เพิ่ม</dt>
                <dd>{formatPlainNumber(Number(addQty) || 0)}</dd>
              </div>
            </dl>
            {deductReason || addReason ? (
              <p className="muted form-hint-inline">
                {deductReason ? `ลด: ${deductReason}` : ""}
                {deductReason && addReason ? " · " : ""}
                {addReason ? `เพิ่ม: ${addReason}` : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        {detailsOpen || imageUrls.length > 0 ? (
          <PhotoAttachMultiField
            values={imageUrls}
            onChange={setImageUrls}
            onError={reportError}
            label="รูปสินค้า (แนบได้หลายรูป)"
            max={OT_IMAGE_MAX}
            perImageMaxChars={Math.floor(OT_IMAGE_PAYLOAD_BUDGET / (OT_IMAGE_MAX + 1))}
            maxTotalChars={OT_IMAGE_PAYLOAD_BUDGET}
            measureTotalChars={otImagePayloadChars}
            hint={
              locked
                ? imageUrls.length
                  ? `${imageUrls.length} รูป · กดรูปเพื่อดู`
                  : "ยังไม่มีรูป"
                : `ถ่ายหรือแนบได้หลายรูป · สูงสุด ${OT_IMAGE_MAX} รูป · กดรูปเพื่อดู`
            }
            readOnly={locked}
            onPreview={(urls, index) => setFormPreview({ urls, index })}
          />
        ) : null}

        {formPreview ? (
          <ImagePreviewModal
            urls={formPreview.urls}
            initialIndex={formPreview.index}
            title="รูปสินค้า"
            onClose={() => setFormPreview(null)}
          />
        ) : null}

        {detailsOpen && preview.summaryQty > 0 ? (
          <p className="muted form-hint-inline ot-form-preview">
            สรุป {formatPlainNumber(preview.summaryQty)} · ฿{formatPlainNumber(preview.totalBonus)} ·{" "}
            <strong>฿{formatPlainNumber(preview.bonusPerPerson)}/คน</strong>
            {locked ? ` · เรท ${formatPlainNumber(rate)}` : ""}
          </p>
        ) : null}
      </div>

      <div className="entry-actions module-form-actions ot-form-actions">
        {locked ? (
          <button type="button" className="ghost-btn" disabled={busy} onClick={onCancelEdit}>
            ปิด
          </button>
        ) : (
          <>
            {!detailsOpen ? (
              <>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={busy || !workers.length}
                  onClick={() => void onSavePlan()}
                >
                  {busy ? "กำลังบันทึก..." : "บันทึกแผน"}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => setDetailsOpen(true)}
                >
                  ปิดกะ — กรอกครบ
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={
                    busy ||
                    !workers.length ||
                    checkLoading ||
                    !checkSession ||
                    liveProgress.missingLabels.length > 0
                  }
                  onClick={() => void onSaveClose()}
                >
                  {busy
                    ? "กำลังบันทึก..."
                    : liveProgress.missingLabels.length
                      ? `บันทึก (เหลือ ${liveProgress.missingLabels.length})`
                      : "บันทึกปิดกะ"}
                </button>
                {plannedEntry || !entry ? (
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => setDetailsOpen(false)}
                  >
                    กลับแผน
                  </button>
                ) : null}
              </>
            )}
            <button type="button" className="ghost-btn ot-form-exit" disabled={busy} onClick={onCancelEdit}>
              ออก
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function OtTable({
  entries,
  checkRecords,
  openingItems,
  closingItems,
  staff,
  isOwner,
  onEditSlot,
  onEdit,
  onError,
}: {
  entries: OtEntry[];
  checkRecords: ChecklistRecord[];
  openingItems: ChecklistItem[];
  closingItems: ChecklistItem[];
  staff: StaffMember | null;
  isOwner: boolean;
  onEditSlot: (target: OtSlotTarget) => void;
  onEdit: (row: OtEntry) => void;
  onError: (msg: string) => void;
}) {
  const [tableView, setTableView] = useState<TableView>("sheet");
  const [statusFilter, setStatusFilter] = useState<OtStatus | "all">("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [preview, setPreview] = useState<{ urls: string[]; title: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useBodyScrollLock(!!preview);

  const myName = staff?.displayName || "";

  const filtered = useMemo(() => {
    return entries.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (mineOnly && !entryIncludesName(row, myName)) return false;
      return true;
    });
  }, [entries, statusFilter, mineOnly, myName]);

  const summary = useMemo(() => {
    let shiftCount = 0;
    let summaryQty = 0;
    let totalBonus = 0;
    let pendingBonus = 0;
    let myBonus = 0;

    for (const row of filtered) {
      const c = computeOtBonus(row);
      shiftCount += 1;
      summaryQty += c.summaryQty;
      totalBonus += c.totalBonus;
      if (row.status === "pending") pendingBonus += c.totalBonus;
      if (entryIncludesName(row, myName)) myBonus += c.bonusPerPerson;
    }

    return { shiftCount, summaryQty, totalBonus, pendingBonus, myBonus };
  }, [filtered, myName]);

  const dateGroups = useMemo(() => buildOtGrid(filtered), [filtered]);

  const pendingIds = useMemo(
    () => filtered.filter((r) => r.status === "pending").map((r) => r.id),
    [filtered],
  );
  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  async function onBulkStatus(status: OtStatus) {
    const ids = [...selected];
    if (!ids.length) return;
    const label = labelOtStatus(status);
    if (!window.confirm(`เปลี่ยนสถานะ ${ids.length} รายการเป็น "${label}"?`)) return;
    setBulkBusy(true);
    onError("");
    try {
      await bulkUpdateOtEntryStatus(ids, status);
      setSelected(new Set());
    } catch (err) {
      onError((err as Error).message || "อัปเดตกลุ่มไม่สำเร็จ");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="ot-table-view">
      <div className="ot-toolbar-slim">
        <span className="ot-slim-hint muted">ทุกวัน · ใหม่ → เก่า · 3 กะ/วัน · ล่วงหน้า 3 วัน</span>
        <select
          id="ot-status-filter"
          className="ot-slim-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as OtStatus | "all")}
          aria-label="สถานะ"
        >
          <option value="all">ทั้งหมด</option>
          <option value="pending">เตรียมจ่าย</option>
          <option value="paid">จ่ายแล้ว</option>
        </select>
        {myName ? (
          <label className="ot-slim-chip">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            ของฉัน
          </label>
        ) : null}
        <div className="ot-view-toggle ot-view-toggle-slim" role="group" aria-label="มุมมองตาราง">
          <button
            type="button"
            className={tableView === "sheet" ? "ot-view-btn is-active" : "ot-view-btn"}
            onClick={() => setTableView("sheet")}
            aria-pressed={tableView === "sheet"}
            aria-label="Sheet"
          >
            <Table2 size={13} aria-hidden />
          </button>
          <button
            type="button"
            className={tableView === "cards" ? "ot-view-btn is-active" : "ot-view-btn"}
            onClick={() => setTableView("cards")}
            aria-pressed={tableView === "cards"}
            aria-label="การ์ด"
          >
            <LayoutGrid size={13} aria-hidden />
          </button>
        </div>
      </div>

      <p className="ot-summary-inline muted">
        รอบ {summary.shiftCount} · หน่วย {formatPlainNumber(summary.summaryQty)} ·{" "}
        {mineOnly ? "ของฉัน" : "รวม"} ฿{formatPlainNumber(mineOnly ? summary.myBonus : summary.totalBonus)} ·{" "}
        เตรียมจ่าย ฿{formatPlainNumber(summary.pendingBonus)}
      </p>

      {isOwner ? (
        <BulkStatusToolbar
          selectedCount={selected.size}
          onSelectUnpaid={() => setSelected(new Set(pendingIds))}
          onSelectVisible={() => setSelected(new Set(visibleIds))}
          onClear={() => setSelected(new Set())}
          onSetStatus={(s) => void onBulkStatus(s as OtStatus)}
          busy={bulkBusy}
          visibleCount={visibleIds.length}
          unpaidCount={pendingIds.length}
        />
      ) : null}

      {tableView === "sheet" ? (
        <OtSheetTable
          groups={dateGroups}
          checkRecords={checkRecords}
          openingItems={openingItems}
          closingItems={closingItems}
          isOwner={isOwner}
          selected={selected}
          allVisibleSelected={allVisibleSelected}
          someSelected={someSelected}
          onToggleRow={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleAllVisible={() =>
            setSelected(allVisibleSelected ? new Set() : new Set(visibleIds))
          }
          onEditSlot={onEditSlot}
          onError={onError}
          onViewPhoto={(urls, title) => setPreview({ urls, title })}
        />
      ) : !filtered.length ? (
        <p className="empty">{entries.length ? "ไม่มีรายการตามตัวกรอง" : "ยังไม่มีรายการชง — แตะช่องว่างในตารางเพื่อเริ่ม"}</p>
      ) : (
        <OtCardList
          entries={sortOtEntries(filtered)}
          isOwner={isOwner}
          selected={selected}
          onToggleRow={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onEdit={onEdit}
          onError={onError}
          onViewPhoto={(urls, title) => setPreview({ urls, title })}
        />
      )}
      {preview ? (
        <ImagePreviewModal urls={preview.urls} title={preview.title} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

function OtSheetTable({
  groups,
  checkRecords,
  openingItems,
  closingItems,
  isOwner,
  selected,
  allVisibleSelected,
  someSelected,
  onToggleRow,
  onToggleAllVisible,
  onEditSlot,
  onError,
  onViewPhoto,
}: {
  groups: OtDayGroup[];
  checkRecords: ChecklistRecord[];
  openingItems: ChecklistItem[];
  closingItems: ChecklistItem[];
  isOwner: boolean;
  selected: Set<string>;
  allVisibleSelected: boolean;
  someSelected: boolean;
  onToggleRow: (id: string) => void;
  onToggleAllVisible: () => void;
  onEditSlot: (target: OtSlotTarget) => void;
  onError: (msg: string) => void;
  onViewPhoto: (urls: string[], title: string) => void;
}) {
  async function setStatus(row: OtEntry, status: OtStatus) {
    try {
      await updateOtEntry(row.id, { status });
    } catch (err) {
      onError((err as Error).message || "อัปเดตสถานะไม่สำเร็จ");
    }
  }

  const colCount = 19 + (isOwner ? 2 : 0);
  const slotCount = groups[0]?.slots.length || 3;

  return (
    <div className="sheet-wrap ot-sheet-wrap">
      <table className="sheet-table ot-table">
        <thead>
          <tr>
            {isOwner ? (
              <th className="col-act bulk-check-col">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allVisibleSelected;
                  }}
                  onChange={onToggleAllVisible}
                  aria-label="เลือกทั้งหมดที่แสดง"
                />
              </th>
            ) : null}
            <th className="ot-th-staff col-sticky-left ot-col-date">วันที่</th>
            <th className="ot-th-staff ot-col-worker">พนักงาน</th>
            <th className="ot-th-staff ot-col-shift">รอบงาน</th>
            <th className="ot-th-machine col-out">เครื่อง</th>
            <th className="ot-th-prod col-out">อื่นๆ</th>
            <th className="ot-th-prod col-out">โคน</th>
            <th className="ot-th-prod col-out">ขนมปัง</th>
            <th className="ot-th-prod col-out">เคลม</th>
            <th className="ot-th-deduct col-out">ลด</th>
            <th className="ot-th-deduct col-note">สาเหตุลด</th>
            <th className="ot-th-add col-out">เพิ่ม</th>
            <th className="ot-th-add col-note">สาเหตุเพิ่ม</th>
            <th className="ot-th-result col-out">สรุป</th>
            <th className="ot-th-result col-out">เรท</th>
            <th className="ot-th-result col-out">รวม</th>
            <th className="ot-th-result ot-col-bonus col-sticky-right">โบนัส/คน</th>
            <th className="ot-th-result col-act">คน</th>
            <th className="ot-th-result col-act">สถานะ</th>
            <th className="ot-th-result col-act">แก้ไข</th>
            {isOwner ? <th className="ot-th-result col-act" /> : null}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const futureDay = isFutureLocalDay(group.date);
            return (
            <Fragment key={group.date}>
              {group.slots.map((slot, idx) => {
                const row = slot.entry;
                const isEmpty = !row;
                const isPlanned = row ? isOtEntryPlanned(row) : false;
                const slotProgress = computeShiftProgress({
                  entry: row,
                  records: checkRecords,
                  openingItems,
                  closingItems,
                  date: group.date,
                  shift: slot.shiftId,
                });
                const slotStatus = slotProgress.status;
                const slotHints = isOwner ? ownerQualityHints(slotProgress.quality) : [];
                const processIssue = hasOtProcessOrderIssue(slotProgress.quality);
                const processHint = staffProcessOrderHint(slotProgress.quality);
                const c = row ? computeOtBonus(row) : null;
                const statusClass =
                  row?.status === "paid"
                    ? "is-paid"
                    : "is-pending";
                const workerNames = (row?.workerNames || []).filter(Boolean);
                const statusPill =
                  slotStatus === "planned"
                    ? "วางแผน"
                    : slotStatus === "partial"
                      ? "ค้าง"
                      : null;

                return (
                  <tr
                    key={`${group.date}-${slot.shiftId}`}
                    className={
                      isEmpty
                        ? futureDay
                          ? "ot-slot-empty ot-day-future row-out"
                          : "ot-slot-empty row-out"
                        : slotStatus === "planned"
                          ? futureDay
                            ? "ot-slot-planned ot-day-future row-out"
                            : "ot-slot-planned row-out"
                        : slotStatus === "partial"
                          ? futureDay
                            ? "ot-slot-partial ot-day-future row-out"
                            : "ot-slot-partial row-out"
                        : slotStatus === "complete"
                          ? futureDay
                            ? "ot-slot-complete ot-day-future row-out"
                            : "ot-slot-complete row-out"
                        : isOtEntryLocked(row!)
                          ? "row-out prod-row-paid"
                          : futureDay
                            ? "ot-day-future row-out"
                            : "row-out"
                    }
                  >
                    {isOwner ? (
                      <td className="col-act bulk-check-col">
                        {row ? (
                          <input
                            type="checkbox"
                            checked={selected.has(row.id)}
                            onChange={() => onToggleRow(row.id)}
                            aria-label={`เลือก ${formatDateShort(group.date)} ${slot.shiftLabel}`}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    {idx === 0 ? (
                      <td className="col-sticky-left ot-col-date ot-date-cell" rowSpan={slotCount}>
                        {formatDateShort(group.date)}
                      </td>
                    ) : null}
                    <td className="ot-col-worker">
                      {isEmpty ? (
                        <span className="muted">—</span>
                      ) : (
                        <div className="ot-worker-cell">
                          <div className="ot-worker-names">
                            {workerNames.length ? workerNames.join(" · ") : "—"}
                          </div>
                          <div className="ot-worker-meta">
                            {statusPill ? (
                              <span className={`ot-shift-pill is-${slotStatus}`}>
                                {statusPill}
                              </span>
                            ) : null}
                            {processIssue ? (
                              <span
                                className="ot-owner-hint-pill"
                                title={processHint || slotHints.join(" · ")}
                              >
                                ⚠
                              </span>
                            ) : null}
                            <EntryPhotoIndicator
                              imageUrls={getOtImageUrls(row!)}
                              label={`${formatDateShort(group.date)} ${slot.shiftLabel}`}
                              onView={(urls) =>
                                onViewPhoto(
                                  urls,
                                  `${formatDateShort(group.date)} ${slot.shiftLabel}`,
                                )
                              }
                              onAdd={
                                row && !isOtEntryLocked(row)
                                  ? () =>
                                      onEditSlot({
                                        date: group.date,
                                        shift: slot.shiftId,
                                        entry: row,
                                      })
                                  : undefined
                              }
                            />
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="ot-col-shift">
                      <button
                        type="button"
                        className={isEmpty ? "desc-link muted" : "desc-link"}
                        onClick={() =>
                          onEditSlot({ date: group.date, shift: slot.shiftId, entry: row })
                        }
                      >
                        {slot.shiftLabel}
                      </button>
                    </td>
                    <td className="col-out">{row ? formatPlainNumber(row.machineCount) : "—"}</td>
                    <td className="col-out">{row ? otQtyCell(row.otherCups || 0) : "—"}</td>
                    <td className="col-out">{row ? otQtyCell(row.iceCreamCones || 0) : "—"}</td>
                    <td className="col-out">{row ? otQtyCell(row.breadSlices || 0) : "—"}</td>
                    <td className="col-out">{row ? otQtyCell(row.claimCups || 0) : "—"}</td>
                    <td className="col-out">{row ? otQtyCell(row.deductQty || 0) : "—"}</td>
                    <td className="col-note" title={row?.deductReason || ""}>
                      {row?.deductReason || "—"}
                    </td>
                    <td className="col-out">{row ? otQtyCell(row.addQty || 0) : "—"}</td>
                    <td className="col-note" title={row?.addReason || ""}>
                      {row?.addReason || "—"}
                    </td>
                    <td className="col-out">{c ? formatPlainNumber(c.summaryQty) : "—"}</td>
                    <td className="col-out">{row ? formatPlainNumber(row.bonusRate) : "—"}</td>
                    <td className="col-out">{c ? `฿${formatPlainNumber(c.totalBonus)}` : "—"}</td>
                    <td
                      className="col-sticky-right ot-col-bonus ot-bonus-cell"
                      title={row && c ? otFormulaText(row, c) : undefined}
                    >
                      {c ? `฿${formatPlainNumber(c.bonusPerPerson)}` : "—"}
                    </td>
                    <td className="col-act">{c ? c.workerCount : "—"}</td>
                    <td className="col-act">
                      {row ? (
                        isOwner ? (
                          <select
                            className={`prod-status ${statusClass}`}
                            value={row.status}
                            onChange={(e) => void setStatus(row, e.target.value as OtStatus)}
                            aria-label="สถานะโบนัส"
                          >
                            <option value="pending">เตรียมจ่าย</option>
                            <option value="paid">จ่ายแล้ว</option>
                          </select>
                        ) : (
                          <span className={`prod-status-pill ${statusClass}`}>
                            {labelOtStatus(row.status)}
                          </span>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="col-act">
                      <button
                        type="button"
                        className="ghost-btn ot-slot-edit-btn"
                        onClick={() =>
                          onEditSlot({ date: group.date, shift: slot.shiftId, entry: row })
                        }
                      >
                        {isEmpty ? "เพิ่ม" : isPlanned ? "แก้แผน" : "แก้ไข"}
                      </button>
                    </td>
                    {isOwner && row && !isOtEntryLocked(row) ? (
                      <td className="col-act">
                        <button
                          type="button"
                          className="trash-btn"
                          aria-label="ลบ"
                          onClick={() => {
                            if (!window.confirm("ลบรายการนี้?")) return;
                            void deleteOtEntry(row.id).catch((err) =>
                              onError(err.message || "ลบไม่สำเร็จ"),
                            );
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    ) : isOwner ? (
                      <td className="col-act" />
                    ) : null}
                  </tr>
                );
              })}
              <tr className="ot-day-summary">
                <td colSpan={colCount}>
                  สรุป {formatDateShort(group.date)}: {group.filledCount}/{group.slots.length} กะ · สรุปหน่วย{" "}
                  {formatPlainNumber(group.summaryQty)} · โบนัสรวม ฿{formatPlainNumber(group.totalBonus)}
                </td>
              </tr>
            </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OtCardList({
  entries,
  isOwner,
  selected,
  onToggleRow,
  onEdit,
  onError,
  onViewPhoto,
}: {
  entries: OtEntry[];
  isOwner: boolean;
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onEdit: (row: OtEntry) => void;
  onError: (msg: string) => void;
  onViewPhoto: (urls: string[], title: string) => void;
}) {
  async function setStatus(row: OtEntry, status: OtStatus) {
    try {
      await updateOtEntry(row.id, { status });
    } catch (err) {
      onError((err as Error).message || "อัปเดตสถานะไม่สำเร็จ");
    }
  }

  return (
    <div className="ot-list">
      {entries.map((row) => {
        const c = computeOtBonus(row);
        const statusClass = row.status === "paid" ? "is-paid" : "is-pending";
        const quality = computeShiftQuality(row);
        const processHint = staffProcessOrderHint(quality);
        const detailItems = [
          { label: "เครื่อง", value: formatPlainNumber(row.machineCount) },
          { label: "อื่นๆ", value: otQtyCell(row.otherCups || 0) },
          { label: "โคน", value: otQtyCell(row.iceCreamCones || 0) },
          { label: "ขนมปัง", value: otQtyCell(row.breadSlices || 0) },
          { label: "เคลม", value: otQtyCell(row.claimCups || 0) },
          {
            label: "ลด",
            value: otQtyCell(row.deductQty || 0),
            title: row.deductReason || undefined,
          },
          {
            label: "เพิ่ม",
            value: otQtyCell(row.addQty || 0),
            title: row.addReason || undefined,
          },
          { label: "สรุป", value: formatPlainNumber(c.summaryQty) },
          { label: "รวม", value: `฿${formatPlainNumber(c.totalBonus)}` },
        ];

        return (
          <article key={row.id} className={isOtEntryLocked(row) ? "ot-card prod-row-paid" : "ot-card"}>
            <header className="ot-card-head">
              <div className="ot-card-meta">
                {isOwner ? (
                  <input
                    type="checkbox"
                    className="ot-card-check"
                    checked={selected.has(row.id)}
                    onChange={() => onToggleRow(row.id)}
                    aria-label="เลือกรายการ"
                  />
                ) : null}
                <button type="button" className="desc-link ot-card-date" onClick={() => onEdit(row)}>
                  {isOtEntryLocked(row) ? <Lock size={11} aria-hidden /> : null} {formatDateShort(row.date)}
                </button>
                <span className="ot-card-shift">{labelOtShift(row.shift)}</span>
              </div>
              <div className="ot-card-actions">
                {isOwner ? (
                  <select
                    className={`prod-status ot-card-status ${statusClass}`}
                    value={row.status}
                    onChange={(e) => void setStatus(row, e.target.value as OtStatus)}
                    aria-label="สถานะโบนัส"
                  >
                    <option value="pending">เตรียมจ่าย</option>
                    <option value="paid">จ่ายแล้ว</option>
                  </select>
                ) : (
                  <span className={`prod-status-pill ${statusClass}`}>
                    {labelOtStatus(row.status)}
                  </span>
                )}
                {isOwner && !isOtEntryLocked(row) ? (
                  <button
                    type="button"
                    className="ghost-btn icon-btn"
                    aria-label="ลบ"
                    onClick={() => {
                      if (!window.confirm("ลบรายการนี้?")) return;
                      void deleteOtEntry(row.id).catch((err) =>
                        onError(err.message || "ลบไม่สำเร็จ"),
                      );
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </div>
            </header>

            <div className="ot-worker-cell">
              <div className="ot-worker-names">
                {(row.workerNames || []).filter(Boolean).join(" · ") || "—"}
              </div>
              <div className="ot-worker-meta">
                {processHint ? (
                  <span className="ot-owner-hint-pill" title={processHint}>
                    ⚠
                  </span>
                ) : null}
                <EntryPhotoIndicator
                  imageUrls={getOtImageUrls(row)}
                  label={`${formatDateShort(row.date)} ${labelOtShift(row.shift)}`}
                  onView={(urls) =>
                    onViewPhoto(urls, `${formatDateShort(row.date)} ${labelOtShift(row.shift)}`)
                  }
                  onAdd={!isOtEntryLocked(row) ? () => onEdit(row) : undefined}
                />
              </div>
            </div>

            <p className="ot-card-bonus" title={otFormulaText(row, c)}>
              โบนัส/คน <strong>฿{formatPlainNumber(c.bonusPerPerson)}</strong>
            </p>

            <dl className="ot-card-grid">
              {detailItems.map((item) => (
                <div key={item.label} className="ot-card-stat" title={item.title}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </article>
        );
      })}
    </div>
  );
}
