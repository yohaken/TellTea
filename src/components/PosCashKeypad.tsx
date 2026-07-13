"use client";

import { formatPlainNumber } from "@/lib/utils";

const BILLS = [20, 50, 100, 500, 1000] as const;
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export function parseCashAmount(raw: string): number {
  const n = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

type PosCashKeypadProps = {
  total: number;
  value: string;
  onChange: (next: string) => void;
};

export function PosCashKeypad({ total, value, onChange }: PosCashKeypadProps) {
  const received = parseCashAmount(value);
  const enough = received >= total;
  const change = enough ? Math.round((received - total) * 100) / 100 : 0;

  function addBill(amount: number) {
    const next = Math.round((received + amount) * 100) / 100;
    onChange(next > 0 ? String(next) : "");
  }

  function setExact() {
    onChange(String(Math.ceil(total)));
  }

  function clearAll() {
    onChange("");
  }

  function appendDigit(digit: string) {
    onChange(value ? `${value}${digit}` : digit);
  }

  function backspace() {
    onChange(value.slice(0, -1));
  }

  return (
    <div className="pos-cash-keypad" aria-label="รับเงินสด">
      <div className="pos-cash-keypad-display" aria-live="polite">
        <span className="pos-cash-keypad-label">รับเงินมา</span>
        <strong className="pos-cash-keypad-amount">
          {value ? `฿${formatPlainNumber(received)}` : "—"}
        </strong>
      </div>

      <p className={`pos-cash-keypad-change ${enough ? "ok-text" : "error-text"}`}>
        ทอน {enough ? `฿${formatPlainNumber(change)}` : "— เงินไม่พอ"}
      </p>

      <button type="button" className="pos-cash-keypad-exact" onClick={setExact}>
        ตรงพอดี
        <span>฿{formatPlainNumber(total)}</span>
      </button>

      <div className="pos-cash-keypad-bills" role="group" aria-label="แบงก์">
        {BILLS.map((amt) => (
          <button key={amt} type="button" className="pos-cash-keypad-bill" onClick={() => addBill(amt)}>
            +฿{amt}
          </button>
        ))}
        <button type="button" className="pos-cash-keypad-bill pos-cash-keypad-bill--clear" onClick={clearAll}>
          ล้าง
        </button>
      </div>

      <div className="pos-cash-keypad-pad" role="group" aria-label="ตัวเลข">
        {DIGITS.slice(0, 9).map((d) => (
          <button key={d} type="button" className="pos-cash-keypad-digit" onClick={() => appendDigit(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="pos-cash-keypad-digit pos-cash-keypad-digit--wide" onClick={() => appendDigit("0")}>
          0
        </button>
        <button type="button" className="pos-cash-keypad-digit" onClick={backspace} aria-label="ลบตัวเลข">
          ⌫
        </button>
      </div>
    </div>
  );
}
