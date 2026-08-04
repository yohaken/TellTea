/**
 * แปลงจำนวนเงินเป็นตัวอักษรภาษาไทย (มาตรฐานเอกสารทางการ)
 * เช่น 8200 → แปดพันสองร้อยบาทถ้วน
 */

const DIGIT = [
  "ศูนย์",
  "หนึ่ง",
  "สอง",
  "สาม",
  "สี่",
  "ห้า",
  "หก",
  "เจ็ด",
  "แปด",
  "เก้า",
] as const;

function readNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  n = Math.floor(Math.abs(n));
  if (n === 0) return DIGIT[0];

  const parts: string[] = [];
  // ประมวลผลทีละล้าน
  let rest = n;
  let millionLevel = 0;
  while (rest > 0) {
    const block = rest % 1_000_000;
    rest = Math.floor(rest / 1_000_000);
    if (block > 0) {
      const blockText = readUnderMillion(block);
      const suffix =
        millionLevel === 0 ? "" : "ล้าน".repeat(millionLevel);
      parts.unshift(`${blockText}${suffix}`);
    }
    millionLevel += 1;
  }
  return parts.join("");
}

function readUnderMillion(n: number): string {
  // n = 0..999999 → แสน หมื่น พัน ร้อย สิบ หน่วย
  const units = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"] as const;
  let s = "";
  const str = String(n);
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const d = Number(str[i]);
    const pos = len - i - 1; // 0=หน่วย
    if (d === 0) continue;
    if (pos === 1) {
      // สิบ
      if (d === 1) s += "สิบ";
      else if (d === 2) s += "ยี่สิบ";
      else s += `${DIGIT[d]}สิบ`;
    } else if (pos === 0) {
      if (d === 1 && len > 1) s += "เอ็ด";
      else s += DIGIT[d];
    } else {
      s += `${DIGIT[d]}${units[pos]}`;
    }
  }
  return s;
}

/** จำนวนเงินเป็นตัวอักษร เช่น แปดพันสองร้อยบาทถ้วน */
export function thaiBahtText(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const rounded = Math.round(amount * 100) / 100;
  const neg = rounded < 0;
  const abs = Math.abs(rounded);
  const baht = Math.floor(abs + 1e-9);
  const satang = Math.round((abs - baht) * 100);
  let text = `${readNumber(baht)}บาท`;
  if (satang <= 0) text += "ถ้วน";
  else text += `${readNumber(satang)}สตางค์`;
  return neg ? `ลบ${text}` : text;
}
