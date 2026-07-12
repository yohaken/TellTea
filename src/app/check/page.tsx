"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { CheckTabDock } from "@/components/CheckTabDock";
import { useAuth } from "@/lib/auth";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import { fileToReceiptDataUrl } from "@/lib/receipts";
import {
  CHECK_SHIFTS,
  addChecklistItem,
  deleteChecklistItem,
  deleteCheckSession,
  deleteAllChecklistRecords,
  getSessionForShift,
  groupRecordsBySession,
  labelCheckShift,
  listActiveChecklistItems,
  listChecklistItems,
  newCheckId,
  seedChecklistItemsIfEmpty,
  submitChecklistBatch,
  subscribeChecklistRecords,
  updateChecklistItem,
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

type Tab = "check" | "summary" | "setup";

type DraftItem = {
  itemId: string;
  itemName: string;
  groupLabel: string;
  status: CheckStatus;
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
  const { user, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [tab, setTab] = useState<Tab>("check");
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

  if (!can(staff, "checklist")) return null;

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

      {!loading && tab === "check" ? (
        <CheckForm
          items={items}
          employees={employees}
          createdBy={user?.email || ""}
          onError={setError}
          onSubmitted={() => setTab("summary")}
        />
      ) : null}

      {!loading && tab === "summary" ? (
        <CheckSummary
          records={records}
          isOwner={isOwner}
          onError={setError}
        />
      ) : null}

      {!loading && tab === "setup" && isOwner ? (
        <CheckSetup
          onReload={() => void reloadCatalog().catch((err) => setError((err as Error).message))}
          onError={setError}
        />
      ) : null}

      <CheckTabDock tab={tab} isOwner={isOwner} onSelect={setTab} />
    </div>
  );
}

function CheckForm({
  items,
  employees,
  createdBy,
  onError,
  onSubmitted,
}: {
  items: ChecklistItem[];
  employees: Employee[];
  createdBy: string;
  onError: (msg: string) => void;
  onSubmitted: () => void;
}) {
  const [step, setStep] = useState<"setup" | "list" | "done">("setup");
  const [date, setDate] = useState(todayInputValue());
  const [shift, setShift] = useState<CheckShiftId>("morning");
  const [inspectorId, setInspectorId] = useState("");
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [existingSession, setExistingSession] = useState<CheckSessionSummary | null>(null);
  const [failModal, setFailModal] = useState<{ index: number; remark: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      onError("ยังไม่มีรายการตรวจ — ให้เจ้าของตั้งค่าก่อน");
      return;
    }
    setDrafts(
      items.map((item) => ({
        itemId: item.id,
        itemName: item.name,
        groupLabel: item.groupLabel,
        status: "pass" as CheckStatus,
        remark: "",
        imageUrl: "",
      })),
    );
    setStep("list");
  }

  const failCount = drafts.filter((d) => d.status === "fail").length;
  const passCount = drafts.length - failCount;
  const progressPct = drafts.length ? Math.round((drafts.length / drafts.length) * 100) : 0;

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; items: { draft: DraftItem; index: number }[] }>();
    drafts.forEach((draft, index) => {
      const g = map.get(draft.groupLabel) || { label: draft.groupLabel, items: [] };
      g.items.push({ draft, index });
      map.set(draft.groupLabel, g);
    });
    return [...map.values()];
  }, [drafts]);

  function setPass(index: number) {
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === index ? { ...d, status: "pass", remark: "", imageUrl: "" } : d,
      ),
    );
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
          status: d.status,
          remark: d.remark,
          imageUrl: d.imageUrl,
          submittedAt,
          createdBy,
        })),
      );
      setStep("done");
      onSubmitted();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!employees.length) {
    return (
      <p className="muted" style={{ textAlign: "left" }}>
        ยังไม่มีรายชื่อพนักงาน — เพิ่มที่{" "}
        <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
      </p>
    );
  }

  if (step === "done") {
    return (
      <div className="check-done-card">
        <CheckCircle2 size={40} className="check-done-icon" aria-hidden />
        <h2 className="panel-title">บันทึกเรียบร้อย</h2>
        <p className="muted">
          {formatDateShort(parseDateInput(date))} · {labelCheckShift(shift)} · ผู้ตรวจ {inspector?.name}
        </p>
        <p className="muted">
          ผ่าน {passCount} · ไม่ผ่าน {failCount}
        </p>
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            setStep("setup");
            setExistingSession(null);
          }}
        >
          เช็ครอบใหม่
        </button>
      </div>
    );
  }

  if (step === "setup") {
    return (
      <div className="form-card entry-form">
        <h2 className="panel-title" style={{ fontSize: "1rem" }}>เริ่มตรวจ SOP</h2>
        <p className="muted check-hint">
          เลือกกะและผู้ตรวจก่อน — ทุกรายการเริ่มต้นเป็น &quot;ผ่าน&quot; แก้เฉพาะข้อที่มีปัญหา
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
    );
  }

  return (
    <>
      <div className="check-list-header">
        <div>
          <strong>{formatDateShort(parseDateInput(date))}</strong>
          <span className="muted"> · {labelCheckShift(shift)} · {inspector?.name}</span>
        </div>
        <div className="check-progress-wrap">
          <div className="check-progress-bar" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="muted check-progress-label">
          {drafts.length} รายการ · ผ่าน {passCount}
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
                className={draft.status === "fail" ? "check-item is-fail" : "check-item is-pass"}
              >
                <p className="check-item-name">{draft.itemName}</p>
                <div className="check-item-actions">
                  <button
                    type="button"
                    className={draft.status === "pass" ? "check-status-btn is-pass is-active" : "check-status-btn is-pass"}
                    onClick={() => setPass(index)}
                  >
                    ผ่าน
                  </button>
                  <button
                    type="button"
                    className={draft.status === "fail" ? "check-status-btn is-fail is-active" : "check-status-btn is-fail"}
                    onClick={() => openFailModal(index)}
                  >
                    ไม่ผ่าน
                  </button>
                </div>
                {draft.status === "fail" ? (
                  <div className="check-fail-detail">
                    <p className="check-fail-remark">{draft.remark}</p>
                    {draft.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={draft.imageUrl} alt="หลักฐาน" className="check-fail-thumb" />
                    ) : null}
                    <button type="button" className="ghost-btn" style={{ fontSize: "0.72rem" }} onClick={() => openFailModal(index)}>
                      แก้ไขหมายเหตุ/รูป
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ))}

      <div className="check-submit-bar">
        <button type="button" className="ghost-btn" onClick={() => setStep("setup")}>
          ย้อนกลับ
        </button>
        <button type="button" className="primary-btn" disabled={busy} onClick={() => void onSubmit()}>
          {busy ? "กำลังบันทึก..." : "ส่งผลตรวจ"}
        </button>
      </div>

      {failModal ? (
        <FailModal
          itemName={drafts[failModal.index]?.itemName || ""}
          remark={failModal.remark}
          preview={failModal.preview}
          fileRef={fileRef}
          onRemarkChange={(remark) => setFailModal((m) => m ? { ...m, remark } : null)}
          onImagePick={async (file) => {
            try {
              const url = await fileToReceiptDataUrl(file);
              setFailModal((m) => m ? { ...m, preview: url } : null);
            } catch (err) {
              onError((err as Error).message || "อัปโหลดรูปไม่สำเร็จ");
            }
          }}
          onCancel={() => setFailModal(null)}
          onSave={() => saveFailModal(failModal.preview)}
        />
      ) : null}
    </>
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
    <div className="check-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="fail-modal-title">
      <div className="check-modal">
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

