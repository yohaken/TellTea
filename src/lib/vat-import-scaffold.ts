/**
 * สร้างตารางนำเข้ารอทั้งเดือน — วัน × ช่องทาง (แถวขายว่าง)
 * อะแดปเตอร์/คน/AI เติมทีหลัง · กันซ้ำด้วย slot key
 */

import { daysInMonthKey } from "./categories";
import {
  createVatImportRow,
  emptyVatImportRow,
  updateVatImportRow,
  type VatImportChannel,
  type VatImportRow,
  type VatImportRowInput,
} from "./vat-import";
import { isMonthKey } from "./vat-sales";

export const MONTH_SCAFFOLD_ADAPTER_ID = "month-scaffold";

/** ช่องทางที่สร้างโครงตารางเดือน */
export const VAT_IMPORT_SCAFFOLD_CHANNELS: VatImportChannel[] = [
  "shopee",
  "grab",
  "lineman",
  "storefront",
];

export function padDay(day: number): string {
  return String(day).padStart(2, "0");
}

export function scaffoldSlotExternalId(
  channel: VatImportChannel,
  dateKey: string,
): string {
  return `slot:${channel}:${dateKey}`;
}

export function salesSlotKey(channel: VatImportChannel, dateKey: string): string {
  return `${channel}|${dateKey}|sales`;
}

export function listMonthDateKeys(monthKey: string): string[] {
  if (!isMonthKey(monthKey)) return [];
  const n = daysInMonthKey(monthKey);
  const out: string[] = [];
  for (let d = 1; d <= n; d++) out.push(`${monthKey}-${padDay(d)}`);
  return out;
}

/** แผนแถวว่างทั้งเดือน (ยังไม่เขียน DB) */
export function planMonthScaffoldRows(monthKey: string): VatImportRowInput[] {
  if (!isMonthKey(monthKey)) return [];
  const rows: VatImportRowInput[] = [];
  for (const dateKey of listMonthDateKeys(monthKey)) {
    for (const channel of VAT_IMPORT_SCAFFOLD_CHANNELS) {
      rows.push(
        emptyVatImportRow(monthKey, {
          dateKey,
          channel,
          rowKind: "sales",
          grossInclusive: 0,
          fee: 0,
          netTransfer: 0,
          gpVat: 0,
          adapterId: MONTH_SCAFFOLD_ADAPTER_ID,
          adapterVersion: "1",
          externalId: scaffoldSlotExternalId(channel, dateKey),
          status: "draft",
          note: "โครงตาราง · รอเติม (ไฟล์หรือรายบรรทัด)",
        }),
      );
    }
  }
  return rows;
}

export type ScaffoldMonthResult = {
  planned: number;
  created: number;
  skipped: number;
};

/** สร้างแถวขายว่างที่ยังไม่มีสำหรับเดือน (ข้ามถ้ามี sales วัน×ช่องทางแล้ว) */
export async function ensureVatImportMonthScaffold(
  monthKey: string,
  actor: string,
  existing: VatImportRow[],
): Promise<ScaffoldMonthResult> {
  const planned = planMonthScaffoldRows(monthKey);
  const have = new Set<string>();
  for (const r of existing) {
    if (r.rowKind !== "sales") continue;
    if (r.status === "skipped") continue;
    have.add(salesSlotKey(r.channel, r.dateKey));
  }
  let created = 0;
  let skipped = 0;
  for (const input of planned) {
    const key = salesSlotKey(input.channel, input.dateKey);
    if (have.has(key)) {
      skipped += 1;
      continue;
    }
    const row = await createVatImportRow(input, actor);
    have.add(key);
    existing.push(row);
    created += 1;
  }
  return { planned: planned.length, created, skipped };
}

function hasMoney(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && n !== 0;
}

/**
 * เติมแถวขายเข้าช่องว่างที่มีอยู่ (scaffold) แทนการสร้างซ้ำ
 * แถวที่ไม่ใช่ sales หรือหาช่องไม่ได้ → สร้างใหม่ (ถ้าไม่ซ้ำ externalId)
 */
