"use client";

/** หัวคอลัมน์ + ป้ายบทบาทสั้น + ปุ่ม info (title = อธิบายหลักการ · onInfo = แตะเปิด popup) */
export function VatColHead({
  label,
  info,
  role,
  className = "col-num",
  onInfo,
}: {
  label: string;
  info: string;
  /** บทบาทสั้นใต้ชื่อ เช่น → VAT · → รายได้ · อ้างอิง */
  role?: string;
  className?: string;
  onInfo?: () => void;
}) {
  return (
    <th className={className} title={info}>
      <span className="vat-col-head">
        <span className="vat-col-head-text">
          <span className="vat-col-head-label">
            {label}
            {onInfo ? (
              <button
                type="button"
                className="vat-col-info vat-col-info-btn"
                aria-label={`ที่มา ${label}`}
                onClick={onInfo}
              >
                i
              </button>
            ) : (
              <span className="vat-col-info" aria-label={info} title={info}>
                i
              </span>
            )}
          </span>
          {role ? <span className="vat-col-head-role">{role}</span> : null}
        </span>
      </span>
    </th>
  );
}
