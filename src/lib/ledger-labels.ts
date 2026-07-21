const TYPE_LABELS: Record<string, string> = {
  auto: "อัตโนมัติจากชื่อรายการ",
  cogs: "ต้นทุน (cogs)",
  sga: "ค่าใช้จ่าย (sga)",
  asset: "สินทรัพย์ (asset)",
  อื่นๆ: "อื่นๆ",
  pos: "ขายหน้าร้าน (POS)",
  pos_void: "ยกเลิก POS",
  โอนเข้า: "โอนเข้า",
  ยอดยกมา: "ยอดยกมา",
};

export const BASE_TYPE_OPTIONS = [
  { value: "auto", label: "ให้ AI จัดประเภท" },
  { value: "cogs", label: TYPE_LABELS.cogs },
  { value: "sga", label: TYPE_LABELS.sga },
  { value: "asset", label: TYPE_LABELS.asset },
  { value: "อื่นๆ", label: TYPE_LABELS["อื่นๆ"] },
] as const;

export function labelLedgerType(type: string) {
  if (!type) return "";
  const key = type.trim();
  const lower = key.toLowerCase();
  if (lower === "asset" || lower === "assets") return TYPE_LABELS.asset;
  if (lower === "cogs" || lower === "cosg") return TYPE_LABELS.cogs;
  if (lower === "sga") return TYPE_LABELS.sga;
  return TYPE_LABELS[key] || TYPE_LABELS[lower] || key;
}

/** เดาหมวดจากชื่อรายการ — พนักงานไม่ต้องเลือกเอง */
export function guessTypeFromDescription(description: string): string {
  const text = description.trim().toLowerCase();
  if (!text) return "cogs";

  if (text.includes("ยกมา")) return "ยอดยกมา";
  if (text.includes("โอนเข้า")) return "โอนเข้า";

  // เครื่องดื่ม ≠ เครื่องจักร — ต้องเช็คก่อนคำว่า "เครื่อง"
  if (text.includes("เครื่องดื่ม") || text.includes("วัตถุดิบ") || text.includes("นม")) {
    return "cogs";
  }

  // ค่าขนส่งวัตถุดิบ/บรรจุภัณฑ์ → cogs (ก่อนกฎ "ขนส่ง" ทั่วไปที่เป็น sga)
  const freightMaterialHints = [
    "แก้ว",
    "หลอด",
    "ฝา",
    "น้ำแข็ง",
    "น้ำตาล",
    "ชานม",
    "ชา",
    "กาแฟ",
    "แป้ง",
    "วัตถุดิบ",
    "บรรจุภัณฑ์",
    "แพ็กเกจ",
    "package",
  ];
  const isFreight =
    text.includes("ขนส่ง") || text.includes("ค่าส่ง") || text.includes("ค่ารถส่ง") || text.includes("ค่าจัดส่ง");
  if (isFreight && freightMaterialHints.some((h) => text.includes(h))) {
    return "cogs";
  }
  // ซื้อ/สั่ง แก้ว หลอด ฯลฯ โดยตรง
  if (["แก้ว", "หลอด", "ฝา", "น้ำแข็ง"].some((h) => text.includes(h))) {
    return "cogs";
  }

  const assetHints = ["ซื้อเครื่อง", "เครื่องใหม่", "ตู้เย็น", "ตู้แช่", "แอร์ใหม่", "อุปกรณ์ถาวร", "สินทรัพย์"];
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
    "ซ่อม",
    "ส่งเครื่อง",
  ];
  if (sgaHints.some((h) => text.includes(h))) return "sga";

  // คำว่า "เครื่อง"/"ตู้"/"แอร์" ที่ไม่ใช่เครื่องดื่ม — มักเป็น asset
  const stripped = text.replace(/เครื่องดื่ม/g, "");
  if (stripped.includes("เครื่อง") || stripped.includes("ตู้") || stripped.includes("แอร์")) {
    return "asset";
  }

  // ของใช้ทำเครื่องดื่ม / สั่งซื้อวัตถุดิบ → cogs
  return "cogs";
}

/** Frequent non-empty types from history, most used first. */
export function frequentTypes(
  entries: { type?: string }[],
  limitCount = 8,
): string[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    const raw = (e.type || "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase() === "asset" ? "asset" : raw.toLowerCase() === "cogs" ? "cogs" : raw.toLowerCase() === "sga" ? "sga" : raw;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limitCount)
    .map(([k]) => k);
}

/** Smart filter for type chips / search. */
export function filterTypeOptions(options: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((opt) => {
    const label = labelLedgerType(opt).toLowerCase();
    return opt.toLowerCase().includes(q) || label.includes(q);
  });
}
