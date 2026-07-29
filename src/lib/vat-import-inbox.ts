/**
 * Storage inbox → แถววัน×ช่องทาง (strict)
 * แปลงเฉพาะช่องที่ชัวร์ · ไม่ชัวร์ปล่อยว่าง (0 / "") รอ AI/คนเติม
 */
import {
  getDownloadURL,
  getMetadata,
  listAll,
  ref,
  type FullMetadata,
  type StorageReference,
} from "firebase/storage";
import { getFirebaseStorage } from "./firebase";
import { hashBytesSha256 } from "./vat-import-hash";
import {
  createVatImportRowsSkippingDupes,
  emptyVatImportRow,
  listVatImportRows,
  mapVatImportChannel,
  VAT_IMPORT_STORAGE_PREFIX,
  type VatImportChannel,
  type VatImportRow,
  type VatImportRowInput,
} from "./vat-import";
import {
  grabCsvToImportRows,
  looksLikeGrabTransactionCsv,
  parseGrabTransactionCsv,
} from "./vat-import-grab-csv";
import {
  linemanMonthlyToImportRows,
  looksLikeLinemanMonthlyReport,
  parseLinemanMonthlyReport,
} from "./vat-import-lineman-monthly";
import { extractPdfTextFromBytes } from "./vat-import-pdf-text";
import {
  looksLikeShopeeTaxInvoice,
  parseShopeeTaxInvoice,
  shopeeTaxInvoiceToImportRow,
} from "./vat-import-shopee-taxinvoice";
import { isMonthKey } from "./vat-sales";

export const INBOX_PENDING_ADAPTER_ID = "inbox-pending";

export type StorageInboxFile = {
  storagePath: string;
  name: string;
  channel: VatImportChannel;
  size: number | null;
  contentType: string | null;
  md5Hash: string | null;
  updated: string | null;
  downloadUrl: string;
};

export function channelFromStoragePath(storagePath: string): VatImportChannel {
  const parts = String(storagePath || "").split("/").filter(Boolean);
  const idx = parts.indexOf(VAT_IMPORT_STORAGE_PREFIX);
  // vat-imports / YYYY / MM / channel / file
  const channel = idx >= 0 ? parts[idx + 3] : "";
  return mapVatImportChannel(channel);
}


function looksLikeCsv(name: string, contentType: string | null): boolean {
  const n = name.toLowerCase();
  return n.endsWith(".csv") || (contentType ?? "").includes("csv");
}

function looksLikePdf(name: string, contentType: string | null): boolean {
  const n = name.toLowerCase();
  return n.endsWith(".pdf") || (contentType ?? "").includes("pdf");
}

async function collectItems(prefix: StorageReference): Promise<StorageReference[]> {
  const page = await listAll(prefix);
  const items = [...page.items];
  for (const p of page.prefixes) {
    items.push(...(await collectItems(p)));
  }
  return items;
}

/** รายการไฟล์ใต้ vat-imports/{YYYY}/{MM}/ */
export async function listVatImportStorageFiles(
  monthKey: string,
): Promise<StorageInboxFile[]> {
  if (!isMonthKey(monthKey)) return [];
  const [y, m] = monthKey.split("-");
  const root = ref(getFirebaseStorage(), `${VAT_IMPORT_STORAGE_PREFIX}/${y}/${m}`);
  let items: StorageReference[] = [];
  try {
    items = await collectItems(root);
  } catch {
    return [];
  }
  const out: StorageInboxFile[] = [];
  for (const item of items) {
    let meta: FullMetadata | null = null;
    try {
      meta = await getMetadata(item);
    } catch {
      meta = null;
    }
    out.push({
      storagePath: item.fullPath,
      name: item.name,
      channel: channelFromStoragePath(item.fullPath),
      size: meta?.size ?? null,
      contentType: meta?.contentType ?? null,
      md5Hash: meta?.md5Hash ?? null,
      updated: meta?.updated ?? null,
      downloadUrl: await getDownloadURL(item),
    });
  }
  out.sort((a, b) => a.storagePath.localeCompare(b.storagePath));
  return out;
}

