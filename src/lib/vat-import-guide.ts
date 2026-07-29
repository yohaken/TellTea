/**
 * บริบทตารางนำเข้า — ให้คน / local AI รู้ว่าหาอะไร ใส่อะไร
 * แสดงบนเว็บแท็บนำเข้า
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

/** คอลัมน์หลักของตาราง (slim) */
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
    put: "Shopee / Grab / LINE MAN / หน้าร้าน",
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
    find: "ค่า GP หรือคอมมิชชั่นของวัน (มักรวม VAT)",
    put: "ยอดคชจ.รวม VAT · ว่างได้",
  },
  {
    id: "netTransfer",
    short: "โอน",
    label: "ยอดโอนหลัง",
    find: "เงินเข้าหลังหัก GP / ยอดเงินในระบบ",
    put: "ยอดโอนหรือยอดสุทธิหลังหัก · ว่างได้",
  },
  {
    id: "gpVat",
    short: "GP≠",
    label: "ภาษีซื้อ GP",
    find: "VAT 7% ในใบกำกับค่าบริการ/คอมมิชชั่น",
    put: "ยอด VAT จากใบกำกับ · หรือ fee×7/107 ถ้า GP รวม VAT",
  },
  {
    id: "invoiceNo",
    short: "เลขที่",
    label: "เลขที่ใบกำกับ",
    find: "เลขที่บนใบกำกับภาษีของแพลตฟอร์ม",
    put: "คัดลอกเลขที่ · แถวใบกำกับแยกจากแถวขายได้",
  },
  {
    id: "file",
    short: "ไฟล์",
    label: "ไฟล์ต้นทาง",
    find: "PDF/CSV ที่ดาวน์โหลดจากพอร์ทัล",
    put: "อัปโหลดหรือแนบ · ระบบกันซ้ำด้วย hash",
  },
];

export const VAT_IMPORT_CHANNEL_GUIDE: VatImportChannelGuide[] = [
  {
    channel: "lineman",
    short: "LM",
    label: "LINE MAN",
    source: "รายงานยอดขายประจำเดือน (PDF) มีสรุปรายวัน + ค่า GP (รวม VAT)",
    how: "ปุ่ม「LINE MAN รายงานเดือน」หรือโยนเข้า Storage แล้ว「ดึงไฟล์ใหม่」หรือเติมรายวันในตาราง",
    fills: "ขาย · คชจ.(GP) · โอน(=ยอดเงินในระบบ) · GP VAT (=fee×7/107)",
  },
  {
    channel: "grab",
    short: "GB",
    label: "Grab",
    source: "CSV Transaction_Store / รายงานธุรกรรมร้าน รายวัน",
    how: "ปุ่ม「Grab CSV」หรืออัปโหลดแล้วดึงไฟล์ใหม่ หรือเติมรายบรรทัด",
    fills: "ขาย · คชจ. · โอน · GP VAT จาก fee",
  },
  {
    channel: "shopee",
    short: "SF",
    label: "ShopeeFood",
    source:
      "ใบกำกับ Commission (PDF) = ภาษีซื้อ GP + เลขที่ · ยอดขายรอไฟล์ขายแยก (ยังจูน)",
    how: "ปุ่ม「Shopee ใบกำกับ PDF」หลายไฟล์ได้ · แถวขายว่างไว้ก่อนได้จนมีไฟล์ขาย",
    fills: "ภาษีซื้อ GP · เลขที่ใบกำกับ · (ขาย/โอนเมื่อมีไฟล์ขาย)",
  },
  {
    channel: "storefront",
    short: "หน้าร้าน",
    label: "หน้าร้าน",
    source: "ยอดหน้าร้าน / POS / กรอกมือ",
    how: "เติมรายวันในตาราง หรืออัปโหลดไฟล์อ้างอิงแนบแถว",
    fills: "ขาย · อื่นๆ ถ้ามี",
  },
];

export const VAT_IMPORT_WORKFLOW_NOTES: string[] = [
  "สร้างตารางเดือนก่อน → ได้แถวว่างครบวัน×ช่องทาง รอเติม",
  "เติมได้หลายทาง: อัปโหลดไฟล์ / ดึงไฟล์ใหม่จาก Storage / กรอกรายบรรทัด (คนหรือ local AI)",
  "ไฟล์ซ้ำได้ — ตาราง+hash คัดเอง · ไม่ชัวร์ปล่อยช่องว่าง",
  "ตรวจแถวครบแล้วค่อยกด「ใช้เข้าเดือน」",
];

export function channelGuide(
  channel: VatImportChannel,
): VatImportChannelGuide | undefined {
  return VAT_IMPORT_CHANNEL_GUIDE.find((g) => g.channel === channel);
}

export function columnTitleAttr(col: VatImportColumnGuide): string {
  return `${col.label}\nหา: ${col.find}\nใส่: ${col.put}`;
}