export async function upsertVatImportSalesIntoSlots(
  inputs: VatImportRowInput[],
  actor: string,
  existing: VatImportRow[],
): Promise<{ created: VatImportRow[]; updated: VatImportRow[]; skipped: number }> {
  const bySlot = new Map<string, VatImportRow>();
  const byExt = new Set<string>();
  for (const r of existing) {
    if (r.externalId) byExt.add(`${r.channel}|${r.externalId}`);
    if (r.rowKind === "sales" && r.status !== "skipped") {
      bySlot.set(salesSlotKey(r.channel, r.dateKey), r);
    }
  }

  const created: VatImportRow[] = [];
  const updated: VatImportRow[] = [];
  let skipped = 0;

  for (const input of inputs) {
    if (input.rowKind && input.rowKind !== "sales") {
      const ext = String(input.externalId || "").trim();
      const ek = ext ? `${input.channel}|${ext}` : "";
      if (ek && byExt.has(ek)) {
        skipped += 1;
        continue;
      }
      const row = await createVatImportRow(input, actor);
      created.push(row);
      existing.push(row);
      if (ek) byExt.add(ek);
      continue;
    }

    const slot = bySlot.get(salesSlotKey(input.channel, input.dateKey));
    if (slot && slot.status === "draft") {
      const next: VatImportRowInput = {
        monthKey: slot.monthKey,
        dateKey: slot.dateKey,
        channel: slot.channel,
        rowKind: "sales",
        grossInclusive: hasMoney(input.grossInclusive)
          ? input.grossInclusive!
          : slot.grossInclusive,
        fee: hasMoney(input.fee) ? input.fee! : slot.fee,
        netTransfer: hasMoney(input.netTransfer)
          ? input.netTransfer!
          : slot.netTransfer,
        gpVat: hasMoney(input.gpVat) ? input.gpVat! : slot.gpVat,
        invoiceNo: String(input.invoiceNo || slot.invoiceNo || ""),
        invoiceDate: String(input.invoiceDate || slot.invoiceDate || ""),
        sellerTaxId: String(input.sellerTaxId || slot.sellerTaxId || ""),
        storagePath: String(input.storagePath || slot.storagePath || ""),
        downloadUrl: String(input.downloadUrl || slot.downloadUrl || ""),
        fileName: String(input.fileName || slot.fileName || ""),
        contentType: String(input.contentType || slot.contentType || ""),
        contentHash: String(input.contentHash || slot.contentHash || ""),
        adapterId:
          String(input.adapterId || "").trim() &&
          input.adapterId !== MONTH_SCAFFOLD_ADAPTER_ID
            ? String(input.adapterId)
            : slot.adapterId,
        adapterVersion: String(
          input.adapterVersion || slot.adapterVersion || "1",
        ),
        externalId: String(input.externalId || slot.externalId || ""),
        status: "draft",
        note: String(input.note || slot.note || ""),
        appliedAt: null,
        appliedToMonth: "",
      };
      const saved = await updateVatImportRow(
        slot.id,
        next,
        actor,
        slot.createdAt,
      );
      updated.push(saved);
      bySlot.set(salesSlotKey(saved.channel, saved.dateKey), saved);
      const idx = existing.findIndex((r) => r.id === slot.id);
      if (idx >= 0) existing[idx] = saved;
      if (saved.externalId) byExt.add(`${saved.channel}|${saved.externalId}`);
      continue;
    }

    const ext = String(input.externalId || "").trim();
    const ek = ext ? `${input.channel}|${ext}` : "";
    if (ek && byExt.has(ek)) {
      skipped += 1;
      continue;
    }
    const row = await createVatImportRow(input, actor);
    created.push(row);
    existing.push(row);
    bySlot.set(salesSlotKey(row.channel, row.dateKey), row);
    if (ek) byExt.add(ek);
  }

  return { created, updated, skipped };
}