/** ไฟล์นี้มีแถวในตารางแล้วหรือยัง (path / contentHash / md5) */
export function isStorageFileAlreadyInRows(
  file: Pick<StorageInboxFile, "storagePath" | "md5Hash"> & {
    contentHash?: string | null;
  },
  rows: VatImportRow[],
): boolean {
  if (file.storagePath && rows.some((r) => r.storagePath === file.storagePath)) {
    return true;
  }
  const hash = (file.contentHash || "").trim();
  if (hash && rows.some((r) => r.contentHash && r.contentHash === hash)) {
    return true;
  }
  if (
    file.md5Hash &&
    rows.some((r) => r.contentHash && r.contentHash === `md5:${file.md5Hash}`)
  ) {
    return true;
  }
  return false;
}

function fileMetaOpts(
  file: StorageInboxFile,
  contentHash: string,
): {
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  contentHash: string;
} {
  return {
    storagePath: file.storagePath,
    downloadUrl: file.downloadUrl,
    fileName: file.name,
    contentType: file.contentType || "",
    contentHash,
  };
}

/** แถวว่างติดไฟล์ — ช่องตัวเลขเป็น 0 / ข้อความว่าง รอเติม */
export function pendingInboxRow(
  monthKey: string,
  file: StorageInboxFile,
  contentHash: string,
  note: string,
): VatImportRowInput {
  return emptyVatImportRow(monthKey, {
    channel: file.channel,
    dateKey: `${monthKey}-01`,
    rowKind: "sales",
    grossInclusive: 0,
    fee: 0,
    netTransfer: 0,
    gpVat: 0,
    invoiceNo: "",
    invoiceDate: "",
    sellerTaxId: "",
    storagePath: file.storagePath,
    downloadUrl: file.downloadUrl,
    fileName: file.name,
    contentType: file.contentType || "",
    contentHash,
    adapterId: INBOX_PENDING_ADAPTER_ID,
    adapterVersion: "1",
    externalId: `inbox:${contentHash}`,
    status: "draft",
    note,
  });
}

export type StrictBuildResult = {
  mode: "parsed" | "pending";
  rows: VatImportRowInput[];
  notes: string;
};

/**
 * Strict convert: เฉพาะช่องที่ parse ได้แน่ · ไม่แน่ → แถวว่างติดไฟล์
 */
