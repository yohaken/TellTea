"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { addLedgerEntry } from "@/lib/ledger";
import { parseDateInput, todayInputValue } from "@/lib/utils";

const TYPE_OPTIONS = [
  { value: "cogs", label: "ต้นทุน (cogs)" },
  { value: "sga", label: "ค่าใช้จ่าย (sga)" },
  { value: "asset", label: "สินทรัพย์ (asset)" },
  { value: "อื่นๆ", label: "อื่นๆ" },
];

export default function MoneyOutPage() {
  return (
    <AuthGate>
      <MoneyOutView />
    </AuthGate>
  );
}

function MoneyOutView() {
  const { user } = useAuth();
  const router = useRouter();
  const [date, setDate] = useState(todayInputValue());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("cogs");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    try {
      await addLedgerEntry({
        date: parseDateInput(date),
        description,
        amountIn: 0,
        amountOut: Number(amount),
        type,
        createdBy: user.email,
      });
      router.replace("/ledger/");
    } catch (err) {
      setError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="panel-title">บันทึกเงินออก</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        โอนสั่งซื้อของ / จ่ายค่าใช้จ่าย แล้วบันทึกรายการเงินออก
      </p>
      {error ? <p className="error-text">{error}</p> : null}

      <form className="form-card" onSubmit={(e) => void onSubmit(e)}>
        <div className="field">
          <label htmlFor="date">วันที่</label>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="description">รายการ</label>
          <input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="เช่น ค่าน้ำแข็ง / แม็คโคร"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="type">หมวด</label>
          <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="amount">จำนวนเงินออก (บาท)</label>
          <input
            id="amount"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="250"
            required
          />
        </div>
        <button type="submit" className="primary-btn action-out" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึกเงินออก"}
        </button>
      </form>
    </div>
  );
}
