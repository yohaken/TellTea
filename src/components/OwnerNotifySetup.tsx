"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Bell } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { SettingsFold } from "@/components/SettingsFold";
import { useAuth } from "@/lib/auth";
import { getDb, getFirebaseFunctions } from "@/lib/firebase";
import { getLedgerBalance } from "@/lib/ledger";
import {
  DEFAULT_ALERT_SETTINGS,
  getAlertSettings,
  saveAlertSettings,
} from "@/lib/settings";
import {
  DEFAULT_OWNER_NOTIFY,
  formatHourLabel,
  getOwnerNotifySettings,
  lineReady,
  maskSecret,
  saveOwnerNotifySettings,
  type OwnerNotifySettings,
} from "@/lib/owner-notify";
import { formatBaht } from "@/lib/utils";

type Props = {
  onError: (msg: string | null) => void;
};

type AlertStatus = {
  balance: number | null;
  active: boolean;
  lastLineOk: boolean | null;
  lastError: string;
  lastAttemptAt: number;
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);

async function loadAlertStatus(): Promise<AlertStatus> {
  const [balance, snap] = await Promise.all([
    getLedgerBalance().catch(() => null),
    getDoc(doc(getDb(), "meta", "lowBalanceAlert")),
  ]);
  const data = snap.exists() ? snap.data() : {};
  const last = data.lastLineResult as { ok?: boolean; error?: string } | undefined;
  return {
    balance: typeof balance === "number" && Number.isFinite(balance) ? balance : null,
    active: Boolean(data.active),
    lastLineOk: last ? Boolean(last.ok) : null,
    lastError: String(last?.error || ""),
    lastAttemptAt: Number(data.lastAttemptAt || data.lastLineAt || 0),
  };
}

