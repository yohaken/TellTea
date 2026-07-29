"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyVatImportRowsToMonth,
  previewApplyVatImportRows,
} from "@/lib/vat-import-apply";
import {
  createVatImportRow,
  createVatImportRowsSkippingDupes,
  deleteVatImportRow,
  emptyVatImportRow,
  isAllowedVatImportFile,
  isDateKey,
  listVatImportRows,
  monthKeyFromDateKey,
  sumVatImportDraftByChannel,
  updateVatImportRow,
  uploadVatImportFile,
  VAT_IMPORT_CHANNEL_LABELS,
  VAT_IMPORT_KIND_LABELS,
  vatImportDedupeKey,
  type VatImportChannel,
  type VatImportRow,
  type VatImportRowKind,
  type VatImportRowStatus,
} from "@/lib/vat-import";
import {
  grabCsvToImportRows,
  looksLikeGrabTransactionCsv,
  parseGrabTransactionCsv,
} from "@/lib/vat-import-grab-csv";
import { ingestNewVatImportFiles } from "@/lib/vat-import-inbox";
import {
  linemanMonthlyToImportRows,
  looksLikeLinemanMonthlyReport,
  parseLinemanMonthlyReport,
} from "@/lib/vat-import-lineman-monthly";
import { extractPdfTextFromFile } from "@/lib/vat-import-pdf-text";
import {
  looksLikeShopeeTaxInvoice,
  parseShopeeTaxInvoice,
  shopeeTaxInvoiceToImportRow,
} from "@/lib/vat-import-shopee-taxinvoice";

import {
  formatVatMoney,
  moneyFieldValue,
  normalizeMoneyFieldText,
  parseVatMoneyInput,
} from "@/lib/vat-number-format";
import {
  formatThaiMonthKey,
  listThaiMonthOptions,
} from "@/lib/vat-monthly";
import { bangkokMonthKey } from "@/lib/vat-sales";

type Props = { actor: string };

const CHANNELS: VatImportChannel[] = [
  "shopee",
  "grab",
  "lineman",
  "storefront",
];

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  return formatVatMoney(n);
}

function MoneyInput({
  value,
  disabled,
  ariaLabel,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  ariaLabel: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(() => moneyFieldValue(value));
  useEffect(() => {
    setText(moneyFieldValue(value));
  }, [value]);
  return (
    <input
      className="vat-sales-input vat-money-input"
      inputMode="decimal"
      disabled={disabled}
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = parseVatMoneyInput(text);
        setText(normalizeMoneyFieldText(text));
        onCommit(n);
      }}
    />
  );
}

