"use client";

/** หัวคอลัมน์ + ป้ายบทบาทสั้น + ปุ่ม info (title = อธิบายหลักการ) */
export function VatColHead({
  label,
  info,
  role,
  className = "col-num",
}: {
  label: string;
  info: string;
  /** บทบาทสั้นใต้ชื่อ เช่น → VAT · → รายได้ · อ้างอิง */
  role?: string;
  className?: string;
}) {
  return (
    <th className={className} title={info}>
      <span className="vat-col-head">
        <span className="vat-col-head-text">
          <span className="vat-col-head-label">
            {label}
            <span className="vat-col-info" aria-label={info} title={info}>
              i
            </span>
          </span>
          {role ? <span className="vat-col-head-role">{role}</span> : null}
        </span>
      </span>
    </th>
  );
}
