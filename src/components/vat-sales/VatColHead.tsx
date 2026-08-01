"use client";

/** หัวคอลัมน์ + ปุ่ม info เล็ก ๆ (title = อธิบายหลักการ) */
export function VatColHead({
  label,
  info,
  className = "col-num",
}: {
  label: string;
  info: string;
  className?: string;
}) {
  return (
    <th className={className} title={info}>
      <span className="vat-col-head">
        {label}
        <span className="vat-col-info" aria-label={info} title={info}>
          i
        </span>
      </span>
    </th>
  );
}
