"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  mergeVatImportIntoMonth,
  previewApplyVatImportRows,
} from "@/lib/vat-import-apply";
import {
  computeImportFillStats,
  formatFillPct,
} from "@/lib/vat-import-fill";
import { verifyVatImportRows } from "@/lib/vat-import-verify";

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
  vatImportDedupeKey,
  type VatImportChannel,
  type VatImportRow,
} from "@/lib/vat-import";

import { VatImportAiScratchpad } from "@/components/vat-sales/VatImportAiScratchpad";
import {
  VAT_IMPORT_AI_RULES,
  VAT_IMPORT_CHANNEL_GUIDE,
  VAT_IMPORT_COLUMN_GUIDE,
  VAT_IMPORT_VISIBLE_COLUMN_IDS,
  VAT_IMPORT_WORKFLOW_NOTES,
  columnTitleAttr,
} from "@/lib/vat-import-guide";



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
import { parseVatImportPasteText } from "@/lib/vat-import-paste";
import {
  ensureVatImportMonthScaffold,
  upsertVatImportSalesIntoSlots,
} from "@/lib/vat-import-scaffold";
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

const CHANNEL_SHORT: Record<VatImportChannel, string> = {
  shopee: "SF",
  grab: "GB",
  lineman: "LM",
  storefront: "หน้าร้าน",
};


type Props = { actor: string };

