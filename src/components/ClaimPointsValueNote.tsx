/** Short customer-facing redeem value — shown on /claim and /me. */
export function ClaimPointsValueNote({ className = "" }: { className?: string }) {
  return (
    <p className={`claim-value-note ${className}`.trim()}>
      <strong>1 แต้ม = 1 บาท</strong>
      {" · "}ใช้ลดยอดตอนจ่ายครั้งถัดไปที่ร้าน TellTea
    </p>
  );
}
