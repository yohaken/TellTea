/** Customer-facing redeem value — shown on /claim and /me from first glance. */
export function ClaimPointsValueNote({ className = "" }: { className?: string }) {
  return (
    <div className={`claim-value-note ${className}`.trim()}>
      <p className="claim-value-note-lead">
        <strong>1 แต้ม = ส่วนลด 1 บาท</strong>
      </p>
      <p className="claim-value-note-sub">
        ใช้ลดยอดตอนจ่ายครั้งหน้าที่ร้าน · ไม่ต้องรอครบแก้ว
      </p>
    </div>
  );
}
