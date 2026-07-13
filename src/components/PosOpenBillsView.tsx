"use client";

import { PosHardLink } from "@/components/PosHardLink";
import { usePosApp } from "@/lib/pos-app-context";

export function PosOpenBillsView() {
  const { selling } = usePosApp();

  return (
    <div className="pos-module">
      <div className="pos-module-content pos-module-empty">
        <h2>บิลที่เปิดอยู่</h2>
        {selling ? (
          <>
            <p className="muted">บิลปัจจุบันอยู่ที่หน้าขาย — แผงตะกร้าด้านขวา</p>
            <PosHardLink href="/pos/sell/" className="primary-btn">
              ไปหน้าสั่งและชำระเงิน
            </PosHardLink>
          </>
        ) : (
          <p className="muted">เปิดรอบขายก่อนเพื่อเริ่มบิลใหม่</p>
        )}
      </div>
    </div>
  );
}
