"use client";

/**
 * หมวดจัดการ Pos — ว่างไว้ชั่วคราว
 * (เคยมีเมนู/เครื่องเว็บ — ย้ายไป native แล้ว · เว็บ POS จริงยังไม่ลบ)
 */
export function PosManagePanel(_props: { onError: (msg: string | null) => void }) {
  return (
    <div className="owner-settings-stack pos-manage-stack">
      <p className="muted pos-manage-lead empty" style={{ textAlign: "left", marginTop: "0.5rem" }}>
        ยังไม่มีรายการจัดการในหน้านี้
      </p>
    </div>
  );
}
