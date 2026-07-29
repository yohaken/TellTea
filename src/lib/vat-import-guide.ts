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
  {
    id: "file",
    short: "ไฟล์",
    label: "ไฟล์ต้นทาง",
    find: "PDF/CSV ที่ดาวน์โหลดจากพอร์ทัล — เก็บใน Firebase Storage",
    put: "แถวที่มีตัวเลขต้องมีไฟล์อ้างอิง · ใส่เลขแล้วอัป/แนบทันที",
  },
];

export const VAT_IMPORT_CHANNEL_GUIDE: VatImportChannelGuide[] = [
  {
    channel: "lineman",
    short: "LM",
    label: "LINE MAN",
    source:
      "รายงานยอดขายประจำเดือน (PDF) เท่านั้น — โฟลเดอร์ lineman-pos / POS ไม่ใช่รายงานเดือน อย่าสับสน",
    how: "สร้างตารางเดือนก่อน → ปุ่ม「LINE MAN รายงานเดือน」หรือเติมช่องแล้วแนบไฟล์รายงานเดือน",
    fills: "ขาย · คชจ.(GP จากไฟล์) · โอน(=ยอดเงินในระบบ) · GP VAT เฉพาะเมื่อมีใบกำกับ",
  },
  {
    channel: "grab",
    short: "GB",
    label: "Grab",
    source: "CSV Transaction_Store / รายงานธุรกรรมร้าน — ถ้าวันที่เป็น `29 Jul 2026` อะแดปเตอร์อาจอ่านไม่ตรง ต้องสรุปรายวันหรือจูน parser",
    how: "สร้างตารางก่อน → ปุ่ม「Grab CSV」หรือเติมช่องรายวัน + แนบไฟล์",
    fills: "ขาย · คชจ. · โอน จากไฟล์ · GP VAT เฉพาะจากใบกำกับ",
  },
  {
    channel: "shopee",
    short: "SF",
    label: "ShopeeFood",
    source:
      "ยอดขายจาก export transactions · ใบกำกับ Commission PDF = ภาษีซื้อ GP + เลขที่ (API ดาวน์โหลดมักได้แค่ taskId — รอไฟล์ใน Downloads)",
    how: "สร้างตารางก่อน → เติมขายจาก transactions · ใบกำกับ PDF หลายไฟล์ · แนบทุกแถวที่มีตัวเลข",
    fills: "ขายจากไฟล์ขาย · ภาษีซื้อ GP + เลขที่จากใบกำกับ",
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
  "กด「สร้างตารางเดือน」ก่อน → แถวว่างวัน×SF/GB/LM (ไม่มีหน้าร้าน)",
  "ลำดับที่ชอบ: สร้างตาราง → เติมช่อง (จากไฟล์/อ่าน PDF) → แนบไฟล์ในแถวทันที · อัปโหลดปุ่มเป็นทางเสริม",
  "ห้ามคำนวณ VAT/คชจ. เอง — เอาเฉพาะจากใบกำกับหรือไฟล์ · ไม่มีก็ว่าง",
  "ช่องเงิน: โฟกัสแล้วคีย์ตัวเลข+Tab (paste มักไม่ติด) · เลขที่ใบกำกับค่อย paste",
  "ตรวจแถวครบแล้วค่อยกด「ใช้เข้าเดือน」",
];

/**
 * กฎสั้นสำหรับ local AI ที่จำลองคนใช้ Chrome/TellTea
 */
export const VAT_IMPORT_AI_RULES: string[] = [
  "จำลองเป็นคนใช้เว็บเท่านั้น — ใช้ปุ่มและช่องกรอกบนหน้า",
  "เปิด /vat-sales/ → แท็บ「นำเข้า」→ เลือกเดือน → อ่าน #vat-import-ai-notes + แผงบริบท",
  "สร้างตารางด้วย「สร้างตารางเดือน」ถ้ายังไม่มี (ได้แค่ Shopee/Grab/LINE MAN)",
  "หน้าร้านไม่อยู่ในตารางนี้ — อย่าสร้าง/เติม storefront ในแท็บนำเข้า",
  "ห้ามประมาณหรือคำนวณ GP VAT (ห้าม fee×7/107) — มีใบกำกับค่อยใส่ · ไม่มีปล่อยว่าง",
  "ช่องเงิน (.vat-money-input): คลิกโฟกัส คีย์ตัวเลข แล้ว Tab — อย่าพึ่ง paste; เลขที่ใบกำกับค่อย paste (กันคีย์ไทยเพี้ยน)",
  "ใส่ตัวเลขแล้วต้องมีไฟล์ใน Storage ของแถวนั้นทันที (อัปหรือแนบ) — อย่าคีย์แล้วข้ามไฟล์",
  "Shopee ใบกำกับ: ถ้า automation ได้แค่ taskId ให้รอไฟล์ลง Downloads แล้วอ่าน PDF ต่อ อย่าเดา",
  "Grab CSV วันที่แบบ `29 Jul 2026` อาจ parse ไม่ได้ — สรุปรายวันก่อนหรือแจ้ง mentor อย่าเดาวัน",
  "LINE MAN ใช้เฉพาะรายงานประจำเดือน PDF — โฟลเดอร์ lineman-pos ไม่ใช่รายงานเดือน",
  "ไม่ชัวร์ → ปล่อยว่าง · อย่าเดาตัวเลข",
  "ไฟล์ซ้ำไม่เป็นไร · mentor ออฟไลน์/หมดเวลา Ask → ไปต่อเอง อย่ารอ",
  "ห้ามกด「ใช้เข้าเดือน」จนกว่าผู้ใช้จะสั่งชัด",
  "จบรอบสรุปสั้น: เดือน · ไฟล์ที่อัป · แถวที่เติม/ว่าง · error",
  "ถ้าติดจริง: โต๊ะจูน Ask สั้นๆ — ออฟไลน์/หมดเวลา → ไปต่อเอง",
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