/** ช่องทางในตารางนำเข้า — ไม่มีหน้าร้าน */
const CHANNELS = ["shopee", "grab", "lineman"] as const;


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
  const [filterFill, setFilterFill] = useState<"all" | "empty" | "filled">(
    "all",
  );
  const [uploadChannel, setUploadChannel] =
    useState<VatImportChannel>("grab");
  const fileRef = useRef<HTMLInputElement>(null);
  const linemanRef = useRef<HTMLInputElement>(null);
  const shopeeRef = useRef<HTMLInputElement>(null);
  const grabRef = useRef<HTMLInputElement>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const visible = useMemo(() => {
    // หน้าร้านไม่อยู่ในตารางนำเข้า (แม้มีแถวเก่าค้าง)
    let base = rows.filter((r) => r.channel !== "storefront");
    if (filterChannel !== "all") {
      base = base.filter((r) => r.channel === filterChannel);
    }
    if (filterFill === "empty") {
      base = base.filter(
        (r) => !r.grossInclusive && !r.fee && !r.netTransfer && !r.gpVat,
      );
    } else if (filterFill === "filled") {
      base = base.filter(
        (r) => r.grossInclusive || r.fee || r.netTransfer || r.gpVat,
      );
    }
    return base;
  }, [rows, filterChannel, filterFill]);



  const applyPreview = useMemo(
    () =>
      previewApplyVatImportRows(
        month,
        rows.filter((r) => r.status !== "skipped"),
      ),
    [month, rows],
  );

  const sums = useMemo(() => sumVatImportDraftByChannel(rows), [rows]);

  const fillStats = useMemo(
    () => computeImportFillStats(month, rows),
    [month, rows],
  );

  const verifyReport = useMemo(() => verifyVatImportRows(rows), [rows]);

  const scheduleMergeToMonth = useCallback(
    (list: VatImportRow[], silent = true) => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        void (async () => {
          try {
            const draftish = list.filter((r) => r.status !== "skipped");
            const result = await mergeVatImportIntoMonth({
              monthKey: month,
              rows: draftish,
              actor,
              markApplied: false,
            });
            if (result.skipped) {
              if (!silent && result.reason) setSyncNote(result.reason);
              return;
            }
            setSyncNote(
              `ผสานเข้าเดือนอัตโนมัติ · โอน SF ${formatVatMoney(result.preview.byChannel.shopee.netTransfer)} · GB ${formatVatMoney(result.preview.byChannel.grab.netTransfer)} · LM ${formatVatMoney(result.preview.byChannel.lineman.netTransfer)} · ขาย SF ${formatVatMoney(result.preview.byChannel.shopee.gross)} · GB ${formatVatMoney(result.preview.byChannel.grab.gross)} · LM ${formatVatMoney(result.preview.byChannel.lineman.gross)}`,
            );
          } catch (e) {
            if (!silent) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }
        })();
      }, 700);
    },
    [actor, month],
  );

  useEffect(() => {
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, []);


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

  async function onScaffoldMonth() {
    setBusyId("scaffold");
    setError("");
    setMsg("");
    try {
      const existing = [...rows];
      const result = await ensureVatImportMonthScaffold(month, actor, existing);
      await refresh();
      setMsg(
        `สร้างตาราง ${formatThaiMonthKey(month)} · SF/GB/LM ${result.planned} ช่อง · ใหม่ ${result.created}` +
          (result.skipped ? ` · มีแล้วข้าม ${result.skipped}` : "") +
          " · ไม่รวมหน้าร้าน (ยอดจริงแท็บเดือน)",
      );

      setGuideOpen(true);
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
      setRows((prev) => {
        const next = prev
          .map((r) => (r.id === row.id ? saved : r))
          .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
        scheduleMergeToMonth(next);
        return next;
      });
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

      const { created, updated, skipped } = await upsertVatImportSalesIntoSlots(
        inputs,
        actor,
        existing,
      );
      const filled = created.length + updated.length;
      const nextLm = [...existing].sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey),
      );
      setRows(nextLm);
      scheduleMergeToMonth(nextLm);
      const warn =
        parsed.warnings.length > 0
          ? ` · เตือน: ${parsed.warnings.join(" · ")}`
          : "";
      setMsg(
        `LINE MAN ${formatThaiMonthKey(targetMonth)} · เติม ${filled} วัน` +
          (updated.length ? ` (อัปเดตช่องว่าง ${updated.length})` : "") +
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
      const nextSp = [...existing, ...created].sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey),
      );
      setRows(nextSp);
      scheduleMergeToMonth(nextSp);
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

      const { created, updated, skipped } = await upsertVatImportSalesIntoSlots(
        inputs,
        actor,
        existing,
      );
      const filledRows = [...created, ...updated];
      const nextGb = [...existing].sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey),
      );
      setRows(nextGb);
      scheduleMergeToMonth(nextGb);
      setFilterChannel("grab");
      const g = filledRows.reduce((s, r) => s + r.grossInclusive, 0);
      setMsg(
        `Grab CSV · เติม ${filledRows.length} วัน` +
          (updated.length ? ` (อัปเดตช่องว่าง ${updated.length})` : "") +
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

  async function onForceSyncMonth() {
    setBusyId("apply");
    setError("");
    setMsg("");
    try {
      const draftish = rows.filter((r) => r.status !== "skipped");
      const result = await mergeVatImportIntoMonth({
        monthKey: month,
        rows: draftish,
        actor,
        markApplied: false,
      });
      if (result.skipped) {
        setMsg(result.reason || "ยังไม่ผสาน");
      } else {
        setSyncNote(
          `ผสานเข้าเดือน · SF ${formatVatMoney(result.preview.byChannel.shopee.gross)} · GB ${formatVatMoney(result.preview.byChannel.grab.gross)} · LM ${formatVatMoney(result.preview.byChannel.lineman.gross)}`,
        );
        setMsg("ผสานเข้าแท็บเดือนแล้ว (แก้แถวต่อได้ · ซิงก์อัตโนมัติ)");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  async function onPasteFill() {
    setBusyId("paste");
    setError("");
    setMsg("");
    try {
      const parsed = parseVatImportPasteText(pasteText, month);
      if (parsed.inputs.length === 0) {
        throw new Error(
          parsed.errors[0]
            ? `วางแล้วอ่านไม่ได้ · ${parsed.errors[0]}`
            : "ไม่มีบรรทัดที่แปลงได้ — รูปแบบ: วัน ช่องทาง ขาย [คชจ.] [โอน] [GP≠] [เลขที่]",
        );
      }
      const existing = [...rows];
      const { created, updated, skipped } = await upsertVatImportSalesIntoSlots(
        parsed.inputs,
        actor,
        existing,
      );
      const next = [...existing].sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey),
      );
      setRows(next);
      scheduleMergeToMonth(next);
      setPasteText("");
      setMsg(
        `วางข้อความ · เติม ${created.length + updated.length} แถว` +
          (updated.length ? ` (อัปเดต ${updated.length})` : "") +
          (skipped ? ` · ข้าม ${skipped}` : "") +
          (parsed.errors.length
            ? ` · อ่านไม่ได้ ${parsed.errors.length}`
            : "") +
          " · ผสานเดือนอัตโนมัติ",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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
          กรอก/วาง → ผสานเดือนอัตโนมัติ (GP + ภาษีซื้อ) · ไม่รวมหน้าร้าน
        </p>
      </header>

      <div className="vat-import-fill-strip" role="status">
        <span>
          ครบรวม <strong>{formatFillPct(fillStats.overallPct)}</strong>
        </span>
        <span className="muted">
          SF {formatFillPct(fillStats.byChannel.shopee.pct)} (
          {fillStats.byChannel.shopee.daysFilled}/{fillStats.daysInMonth})
        </span>
        <span className="muted">
          GB {formatFillPct(fillStats.byChannel.grab.pct)} (
          {fillStats.byChannel.grab.daysFilled}/{fillStats.daysInMonth})
        </span>
        <span className="muted">
          LM {formatFillPct(fillStats.byChannel.lineman.pct)} (
          {fillStats.byChannel.lineman.daysFilled}/{fillStats.daysInMonth})
        </span>
      </div>

      <VatImportAiScratchpad actor={actor} />

      <details
        className="vat-import-guide"
        open={guideOpen}
        onToggle={(e) => setGuideOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>คำแนะนำ / กฎ AI (หุบไว้)</summary>
        <section className="vat-import-guide-ai" aria-label="กฎสำหรับ AI">
          <h3 className="vat-import-guide-h">กฎสำหรับ local AI</h3>
          <ol className="vat-import-guide-steps">
            {VAT_IMPORT_AI_RULES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ol>
        </section>
        <h3 className="vat-import-guide-h">ขั้นตอน</h3>
        <ol className="vat-import-guide-steps">
          {VAT_IMPORT_WORKFLOW_NOTES.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ol>
        <div className="vat-import-guide-grid">
          <section>
            <h3 className="vat-import-guide-h">คอลัมน์</h3>
            <table className="vat-import-guide-table">
              <thead>
                <tr>
                  <th>ช่อง</th>
                  <th>หาจาก</th>
                  <th>ใส่</th>
                </tr>
              </thead>
              <tbody>
                {VAT_IMPORT_COLUMN_GUIDE.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.short}</strong> {c.label}
                    </td>
                    <td>{c.find}</td>
                    <td>{c.put}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h3 className="vat-import-guide-h">ช่องทาง</h3>
            <table className="vat-import-guide-table">
              <thead>
                <tr>
                  <th>ช่อง</th>
                  <th>แหล่งไฟล์</th>
                  <th>วิธีเติม</th>
                </tr>
              </thead>
              <tbody>
                {VAT_IMPORT_CHANNEL_GUIDE.map((g) => (
                  <tr key={g.channel}>
                    <td>
                      <strong>{g.short}</strong> {g.label}
                    </td>
                    <td>{g.source}</td>
                    <td>
                      {g.how}
                      <span className="muted"> · ได้: {g.fills}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </details>


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
            ช่องทาง
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
          <label className="vat-sales-month">
            สถานะช่อง
            <select
              className="vat-thai-month-select"
              value={filterFill}
              onChange={(e) =>
                setFilterFill(e.target.value as "all" | "empty" | "filled")
              }
            >
              <option value="all">ทุกแถว</option>
              <option value="empty">ว่าง</option>
              <option value="filled">มียอด</option>
            </select>
          </label>
          {busyId ? <span className="muted">…</span> : null}
        </div>
      </div>

      <div className="vat-month-actions vat-month-actions--mini">
        <button
          type="button"
          className="vat-mini-btn vat-mini-btn--primary"
          disabled={Boolean(busyId) || loading}
          onClick={() => void onScaffoldMonth()}
          title="สร้างแถวว่างวัน×SF/GB/LM — ไม่ซ้ำถ้ามีแล้ว"
        >
          {busyId === "scaffold" ? "กำลังสร้าง…" : "สร้างตารางเดือน"}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busyId)}
          onClick={() => setPasteOpen((v) => !v)}
        >
          วางข้อความ
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busyId) || applyPreview.rowIds.length === 0}
          onClick={() => void onForceSyncMonth()}
          title="บังคับผสานเข้าแท็บเดือนทันที (ปกติซิงก์อัตโนมัติหลังแก้)"
        >
          {busyId === "apply" ? "กำลังผสาน…" : "ซิงก์เดือน"}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busyId) || loading}
          onClick={() => void refresh()}
        >
          รีเฟรช
        </button>
      </div>

      {pasteOpen ? (
        <div className="vat-import-paste" data-ai-context="vat-import-paste">
          <p className="muted vat-import-paste-hint">
            วางทีละบรรทัด · กระชับ:{" "}
            <code>YYYY-MM-DD SF|GB|LM ขาย [คชจ.] [โอน] [GP≠] [เลขที่]</code>
          </p>
          <textarea
            className="vat-import-paste-input"
            rows={4}
            value={pasteText}
            spellCheck={false}
            placeholder={"2026-07-01 GB 1200 84 1116\n2026-07-01 LM 800 56 744"}
            onChange={(e) => setPasteText(e.target.value)}
            aria-label="วางข้อความเติมแถว"
          />
          <button
            type="button"
            className="vat-mini-btn vat-mini-btn--primary"
            disabled={Boolean(busyId) || !pasteText.trim()}
            onClick={() => void onPasteFill()}
          >
            {busyId === "paste" ? "…" : "เติมลงตาราง"}
          </button>
        </div>
      ) : null}

      <details className="vat-import-file-alt">
        <summary>ทางเลือก: ดึงจากไฟล์ (ไม่บังคับ)</summary>
        <div className="vat-month-actions vat-month-actions--mini">
          <button
            type="button"
            className="vat-mini-btn"
            disabled={Boolean(busyId) || loading}
            onClick={() => void onIngestInbox()}
          >
            {busyId === "inbox" ? "กำลังดึง…" : "ดึงไฟล์ใหม่"}
          </button>
          <button
            type="button"
            className="vat-mini-btn"
            disabled={Boolean(busyId)}
            onClick={() => linemanRef.current?.click()}
          >
            {busyId === "lineman" ? "…" : "LINE MAN PDF"}
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
            {busyId === "shopee" ? "…" : "Shopee ใบกำกับ"}
          </button>
          <button
            type="button"
            className="vat-mini-btn"
            disabled={Boolean(busyId)}
            onClick={() => fileRef.current?.click()}
          >
            อัปโหลดอื่น
          </button>
        </div>
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
      </details>

      <p className="muted vat-sales-hint vat-hint-one-line">
        แก้แล้วซิงก์เดือน · มี verify ก่อนปิดงบ
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}
      {syncNote ? <p className="muted vat-sales-msg">{syncNote}</p> : null}
      {verifyReport.issues.length > 0 ? (
        <p className="vat-import-verify" role="status">
          {verifyReport.summary}
          {verifyReport.issues.slice(0, 3).map((i) => (
            <span key={`${i.rowId}-${i.code}`} className="vat-import-verify-item">
              {" "}
              · {i.dateKey} {CHANNEL_SHORT[i.channel as VatImportChannel] || i.channel}:{" "}
              {i.message}
            </span>
          ))}
          {verifyReport.issues.length > 3
            ? ` · +${verifyReport.issues.length - 3}`
            : ""}
        </p>
      ) : null}

      <div className="vat-import-sum-strip" role="status">
        {CHANNELS.map((c) => {
          const st = fillStats.byChannel[c];
          return (
            <span key={c} className="vat-import-sum-item">
              {VAT_IMPORT_CHANNEL_LABELS[c]}{" "}
              <strong>{formatFillPct(st.pct)}</strong>
              <span className="muted">
                {" "}
                {st.daysFilled}/{fillStats.daysInMonth} วัน · ขาย{" "}
                {fmt(sums[c].gross)} · โอน {fmt(sums[c].netTransfer)} · GP{" "}
                {fmt(sums[c].gpVat)}
              </span>
            </span>
          );
        })}
      </div>

      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : (
        <div className="sheet-wrap vat-month-slim-wrap vat-import-table-wrap">
          <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-import-table vat-import-table--compact">
            <thead>
              <tr>
                {VAT_IMPORT_VISIBLE_COLUMN_IDS.map((id) => {
                  const c = VAT_IMPORT_COLUMN_GUIDE.find((x) => x.id === id)!;
                  return (
                    <th
                      key={c.id}
                      className={
                        c.id === "dateKey"
                          ? "col-date"
                          : c.id === "grossInclusive" ||
                              c.id === "fee" ||
                              c.id === "netTransfer" ||
                              c.id === "gpVat"
                            ? "col-num"
                            : "col-seg"
                      }
                      title={columnTitleAttr(c)}
                    >
                      {c.short}
                    </th>
                  );
                })}
                <th
                  className="col-claim"
                  title="ติ๊ก = ไม่นำยอดแถวนี้เข้างบ (อื่นๆ ผสานอัตโนมัติ)"
                >
                  ข้าม
                </th>
                <th
                  className="col-inv-cloak"
                  title={columnTitleAttr(
                    VAT_IMPORT_COLUMN_GUIDE.find((c) => c.id === "invoiceNo")!,
                  )}
                >
                  #
                </th>
                <th className="col-act"> </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td className="col-seg" colSpan={9}>
                    ยังไม่มีแถว — กด「สร้างตารางเดือน」แล้วกรอกหรือวางข้อความ
                  </td>
                </tr>
              ) : (
                visible.map((row) => {
                  const skipped = row.status === "skipped";
                  const dup = dedupeWarnings.has(row.id);
                  const emptySlot =
                    !row.grossInclusive &&
                    !row.fee &&
                    !row.netTransfer &&
                    !row.gpVat &&
                    !row.invoiceNo;
                  return (
                    <tr
                      key={row.id}
                      className={[
                        dup ? "vat-import-row--dup" : "",
                        emptySlot ? "vat-import-row--empty" : "",
                        skipped ? "vat-import-row--skipped" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined}
                      title={row.note || undefined}
                    >
                      <td className="col-date col-input">
                        <input
                          className="vat-sales-input"
                          type="date"
                          disabled={busyId === row.id}
                          value={row.dateKey}
                          aria-label="วันที่"
                          onChange={(e) =>
                            void saveRow(row, {
                              dateKey: e.target.value,
                              status: skipped ? "skipped" : "draft",
                            })
                          }
                        />
                      </td>
                      <td
                        className="col-seg vat-import-channel-fixed"
                        title={VAT_IMPORT_CHANNEL_LABELS[row.channel]}
                      >
                        {CHANNEL_SHORT[row.channel]}
                      </td>
                      <td className="col-num col-input">
                        <MoneyInput
                          value={row.grossInclusive}
                          disabled={busyId === row.id}
                          ariaLabel="ยอดขาย"
                          onCommit={(n) =>
                            void saveRow(row, {
                              grossInclusive: n,
                              status: skipped ? "skipped" : "draft",
                            })
                          }
                        />
                      </td>
                      <td className="col-num col-input">
                        <MoneyInput
                          value={row.fee}
                          disabled={busyId === row.id}
                          ariaLabel="คชจ."
                          onCommit={(n) =>
                            void saveRow(row, {
                              fee: n,
                              status: skipped ? "skipped" : "draft",
                            })
                          }
                        />
                      </td>
                      <td className="col-num col-input">
                        <MoneyInput
                          value={row.netTransfer}
                          disabled={busyId === row.id}
                          ariaLabel="ยอดโอน"
                          onCommit={(n) =>
                            void saveRow(row, {
                              netTransfer: n,
                              status: skipped ? "skipped" : "draft",
                            })
                          }
                        />
                      </td>
                      <td className="col-num col-input">
                        <MoneyInput
                          value={row.gpVat}
                          disabled={busyId === row.id}
                          ariaLabel="ภาษีซื้อ GP"
                          onCommit={(n) =>
                            void saveRow(row, {
                              gpVat: n,
                              status: skipped ? "skipped" : "draft",
                            })
                          }
                        />
                      </td>
                      <td className="col-claim">
                        <input
                          type="checkbox"
                          className="vat-claim-check"
                          disabled={busyId === row.id}
                          checked={skipped}
                          onChange={(e) =>
                            void saveRow(row, {
                              status: e.target.checked ? "skipped" : "draft",
                              appliedAt: null,
                              appliedToMonth: "",
                            })
                          }
                          aria-label={`ข้าม ${row.dateKey}`}
                          title="ติ๊ก = ไม่เข้างบ"
                        />
                      </td>
                      <td className="col-inv-cloak col-input">
                        <input
                          className="vat-sales-input vat-import-inv-cloak"
                          disabled={busyId === row.id}
                          value={row.invoiceNo}
                          aria-label="เลขที่ใบกำกับ"
                          title={row.invoiceNo || "เลขที่ใบกำกับ (ซ่อน)"}
                          placeholder=""
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
                              status: skipped ? "skipped" : "draft",
                            })
                          }
                        />
                      </td>
                      <td className="col-act">
                        <button
                          type="button"
                          className="vat-mini-btn"
                          disabled={busyId === row.id}
                          onClick={() => void removeRow(row)}
                          title="ลบแถว"
                        >
                          ×
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
          มีแถวคีย์ซ้ำ — แถวไฮไลต์
        </p>
      ) : null}
    </div>
  );
}
