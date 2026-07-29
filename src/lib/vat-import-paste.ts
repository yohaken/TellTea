/**
 * วางข้อความสั้น → เติมแถววัน×ช่องทาง (สำหรับคน / local AI)
 * รูปแบบบรรทัด (คั่นด้วยช่องว่างหรือแท็บ):
 *   YYYY-MM-DD ช่องทาง ขาย [คชจ.] [โอน] [GPVAT] [เลขที่]
 * ช่องทาง: SF|GB|LM|shopee|grab|lineman
 */
import {
  isDateKey,
  mapVatImportChannel,
  monthKeyFromDateKey,
  type VatImportChannel,
  type VatImportRowInput,
} from "./vat-import";

const CHANNEL_ALIAS: Record<string, VatImportChannel> = {
  sf: "shopee",
  shopee: "shopee",
  shopeefood: "shopee",
  gb: "grab",
  grab: "grab",
  lm: "lineman",
  lineman: "lineman",
  "line-man": "lineman",
};

function parseChannel(raw: string): VatImportChannel | null {
  const k = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (CHANNEL_ALIAS[k]) return CHANNEL_ALIAS[k]!;
  const mapped = mapVatImportChannel(k);
  if (k === "shopee" || k === "grab" || k === "lineman") return mapped;
  return null;
}

function parseNum(raw: string): number | null {
  const t = String(raw || "")
    .trim()
    .replace(/,/g, "")
    .replace(/฿/g, "");
  if (!t || t === "-" || t === "—") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type PasteFillLine = {
  dateKey: string;
  channel: VatImportChannel;
  grossInclusive: number | null;
  fee: number | null;
  netTransfer: number | null;
  gpVat: number | null;
  invoiceNo: string;
  raw: string;
  ok: boolean;
  error?: string;
};

export type PasteFillResult = {
  lines: PasteFillLine[];
  inputs: VatImportRowInput[];
  skipped: number;
  errors: string[];
};

/** แปลงข้อความหลายบรรทัด → แถวนำเข้า (เฉพาะที่ parse ได้) */
export function parseVatImportPasteText(
  text: string,
  monthKey: string,
): PasteFillResult {
  const lines: PasteFillLine[] = [];
  const inputs: VatImportRowInput[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      if (line) skipped += 1;
      continue;
    }
    const parts = line.split(/[\t,;]+|\s+/).filter(Boolean);
    if (parts.length < 3) {
      lines.push({
        dateKey: "",
        channel: "grab",
        grossInclusive: null,
        fee: null,
        netTransfer: null,
        gpVat: null,
        invoiceNo: "",
        raw: line,
        ok: false,
        error: "ต้องการอย่างน้อย: วัน ช่องทาง ขาย",
      });
      errors.push(`${line.slice(0, 40)}…`);
      continue;
    }

    let dateKey = parts[0]!;
    // รองรับ 29/07/2026 หรือ 2026-07-29
    const dmy = dateKey.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (dmy) {
      dateKey = `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
    }
    if (!isDateKey(dateKey)) {
      lines.push({
        dateKey: "",
        channel: "grab",
        grossInclusive: null,
        fee: null,
        netTransfer: null,
        gpVat: null,
        invoiceNo: "",
        raw: line,
        ok: false,
        error: "วันที่ไม่ถูกต้อง",
      });
      errors.push(`วันไม่ถูก: ${parts[0]}`);
      continue;
    }
    if (monthKeyFromDateKey(dateKey) !== monthKey) {
      lines.push({
        dateKey,
        channel: "grab",
        grossInclusive: null,
        fee: null,
        netTransfer: null,
        gpVat: null,
        invoiceNo: "",
        raw: line,
        ok: false,
        error: `วันนอกเดือน ${monthKey}`,
      });
      errors.push(`${dateKey} นอกเดือน`);
      continue;
    }

    const channel = parseChannel(parts[1]!);
    if (!channel || channel === "storefront") {
      lines.push({
        dateKey,
        channel: "grab",
        grossInclusive: null,
        fee: null,
        netTransfer: null,
        gpVat: null,
        invoiceNo: "",
        raw: line,
        ok: false,
        error: "ช่องทางต้องเป็น SF/GB/LM",
      });
      errors.push(`ช่องทาง: ${parts[1]}`);
      continue;
    }

    const grossInclusive = parseNum(parts[2]!);
    const fee = parts[3] != null ? parseNum(parts[3]!) : null;
    const netTransfer = parts[4] != null ? parseNum(parts[4]!) : null;
    const gpVat = parts[5] != null ? parseNum(parts[5]!) : null;
    const invoiceNo = parts[6] ? String(parts[6]).trim() : "";

    const parsed: PasteFillLine = {
      dateKey,
      channel,
      grossInclusive,
      fee,
      netTransfer,
      gpVat,
      invoiceNo,
      raw: line,
      ok: true,
    };
    lines.push(parsed);
    inputs.push({
      monthKey,
      dateKey,
      channel,
      rowKind: "sales",
      grossInclusive: grossInclusive ?? 0,
      fee: fee ?? 0,
      netTransfer: netTransfer ?? 0,
      gpVat: gpVat ?? 0,
      invoiceNo,
      invoiceDate: invoiceNo ? dateKey : "",
      sellerTaxId: "",
      storagePath: "",
      downloadUrl: "",
      fileName: "",
      contentType: "",
      contentHash: "",
      adapterId: "paste-text",
      adapterVersion: "1",
      externalId: `slot:${channel}:${dateKey}`,
      status: "draft",
      note: "วางข้อความ",
      appliedAt: null,
      appliedToMonth: "",
    });
  }

  return { lines, inputs, skipped, errors };
}