export function VatImportWorkbench({ actor }: Props) {
  const [month, setMonth] = useState(() => bangkokMonthKey());
  const [rows, setRows] = useState<VatImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [filterChannel, setFilterChannel] = useState<VatImportChannel | "all">(
    "all",
  );
  const [uploadChannel, setUploadChannel] =
    useState<VatImportChannel>("grab");
  const fileRef = useRef<HTMLInputElement>(null);
  const linemanRef = useRef<HTMLInputElement>(null);
  const shopeeRef = useRef<HTMLInputElement>(null);
  const grabRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await listVatImportRows(month);
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () =>
      filterChannel === "all"
        ? rows
        : rows.filter((r) => r.channel === filterChannel),
    [rows, filterChannel],
  );

  const draftVisible = useMemo(
    () => visible.filter((r) => r.status === "draft"),
    [visible],
  );

  const selectedRows = useMemo(() => {
    const picked = rows.filter((r) => selected[r.id] && r.status === "draft");
    return picked.length > 0 ? picked : draftVisible;
  }, [rows, selected, draftVisible]);

  const applyPreview = useMemo(
    () => previewApplyVatImportRows(month, selectedRows),
    [month, selectedRows],
  );

  const sums = useMemo(() => sumVatImportDraftByChannel(rows), [rows]);

  const dedupeWarnings = useMemo(() => {
    const seen = new Map<string, string>();
    const warn = new Set<string>();
    for (const r of rows) {
      if (r.status === "skipped") continue;
      const k = vatImportDedupeKey(r);
      const prev = seen.get(k);
      if (prev) {
        warn.add(prev);
        warn.add(r.id);
      } else {
        seen.set(k, r.id);
      }
    }
    return warn;
  }, [rows]);

  async function addBlankRow() {
    setBusyId("new");
    setError("");
    setMsg("");
    try {
      const created = await createVatImportRow(
        emptyVatImportRow(month, {
          channel: uploadChannel,
          dateKey: `${month}-01`,
        }),
        actor,
      );
      setRows((prev) => [...prev, created].sort((a, b) => a.dateKey.localeCompare(b.dateKey)));
      setMsg("เพิ่มแถวว่างแล้ว — กรอกวันที่/ยอด หรืออัปโหลดไฟล์");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  async function saveRow(
    row: VatImportRow,
    patch: Partial<VatImportRow>,
  ) {
    const next = { ...row, ...patch };
    if (patch.dateKey && isDateKey(patch.dateKey)) {
      const mk = monthKeyFromDateKey(patch.dateKey);
      if (mk && mk !== month) {
        setError(`วันที่ ${patch.dateKey} ไม่อยู่ในเดือน ${formatThaiMonthKey(month)}`);
        return;
      }
      next.monthKey = month;
    }
    setBusyId(row.id);
    setError("");
    try {
      const saved = await updateVatImportRow(
        row.id,
        {
          monthKey: next.monthKey,
          dateKey: next.dateKey,
          channel: next.channel,
          rowKind: next.rowKind,
          grossInclusive: next.grossInclusive,
          fee: next.fee,
          netTransfer: next.netTransfer,
          gpVat: next.gpVat,
          invoiceNo: next.invoiceNo,
          invoiceDate: next.invoiceDate,
          sellerTaxId: next.sellerTaxId,
          storagePath: next.storagePath,
          downloadUrl: next.downloadUrl,
          fileName: next.fileName,
          contentType: next.contentType,
          contentHash: next.contentHash,
          adapterId: next.adapterId,
          adapterVersion: next.adapterVersion,
          externalId: next.externalId,
          status: next.status,
          note: next.note,
          appliedAt: next.appliedAt,
          appliedToMonth: next.appliedToMonth,
        },
        actor,
        row.createdAt,
      );
      setRows((prev) =>
        prev
          .map((r) => (r.id === row.id ? saved : r))
          .sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  async function removeRow(row: VatImportRow) {
    if (row.status === "applied") {
      setError("แถวที่ apply แล้ว — ตั้งเป็นข้ามแทนการลบ");
      return;
    }
    if (!window.confirm("ลบแถวนี้?")) return;
    setBusyId(row.id);
    setError("");
    try {
      await deleteVatImportRow(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  async function onUploadFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setBusyId("upload");
    setError("");
    setMsg("");
    try {
      const created: VatImportRow[] = [];
      for (const file of Array.from(fileList)) {
        if (!isAllowedVatImportFile(file)) {
          throw new Error(`ไฟล์ไม่รองรับ: ${file.name}`);
        }
        const up = await uploadVatImportFile({
          file,
          monthKey: month,
          channel: uploadChannel,
        });
        const row = await createVatImportRow(
          emptyVatImportRow(month, {
            channel: uploadChannel,
            dateKey: `${month}-01`,
            rowKind: "sales",
            storagePath: up.storagePath,
            downloadUrl: up.downloadUrl,
            fileName: up.fileName,
            contentType: up.contentType,
            contentHash: up.contentHash,
            adapterId: "manual",
            note: `อัปโหลด ${up.fileName} · รอแปลง/กรอกยอด`,
          }),
          actor,
        );
        created.push(row);
      }
      setRows((prev) =>
        [...prev, ...created].sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
      );
      setMsg(`อัปโหลด ${created.length} ไฟล์แล้ว · แก้วันที่/ยอดในแถว`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onImportLinemanMonthly(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setBusyId("lineman");
    setError("");
    setMsg("");
    try {
      if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
        throw new Error("ต้องเป็น PDF รายงานประจำเดือน LINE MAN");
      }
      const text = await extractPdfTextFromFile(file);
      if (!looksLikeLinemanMonthlyReport(text)) {
        throw new Error(
          "ไม่ใช่รายงานยอดขายประจำเดือน LINE MAN (หาคำว่า ค่า GP (รวม VAT) ไม่เจอ)",
        );
      }
      const parsed = parseLinemanMonthlyReport(text);
      if (!parsed.monthKey || parsed.days.length === 0) {
        throw new Error(
          `อ่านแถววันไม่ได้${parsed.warnings.length ? ` · ${parsed.warnings.join(" · ")}` : ""}`,
        );
      }
      const targetMonth = parsed.monthKey;
      if (targetMonth !== month) {
        setMonth(targetMonth);
      }
      const existing =
        targetMonth === month ? rows : await listVatImportRows(targetMonth);
      const up = await uploadVatImportFile({
        file,
        monthKey: targetMonth,
        channel: "lineman",
      });
      const inputs = linemanMonthlyToImportRows(parsed, {
        storagePath: up.storagePath,
        downloadUrl: up.downloadUrl,
        fileName: up.fileName,
        contentType: up.contentType,
        contentHash: up.contentHash,
      });

      const { created, skipped } = await createVatImportRowsSkippingDupes(
        inputs,
        actor,
        existing,
      );
      if (targetMonth === month) {
        setRows((prev) =>
          [...prev, ...created].sort((a, b) =>
            a.dateKey.localeCompare(b.dateKey),
          ),
        );
      } else {
        setRows(
          [...existing, ...created].sort((a, b) =>
            a.dateKey.localeCompare(b.dateKey),
          ),
        );
      }
      const warn =
        parsed.warnings.length > 0
          ? ` · เตือน: ${parsed.warnings.join(" · ")}`
          : "";
      setMsg(
        `LINE MAN ${formatThaiMonthKey(targetMonth)} · นำเข้า ${created.length} วัน` +
          (skipped ? ` · ข้ามซ้ำ ${skipped}` : "") +
          ` · ขาย ${formatVatMoney(parsed.monthGross)} · GP ${formatVatMoney(parsed.monthFeeInclVat)}` +
          warn,
      );
      setFilterChannel("lineman");
      setUploadChannel("lineman");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
      if (linemanRef.current) linemanRef.current.value = "";
    }
  }

  async function onImportShopeeInvoices(fileList: FileList | null) {
    if (!fileList?.length) return;
    setBusyId("shopee");
    setError("");
    setMsg("");
    try {
      const inputs = [];
      let targetMonth = month;
      for (const file of Array.from(fileList)) {
        const text = await extractPdfTextFromFile(file);
        if (!looksLikeShopeeTaxInvoice(text)) {
          throw new Error(`ไม่ใช่ใบกำกับ Shopee: ${file.name}`);
        }
        const parsed = parseShopeeTaxInvoice(text, file.name);
        if (!parsed.monthKey) {
          throw new Error(`อ่านเดือนไม่ได้: ${file.name}`);
        }
        targetMonth = parsed.monthKey;
        const up = await uploadVatImportFile({
          file,
          monthKey: parsed.monthKey,
          channel: "shopee",
        });
        const row = shopeeTaxInvoiceToImportRow(parsed, {
          storagePath: up.storagePath,
          downloadUrl: up.downloadUrl,
          fileName: up.fileName,
          contentType: up.contentType,
          contentHash: up.contentHash,
        });
        if (row) inputs.push(row);
      }
      if (targetMonth !== month) setMonth(targetMonth);
      const existing =
        targetMonth === month ? rows : await listVatImportRows(targetMonth);
      const { created, skipped } = await createVatImportRowsSkippingDupes(
        inputs,
        actor,
        existing,
      );
      if (targetMonth === month) {
        setRows((prev) =>
          [...prev, ...created].sort((a, b) =>
            a.dateKey.localeCompare(b.dateKey),
          ),
        );
      } else {
        setRows(
          [...existing, ...created].sort((a, b) =>
            a.dateKey.localeCompare(b.dateKey),
          ),
        );
      }
      setFilterChannel("shopee");
      setMsg(
        `Shopee ใบกำกับ · นำเข้า ${created.length}` +
          (skipped ? ` · ข้ามซ้ำ ${skipped}` : "") +
          ` · รวม VAT ${formatVatMoney(
            created.reduce((s, r) => s + r.gpVat, 0),
          )}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
      if (shopeeRef.current) shopeeRef.current.value = "";
    }
  }

  async function onImportGrabCsv(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setBusyId("grab");
    setError("");
    setMsg("");
    try {
      const text = await file.text();
      if (!looksLikeGrabTransactionCsv(text)) {
        throw new Error(
          "ไม่พบหัวตารางวันที่+ยอดใน CSV (รองรับ Transaction_Store / Gross+Commission+Net)",
        );
      }
      const parsed = parseGrabTransactionCsv(text);
      if (!parsed.monthKey || parsed.days.length === 0) {
        throw new Error(
          `อ่านแถววันไม่ได้${parsed.warnings.length ? ` · ${parsed.warnings.join(" · ")}` : ""}`,
        );
      }
      if (parsed.monthKey !== month) setMonth(parsed.monthKey);
      const existing =
        parsed.monthKey === month
          ? rows
          : await listVatImportRows(parsed.monthKey);
      const up = await uploadVatImportFile({
        file,
        monthKey: parsed.monthKey,
        channel: "grab",
      });
      const inputs = grabCsvToImportRows(parsed, {
        storagePath: up.storagePath,
        downloadUrl: up.downloadUrl,
        fileName: up.fileName,
        contentType: up.contentType,
        contentHash: up.contentHash,
      });

      const { created, skipped } = await createVatImportRowsSkippingDupes(
        inputs,
        actor,
        existing,
      );
      if (parsed.monthKey === month) {
        setRows((prev) =>
          [...prev, ...created].sort((a, b) =>
            a.dateKey.localeCompare(b.dateKey),
          ),
        );
      } else {
        setRows(
          [...existing, ...created].sort((a, b) =>
            a.dateKey.localeCompare(b.dateKey),
          ),
        );
      }
      setFilterChannel("grab");
      const g = created.reduce((s, r) => s + r.grossInclusive, 0);
      setMsg(
        `Grab CSV · ${created.length} วัน` +
          (skipped ? ` · ข้ามซ้ำ ${skipped}` : "") +
          ` · ขาย ${formatVatMoney(g)}` +
          (parsed.warnings.length
            ? ` · เตือน: ${parsed.warnings.join(" · ")}`
            : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
      if (grabRef.current) grabRef.current.value = "";
    }
  }

  async function onApplyToMonth() {
    const targets = selectedRows;
    if (targets.length === 0) {
      setError("ไม่มีแถว draft ที่จะใช้เข้าเดือน");
      return;
    }
    const prev = previewApplyVatImportRows(month, targets);
    const ok = window.confirm(
      `ใช้ ${prev.rowIds.length} แถวเข้าเดือน ${formatThaiMonthKey(month)}?\n` +
        `LM ขาย ${formatVatMoney(prev.byChannel.lineman.gross)} · ` +
        `Grab ${formatVatMoney(prev.byChannel.grab.gross)} · ` +
        `Shopee ${formatVatMoney(prev.byChannel.shopee.gross)}\n` +
        `ภาษีซื้อ GP เดลิเวอรี่ Σ ${formatVatMoney(prev.deliveryGpVat)}`,
    );
    if (!ok) return;
    setBusyId("apply");
    setError("");
    setMsg("");
    try {
      const result = await applyVatImportRowsToMonth({
        monthKey: month,
        rows: targets,
        actor,
      });
      await refresh();
      setSelected({});
      setMsg(
        `ใช้เข้าเดือนแล้ว ${result.appliedCount} แถว · GP VAT ${formatVatMoney(result.preview.deliveryGpVat)} · สลับแท็บ「เดือน」ตรวจยอด`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  function toggleSelectAllDraft(on: boolean) {
    if (!on) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const r of draftVisible) next[r.id] = true;
    setSelected(next);
  }

  async function attachToRow(row: VatImportRow, file: File | null) {
    if (!file) return;
    setBusyId(row.id);
    setError("");
    try {
      const up = await uploadVatImportFile({
        file,
        monthKey: month,
        channel: row.channel,
      });
      await saveRow(row, {
        storagePath: up.storagePath,
        downloadUrl: up.downloadUrl,
        fileName: up.fileName,
        contentType: up.contentType,
        contentHash: up.contentHash,
      });
      setMsg(`แนบไฟล์ ${up.fileName} แล้ว`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusyId("");
    }
  }

  async function onIngestInbox() {
    setBusyId("inbox");
    setError("");
    setMsg("");
    try {
      const result = await ingestNewVatImportFiles(month, actor);
      await refresh();
      const err =
        result.errors.length > 0
          ? ` · พัง ${result.errors.length}: ${result.errors.slice(0, 2).join(" · ")}`
          : "";
      setMsg(
        `ดึงไฟล์ใหม่ · สแกน ${result.scanned} · สร้าง ${result.created}` +
          (result.pending ? ` · ว่างรอแปลง ${result.pending}` : "") +
          (result.skipped ? ` · ข้ามซ้ำ ${result.skipped}` : "") +
          err,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="vat-import-workbench">
      <header className="vat-sales-header">
        <p className="vat-sales-lead">
          Storage inbox → ตารางวัน×ช่องทาง · แปลงเฉพาะช่องที่ชัวร์ · ว่างไว้ให้ AI/คนเติม ·
          แล้วใช้เข้าเดือน
        </p>
      </header>


      <div className="vat-top-bar">
        <div className="vat-sales-toolbar vat-sales-toolbar--slim">
          <label className="vat-sales-month">
            เดือน
            <select
              className="vat-thai-month-select"
              value={month}
              aria-label="เลือกเดือนนำเข้า"
              onChange={(e) => setMonth(e.target.value)}
            >
              {listThaiMonthOptions(month).map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="vat-sales-month">
            กรองช่องทาง
            <select
              className="vat-thai-month-select"
              value={filterChannel}
              onChange={(e) =>
                setFilterChannel(
                  e.target.value === "all"
                    ? "all"
                    : (e.target.value as VatImportChannel),
                )
              }
            >
              <option value="all">ทั้งหมด</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {VAT_IMPORT_CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          {busyId ? <span className="muted">…</span> : null}
        </div>
      </div>

      <p className="muted vat-sales-hint vat-hint-one-line">
        ติ๊กแถว draft (ไม่ติ๊ก = ใช้ทุก draft ที่มองเห็น) →{" "}
        <strong>ใช้เข้าเดือน</strong> · Σ ขาย/โอน/GP VAT เข้าแท็บเดือน
      </p>

      <div className="vat-month-actions vat-month-actions--mini">
        <button
          type="button"
          className="vat-mini-btn vat-mini-btn--primary"
          disabled={Boolean(busyId) || loading}
          onClick={() => void onIngestInbox()}
          title="สแกนไฟล์ใน Storage ของเดือนนี้ → ใส่ตาราง (ไม่ซ้ำ)"
        >
          {busyId === "inbox" ? "กำลังดึง…" : "ดึงไฟล์ใหม่"}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busyId)}
          onClick={() => linemanRef.current?.click()}
        >
          {busyId === "lineman" ? "…" : "LINE MAN รายงานเดือน"}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busyId)}
          onClick={() => grabRef.current?.click()}
        >
          {busyId === "grab" ? "…" : "Grab CSV"}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busyId)}
          onClick={() => shopeeRef.current?.click()}
        >
          {busyId === "shopee" ? "…" : "Shopee ใบกำกับ PDF"}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busyId) || applyPreview.rowIds.length === 0}
          onClick={() => void onApplyToMonth()}
        >
          {busyId === "apply"
            ? "กำลังใส่เดือน…"
            : `ใช้เข้าเดือน (${applyPreview.rowIds.length})`}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busyId)}
          onClick={() => fileRef.current?.click()}
        >
          อัปโหลดอื่น
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busyId)}
          onClick={() => void addBlankRow()}
        >
          + แถวว่าง
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busyId) || loading}
          onClick={() => void refresh()}
        >
          รีเฟรช
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.xlsx,.xls,.csv,image/*"
          multiple
          hidden
          onChange={(e) => void onUploadFiles(e.target.files)}
        />
        <input
          ref={linemanRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => void onImportLinemanMonthly(e.target.files)}
        />
        <input
          ref={shopeeRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => void onImportShopeeInvoices(e.target.files)}
        />
        <input
          ref={grabRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => void onImportGrabCsv(e.target.files)}
        />
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      <div className="vat-import-sum-strip" role="status">
        {CHANNELS.map((c) => (
          <span key={c} className="vat-import-sum-item">
            {VAT_IMPORT_CHANNEL_LABELS[c]}{" "}
            <strong>{sums[c].count}</strong>
            <span className="muted">
              {" "}
              ขาย {fmt(sums[c].gross)} · โอน {fmt(sums[c].netTransfer)} · GP{" "}
              {fmt(sums[c].gpVat)}
            </span>
          </span>
        ))}
      </div>

      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : (
        <div className="sheet-wrap vat-month-slim-wrap">
          <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-import-table">
            <thead>
              <tr>
                <th className="col-claim">
                  <input
                    type="checkbox"
                    className="vat-claim-check"
                    checked={
                      draftVisible.length > 0 &&
                      draftVisible.every((r) => selected[r.id])
                    }
                    disabled={draftVisible.length === 0}
                    onChange={(e) => toggleSelectAllDraft(e.target.checked)}
                    aria-label="เลือก draft ทั้งหมด"
                  />
                </th>
                <th className="col-date">วันที่</th>
                <th className="col-seg">ช่องทาง</th>
                <th className="col-seg">ชนิด</th>
                <th className="col-num">ยอดขาย</th>
                <th className="col-num">คชจ.</th>
                <th className="col-num">ยอดโอน</th>
                <th className="col-num">ภาษีซื้อ GP</th>
                <th className="col-seg">เลขที่ใบกำกับ</th>
                <th className="col-seg">ไฟล์</th>
                <th className="col-seg">สถานะ</th>
                <th className="col-act"> </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td className="col-seg" colSpan={12}>
                    ยังไม่มีแถว — ใช้ปุ่ม LINE MAN / Grab / Shopee หรือ + แถวว่าง
                  </td>
                </tr>
              ) : (
                visible.map((row) => {
                  const locked = row.status === "applied";
                  const dup = dedupeWarnings.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      className={dup ? "vat-import-row--dup" : undefined}
                    >
                      <td className="col-claim">
                        <input
                          type="checkbox"
                          className="vat-claim-check"
                          disabled={row.status !== "draft"}
                          checked={Boolean(selected[row.id])}
                          onChange={(e) =>
                            setSelected((prev) => ({
                              ...prev,
                              [row.id]: e.target.checked,
                            }))
                          }
                          aria-label={`เลือก ${row.dateKey}`}
                        />
                      </td>
                      <td className="col-date col-input">
                        <input
                          className="vat-sales-input"
                          type="date"
                          disabled={locked || busyId === row.id}
                          value={row.dateKey}
                          aria-label="วันที่"
                          onChange={(e) =>
                            void saveRow(row, { dateKey: e.target.value })
                          }
                        />
                      </td>
                      <td className="col-seg col-input">
                        <select
                          className="vat-inline-select"
                          disabled={locked || busyId === row.id}
                          value={row.channel}
                          onChange={(e) =>
                            void saveRow(row, {
                              channel: e.target.value as VatImportChannel,
                            })
                          }
                        >
                          {CHANNELS.map((c) => (
                            <option key={c} value={c}>
                              {VAT_IMPORT_CHANNEL_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="col-seg col-input">
                        <select
                          className="vat-inline-select"
                          disabled={locked || busyId === row.id}
                          value={row.rowKind}
                          onChange={(e) =>
                            void saveRow(row, {
                              rowKind: e.target.value as VatImportRowKind,
                            })
                          }
                        >
                          {(
                            Object.keys(VAT_IMPORT_KIND_LABELS) as VatImportRowKind[]
                          ).map((k) => (
                            <option key={k} value={k}>
                              {VAT_IMPORT_KIND_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="col-num col-input">
                        <MoneyInput
                          value={row.grossInclusive}
                          disabled={locked || busyId === row.id}
                          ariaLabel="ยอดขาย"
                          onCommit={(n) =>
                            void saveRow(row, { grossInclusive: n })
                          }
                        />
                      </td>
                      <td className="col-num col-input">
                        <MoneyInput
                          value={row.fee}
                          disabled={locked || busyId === row.id}
                          ariaLabel="คชจ."
                          onCommit={(n) => void saveRow(row, { fee: n })}
                        />
                      </td>
                      <td className="col-num col-input">
                        <MoneyInput
                          value={row.netTransfer}
                          disabled={locked || busyId === row.id}
                          ariaLabel="ยอดโอน"
                          onCommit={(n) =>
                            void saveRow(row, { netTransfer: n })
                          }
                        />
                      </td>
                      <td className="col-num col-input">
                        <MoneyInput
                          value={row.gpVat}
                          disabled={locked || busyId === row.id}
                          ariaLabel="ภาษีซื้อ GP"
                          onCommit={(n) => void saveRow(row, { gpVat: n })}
                        />
                      </td>
                      <td className="col-seg col-input">
                        <input
                          className="vat-sales-input"
                          disabled={locked || busyId === row.id}
                          value={row.invoiceNo}
                          aria-label="เลขที่ใบกำกับ"
                          placeholder="—"
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r) =>
                                r.id === row.id
                                  ? { ...r, invoiceNo: e.target.value }
                                  : r,
                              ),
                            )
                          }
                          onBlur={(e) =>
                            void saveRow(row, {
                              invoiceNo: e.target.value.trim(),
                            })
                          }
                        />
                      </td>
                      <td className="col-seg">
                        {row.downloadUrl ? (
                          <a
                            className="vat-import-file-link"
                            href={row.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {row.fileName || "เปิดไฟล์"}
                          </a>
                        ) : (
                          <label className="vat-mini-btn vat-import-attach">
                            แนบ
                            <input
                              type="file"
                              accept=".pdf,.xlsx,.xls,.csv,image/*"
                              hidden
                              disabled={locked || busyId === row.id}
                              onChange={(e) =>
                                void attachToRow(
                                  row,
                                  e.target.files?.[0] || null,
                                )
                              }
                            />
                          </label>
                        )}
                      </td>
                      <td className="col-seg col-input">
                        <select
                          className="vat-inline-select"
                          disabled={busyId === row.id || row.status === "applied"}
                          value={row.status}
                          onChange={(e) =>
                            void saveRow(row, {
                              status: e.target.value as VatImportRowStatus,
                            })
                          }
                        >
                          <option value="draft">draft</option>
                          <option value="skipped">ข้าม</option>
                          <option value="applied" disabled>
                            applied
                          </option>
                        </select>
                      </td>
                      <td className="col-act">
                        <button
                          type="button"
                          className="vat-mini-btn"
                          disabled={busyId === row.id || locked}
                          onClick={() => void removeRow(row)}
                        >
                          ลบ
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {dedupeWarnings.size > 0 ? (
        <p className="muted vat-sales-hint vat-hint-one-line">
          มีแถวที่คีย์ซ้ำ (ช่องทาง+เลขใบกำกับ หรือ วัน+ชนิด) — แถวไฮไลต์ · ตรวจก่อน
          apply เดือน
        </p>
      ) : null}
    </div>
  );
}
