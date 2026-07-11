"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { addLedgerEntry } from "@/lib/ledger";
import { parseDateInput, todayInputValue } from "@/lib/utils";

export default function TransferInPage() {
  return (
    <AuthGate>
      <TransferInView />
    </AuthGate>
  );
}

function TransferInView() {
  const { user, staff } = useAuth();
  const router = useRouter();
  const [date, setDate] = useState(todayInputValue());
  const [description, setDescription] = useState("โอนเข้า");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (staff && staff.role !== "owner") {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  if (staff?.role !== "owner") {
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    try {
      await addLedgerEntry({
        date: parseDateInput(date),
        description,
        amountIn: Number(amount),
        amountOut: 0,
        type: "โอนเข้า",
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
      <h1 className="panel-title">โอนเข้า</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        เจ้าของโอนเงินเข้าบัญชีร้าน — พนักงานบันทึกเงินออกอย่างเดียว
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
            required
          />
        </div>
        <div className="field">
          <label htmlFor="amount">จำนวนเงินเข้า (บาท)</label>
          <input
            id="amount"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="30000"
            required
          />
        </div>
        <button type="submit" className="primary-btn action-in" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึกโอนเข้า"}
        </button>
      </form>
    </div>
  );
}
