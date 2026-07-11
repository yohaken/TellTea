const TYPE_LABELS: Record<string, string> = {
  cogs: "ต้นทุน (cogs)",
  sga: "ค่าใช้จ่าย (sga)",
  asset: "สินทรัพย์ (asset)",
  โอนเข้า: "โอนเข้า",
  ยอดยกมา: "ยอดยกมา",
};

export function labelLedgerType(type: string) {
  if (!type) return "";
  return TYPE_LABELS[type] || type;
}

/** เดาหมวดจากชื่อรายการ — พนักงานไม่ต้องเลือกเอง */
export function guessTypeFromDescription(description: string): string {
  const text = description.trim().toLowerCase();
  if (!text) return "cogs";

  if (text.includes("ยกมา")) return "ยอดยกมา";
  if (text.includes("โอนเข้า")) return "โอนเข้า";

  const assetHints = ["เครื่อง", "ตู้", "แอร์", "อุปกรณ์ถาวร", "สินทรัพย์"];
  if (assetHints.some((h) => text.includes(h))) return "asset";

  const sgaHints = [
    "ค่าแรง",
    "โบนัส",
    "ค่าไฟ",
    "ค่าน้ำประปา",
    "ค่าเน็ต",
    "ค่าขนส่ง",
    "ขนส่ง",
    "ล้างแอร์",
    "ทดลองงาน",
    "diy",
    "ไม้กวาด",
    "แปรง",
    "ค่าเช่า",
  ];
  if (sgaHints.some((h) => text.includes(h))) return "sga";

  // ของใช้ทำเครื่องดื่ม / สั่งซื้อวัตถุดิบ → cogs
  return "cogs";
}
