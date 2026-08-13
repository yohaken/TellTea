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
  isSpinCreditRetryable,
  spinCreditErrorLabel,
} from "@/lib/points-spin-credit";
import type { SpinResult } from "@/lib/points-multiplier-spin";

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
  const [creditRetryable, setCreditRetryable] = useState(false);
  const [lastSpinResult, setLastSpinResult] = useState<SpinResult | null>(null);
  const [done, setDone] = useState<{
    displayName: string;
    cardNo: string;
    points: number;
  } | null>(null);

  useEffect(() => subscribePointsSpinSettings(setSpinSettings), []);

  const spinLive =
    !POINTS_GAMES_KILL_SWITCH && isPointsGameEnabled(spinSettings, "spin");

  async function applySpinCredit(result: SpinResult, playTok: string) {
    setCreditNote("กำลังบันทึกแต้ม…");
    setCreditRetryable(false);
    const r = await creditSpinGamePoints({
      context: "join",
      playToken: playTok,
      points: result.points,
      gameId: "spin",
    });
    if (r.ok && !r.skipped && typeof r.balanceAfter === "number") {
      setDone((prev) => (prev ? { ...prev, points: r.balanceAfter as number } : prev));
      setCreditNote(
        result.points === 0
          ? `รอบนี้ไม่ได้แต้มเพิ่มจากเกม · คงเหลือ ${r.balanceAfter}`
          : `บันทึกแล้ว +${result.points} · รวม ${r.balanceAfter} แต้ม`,
      );
      setLastSpinResult(null);
      return;
    }
    if (r.skipped === "already_played") {
      if (typeof r.balanceAfter === "number") {
        setDone((prev) => (prev ? { ...prev, points: r.balanceAfter as number } : prev));
        setCreditNote(`หมุนรอบนี้ไปแล้ว · คงเหลือ ${r.balanceAfter} แต้ม`);
      } else {
        setCreditNote("หมุนรอบนี้ไปแล้ว");
      }
      setLastSpinResult(null);
      return;
    }
    setCreditNote(spinCreditErrorLabel(r.error));
    setCreditRetryable(isSpinCreditRetryable(r.error));
    setLastSpinResult(result);
  }

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
      const playTok = typeof data.spinPlayToken === "string" ? data.spinPlayToken : "";
      setSpinPlayToken(playTok);
      setDone({
        displayName: m?.displayName || name || phone,
        cardNo: m?.cardNo || "—",
        points: typeof m?.pointsBalance === "number" ? m.pointsBalance : 0,
      });
      if (!playTok) {
        setCreditNote(
          spinLive
            ? "รอบนี้ยังไม่มีสิทธิ์หมุน (อาจหมุนไปแล้ว หรือร้านปิดเกมตอนสมัคร)"
            : null,
        );
      }
    } catch {
      setError("เชื่อมต่อไม่ได้ ลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  const showAttract = spinLive && !done;
  /** เซิร์ฟเวอร์ออกโทเคนแล้ว = มีสิทธิ์หมุน แม้ snapshot ช้า/ปิดทีหลังกลางเซสชัน */
  const showGame = !!done && !!spinPlayToken;

  return (
    <main className={`join-page${showAttract ? " join-page--attract" : ""}`}>
      {showAttract ? <PointsGamesAttractBg liveSettings basePoints={5} /> : null}
      <div className="join-card">
        <p className="join-brand">TellTea</p>
        <h1>สมัครสมาชิก</h1>
        <p className="muted">
          {showAttract
            ? "ด้านหลังมีวงล้อหมุนอยู่ · สมัครแล้วหมุนลุ้นแต้มได้เพิ่ม 0–5"
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
            {showGame && spinSettings ? (
              <PointsGameOnce
                settings={spinSettings}
                basePoints={Math.max(1, done.points)}
                creditNote={creditNote}
                creditRetryable={creditRetryable}
                onRetryCredit={() => {
                  if (!lastSpinResult || !spinPlayToken) return;
                  void applySpinCredit(lastSpinResult, spinPlayToken);
                }}
                onFinished={({ result }) => {
                  void applySpinCredit(result, spinPlayToken);
                }}
              />
            ) : null}
            {done && !showGame && creditNote ? (
              <p className="muted" style={{ marginTop: "0.75rem" }}>
                {creditNote}
              </p>
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
