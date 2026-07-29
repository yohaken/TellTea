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
    find: "PDF/CSV ที่ดาวน์โหลดจากพอร์ทัล — เก็บใน Firebase Storage",
    put: "ทุกแถวที่มีตัวเลขควรมีไฟล์อ้างอิง (อัปโหลด/แนบ) · คนไม่ต้องเปิดดูก็ได้ แต่ต้องรู้ชื่อไฟล์",
  },
];

export const VAT_IMPORT_CHANNEL_GUIDE: VatImportChannelGuide[] = [
  {
    channel: "lineman",
    short: "LM",
    label: "LINE MAN",
    source: "รายงานยอดขายประจำเดือน (PDF) มีสรุปรายวัน + ค่า GP (รวม VAT)",
    how: "ปุ่ม「LINE MAN รายงานเดือน」หรือโยนเข้า Storage แล้ว「ดึงไฟล์ใหม่」หรือเติมรายวันในตารางพร้อมแนบไฟล์",
    fills: "ขาย · คชจ.(GP) · โอน(=ยอดเงินในระบบ) · GP VAT (=fee×7/107)",
  },
  {
    channel: "grab",
    short: "GB",
    label: "Grab",
    source: "CSV Transaction_Store / รายงานธุรกรรมร้าน รายวัน",
    how: "ปุ่ม「Grab CSV」หรืออัปโหลดแล้วดึงไฟล์ใหม่ หรือเติมรายบรรทัดแล้วแนบไฟล์ต้นทาง",
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
    source: "ยอดหน้าร้าน / POS / กรอกมือ — ถ้ามีสลิปหรือรายงานให้แนบ",
    how: "เติมรายวันในตาราง · แนบไฟล์อ้างอิงแถวเมื่อมี",
    fills: "ขาย · อื่นๆ ถ้ามี",
  },
];

/** ขั้นตอนใช้งานทั่วไป */
export const VAT_IMPORT_WORKFLOW_NOTES: string[] = [
  "กด「สร้างตารางเดือน」ก่อน → ได้แถวว่างครบวัน×ช่องทาง (อย่าสร้างตารางนอกเว็บ)",
  "เติมได้หลายทาง: อัปโหลดทั้งไฟล์ / ดึงไฟล์ใหม่จาก Storage / กรอกรายบรรทัดในตาราง",
  "ตัวเลขในแถวควรอ้างถึงไฟล์ต้นทางที่อัปโหลดไว้ในระบบแล้ว (คอลัมน์ไฟล์) — ไม่จำเป็นต้องเปิดดู แค่รู้ว่าเป็นไฟล์ไหน",
  "ไฟล์ซ้ำจากคนหรือ AI ได้ — ตาราง+hash คัดเอง · ไม่ชัวร์ปล่อยช่องว่าง",
  "ยังไม่กด「ใช้เข้าเดือน」จนกว่าคนจะสั่งหรือตรวจครบ",
];

/**
 * กฎสั้นสำหรับ local AI ที่จำลองคนใช้ Chrome/TellTea
 * แสดงบนเว็บให้ agent อ่านได้โดยตรง
 */
export const VAT_IMPORT_AI_RULES: string[] = [
  "จำลองเป็นคนใช้เว็บเท่านั้น — ใช้ปุ่มและช่องกรอกที่มีบนหน้า ไม่สร้าง API/สคริปต์แฮ็ก",
  "เปิด /vat-sales/ → แท็บ「นำเข้า」→ เลือกเดือนเป้าหมาย → อ่านแผงบริบทนี้ก่อนลงมือ",
  "สร้างโครงด้วยปุ่ม「สร้างตารางเดือน」ถ้ายังไม่มีแถว",
  "ทางเลือกเติม: (ก) ดาวน์โหลดจาก Grab/Shopee/LM แล้วอัปโหลดเข้าปุ่มที่ถูกชนิด (ข) คีย์มือทีละช่อง (ค) ดึงไฟล์ใหม่หลังโยนเข้า Storage — ผสมได้",
  "เมื่อใส่ตัวเลขในแถว ให้แถวนั้นมีไฟล์ต้นทางในระบบ (อัปโหลดหรือแนบ) · ชื่อไฟล์ต้องผูกกับแถว",
  "ไม่ชัวร์ → ปล่อยว่าง · อย่าเดาตัวเลข",
  "ไฟล์ซ้ำไม่เป็นไร · อย่าลบของเดิมโดยไม่จำเป็น",
  "ห้ามกด「ใช้เข้าเดือน」จนกว่าผู้ใช้จะสั่งชัด",
  "จบรอบสรุปสั้น: เดือน · ไฟล์ที่อัป · แถวที่เติม/ว่าง · error",
];

export function channelGuide(
  channel: VatImportChannel,
): VatImportChannelGuide | undefined {
  return VAT_IMPORT_CHANNEL_GUIDE.find((g) => g.channel === channel);
}

export function columnTitleAttr(col: VatImportColumnGuide): string {
  return `${col.label}\nหา: ${col.find}\nใส่: ${col.put}`;
}
