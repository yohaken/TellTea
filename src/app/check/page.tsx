"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  buildCheckHistoryGrid,
  checkMonthInputValue,
  computeCheckHistoryMonthStats,
  formatCheckTimeShort,
  inspectorShort,
  parseCheckMonthInput,
  type CheckHistoryDayRow,
  type CheckHistoryShiftCell,
} from "@/lib/check-history";
import { AuthGate } from "@/components/AuthGate";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { useAuth } from "@/lib/auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import { fileToReceiptDataUrl } from "@/lib/receipts";
import {
  CHECK_SHIFTS,
  deleteCheckSession,
  getSessionForShift,
  labelCheckShift,
  listActiveChecklistItems,
  newCheckId,
  seedChecklistItemsIfEmpty,
  submitChecklistBatch,
  subscribeChecklistRecords,
  type CheckShiftId,
  type CheckStatus,
  type ChecklistItem,
  type ChecklistRecord,
  type CheckSessionSummary,
} from "@/lib/checklist";
import {
  formatDateShort,
  formatDateTimeShort,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";

type DraftStatus = CheckStatus | "pending";

type DraftItem = {
  itemId: string;
  itemName: string;
  groupLabel: string;
  status: DraftStatus;
  remark: string;
  imageUrl: string;
};

export default function CheckPage() {
  return (
    <AuthGate>
      <CheckView />
    </AuthGate>
  );
}

function CheckView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [formOpen, setFormOpen] = useState(false);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [records, setRecords] = useState<ChecklistRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reloadCatalog() {
    const [emps, catalog] = await Promise.all([
      listActiveEmployees(),
      listActiveChecklistItems(),
    ]);
    setEmployees(emps);
    setItems(catalog);
  }

  useEffect(() => {
    if (staff && !can(staff, "checklist")) {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  useEffect(() => {
    if (!can(staff, "checklist")) return;
    setLoading(true);
    void reloadCatalog()
      .then(async () => {
        if (isOwner) {
          const seeded = await seedChecklistItemsIfEmpty();
          if (seeded) await reloadCatalog();
        }
      })
      .catch((err) => setError((err as Error).message || "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));

    const unsub = subscribeChecklistRecords(
      (rows) => setRecords(rows),
      (err) => setError(err.message || "โหลดบันทึกไม่สำเร็จ"),
    );
    return unsub;
  }, [staff, isOwner]);

  useBodyScrollLock(formOpen);

  if (!can(staff, "checklist")) return null;

  function openForm() {
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
  }

  return (
    <div className="module-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <ClipboardCheck size={18} aria-hidden />
          SmartCheck SOP
        </h1>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <CheckSummary
          records={records}
          isOwner={isOwner}
          onError={setError}
        />
      ) : null}

      {formOpen && !loading ? (
        <div className="modal-backdrop edit-modal is-module-form is-check-form" onClick={closeForm}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <CheckForm
              key={formOpen ? "open" : "closed"}
              items={items}
              employees={employees}
              createdBy={actorId}
              onError={setError}
              onClose={closeForm}
            />
          </div>
        </div>
      ) : null}

      <ModuleTabDock
        ariaLabel="มุมมอง SmartCheck"
        formOpen={formOpen}
        onAdd={openForm}
      />
    </div>
  );
}

function CheckForm({
  items,
  employees,
  createdBy,
  onError,
  onClose,
}: {
  items: ChecklistItem[];
  employees: Employee[];
  createdBy: string;
  onError: (msg: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"setup" | "list" | "done">("setup");
  const [date, setDate] = useState(todayInputValue());
  const [shift, setShift] = useState<CheckShiftId>("morning");
  const [inspectorId, setInspectorId] = useState("");
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [existingSession, setExistingSession] = useState<CheckSessionSummary | null>(null);
  const [failModal, setFailModal] = useState<{ index: number; remark: string; preview: string } | null>(null);
  const [passConfirm, setPassConfirm] = useState<{ index: number; itemName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useBodyScrollLock(!!failModal || !!passConfirm);

  const inspector = employees.find((e) => e.id === inspectorId);

  useEffect(() => {
    if (step !== "setup") return;
    void getSessionForShift(parseDateInput(date), shift)
      .then(setExistingSession)
      .catch(() => setExistingSession(null));
  }, [date, shift, step]);

  function startChecklist() {
    if (!inspectorId || !inspector) {
      onError("เลือกผู้ตรวจก่อนเริ่ม");
      return;
    }
    if (!items.length) {
      onError("ยังไม่มีรายการตรวจ — ให้เจ้าของตั้งค่าที่ อื่นๆ → ตั้งค่าโมดูล");
      return;
    }
    setDrafts(
      items.map((item) => ({
        itemId: item.id,
        itemName: item.name,
        groupLabel: item.groupLabel,
        status: "pending" as DraftStatus,
        remark: "",
        imageUrl: "",
      })),
    );
    setStep("list");
  }

  const answeredCount = drafts.filter((d) => d.status !== "pending").length;
  const failCount = drafts.filter((d) => d.status === "fail").length;
  const passCount = drafts.filter((d) => d.status === "pass").length;
  const pendingCount = drafts.length - answeredCount;
  const progressPct = drafts.length ? Math.round((answeredCount / drafts.length) * 100) : 0;

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; items: { draft: DraftItem; index: number }[] }>();
    drafts.forEach((draft, index) => {
      const g = map.get(draft.groupLabel) || { label: draft.groupLabel, items: [] };
      g.items.push({ draft, index });
      map.set(draft.groupLabel, g);
    });
    return [...map.values()];
  }, [drafts]);

  function confirmPass() {
    if (!passConfirm) return;
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === passConfirm.index ? { ...d, status: "pass", remark: "", imageUrl: "" } : d,
      ),
    );
    setPassConfirm(null);
  }

  function openFailModal(index: number) {
    const item = drafts[index]!;
    setFailModal({
      index,
      remark: item.remark,
      preview: item.imageUrl,
    });
  }

  function saveFailModal(imageUrl: string) {
    if (!failModal) return;
    const remark = failModal.remark.trim();
    if (!remark) {
      onError("กรุณาระบุปัญหา (Remark) เมื่อไม่ผ่าน");
      return;
    }
    if (!imageUrl) {
      onError("กรุณาแนบรูปหลักฐานเมื่อไม่ผ่าน");
      return;
    }
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === failModal.index
          ? { ...d, status: "fail", remark, imageUrl }
          : d,
      ),
    );
    setFailModal(null);
  }

  async function onSubmit() {
    if (!inspector || !createdBy) return;
    if (pendingCount > 0) {
      onError(`ยังไม่ได้ตรวจ ${pendingCount} รายการ — กด ไม่ผ่าน หรือ ผ่าน ทุกข้อ`);
      return;
    }
    const fails = drafts.filter((d) => d.status === "fail");
    for (const f of fails) {
      if (!f.remark.trim() || !f.imageUrl) {
        onError(`รายการ "${f.itemName}" ไม่ผ่าน — ต้องมีหมายเหตุและรูป`);
        return;
      }
    }
    setBusy(true);
    try {
      const checkId = newCheckId();
      const submittedAt = Date.now();
      const dateMs = parseDateInput(date);
      await submitChecklistBatch(
        drafts.map((d) => ({
          checkId,
          date: dateMs,
          shift,
          inspector: inspector.name,
          inspectorId: inspector.id,
          itemId: d.itemId,
          itemName: d.itemName,
          status: d.status as CheckStatus,
          remark: d.remark,
          imageUrl: d.imageUrl,
          submittedAt,
          createdBy,
        })),
      );
      setStep("done");
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!employees.length) {
    return (
      <>
        <FormHead title="เช็ค SOP" onClose={onClose} />
        <p className="muted" style={{ textAlign: "left" }}>
          ยังไม่มีรายชื่อพนักงาน — เพิ่มที่{" "}
          <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
        </p>
      </>
    );
  }

  if (step === "done") {
    return (
      <>
        <FormHead title="บันทึกเรียบร้อย" onClose={onClose} />
        <div className="check-done-card">
          <CheckCircle2 size={40} className="check-done-icon" aria-hidden />
          <p className="muted">
            {formatDateShort(parseDateInput(date))} · {labelCheckShift(shift)} · ผู้ตรวจ {inspector?.name}
          </p>
          <p className="muted">
            ผ่าน {passCount} · ไม่ผ่าน {failCount}
          </p>
          <button type="button" className="primary-btn" onClick={onClose}>
            ปิด
          </button>
        </div>
      </>
    );
  }

  if (step === "setup") {
    return (
      <>
        <FormHead title="เริ่มตรวจ SOP" onClose={onClose} />
        <div className="form-card entry-form">
          <p className="muted check-hint">
            เลือกกะและผู้ตรวจ — ทุกรายการเริ่มว่าง ต้องกด ไม่ผ่าน หรือ ผ่าน ทีละข้อ
          </p>

          <div className="stock-form-grid">
            <div className="field">
              <label htmlFor="check-date">วันที่</label>
              <input
                id="check-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="check-inspector">ผู้ตรวจ</label>
              <select
                id="check-inspector"
                value={inspectorId}
                onChange={(e) => setInspectorId(e.target.value)}
                required
              >
                <option value="">— เลือก —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <span className="field-label">กะ / รอบงาน</span>
            <div className="check-shift-pills">
              {CHECK_SHIFTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={shift === s.id ? "check-shift-pill is-active" : "check-shift-pill"}
                  onClick={() => setShift(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {existingSession ? (
            <div className="check-existing-banner">
              <AlertTriangle size={16} aria-hidden />
              <span>
                กะนี้เช็คแล้ว ({formatDateTimeShort(existingSession.submittedAt)}) —{" "}
                {existingSession.failed ? `${existingSession.failed} ไม่ผ่าน` : "ผ่าน 100%"}
              </span>
            </div>
          ) : null}

          <button type="button" className="primary-btn" onClick={startChecklist}>
            {existingSession ? "เช็คซ้ำ (บันทึกชุดใหม่)" : "เริ่มเช็คลิสต์"}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <FormHead title="ตรวจรายการ" onClose={onClose} />

      <div className="check-list-header">
        <div>
          <strong>{formatDateShort(parseDateInput(date))}</strong>
          <span className="muted"> · {labelCheckShift(shift)} · {inspector?.name}</span>
        </div>
        <div className="check-progress-wrap">
          <div className="check-progress-bar" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="muted check-progress-label">
          ตรวจแล้ว {answeredCount}/{drafts.length}
          {pendingCount ? ` · ค้าง ${pendingCount}` : ""}
          {failCount ? ` · ไม่ผ่าน ${failCount}` : ""}
        </p>
      </div>

      {grouped.map((group) => (
        <section key={group.label} className="check-group">
          <h3 className="check-group-title">{group.label}</h3>
          <div className="check-items">
            {group.items.map(({ draft, index }) => (
              <article
                key={draft.itemId}
                className={
                  draft.status === "fail"
                    ? "check-item is-fail"
                    : draft.status === "pass"
                      ? "check-item is-pass"
                      : "check-item is-pending"
                }
              >
                <p className="check-item-name">{draft.itemName}</p>
                <div className="check-item-actions">
                  <button
                    type="button"
                    className={
                      draft.status === "fail"
                        ? "check-status-btn is-fail is-active"
                        : "check-status-btn is-fail"
                    }
                    onClick={() => openFailModal(index)}
                  >
                    ไม่ผ่าน
                  </button>
                  <button
                    type="button"
                    className={
                      draft.status === "pass"
                        ? "check-status-btn is-pass is-active"
                        : "check-status-btn is-pass"
                    }
                    onClick={() => setPassConfirm({ index, itemName: draft.itemName })}
                  >
                    ผ่าน
                  </button>
                </div>
                {draft.status === "fail" ? (
                  <div className="check-fail-detail">
                    <p className="check-fail-remark">{draft.remark}</p>
                    {draft.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={draft.imageUrl} alt="หลักฐาน" className="check-fail-thumb" />
                    ) : null}
                    <button
                      type="button"
                      className="ghost-btn"
                      style={{ fontSize: "0.72rem" }}
                      onClick={() => openFailModal(index)}
                    >
                      แก้ไขหมายเหตุ/รูป
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ))}

      <div className="entry-actions module-form-actions">
        <button type="button" className="ghost-btn" onClick={() => setStep("setup")}>
          ย้อนกลับ
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={busy || pendingCount > 0}
          onClick={() => void onSubmit()}
        >
          {busy ? "กำลังบันทึก..." : pendingCount > 0 ? `ค้าง ${pendingCount} รายการ` : "ส่งผลตรวจ"}
        </button>
      </div>

      {failModal ? (
        <FailModal
          itemName={drafts[failModal.index]?.itemName || ""}
          remark={failModal.remark}
          preview={failModal.preview}
          fileRef={fileRef}
          onRemarkChange={(remark) => setFailModal((m) => (m ? { ...m, remark } : null))}
          onImagePick={async (file) => {
            try {
              const url = await fileToReceiptDataUrl(file);
              setFailModal((m) => (m ? { ...m, preview: url } : null));
            } catch (err) {
              onError((err as Error).message || "อัปโหลดรูปไม่สำเร็จ");
            }
          }}
          onCancel={() => setFailModal(null)}
          onSave={() => saveFailModal(failModal.preview)}
        />
      ) : null}

      {passConfirm ? (
        <PassConfirmModal
          itemName={passConfirm.itemName}
          onCancel={() => setPassConfirm(null)}
          onConfirm={confirmPass}
        />
      ) : null}
    </>
  );
}

function FormHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="entry-toolbar module-form-head">
      <h2 className="panel-title">{title}</h2>
      <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" onClick={onClose}>
        <X size={18} />
      </button>
    </div>
  );
}

function PassConfirmModal({
  itemName,
  onCancel,
  onConfirm,
}: {
  itemName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="modal-backdrop alert-backdrop check-sub-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pass-confirm-title"
      onClick={onCancel}
    >
      <div className="check-confirm-card" onClick={(e) => e.stopPropagation()}>
        <h2 id="pass-confirm-title" className="panel-title" style={{ fontSize: "1rem" }}>
          ยืนยัน &quot;ผ่าน&quot;
        </h2>
        <p className="muted check-hint">{itemName}</p>
        <div className="btn-row">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            ยกเลิก
          </button>
          <button type="button" className="primary-btn" onClick={onConfirm}>
            ยืนยันผ่าน
          </button>
        </div>
      </div>
    </div>
  );
}

function FailModal({
  itemName,
  remark,
  preview,
  fileRef,
  onRemarkChange,
  onImagePick,
  onCancel,
  onSave,
}: {
  itemName: string;
  remark: string;
  preview: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onRemarkChange: (v: string) => void;
  onImagePick: (file: File) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className="modal-backdrop alert-backdrop check-sub-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fail-modal-title"
      onClick={onCancel}
    >
      <div className="check-confirm-card check-fail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="check-modal-head">
          <h2 id="fail-modal-title" className="panel-title" style={{ fontSize: "1rem" }}>
            ไม่ผ่าน: {itemName}
          </h2>
          <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p className="muted check-hint">ระบุปัญหาและแนบรูปหลักฐาน — บังคับก่อนบันทึก</p>
        <div className="field">
          <label htmlFor="fail-remark">หมายเหตุ / ปัญหา</label>
          <textarea
            id="fail-remark"
            rows={3}
            value={remark}
            onChange={(e) => onRemarkChange(e.target.value)}
            placeholder="เช่น แอพ Grab เปิดเมนูผิด"
            required
          />
        </div>
        <div className="field">
          <span className="field-label">รูปหลักฐาน</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="check-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImagePick(file);
            }}
          />
          <button
            type="button"
            className="check-camera-btn"
            onClick={() => fileRef.current?.click()}
          >
            <Camera size={18} aria-hidden />
            {preview ? "ถ่าย/เลือกรูปใหม่" : "เปิดกล้อง / เลือกรูป"}
          </button>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="ตัวอย่างหลักฐาน" className="check-fail-preview" />
          ) : null}
        </div>
        <button type="button" className="primary-btn action-out" onClick={onSave}>
          บันทึก &quot;ไม่ผ่าน&quot;
        </button>
      </div>
    </div>
  );
}

type HistoryFilter = "all" | "issues";

type HistoryDetail = {
  dateMs: number;
  cell: CheckHistoryShiftCell;
};

function CheckSummary({
  records,
  isOwner,
  onError,
}: {
  records: ChecklistRecord[];
  isOwner: boolean;
  onError: (msg: string) => void;
}) {
  const [month, setMonth] = useState(checkMonthInputValue());
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [detail, setDetail] = useState<HistoryDetail | null>(null);

  const { year, month: monthIdx } = parseCheckMonthInput(month);

  useBodyScrollLock(!!detail);

  const allRows = useMemo(
    () => buildCheckHistoryGrid(records, year, monthIdx),
    [records, year, monthIdx],
  );

  const rows = useMemo(
    () => (filter === "issues" ? allRows.filter((r) => r.dayFails > 0) : allRows),
    [allRows, filter],
  );

  const stats = useMemo(() => computeCheckHistoryMonthStats(allRows), [allRows]);

  const detailRecords = useMemo(() => {
    if (!detail?.cell.session) return [];
    const { checkId } = detail.cell.session;
    return records
      .filter((r) => r.checkId === checkId)
      .sort((a, b) => a.itemName.localeCompare(b.itemName, "th"));
  }, [detail, records]);

  async function onDeleteSession(checkId: string) {
    if (!window.confirm("ลบชุดตรวจนี้?")) return;
    try {
      await deleteCheckSession(checkId);
      setDetail(null);
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  return (
    <div className="check-summary-view">
      <div className="check-history-toolbar">
        <input
          type="month"
          className="ot-slim-input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="เดือน"
        />
        <div className="check-filter-pills" role="group" aria-label="ตัวกรอง">
          <button
            type="button"
            className={filter === "all" ? "check-filter-pill is-active" : "check-filter-pill"}
            onClick={() => setFilter("all")}
          >
            ทั้งหมด
          </button>
          <button
            type="button"
            className={filter === "issues" ? "check-filter-pill is-active" : "check-filter-pill"}
            onClick={() => setFilter("issues")}
          >
            มีปัญหา
          </button>
        </div>
        <p className="muted check-history-stats">
          {stats.sessions}/{stats.expectedSessions} กะ · ไม่ผ {stats.failItems}
          {stats.daysWithIssues ? ` · ${stats.daysWithIssues} วันมีปัญหา` : ""}
        </p>
      </div>

      <p className="muted check-history-hint">
        แต่ละวัน 3 กะ — พนักงานเข้ากะต้องตรวจ · แตะช่องดูรายละเอียด
      </p>

      {rows.length ? (
        <div className="sheet-wrap check-history-wrap">
          <table className="sheet-table check-history-table">
            <thead>
              <tr>
                <th className="check-history-th-date">วันที่</th>
                <th className="check-history-th-shift">ดึก</th>
                <th className="check-history-th-shift">เช้า</th>
                <th className="check-history-th-shift">เย็น</th>
                <th className="check-history-th-fail col-out">ไม่ผ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CheckHistoryRow
                  key={row.dateMs}
                  row={row}
                  onOpen={(cell) => setDetail({ dateMs: row.dateMs, cell })}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          {filter === "issues"
            ? "ไม่พบวันที่มีปัญหาในเดือนนี้"
            : "ยังไม่มีบันทึกในเดือนนี้ — กด + กรอก เมื่อเข้ากะ"}
        </p>
      )}

      {detail?.cell.session ? (
        <CheckShiftDetailModal
          dateMs={detail.dateMs}
          cell={detail.cell}
          records={detailRecords}
          isOwner={isOwner}
          onClose={() => setDetail(null)}
          onDelete={() => void onDeleteSession(detail.cell.session!.checkId)}
        />
      ) : null}
    </div>
  );
}

function CheckHistoryRow({
  row,
  onOpen,
}: {
  row: CheckHistoryDayRow;
  onOpen: (cell: CheckHistoryShiftCell) => void;
}) {
  const todayMs = parseDateInput(todayInputValue());
  const isToday = row.dateMs === todayMs;
  const missingShifts = row.shifts.filter((s) => !s.session).length;

  return (
    <tr className={row.dayFails > 0 ? "check-history-row-issues" : isToday ? "check-history-row-today" : ""}>
      <td className="check-history-date">
        {formatDateShort(row.dateMs)}
        {isToday ? <span className="check-history-today-tag">วันนี้</span> : null}
        {isToday && missingShifts ? (
          <span className="check-history-missing-tag">ค้าง {missingShifts} กะ</span>
        ) : null}
      </td>
      {row.shifts.map((cell) => (
        <td key={cell.shiftId}>
          <CheckHistoryCell cell={cell} onOpen={() => cell.session && onOpen(cell)} />
        </td>
      ))}
      <td className="col-out check-history-fail-total">
        {row.dayFails > 0 ? (
          <strong className="check-history-fail-num">{row.dayFails}</strong>
        ) : (
          <span className="check-history-zero">0</span>
        )}
      </td>
    </tr>
  );
}

function CheckHistoryCell({
  cell,
  onOpen,
}: {
  cell: CheckHistoryShiftCell;
  onOpen: () => void;
}) {
  const session = cell.session;
  if (!session) {
    return (
      <span className="check-history-cell is-pending" title="ยังไม่เช็ค">
        —
      </span>
    );
  }

  const state = session.failed > 0 ? "fail" : "pass";
  return (
    <button
      type="button"
      className={`check-history-cell is-${state}`}
      onClick={onOpen}
      title={`${cell.label} · ${session.inspector}`}
    >
      <span className="check-history-score">
        {session.passed}/{session.total}
      </span>
      <span className="check-history-meta">
        {inspectorShort(session.inspector)} · {formatCheckTimeShort(session.submittedAt)}
      </span>
    </button>
  );
}

function CheckShiftDetailModal({
  dateMs,
  cell,
  records,
  isOwner,
  onClose,
  onDelete,
}: {
  dateMs: number;
  cell: CheckHistoryShiftCell;
  records: ChecklistRecord[];
  isOwner: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const session = cell.session!;

  return (
    <div className="modal-backdrop edit-modal is-module-form" onClick={onClose}>
      <div className="modal-card check-detail-card" onClick={(e) => e.stopPropagation()}>
        <div className="check-modal-head">
          <div>
            <h2 className="panel-title" style={{ fontSize: "1rem", margin: 0 }}>
              {formatDateShort(dateMs)} · {cell.label}
            </h2>
            <p className="muted check-detail-sub">
              {session.inspector} · {formatDateTimeShort(session.submittedAt)} ·{" "}
              {session.failed ? `${session.failed} ไม่ผ่าน` : "ผ่านครบ"}
            </p>
          </div>
          <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="check-detail-grid">
          {records.map((row) => (
            <article
              key={row.id}
              className={row.status === "fail" ? "check-detail-item is-fail" : "check-detail-item is-pass"}
            >
              <span className="check-detail-item-name">{row.itemName}</span>
              <span className={row.status === "fail" ? "check-cell-fail" : "check-cell-pass"}>
                {row.status === "pass" ? "ผ่าน" : "ไม่ผ่าน"}
              </span>
              {row.status === "fail" ? (
                <>
                  <p className="check-detail-remark">{row.remark || "—"}</p>
                  {row.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.imageUrl} alt="หลักฐาน" className="check-detail-photo" />
                  ) : null}
                </>
              ) : null}
            </article>
          ))}
        </div>

        {isOwner ? (
          <button type="button" className="ghost-btn check-detail-delete" onClick={onDelete}>
            <Trash2 size={14} aria-hidden /> ลบชุดตรวจนี้
          </button>
        ) : null}
      </div>
    </div>
  );
}
