/** Customer-facing redeem value + how-to — shown on /claim and /me from first glance. */
export function ClaimPointsValueNote({ className = "" }: { className?: string }) {
  return (
    <div className={`claim-value-note ${className}`.trim()}>
      <p className="claim-value-note-lead">
        <strong>1 แต้ม = ส่วนลด 1 บาท</strong>
      </p>
      <ol className="claim-value-note-steps">
        <li>สแกน QR รับแต้มจากบิล</li>
        <li>ครั้งหน้าบอกเบอร์ตอนจ่าย</li>
        <li>ใช้แต้มลดยอดได้เลย · ไม่ต้องรอครบแก้ว</li>
      </ol>
    </div>
  );
}
