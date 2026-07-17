"use client";

import { useEffect, useState, type FormEvent } from "react";
import { saveOtSettings } from "@/lib/ot";
import {
  addRateScheduleEntry,
  getRateSchedule,
  resolveRateForDate,
} from "@/lib/rate-schedule";
import { parseDateInput, todayInputValue } from "@/lib/utils";

export function OtBonusRateSetup({
  bonusRate,
  createdBy,
  onReload,
  onError,
}: {
  bonusRate: number;
  createdBy: string;
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
      const nextRate = Number(rate);
      await saveOtSettings(nextRate);

      // บันทึกเป็นช่วงในตารางเรท (หน้าโบนัส) เมื่อต่างจากเรทที่ใช้อยู่วันนี้
      // ไม่แตะ bonusRate บนแถวชงที่มีอยู่แล้ว
      const today = todayInputValue();
      const schedule = await getRateSchedule();
      const active = resolveRateForDate(schedule.entries, "ot", parseDateInput(today));
      if (!active || active.rate !== nextRate) {
        await addRateScheduleEntry({
          kind: "ot",
          effectiveFromInput: today,
          rate: nextRate,
          note: "จากหน้าตั้งค่า",
          createdBy: createdBy || "owner",
        });
      }

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
        โบนัส/คน = (เครื่อง + อื่นๆ + โคน + ขนมปัง − เคลม − ลด + เพิ่ม) × เรท ÷ จำนวนคน · กำหนดช่วงเรทตามวันได้ที่{" "}
        <a href="/bonus/" style={{ fontWeight: 700 }}>
          สรุปโบนัส
        </a>
        {" "}· พนักงานอยู่ที่{" "}
        <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
      </p>

      <form className="form-card entry-form" onSubmit={(e) => void onSave(e)}>
        <h3 className="panel-title" style={{ fontSize: "1rem" }}>เรทโบนัส / หน่วย (เริ่มวันนี้)</h3>
        <div className="field">
          <label htmlFor="ot-rate">บาทต่อหน่วย</label>
          <input
            id="ot-rate"
            type="number"
            min="0"
            step="any"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
          />
          <p className="muted form-hint-inline">
            ใช้กับรายการชงใหม่หลังบันทึก — แถวเก่าในตารางไม่เปลี่ยนเรท
          </p>
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึกเรท"}
        </button>
      </form>
    </section>
  );
}