export async function buildStrictImportRowsFromStorageFile(
  file: StorageInboxFile,
  bytes: ArrayBuffer,
  monthKey: string,
): Promise<StrictBuildResult> {
  const contentHash = await hashBytesSha256(bytes);
  const meta = fileMetaOpts(file, contentHash);
  const channel = file.channel;
  const name = file.name;

  if (looksLikePdf(name, file.contentType)) {
    try {
      const text = await extractPdfTextFromBytes(bytes);

      if (
        (channel === "lineman" || /lineman|ไลน์แมน|รายงานยอดขายประจำเดือน/i.test(name)) &&
        looksLikeLinemanMonthlyReport(text)
      ) {
        const parsed = parseLinemanMonthlyReport(text);
        if (parsed.monthKey === monthKey && parsed.days.length > 0) {
          const rows = linemanMonthlyToImportRows(parsed, meta);
          return {
            mode: "parsed",
            rows,
            notes:
              parsed.warnings.join(" · ") ||
              `LINE MAN · ${parsed.days.length} วัน`,
          };
        }
        return {
          mode: "pending",
          rows: [
            pendingInboxRow(
              monthKey,
              file,
              contentHash,
              parsed.monthKey && parsed.monthKey !== monthKey
                ? `รอตรวจ — รายงานเป็นเดือน ${parsed.monthKey} ไม่ตรง inbox ${monthKey}`
                : "รอแปลง LINE MAN — อ่านแถววันไม่ได้",
            ),
          ],
          notes: "lineman pending",
        };
      }

      if (
        (channel === "shopee" || /shopee|trspespf|ใบกำกับ/i.test(name)) &&
        looksLikeShopeeTaxInvoice(text)
      ) {
        const parsed = parseShopeeTaxInvoice(text, name);
        if (parsed.monthKey === monthKey && parsed.dateKey) {
          const row = shopeeTaxInvoiceToImportRow(parsed, meta);
          if (row) {
            return {
              mode: "parsed",
              rows: [{ ...row, contentHash }],
              notes: parsed.warnings.join(" · ") || "Shopee ใบกำกับ",
            };
          }
        }
        return {
          mode: "pending",
          rows: [
            pendingInboxRow(
              monthKey,
              file,
              contentHash,
              "รอแปลง Shopee — อ่านวันที่/เลขที่ไม่ได้หรือเดือนไม่ตรง",
            ),
          ],
          notes: "shopee pending",
        };
      }
    } catch {
      /* fall through → pending */
    }
  }

  if (
    looksLikeCsv(name, file.contentType) &&
    (channel === "grab" || /grab|transaction/i.test(name))
  ) {
    try {
      const text = new TextDecoder("utf-8").decode(bytes);
      if (looksLikeGrabTransactionCsv(text)) {
        const parsed = parseGrabTransactionCsv(text);
        if (parsed.monthKey === monthKey && parsed.days.length > 0) {
          const rows = grabCsvToImportRows(parsed, meta).map((r) => ({
            ...r,
            contentHash,
          }));
          return {
            mode: "parsed",
            rows,
            notes:
              parsed.warnings.join(" · ") || `Grab CSV · ${parsed.days.length} วัน`,
          };
        }
        return {
          mode: "pending",
          rows: [
            pendingInboxRow(
              monthKey,
              file,
              contentHash,
              parsed.monthKey && parsed.monthKey !== monthKey
                ? `รอตรวจ — CSV เป็นเดือน ${parsed.monthKey} ไม่ตรง inbox ${monthKey}`
                : "รอแปลง Grab — อ่านแถววันไม่ได้",
            ),
          ],
          notes: "grab pending",
        };
      }
    } catch {
      /* fall through */
    }
  }

  return {
    mode: "pending",
    rows: [
      pendingInboxRow(
        monthKey,
        file,
        contentHash,
        "รอแปลง — เก็บในตารางแล้ว ช่องที่ไม่ชัวร์ปล่อยว่าง (AI/คนเติมทีหลัง)",
      ),
    ],
    notes: "inbox-pending",
  };
}

export type IngestNewFilesResult = {
  scanned: number;
  created: number;
  skipped: number;
  pending: number;
  errors: string[];
};

/** สแกน Storage inbox ของเดือน → สร้างแถวใหม่ (ข้ามซ้ำ) */
export async function ingestNewVatImportFiles(
  monthKey: string,
  actor: string,
): Promise<IngestNewFilesResult> {
  const files = await listVatImportStorageFiles(monthKey);
  const existing = await listVatImportRows(monthKey);
  let created = 0;
  let skipped = 0;
  let pending = 0;
  const errors: string[] = [];

  for (const file of files) {
    if (isStorageFileAlreadyInRows(file, existing)) {
      skipped += 1;
      continue;
    }
    try {
      const res = await fetch(file.downloadUrl);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const bytes = await res.arrayBuffer();
      const contentHash = await hashBytesSha256(bytes);
      if (isStorageFileAlreadyInRows({ ...file, contentHash }, existing)) {
        skipped += 1;
        continue;
      }
      const built = await buildStrictImportRowsFromStorageFile(
        file,
        bytes,
        monthKey,
      );
      const { created: newRows, skipped: skipDup } =
        await createVatImportRowsSkippingDupes(built.rows, actor, existing);
      created += newRows.length;
      skipped += skipDup;
      if (built.mode === "pending") pending += newRows.length;
      existing.push(...newRows);
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { scanned: files.length, created, skipped, pending, errors };
}