function CheckSummary({
  records,
  isOwner,
  onError,
}: {
  records: ChecklistRecord[];
  isOwner: boolean;
  onError: (msg: string) => void;
}) {
  const [date, setDate] = useState(todayInputValue());
  const dateMs = parseDateInput(date);

  const dayRecords = useMemo(
    () => records.filter((r) => r.date === dateMs),
    [records, dateMs],
  );

  const sessions = useMemo(() => groupRecordsBySession(dayRecords), [dayRecords]);

  const shiftSummaries = useMemo(() => {
    const latestByShift = new Map<CheckShiftId, CheckSessionSummary>();
    for (const session of [...sessions].sort((a, b) => b.submittedAt - a.submittedAt)) {
      if (!latestByShift.has(session.shift)) {
        latestByShift.set(session.shift, session);
      }
    }
    return CHECK_SHIFTS.map((s) => {
      const session = latestByShift.get(s.id) || null;
      if (!session) {
        return { shift: s.id, label: s.label, state: "pending" as const, session: null };
      }
      if (session.failed === 0) {
        return { shift: s.id, label: s.label, state: "pass" as const, session };
      }
      return { shift: s.id, label: s.label, state: "fail" as const, session };
    });
  }, [sessions]);

  const allFails = useMemo(() => {
    return dayRecords
      .filter((r) => r.status === "fail")
      .sort((a, b) => b.submittedAt - a.submittedAt);
  }, [dayRecords]);

  async function onDeleteSession(checkId: string) {
    if (!window.confirm("ลบชุดตรวจนี้?")) return;
    try {
      await deleteCheckSession(checkId);
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  return (
    <div className="check-summary-view">
      <div className="field" style={{ maxWidth: "12rem" }}>
        <label htmlFor="summary-date">วันที่</label>
        <input
          id="summary-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {allFails.length ? (
        <section className="check-fail-alert">
          <h2 className="check-section-title">
            <AlertTriangle size={18} aria-hidden />
            พบปัญหา {allFails.length} รายการ
          </h2>
          <div className="check-fail-list">
            {allFails.map((row) => (
              <article key={row.id} className="check-fail-card">
                <header>
                  <strong>{row.itemName}</strong>
                  <span className="check-fail-meta">
                    {labelCheckShift(row.shift)} · {row.inspector} · {formatDateTimeShort(row.submittedAt)}
                  </span>
                </header>
                <p className="check-fail-remark">{row.remark || "—"}</p>
                {row.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageUrl} alt="หลักฐาน" className="check-fail-photo" />
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : dayRecords.length ? (
        <div className="check-all-pass-banner">
          <CheckCircle2 size={20} aria-hidden />
          วันนี้ไม่พบรายการไม่ผ่าน
        </div>
      ) : null}

      <section>
        <h2 className="check-section-title">สรุปตามกะ — {formatDateShort(dateMs)}</h2>
        <div className="check-shift-summary-grid">
          {shiftSummaries.map(({ shift, label, state, session }) => (
            <div
              key={shift}
              className={
                state === "pass"
                  ? "check-shift-card is-pass"
                  : state === "fail"
                    ? "check-shift-card is-fail"
                    : "check-shift-card is-pending"
              }
            >
              <span className="check-shift-card-label">{label}</span>
              {state === "pending" ? (
                <strong>ยังไม่เช็ค</strong>
              ) : session ? (
                <>
                  <strong>
                    {session.failed === 0 ? "ผ่าน 100%" : `${session.failed} ไม่ผ่าน`}
                  </strong>
                  <span className="muted" style={{ fontSize: "0.68rem" }}>
                    {session.inspector} · {formatDateTimeShort(session.submittedAt)}
                  </span>
                  <span className="muted" style={{ fontSize: "0.68rem" }}>
                    {session.passed}/{session.total} ผ่าน
                  </span>
                  {isOwner ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      style={{ fontSize: "0.65rem", marginTop: "0.25rem" }}
                      onClick={() => void onDeleteSession(session.checkId)}
                    >
                      ลบชุดนี้
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {sessions.length ? (
        <section className="check-sheet-section">
          <h2 className="check-section-title">ตารางบันทึก (แนวตั้ง)</h2>
          <div className="sheet-wrap">
            <table className="sheet-table check-records-table">
              <thead>
                <tr>
                  <th>เวลาส่ง</th>
                  <th>กะ</th>
                  <th>ผู้ตรวจ</th>
                  <th>รายการ</th>
                  <th>สถานะ</th>
                  <th>หมายเหตุ</th>
                  <th>รูป</th>
                </tr>
              </thead>
              <tbody>
                {dayRecords
                  .sort((a, b) => b.submittedAt - a.submittedAt || a.itemName.localeCompare(b.itemName))
                  .map((row) => (
                    <tr key={row.id} className={row.status === "fail" ? "check-row-fail" : ""}>
                      <td className="col-date">{formatDateTimeShort(row.submittedAt)}</td>
                      <td>{labelCheckShift(row.shift)}</td>
                      <td>{row.inspector}</td>
                      <td className="col-desc">{row.itemName}</td>
                      <td className={row.status === "fail" ? "check-cell-fail" : "check-cell-pass"}>
                        {row.status === "pass" ? "ผ่าน" : "ไม่ผ่าน"}
                      </td>
                      <td className="col-note">{row.remark || "—"}</td>
                      <td className="col-act">
                        {row.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.imageUrl} alt="" className="check-table-thumb" />
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="empty">ยังไม่มีบันทึกวันนี้</p>
      )}
    </div>
  );
}

function CheckSetup({
  onReload,
  onError,
}: {
  onReload: () => void;
  onError: (msg: string) => void;
}) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [name, setName] = useState("");
  const [groupLabel, setGroupLabel] = useState("ทั่วไป");
  const [busy, setBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);

  async function reload() {
    setItems(await listChecklistItems());
  }

  useEffect(() => {
    void reload().catch((err) => onError((err as Error).message));
  }, [onError]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await addChecklistItem(name, groupLabel);
      setName("");
      await reload();
      onReload();
    } catch (err) {
      onError((err as Error).message || "เพิ่มไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(item: ChecklistItem) {
    try {
      await updateChecklistItem(item.id, { active: !item.active });
      await reload();
      onReload();
    } catch (err) {
      onError((err as Error).message || "อัปเดตไม่สำเร็จ");
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("ลบรายการนี้?")) return;
    try {
      await deleteChecklistItem(id);
      await reload();
      onReload();
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  async function onClearAllRecords() {
    if (
      !window.confirm(
        "ลบบันทึกความพร้อมทั้งหมด? (รวมข้อมูลที่เคย import จาก CSV) — ไม่สามารถย้อนกลับ",
      )
    ) {
      return;
    }
    if (!window.confirm("ยืนยันอีกครั้ง — ลบทุกรอบที่บันทึกไว้")) return;
    setClearBusy(true);
    setClearMsg(null);
    try {
      const n = await deleteAllChecklistRecords();
      setClearMsg(n ? `ลบแล้ว ${n} แถว` : "ไม่มีบันทึกให้ลบ");
    } catch (err) {
      onError((err as Error).message || "ลบบันทึกไม่สำเร็จ");
    } finally {
      setClearBusy(false);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of items) {
      const list = map.get(item.groupLabel) || [];
      list.push(item);
      map.set(item.groupLabel, list);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div className="prod-setup">
      <p className="muted" style={{ textAlign: "left", marginBottom: "0.75rem" }}>
        ปรับแต่งรายการตรวจ SOP — พนักงานจะเห็นรายการที่เปิดใช้งานเท่านั้น
      </p>

      <form className="form-card entry-form" onSubmit={(e) => void onAdd(e)}>
        <h2 className="panel-title" style={{ fontSize: "1rem" }}>เพิ่มรายการ</h2>
        <div className="stock-form-grid">
          <div className="field">
            <label htmlFor="setup-name">ชื่อรายการ</label>
            <input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="setup-group">กลุ่ม</label>
            <input id="setup-group" value={groupLabel} onChange={(e) => setGroupLabel(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>
          <Plus size={16} aria-hidden /> {busy ? "กำลังเพิ่ม..." : "เพิ่มรายการ"}
        </button>
      </form>

      {groups.map(([group, groupItems]) => (
        <section key={group} className="check-setup-group">
          <h3 className="check-group-title">{group}</h3>
          <ul className="check-setup-list">
            {groupItems.map((item) => (
              <li key={item.id} className={item.active ? "list-row" : "list-row is-muted"}>
                <span>{item.name}</span>
                <div className="check-setup-actions">
                  <button type="button" className="ghost-btn" onClick={() => void toggleActive(item)}>
                    {item.active ? "ปิด" : "เปิด"}
                  </button>
                  <button type="button" className="ghost-btn icon-btn" aria-label="ลบ" onClick={() => void onDelete(item.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="form-card entry-form check-danger-zone">
        <h2 className="panel-title" style={{ fontSize: "1rem" }}>เริ่มใหม่</h2>
        <p className="muted check-hint">
          ลบบันทึกความพร้อมทั้งหมด (รวมข้อมูลเก่าจาก CSV) — รายการตรวจ SOP ด้านบนยังอยู่
        </p>
        <button
          type="button"
          className="ghost-btn check-clear-records-btn"
          disabled={clearBusy}
          onClick={() => void onClearAllRecords()}
        >
          {clearBusy ? "กำลังลบ..." : "ลบบันทึกทั้งหมด"}
        </button>
        {clearMsg ? <p className="muted check-import-preview">{clearMsg}</p> : null}
      </section>
    </div>
  );
}
