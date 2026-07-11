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
