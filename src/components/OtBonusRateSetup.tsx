"use client";

import { useEffect, useState, type FormEvent } from "react";
import { saveOtSettings } from "@/lib/ot";

export function OtBonusRateSetup({
  bonusRate,
  onReload,
  onError,
}: {
  bonusRate: number;
  onReload: () => void;
  onError: (msg: string) => void;
}) {
  const [rate, setRate] = useState(String(bonusRate));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRate(String(bonusRate));
  }, [bonusRate]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await saveOtSettings(Number(rate));
      onReload();
    } catch (err) {
      onError((err as Error).message || "บันทึกเรทไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="owner-settings-section">
      <h2 className="owner-settings-title">โบนัสชง</h2>
      <p className="muted owner-settings-hint">
        โบนัส/คน = (เครื่อง + อื่นๆ + โคน + ขนมปัง − เคลม − ลด + เพิ่ม) × เรท ÷ จำนวนคน · พนักงานอยู่ที่{" "}
        <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
      </p>

      <form className="form-card entry-form" onSubmit={(e) => void onSave(e)}>
        <h3 className="panel-title" style={{ fontSize: "1rem" }}>เรทโบนัส / หน่วย</h3>
        <div className="field">
          <label htmlFor="ot-rate">บาทต่อหน่วย</label>
          <input
            id="ot-rate"
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึกเรท"}
        </button>
      </form>
    </section>
  );
}
