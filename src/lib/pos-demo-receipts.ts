/**
 * ข้อมูลบิลจำลองสำหรับทดสอบ POS (localStorage)
 */
import type { PosLocalReceipt, PosLocalReceiptLine } from "./pos-local-receipts";
import { appendLocalReceipt, listLocalReceiptsRecent, readAllLocalReceipts, writeAllLocalReceipts } from "./pos-local-receipts";

const DEMO_MENU: Array<{
  name: string;
  price: number;
  mods?: string[];
}> = [
  { name: "ชานมไข่มุก", price: 45, mods: ["หวาน 50%", "ไข่มุก"] },
  { name: "ชาเขียวนม", price: 40, mods: ["หวาน 25%", "น้ำแข็งปกติ"] },
  { name: "กาแฟสด อเมริกาโน่ ร้อน 12 ออนซ์", price: 55 },
  { name: "บลูเบอร์รี่สมูทตี้ แก้วใหญ่", price: 65, mods: ["หวาน 0%"] },
  { name: "มัทฉะลาเต้", price: 55, mods: ["หวาน 50%", "โอ๊ตมิลค์"] },
  { name: "ช็อกโกแลตปั่น", price: 60, mods: ["หวาน 75%"] },
  { name: "โกโก้ร้อน", price: 35 },
  { name: "น้ำส้มคั้น", price: 45 },
  { name: "ชาไทยเย็น", price: 40, mods: ["หวาน 100%"] },
  { name: "คุกกี้ช็อกโกแลตชิป", price: 35 },
  { name: "เค้กช็อกโกแลต", price: 75 },
  { name: "วaffle น้ำผึ้ง", price: 89 },
  { name: "ไอศกรีมซอฟต์เสิร์ฟ (กลาง)", price: 15 },
  { name: "บิงซูมะม่วง", price: 129 },
  { name: "ชาแดงไข่มุก", price: 45, mods: ["หวาน 50%"] },
];


function randomBillNo(seq: number): string {
  return `DV${String(seq).padStart(3, "0")}`;
}

function buildDemoReceipt(seq: number, sessionId: string, createdAt: number): PosLocalReceipt {
  const lineCount = 1 + Math.floor(Math.random() * 3);
  const used = new Set<number>();
  const lines: PosLocalReceiptLine[] = [];
  let subtotal = 0;

  for (let i = 0; i < lineCount; i += 1) {
    let idx = Math.floor(Math.random() * DEMO_MENU.length);
    while (used.has(idx) && used.size < DEMO_MENU.length) {
      idx = Math.floor(Math.random() * DEMO_MENU.length);
    }
    used.add(idx);
    const item = DEMO_MENU[idx]!;
    const qty = Math.random() < 0.75 ? 1 : 2;
    subtotal += item.price * qty;
    lines.push({
      name: item.name,
      qty,
      unitPrice: item.price,
      options: item.mods?.length
        ? [{ groupName: "ตัวเลือก", choiceNames: item.mods }]
        : [],
    });
  }

  const total = Math.round(subtotal * 100) / 100;
  const paymentMethod = Math.random() < 0.55 ? "cash" : "promptpay";
  const cashReceived = paymentMethod === "cash" ? Math.ceil(total / 20) * 20 : undefined;
  const change =
    paymentMethod === "cash" && cashReceived != null
      ? Math.round((cashReceived - total) * 100) / 100
      : undefined;

  return {
    id: `demo_${seq}_${createdAt}`,
    billNo: randomBillNo(seq),
    sessionId,
    total,
    paymentMethod,
    linePreview: lines.map((l) => `${l.name}×${l.qty}`).join(", "),
    lines,
    cashReceived,
    change,
    createdAt,
    pending: Math.random() < 0.15,
  };
}

export type DemoSeedResult = {
  added: number;
  total: number;
};

/** สร้างบิลจำลอง 10–25 รายการ (สุ่มจำนวน) */
export function seedDemoLocalReceipts(sessionId = "demo-session"): DemoSeedResult {
  const count = 10 + Math.floor(Math.random() * 16);
  const now = Date.now();
  const existing = readAllLocalReceipts();
  const maxSeq = existing.reduce((n, r) => {
    const m = /^DV(\d+)$/.exec(r.billNo);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);

  const rows: PosLocalReceipt[] = [];
  for (let i = 0; i < count; i += 1) {
    const hoursAgo = Math.floor(Math.random() * 10 * 60) * 60_000;
    const minutesOffset = Math.floor(Math.random() * 60) * 60_000;
    const createdAt = now - hoursAgo - minutesOffset - i * 120_000;
    rows.push(buildDemoReceipt(maxSeq + i + 1, sessionId, createdAt));
  }

  writeAllLocalReceipts([...existing, ...rows]);
  return { added: count, total: readAllLocalReceipts().length };
}

/** เติมข้อมูลทดสอบถ้ายังไม่มีบิลใน 7 วัน */
export function seedDemoLocalReceiptsIfEmpty(sessionId?: string): DemoSeedResult | null {
  if (listLocalReceiptsRecent(7).length > 0) return null;
  return seedDemoLocalReceipts(sessionId || "demo-session");
}

/** ใช้ append ทีละรายการ (สำหรับทดสอบเดี่ยว) */
export function appendDemoReceipt(sessionId: string): PosLocalReceipt {
  const existing = readAllLocalReceipts();
  const maxSeq = existing.reduce((n, r) => {
    const m = /^DV(\d+)$/.exec(r.billNo);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);
  const receipt = buildDemoReceipt(maxSeq + 1, sessionId, Date.now());
  appendLocalReceipt(receipt);
  return receipt;
}

export function isDemoReceipt(receipt: PosLocalReceipt): boolean {
  return receipt.id.startsWith("demo_");
}
