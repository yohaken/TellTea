"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PointsGamesAttractBg } from "@/components/PointsGamesAttractBg";
import { PointsGameOnce } from "@/components/PointsGameOnce";
import { POINTS_GAMES_KILL_SWITCH } from "@/lib/points-games";
import {
  isPointsGameEnabled,
  subscribePointsSpinSettings,
  type PointsSpinSettings,
} from "@/lib/points-spin-settings";
import {
  creditSpinGamePoints,
  spinCreditErrorLabel,
} from "@/lib/points-spin-credit";

const SIGNUP_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicMemberSignup";

function JoinForm() {
  const params = useSearchParams();
  const token = useMemo(() => (params.get("t") || params.get("token") || "").trim(), [params]);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spinSettings, setSpinSettings] = useState<PointsSpinSettings | null>(null);
  const [spinPlayToken, setSpinPlayToken] = useState("");
  const [creditNote, setCreditNote] = useState<string | null>(null);
  const [done, setDone] = useState<{
    displayName: string;
    cardNo: string;
    points: number;
  } | null>(null);

  useEffect(() => subscribePointsSpinSettings(setSpinSettings), []);

  const spinLive =
    !POINTS_GAMES_KILL_SWITCH && isPointsGameEnabled(spinSettings, "spin");

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
        spinPlayToken?: string;
        spinGameEnabled?: boolean;
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
      setSpinPlayToken(typeof data.spinPlayToken === "string" ? data.spinPlayToken : "");
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

  const showAttract = spinLive && !done;
  const showGame = spinLive && !!done && !!spinPlayToken;

  return (
    <main className={`join-page${showAttract ? " join-page--attract" : ""}`}>
      {showAttract ? <PointsGamesAttractBg liveSettings basePoints={5} /> : null}
      <div className="join-card">
        <p className="join-brand">TellTea</p>
        <h1>สมัครสมาชิก</h1>
        <p className="muted">
          {showAttract
            ? "ด้านหลังมีวงล้อหมุนอยู่ · สมัครแล้วหมุนลุ้นได้ 0–5 แต้ม"
            : "สะสมแต้มเมื่อซื้อที่ร้าน · สาขาเดียว"}
        </p>
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
            {showGame ? (
              <PointsGameOnce
                liveSettings
                basePoints={Math.max(1, done.points)}
                creditNote={creditNote}
                onFinished={({ result }) => {
                  setCreditNote("กำลังบันทึกแต้ม…");
                  void creditSpinGamePoints({
                    context: "join",
                    playToken: spinPlayToken,
                    points: result.points,
                    gameId: "spin",
                  }).then((r) => {
                    if (r.ok && !r.skipped && typeof r.balanceAfter === "number") {
                      setDone((prev) =>
                        prev ? { ...prev, points: r.balanceAfter as number } : prev,
                      );
                      setCreditNote(
                        result.points === 0
                          ? `รอบนี้ไม่ได้แต้มเพิ่ม · คงเหลือ ${r.balanceAfter}`
                          : `บันทึกแล้ว +${result.points} · รวม ${r.balanceAfter} แต้ม`,
                      );
                      return;
                    }
                    if (r.skipped === "already_played") {
                      setCreditNote("หมุนรอบนี้ไปแล้ว");
                      return;
                    }
                    setCreditNote(spinCreditErrorLabel(r.error));
                  });
                }}
              />
            ) : null}
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
