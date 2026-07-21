"use client";

/** ติ๊กเมื่อต้องการให้ AI อ่านรูปด้วย — ค่าเริ่มต้นปิด เพื่อไม่เสียเวลา/ค่าใช้จ่าย */
export function AiUseImagesCheckbox({
  checked,
  onChange,
  disabled,
  hasImages,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hasImages: boolean;
}) {
  if (!hasImages) return null;
  return (
    <label className="ledger-ai-use-images">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        ใช้รูปช่วยจัดประเภท
        <span className="ledger-ai-use-images-hint"> — ช้ากว่า ใช้เมื่อชื่อสั้น/กำกวม</span>
      </span>
    </label>
  );
}
