/**
 * บริบทตารางนำเข้า — ให้คน / local AI อ่านบนเว็บแล้วรู้ว่าทำอะไร
 * แสดงที่แท็บนำเข้า `/vat-sales/`
 */

import type { VatImportChannel } from "./vat-import";

export type VatImportColumnGuide = {
  id: string;
  short: string;
  label: string;
  /** หาค่านี้จากไหน */
  find: string;
  /** ใส่ในช่องนี้อย่างไร */
  put: string;
};

export type VatImportChannelGuide = {
  channel: VatImportChannel;
  short: string;
  label: string;
  /** ไฟล์/แหล่งหลัก */
  source: string;
  /** วิธีเติมในแอป */
  how: string;
  /** คอลัมน์ที่มักได้จากไฟล์นี้ */
  fills: string;
};

/** คอลัมน์หลักของตาราง (slim) — เลขที่ใบกำกับซ่อนปลายแถว */
export const VAT_IMPORT_COLUMN_GUIDE: VatImportColumnGuide[] = [
  {
    id: "dateKey",
    short: "วัน",
    label: "วันที่",
    find: "วันในรายงานแพลตฟอร์ม (ไม่ใช่วันอัปโหลด)",
    put: "YYYY-MM-DD ในเดือนที่เลือก",
  },
  {
    id: "channel",
    short: "ช่อง",
    label: "ช่องทาง",
    find: "แพลตฟอร์มของไฟล์นั้น",
    put: "Shopee / Grab / LINE MAN เท่านั้น (หน้าร้านไม่อยู่ในตารางนี้)",
  },
  {
    id: "grossInclusive",
    short: "ขาย",
    label: "ยอดขาย",
    find: "ยอดขายรวม VAT ของวันนั้น (เงินสด+e-pay ถ้าแยก)",
    put: "ตัวเลขรวม VAT · ไม่ชัวร์ปล่อยว่าง",
  },
  {
    id: "fee",
    short: "คชจ.",
    label: "ค่าธรรมเนียม / GP",
    find: "ค่า GP หรือคอมมิชชั่นจากไฟล์เท่านั้น",
    put: "จากไฟล์ · ห้ามประมาณ · ไม่มีในไฟล์ปล่อยว่าง",
  },
  {
    id: "netTransfer",
    short: "โอน",
    label: "ยอดโอนหลัง",
    find: "เงินเข้าหลังหัก GP / ยอดเงินในระบบ จากไฟล์",
    put: "จากไฟล์ · ว่างได้",
  },
  {
    id: "gpVat",
    short: "GP≠",
    label: "ภาษีซื้อ GP",
    find: "VAT 7% จากใบกำกับค่าบริการ/คอมมิชชั่นเท่านั้น",
    put: "ห้ามคำนวณ fee×7/107 เอง · ไม่มีใบกำกับปล่อยว่าง",
  },
  {
    id: "invoiceNo",
    short: "เลขที่",
    label: "เลขที่ใบกำกับ (ซ่อนปลายแถว)",
    find: "เลขที่บนใบกำกับภาษีของแพลตฟอร์ม",
    put: "เก็บในระบบ · UI ซ่อนแคบ · hover/โฟกัสเพื่อแก้ · paste ได้ (อย่าคีย์ไทย)",
  },
];


