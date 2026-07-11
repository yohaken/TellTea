"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { addLedgerEntry } from "@/lib/ledger";
import { guessTypeFromDescription, labelLedgerType } from "@/lib/ledger-labels";
import { parseDateInput, todayInputValue } from "@/lib/utils";

const TYPE_OPTIONS = [
  { value: "auto", label: "อัตโนมัติจากชื่อรายการ" },
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
  const { user, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [date, setDate] = useState(todayInputValue());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [typeMode, setTypeMode] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoType = useMemo(() => guessTypeFromDescription(description), [description]);
  const resolvedType = typeMode === "auto" ? autoType : typeMode;

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
        type: resolvedType,
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
        ใส่แค่วันที่ รายการ และจำนวนเงิน — หมวดระบบจัดให้อัตโนมัติ
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

        {isOwner ? (
          <div className="field">
            <label htmlFor="type">หมวด (เจ้าของแก้ได้ · พนักงานไม่เห็นช่องนี้)</label>
            <select id="type" value={typeMode} onChange={(e) => setTypeMode(e.target.value)}>
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {typeMode === "auto" && description ? (
              <p className="muted" style={{ marginTop: "0.35rem", textAlign: "left" }}>
                จะบันทึกเป็น: {labelLedgerType(autoType)}
              </p>
            ) : null}
          </div>
        ) : null}

        <button type="submit" className="primary-btn action-out" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึกเงินออก"}
        </button>
      </form>
    </div>
  );
}
