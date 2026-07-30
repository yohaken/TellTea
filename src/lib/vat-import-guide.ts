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
    find: "วันในรายงาน",
    put: "YYYY-MM-DD",
  },
  {
    id: "channel",
    short: "ช่อง",
    label: "ช่องทาง",
    find: "แพลตฟอร์ม",
    put: "SF / GB / LM (ล็อก)",
  },
  {
    id: "grossInclusive",
    short: "ขาย",
    label: "ยอดขาย",
    find: "ยอดขายรวม VAT",
    put: "ตัวเลข · ไม่ชัวร์ปล่อยว่าง",
  },
  {
    id: "fee",
    short: "คชจ.",
    label: "ค่าธรรมเนียม / GP",
    find: "จากไฟล์เท่านั้น — ยอดที่แพลตฟอร์มหักก่อนโอน",
    put: "ห้ามประมาณ · ไม่ใช่รายได้ · ใช้ติดตาม/ภาษีซื้อ",
  },
  {
    id: "netTransfer",
    short: "โอน",
    label: "ยอดโอน = รายได้ถึงร้าน",
    find: "เงินเข้าบัญชีหลังหัก GP แล้ว",
    put: "นี่คือรายได้เงินสด · ไม่ต้องบวกคชจ./GP≠ กลับ",
  },
  {
    id: "gpVat",
    short: "GP≠",
    label: "ภาษีซื้อ GP (บนบิลค่า GP)",
    find: "VAT จากใบกำกับแพลตฟอร์ม",
    put: "ไม่ใช่เงินหักเพิ่มจากโอน · ใช้ยื่นภาษีซื้อ · ห้าม fee×7/107",
  },
  {
    id: "invoiceNo",
    short: "เลขที่",
    label: "เลขที่ใบกำกับ",
    find: "บนใบกำกับแพลตฟอร์ม",
    put: "ซ่อนปลายแถว · hover/โฟกัส",
  },
];

export const VAT_IMPORT_CHANNEL_GUIDE: VatImportChannelGuide[] = [
  {
    channel: "lineman",
    short: "LM",
    label: "LINE MAN",
    source: "รายงานยอดขายประจำเดือน (PDF)",
    how: "กรอก/วาง · หรือ PDF",
    fills: "ขาย · คชจ. · โอน · GP≠",
  },
  {
    channel: "grab",
    short: "GB",
    label: "Grab",
    source: "Transaction CSV / สรุปรายวัน",
    how: "กรอก/วาง · หรือ CSV",
    fills: "ขาย · คชจ. · โอน · GP≠",
  },
  {
    channel: "shopee",
    short: "SF",
    label: "ShopeeFood",
    source: "transactions + ใบกำกับ Commission",
    how: "กรอก/วาง · หรือ PDF",
    fills: "ขาย · GP≠ · เลขที่",
  },
];

/** ขั้นตอนใช้งานทั่วไป */
export const VAT_IMPORT_WORKFLOW_NOTES: string[] = [
  "เลือกเดือน → สร้างตาราง (SF/GB/LM)",
  "กรอกหรือวางข้อความ · ช่องทางล็อก · ผสานเดือนอัตโนมัติ",
  "โอน = รายได้ถึงร้าน (หลังหัก GP) · ไม่ต้องคอลัมน์รายได้แยก",
  "GP≠ จากใบกำกับเท่านั้น · เป็น VAT บนบิลค่า GP ไม่ใช่เงินหักเพิ่ม",
  "ติ๊ก「ข้าม」เฉพาะแถวที่ไม่ต้องการเข้างบ",
];

/**
 * กฎสั้นสำหรับ local AI ที่จำลองคนใช้ Chrome/TellTea
 */
export const VAT_IMPORT_AI_RULES: string[] = [
  "/vat-sales/ แท็บนำเข้า · อ่าน #vat-import-ai-notes",
  "สร้างตารางถ้ายังไม่มี · ช่องทางล็อก",
  "เติม: กรอก หรือวาง `วัน SF|GB|LM ขาย [คชจ.] [โอน] [GP≠] [เลขที่]`",
  "ห้าม fee×7/107 · หน้าร้านนอกตารางนี้",
  "ผสานเดือนอัตโนมัติ · กวาด verify · สรุปสั้น",
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