export const VAT_IMPORT_CHANNEL_GUIDE: VatImportChannelGuide[] = [
  {
    channel: "lineman",
    short: "LM",
    label: "LINE MAN",
    source:
      "รายงานยอดขายประจำเดือน (PDF) เท่านั้น — โฟลเดอร์ lineman-pos / POS ไม่ใช่รายงานเดือน อย่าสับสน",
    how: "สร้างตาราง → กรอก/วางข้อความ · หรือทางเลือก LINE MAN PDF",
    fills: "ขาย · คชจ. · โอน(=ยอดเงินในระบบ) · GP≠ เมื่อมีใบกำกับ",
  },
  {
    channel: "grab",
    short: "GB",
    label: "Grab",
    source: "Transaction CSV / สรุปรายวัน — วันที่ `29 Jul 2026` อาจต้องแปลงก่อน",
    how: "สร้างตาราง → กรอก/วางข้อความ · หรือทางเลือก Grab CSV",
    fills: "ขาย · คชจ. · โอน · GP≠ จากใบกำกับ",
  },
  {
    channel: "shopee",
    short: "SF",
    label: "ShopeeFood",
    source: "transactions export + ใบกำกับ Commission (รอไฟล์จริง อย่าเดา)",
    how: "สร้างตาราง → กรอก/วางข้อความ · ทางเลือก Shopee PDF",
    fills: "ขาย · GP≠ + เลขที่จากใบกำกับ",
  },

  {
    channel: "storefront",
    short: "หน้าร้าน",
    label: "หน้าร้าน",
    source: "ไม่สร้างในตารางนำเข้า — คีย์/ยอดจริงที่แท็บเดือน (POS) อัตโนมัติ ถ้าระบุมือจะทับ",
    how: "อย่าสร้างแถวหน้าร้านในแท็บนำเข้า",
    fills: "นอกตารางนำเข้า",
  },
];

/** ขั้นตอนใช้งานทั่วไป */
export const VAT_IMPORT_WORKFLOW_NOTES: string[] = [
  "เลือกเดือน →「สร้างตารางเดือน」(SF/GB/LM วันครบ · ไม่ซ้ำถ้ามีแล้ว)",
  "กรอกช่องเงิน หรือ「วางข้อความ」บรรทัดละแถว · ช่องทางล็อกตามโครง",
  "กรองแถวตามช่องทาง / ว่าง / มียอด ได้",
  "ห้ามคำนวณ VAT เอง — จากใบกำกับเท่านั้น · ไม่มีก็ว่าง",
  "ครบแล้วกด「ใช้เข้าเดือน」ผสานเข้าแท็บเดือน",
];

/**
 * กฎสั้นสำหรับ local AI ที่จำลองคนใช้ Chrome/TellTea
 */
export const VAT_IMPORT_AI_RULES: string[] = [
  "จำลองคนใช้เว็บ · /vat-sales/ แท็บนำเข้า · อ่าน #vat-import-ai-notes",
  "เลือกเดือน → สร้างตารางเดือนถ้ายังไม่มี · ระบบไม่สร้างซ้ำ · ช่องทางล็อก อย่าพยายามเปลี่ยน",
  "เติมหลัก: กรอกช่อง หรือวางข้อความ (วัน SF|GB|LM ขาย [คชจ.] [โอน] [GP≠] [เลขที่])",
  "ช่องเงิน: โฟกัส→คีย์ตัวเลข→Tab · อย่าพึ่ง paste ในช่องเงิน",
  "ห้าม fee×7/107 · GP≠ จากใบกำกับเท่านั้น",
  "หน้าร้านนอกตารางนี้",
  "ไม่ชัวร์ปล่อยว่าง · mentor ออฟไลน์/หมดเวลา Ask → ไปต่อเอง",
  "ห้ามกดใช้เข้าเดือนจนกว่าคนสั่ง",
  "สรุปสั้น: เดือน · แถวที่เติม/ว่าง · error",
];


export function channelGuide(
  channel: VatImportChannel,
): VatImportChannelGuide | undefined {
  return VAT_IMPORT_CHANNEL_GUIDE.find((g) => g.channel === channel);
}

export function columnTitleAttr(col: VatImportColumnGuide): string {
  return `${col.label}\nหา: ${col.find}\nใส่: ${col.put}`;
}

/** คอลัมน์ที่โชว์ชัดในตาราง (ไม่รวมเลขที่ — ไปคอลัมน์ซ่อนปลายแถว) */
export const VAT_IMPORT_VISIBLE_COLUMN_IDS = [
  "dateKey",
  "channel",
  "grossInclusive",
  "fee",
  "netTransfer",
  "gpVat",
] as const;