/** ตั้งค่าแจ้งเตือนเจ้าของ → LINE โดยเฉพาะ (ทันทีตามเงื่อนไข + สรุปรายวัน) */
export function OwnerNotifySetup({ onError }: Props) {
  const { user, actorId } = useAuth();
  const [threshold, setThreshold] = useState(
    String(DEFAULT_ALERT_SETTINGS.lowBalanceThreshold),
  );
  const [lowEnabled, setLowEnabled] = useState(true);
  const [notify, setNotify] = useState<OwnerNotifySettings>({
    ...DEFAULT_OWNER_NOTIFY,
  });
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenDirty, setTokenDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<AlertStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [alerts, line, st] = await Promise.all([
          getAlertSettings(),
          getOwnerNotifySettings(),
          loadAlertStatus(),
        ]);
        if (cancelled) return;
        setThreshold(String(alerts.lowBalanceThreshold));
        setLowEnabled(alerts.lowBalanceEnabled);
        setNotify(line);
        setTokenDraft("");
        setTokenDirty(false);
        setStatus(st);
      } catch (err) {
        if (!cancelled) {
          onError((err as Error).message || "โหลดตั้งค่าแจ้งเตือนไม่สำเร็จ");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    onError(null);
    try {
      const actor = actorId || user?.email || "owner";
      await saveAlertSettings(
        {
          lowBalanceThreshold: Number(threshold),
          lowBalanceEnabled: lowEnabled,
        },
        actor,
      );
      const tokenToSave = tokenDirty
        ? tokenDraft.trim()
        : notify.channelAccessToken;
      await saveOwnerNotifySettings(
        {
          channelAccessToken: tokenToSave,
          lineUserId: notify.lineUserId,
          instantLineEnabled: notify.instantLineEnabled,
          instantHourStart: notify.instantHourStart,
          instantHourEnd: notify.instantHourEnd,
          dailyDigestEnabled: notify.dailyDigestEnabled,
          digestHour: notify.digestHour,
          includeLowBalance: notify.includeLowBalance,
          includeBillNotices: notify.includeBillNotices,
          includeYesterdaySales: notify.includeYesterdaySales,
          includeMemberCount: notify.includeMemberCount,
          webPushOnDigest: notify.webPushOnDigest,
          webPushOnInstant: notify.webPushOnInstant,
        },
        actor,
      );
      const refreshed = await getOwnerNotifySettings();
      setNotify(refreshed);
      setTokenDraft("");
      setTokenDirty(false);
      setMsg("บันทึกตั้งค่าแจ้งเตือน LINE แล้ว");
      setStatus(await loadAlertStatus());
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onCheckLowBalanceNow() {
    setBusy(true);
    setMsg(null);
    onError(null);
    try {
      const fn = httpsCallable(getFirebaseFunctions(), "ownerLowBalanceLineCheck");
      const res = await fn({ force: true });
      const data = (res.data || {}) as { ok?: boolean; detail?: string };
      if (data.ok) {
        setMsg(data.detail || "ส่ง LINE ยอดต่ำแล้ว — เปิดแชท LINE ตรวจข้อความ");
      } else {
        onError(data.detail || "ยังไม่ส่ง LINE (ดูเหตุผลด้านบน)");
        setMsg(data.detail || null);
      }
      setStatus(await loadAlertStatus());
    } catch (err) {
      onError((err as Error).message || "ตรวจยอดต่ำไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onSendTest() {
    setBusy(true);
    setMsg(null);
    onError(null);
    try {
      const fn = httpsCallable(getFirebaseFunctions(), "ownerLineNotifyTest");
      const res = await fn({});
      const data = (res.data || {}) as { ok?: boolean; detail?: string };
      if (data.ok) {
        setMsg(data.detail || "ส่งข้อความทดสอบไป LINE แล้ว");
      } else {
        onError(data.detail || "ส่งทดสอบไม่สำเร็จ");
      }
    } catch (err) {
      onError((err as Error).message || "ส่งทดสอบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onSendDigestNow() {
    setBusy(true);
    setMsg(null);
    onError(null);
    try {
      const fn = httpsCallable(getFirebaseFunctions(), "ownerDailyDigestRunNow");
      const res = await fn({});
      const data = (res.data || {}) as { ok?: boolean; detail?: string };
      if (data.ok) {
        setMsg(data.detail || "ส่งสรุปไป LINE แล้ว");
      } else {
        onError(data.detail || "ส่งสรุปไม่สำเร็จ");
      }
    } catch (err) {
      onError((err as Error).message || "ส่งสรุปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function patchNotify<K extends keyof OwnerNotifySettings>(
    key: K,
    value: OwnerNotifySettings[K],
  ) {
    setNotify((prev) => ({ ...prev, [key]: value }));
  }

  const ready = lineReady({
    ...notify,
    channelAccessToken: tokenDirty
      ? tokenDraft.trim()
      : notify.channelAccessToken,
  });

  return (
    <SettingsFold
      title={
        <>
          <Bell size={18} aria-hidden />
          แจ้งเตือนเจ้าของ (LINE)
        </>
      }
      hint="ส่งเข้า LINE ส่วนตัวเท่านั้น — แจ้งทันทีตามเงื่อนไข + สรุปรายวัน"
      defaultOpen
      className="owner-notify-card"
    >
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <form className="owner-notify-form" onSubmit={(e) => void onSave(e)}>
          <h3 className="owner-notify-section">LINE ของคุณ</h3>
          <p className="muted owner-notify-help">
            ต้องมี LINE Official + Messaging API ก่อน แล้วใส่ 2 ค่าจาก{" "}
            <a
              href="https://developers.line.biz/console/"
              target="_blank"
              rel="noreferrer"
            >
              LINE Developers
            </a>
            : (1) Channel access token แบบยาวอายุ — วางทั้งก้อน (2){" "}
            <strong>User ID</strong> ของคุณ ขึ้นต้นด้วยตัว <strong>U</strong>{" "}
            ยาวๆ — <strong>ไม่ใช่ชื่อเล่น</strong> ใน LINE
          </p>
          <div className="field">
            <label htmlFor="owner-line-token">Channel access token</label>
            <input
              id="owner-line-token"
              name="telltea-line-channel-token"
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              inputMode="text"
              placeholder={
                notify.channelAccessToken
                  ? `บันทึกแล้ว (${maskSecret(notify.channelAccessToken)}) — วางใหม่ถ้าจะเปลี่ยน`
                  : "วาง Channel access token ทั้งก้อนที่นี่"
              }
              value={tokenDraft}
              onChange={(e) => {
                setTokenDraft(e.target.value);
                setTokenDirty(true);
              }}
            />
            <p className="field-hint">
              {notify.channelAccessToken && !tokenDirty
                ? "มี token ในระบบแล้ว — ว่างไว้ได้ถ้าไม่เปลี่ยน"
                : "ถ้าช่องมีจุดๆ จากเบราว์เซอร์ ให้ลบออกแล้ววาง token จริงจาก LINE Developers"}
            </p>
          </div>
          <div className="field">
            <label htmlFor="owner-line-uid">LINE User ID ของคุณ</label>
            <input
              id="owner-line-uid"
              name="telltea-line-user-id"
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="U ตามด้วยตัวอักษร 32 ตัว เช่น Ua1b2c3…"
              value={notify.lineUserId}
              onChange={(e) => patchNotify("lineUserId", e.target.value.trim())}
            />
            <p className="field-hint">
              ตัวอย่างถูก: <code>U1234abcd…</code> · ตัวอย่างผิด: ชื่อ{" "}
              <code>yohoken</code>
            </p>
          </div>
          <div className="btn-row" style={{ marginBottom: "0.5rem" }}>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !ready}
              onClick={() => void onSendTest()}
            >
              ส่งทดสอบ LINE
            </button>
          </div>

          <h3 className="owner-notify-section">1) แจ้งทันทีเมื่อเข้าเงื่อนไข → LINE</h3>
          <p className="muted owner-notify-help">
            เช่น ยอดเงินคงเหลือพนักงานต่ำกว่าที่กำหนด — ส่งเข้า LINE ทันที
            (ภายในช่วงเวลาที่ตั้งไว้ · กันส่งซ้ำทุก 3 ชม. ขณะยังต่ำอยู่)
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={notify.instantLineEnabled && lowEnabled}
              onChange={(e) => {
                const on = e.target.checked;
                setLowEnabled(on);
                patchNotify("instantLineEnabled", on);
              }}
            />
            <span>เปิดแจ้งยอดต่ำไป LINE ทันที</span>
          </label>
          <div className="field">
            <label htmlFor="owner-low-threshold">แจ้งเมื่อคงเหลือต่ำกว่า (บาท)</label>
            <input
              id="owner-low-threshold"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
              disabled={!lowEnabled || !notify.instantLineEnabled}
            />
            <p className="field-hint">ตัวอย่าง: {formatBaht(Number(threshold) || 0)}</p>
          </div>
          <div className="owner-notify-hour-row">
            <div className="field">
              <label htmlFor="owner-instant-start">เริ่มส่งได้ตั้งแต่</label>
              <select
                id="owner-instant-start"
                value={notify.instantHourStart}
                onChange={(e) =>
                  patchNotify("instantHourStart", Number(e.target.value))
                }
                disabled={!lowEnabled || !notify.instantLineEnabled}
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {formatHourLabel(h)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="owner-instant-end">ถึง (รวมชั่วโมงนี้)</label>
              <select
                id="owner-instant-end"
                value={notify.instantHourEnd}
                onChange={(e) => patchNotify("instantHourEnd", Number(e.target.value))}
                disabled={!lowEnabled || !notify.instantLineEnabled}
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {formatHourLabel(h)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="field-hint">
            ค่าเริ่ม {formatHourLabel(8)}–{formatHourLabel(21)} · นอกช่วงนี้จะรอส่งเมื่อเข้าช่วง
          </p>
          <div className="owner-notify-status">
            <p className="muted" style={{ margin: 0, textAlign: "left" }}>
              ยอดคงเหลือปัจจุบัน:{" "}
              <strong>
                {status?.balance == null ? "—" : formatBaht(status.balance)}
              </strong>
              {" · "}
              เกณฑ์ {formatBaht(Number(threshold) || 0)}
              {status?.balance != null &&
              Number(threshold) >= 0 &&
              status.balance < Number(threshold)
                ? " · ตอนนี้ต่ำกว่าเกณฑ์"
                : " · ยังไม่ต่ำกว่าเกณฑ์"}
            </p>
            {status?.lastLineOk === true ? (
              <p className="ok-text" style={{ margin: "0.35rem 0 0" }}>
                ส่ง LINE ยอดต่ำล่าสุดสำเร็จ
                {status.lastAttemptAt
                  ? ` · ${new Date(status.lastAttemptAt).toLocaleString("th-TH")}`
                  : ""}
              </p>
            ) : null}
            {status?.lastLineOk === false ? (
              <p className="error-text" style={{ margin: "0.35rem 0 0" }}>
                ส่ง LINE ล่าสุดไม่สำเร็จ
                {status.lastError ? `: ${status.lastError}` : ""}
              </p>
            ) : null}
            <p className="field-hint" style={{ marginTop: "0.45rem" }}>
              วิธีเช็ค: ให้ยอดบัญชีต่ำกว่าเกณฑ์ (บันทึกรายการจ่าย / ลบรายการโอนเข้า)
              แล้วกดปุ่มด้านล่าง — หรือกดเพื่อบังคับตรวจยอดปัจจุบันทันที
            </p>
            <div className="btn-row" style={{ marginTop: "0.35rem" }}>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy || !ready}
                onClick={() => void onCheckLowBalanceNow()}
              >
                ตรวจยอดต่ำ → ส่ง LINE ตอนนี้
              </button>
            </div>
          </div>

          <h3 className="owner-notify-section">2) สรุปรายวัน → LINE</h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={notify.dailyDigestEnabled}
              onChange={(e) => patchNotify("dailyDigestEnabled", e.target.checked)}
            />
            <span>เปิดสรุปรายวันไป LINE (ครั้งเดียวต่อวัน)</span>
          </label>
          <div className="field">
            <label htmlFor="owner-digest-hour">เวลาส่ง (Asia/Bangkok)</label>
            <select
              id="owner-digest-hour"
              value={notify.digestHour}
              onChange={(e) => patchNotify("digestHour", Number(e.target.value))}
              disabled={!notify.dailyDigestEnabled}
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {formatHourLabel(h)}
                </option>
              ))}
            </select>
            <p className="field-hint">แนะนำ 08:00</p>
          </div>

          <fieldset
            className="owner-notify-includes"
            disabled={!notify.dailyDigestEnabled}
          >
            <legend>รายการที่ให้ส่งในสรุปเช้า (ติ๊กแล้วกดบันทึก)</legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={notify.includeLowBalance}
                onChange={(e) => patchNotify("includeLowBalance", e.target.checked)}
              />
              <span>เงินคงเหลือพนักงาน / สถานะยอดต่ำ</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={notify.includeBillNotices}
                onChange={(e) => patchNotify("includeBillNotices", e.target.checked)}
              />
              <span>แจ้งบิลรอชำระ (ค่าไฟ ค่าน้ำ ฯลฯ)</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={notify.includeYesterdaySales}
                onChange={(e) =>
                  patchNotify("includeYesterdaySales", e.target.checked)
                }
              />
              <span>ยอดขายหน้าร้านวันก่อน</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={notify.includeMemberCount}
                onChange={(e) => patchNotify("includeMemberCount", e.target.checked)}
              />
              <span>จำนวนสมาชิกทั้งหมด</span>
            </label>
          </fieldset>

          <div className="btn-row" style={{ marginTop: "0.9rem" }}>
            <button type="submit" className="primary-btn" disabled={busy}>
              บันทึกตั้งค่า
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !ready || !notify.dailyDigestEnabled}
              onClick={() => void onSendDigestNow()}
            >
              ส่งสรุปตอนนี้
            </button>
          </div>

          {msg ? <p className="ok-text">{msg}</p> : null}
        </form>
      ) : null}
    </SettingsFold>
  );
}
