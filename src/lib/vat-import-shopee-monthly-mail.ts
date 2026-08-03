/**
 * ShopeeFood — บล็อกข้อความในเมล「รายงานยอดขายสะสมประจำเดือน」
 * ไม่ต้องเปิดไฟล์แนบ · คชจ. = GP + VAT
 */
import { normalizeMoney, roundMoney } from "./vat-sales";

export const SHOPEE_MONTHLY_MAIL_ADAPTER_ID = "shopee-monthly-mail";
export const SHOPEE_MONTHLY_MAIL_ADAPTER_VERSION = "1";

export type ShopeeMonthlyMailParseResult = {
  adapterId: typeof SHOPEE_MONTHLY_MAIL_ADAPTER_ID;
  adapterVersion: typeof SHOPEE_MONTHLY_MAIL_ADAPTER_VERSION;
  monthKey: string;
  reportFrom: string;
  reportTo: string;
  /** ยอดรายการ → ยอดขายแอพ */
  sales: number;
  /** ค่าธรรมเนียม (GP) อย่างเดียว */
  gpOnly: number;
  /** ยอดภาษีมูลค่าเพิ่มค่าธรรมเนียม */
  gpVat: number;
  /** คชจ.GP = GP + VAT */
  fee: number;
  /** ยอดรวมสุทธิประจำเดือน → ยอดโอน */
  transfer: number;
  warnings: string[];
};

function parseMoneyToken(raw: string): number {
  const t = String(raw || "")
    .trim()
    .replace(/[฿,\s]/g, "")
    .replace(/\((.*)\)/, "-$1");
  if (!t || t === "-") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? roundMoney(Math.abs(n)) : 0;
}

function moneyAfterLabel(text: string, labels: string[]): number {
  for (const label of labels) {
    const re = new RegExp(
      `${label}\\s*[:：]?\\s*฿?\\s*([\\d,]+(?:\\.\\d{1,2})?)`,
      "i",
    );
    const m = text.match(re);
    if (m?.[1]) return parseMoneyToken(m[1]);
  }
  return 0;
}

export function looksLikeShopeeMonthlyMail(text: string): boolean {
  const t = String(text || "");
  return (
    /รายงานยอดขายสะสมประจำเดือน/.test(t) ||
    (/วันที่รายงาน/.test(t) &&
      /ยอดรายการ/.test(t) &&
      /ยอดรวมสุทธิประจำเดือน|ค่าธรรมเนียม\s*\(\s*GP\s*\)/.test(t))
  );
}

export function parseShopeeMonthlyMail(
  text: string,
): ShopeeMonthlyMailParseResult {
  const body = String(text || "").replace(/\u00a0/g, " ");
  const warnings: string[] = [];
  if (!looksLikeShopeeMonthlyMail(body)) {
    warnings.push("ข้อความไม่เหมือนบล็อกสรุปเดือน ShopeeFood");
  }

  const range = body.match(
    /วันที่รายงาน\s*[:：]?\s*(\d{4}-\d{2}-\d{2})\s*ถึง\s*(\d{4}-\d{2}-\d{2})/,
  );
  const reportFrom = range?.[1] || "";
  const reportTo = range?.[2] || "";
  const monthKey = reportFrom ? reportFrom.slice(0, 7) : "";
  if (!monthKey) warnings.push("ไม่พบวันที่รายงาน YYYY-MM-DD ถึง …");

  const sales = moneyAfterLabel(body, ["ยอดรายการ"]);
  const gpOnlyMatch = body.match(
    /ค่าธรรมเนียม\s*\(\s*GP\s*\)\s*[:：]?\s*฿?\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  const gpOnly = gpOnlyMatch?.[1] ? parseMoneyToken(gpOnlyMatch[1]) : 0;
  const gpVat = moneyAfterLabel(body, [
    "ยอดภาษีมูลค่าเพิ่มค่าธรรมเนียม",
    "ภาษีมูลค่าเพิ่มค่าธรรมเนียม",
  ]);
  const transfer = moneyAfterLabel(body, ["ยอดรวมสุทธิประจำเดือน"]);

  if (!(sales > 0)) warnings.push("ไม่พบยอดรายการ");
  if (!(gpOnly > 0)) warnings.push("ไม่พบค่าธรรมเนียม (GP)");
  if (!(gpVat > 0)) warnings.push("ไม่พบยอดภาษีมูลค่าเพิ่มค่าธรรมเนียม");
  if (!(transfer > 0)) warnings.push("ไม่พบยอดรวมสุทธิประจำเดือน");

  const fee = roundMoney(gpOnly + gpVat);
  const expectedVat = roundMoney(gpOnly * 0.07);
  if (gpOnly > 0 && gpVat > 0 && Math.abs(expectedVat - gpVat) > 0.05) {
    warnings.push(
      `VAT ≈ GP×7% คาด ${expectedVat.toFixed(2)} ได้ ${gpVat.toFixed(2)}`,
    );
  }

  return {
    adapterId: SHOPEE_MONTHLY_MAIL_ADAPTER_ID,
    adapterVersion: SHOPEE_MONTHLY_MAIL_ADAPTER_VERSION,
    monthKey,
    reportFrom,
    reportTo,
    sales: normalizeMoney(sales),
    gpOnly: normalizeMoney(gpOnly),
    gpVat: normalizeMoney(gpVat),
    fee: normalizeMoney(fee),
    transfer: normalizeMoney(transfer),
    warnings,
  };
}
