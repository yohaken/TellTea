"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const SIGNUP_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicMemberSignup";

function JoinForm() {
  const params = useSearchParams();
  const token = useMemo(() => (params.get("t") || params.get("token") || "").trim(), [params]);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ displayName: string; cardNo: string; points: number } | null>(
    null,
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("ลิงก์ไม่ครบ — ขอ QR จากร้านอีกครั้ง");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(SIGNUP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, phone, displayName: name }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        found?: boolean;
        error?: string;
        member?: { displayName?: string; cardNo?: string; pointsBalance?: number };
      };
      if (!data.ok || data.error) {
        const map: Record<string, string> = {
          bad_token: "ลิงก์หมดอายุหรือไม่ถูกต้อง",
          public_off: "ร้านยังไม่เปิดสมัครผ่าน QR",
          disabled: "ระบบสมาชิกปิดอยู่",
          invalid_phone: "เบอร์โทรไม่ถูกต้อง",
        };
        setError(map[data.error || ""] || data.error || "สมัครไม่สำเร็จ");
        return;
      }
      const m = data.member;
      setDone({
        displayName: m?.displayName || name || phone,
        cardNo: m?.cardNo || "—",
        points: typeof m?.pointsBalance === "number" ? m.pointsBalance : 0,
      });
    } catch {
      setError("เชื่อมต่อไม่ได้ ลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="join-page">
      <div className="join-card">
        <p className="join-brand">TellTea</p>
        <h1>สมัครสมาชิก</h1>
        <p className="muted">สะสมแต้มเมื่อซื้อที่ร้าน · สาขาเดียว</p>
        {!token ? (
          <p className="join-error">ลิงก์ไม่ครบ — สแกน QR จากร้านอีกครั้ง</p>
        ) : done ? (
          <div className="join-done">
            <p>
              ยินดีต้อนรับ <strong>{done.displayName}</strong>
            </p>
            <p className="muted">บัตร {done.cardNo}</p>
            <p>
              แต้มปัจจุบัน <strong>{done.points}</strong>
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="join-form">
            <label>
              <span>เบอร์โทร</span>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                disabled={busy}
                placeholder="08x-xxx-xxxx"
              />
            </label>
            <label>
              <span>ชื่อเรียก</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                placeholder="ชื่อเล่น"
              />
            </label>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังสมัคร..." : "สมัครสมาชิก"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main className="join-page"><p className="muted">กำลังโหลด...</p></main>}>
      <JoinForm />
    </Suspense>
  );
}
