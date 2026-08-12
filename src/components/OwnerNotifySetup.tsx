"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Bell } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { SettingsFold } from "@/components/SettingsFold";
import { useAuth } from "@/lib/auth";
import { getFirebaseFunctions } from "@/lib/firebase";
import {
  DEFAULT_ALERT_SETTINGS,
  getAlertSettings,
  saveAlertSettings,
} from "@/lib/settings";
import {
  DEFAULT_OWNER_NOTIFY,
  getOwnerNotifySettings,
  lineReady,
  maskSecret,
  saveOwnerNotifySettings,
  type OwnerNotifySettings,
} from "@/lib/owner-notify";
import {
  disableOwnerPush,
  enableOwnerPush,
  pushSupported,
} from "@/lib/push";
import { formatBaht } from "@/lib/utils";

type Props = {
  onError: (msg: string | null) => void;
};

/** ตั้งค่าแจ้งเตือนเจ้าของ: ยอดต่ำ · LINE สรุปรายวัน · Web Push */
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
  const [pushStatus, setPushStatus] = useState("ยังไม่เปิดบนเครื่องนี้");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [alerts, line] = await Promise.all([
          getAlertSettings(),
          getOwnerNotifySettings(),
        ]);
        if (cancelled) return;
        setThreshold(String(alerts.lowBalanceThreshold));
        setLowEnabled(alerts.lowBalanceEnabled);
        setNotify(line);
        setTokenDraft("");
        setTokenDirty(false);
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

  useEffect(() => {
    if (!pushSupported()) {
      setPushStatus("อุปกรณ์นี้ไม่รองรับ (ลอง Chrome / Safari แล้วเพิ่มหน้าจอโฮม)");
      return;
    }
    if (Notification.permission === "granted") {
      setPushStatus("อนุญาตแจ้งเตือนแล้ว — กดปุ่มด้านล่างเพื่อผูกเครื่องนี้");
    } else if (Notification.permission === "denied") {
      setPushStatus("ถูกบล็อก — เปิดอนุญาตแจ้งเตือนในการตั้งค่าเบราว์เซอร์");
    }
  }, []);

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
          dailyDigestEnabled: notify.dailyDigestEnabled,
          digestHour: notify.digestHour,
          includeLowBalance: notify.includeLowBalance,
          includeBillNotices: notify.includeBillNotices,
          includeYesterdaySales: notify.includeYesterdaySales,
          includeMemberCount: notify.includeMemberCount,
          webPushOnDigest: notify.webPushOnDigest,
        },
        actor,
      );
      const refreshed = await getOwnerNotifySettings();
      setNotify(refreshed);
      setTokenDraft("");
      setTokenDirty(false);
      setMsg("บันทึกตั้งค่าแจ้งเตือนแล้ว");
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onEnablePush() {
    if (!user?.email) return;
    setBusy(true);
    setMsg(null);
    onError(null);
    try {
      const result = await enableOwnerPush(user.email);
      if (result === "granted") {
        setPushStatus("เปิดแจ้งเตือนถึงมือถือเครื่องนี้แล้ว");
        setMsg("เมื่อยอดต่ำหรือสรุปรายวัน ระบบจะเด้งแจ้งเตือนได้แม้ปิดแอป");
      } else if (result === "denied") {
        setPushStatus("ยังไม่อนุญาตแจ้งเตือน");
        onError("กรุณาอนุญาตการแจ้งเตือนของเบราว์เซอร์");
      } else {
        setPushStatus("อุปกรณ์ไม่รองรับ");
      }
    } catch (err) {
      onError((err as Error).message || "เปิดแจ้งเตือนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onDisablePush() {
    setBusy(true);
    try {
      await disableOwnerPush();
      setPushStatus("ปิดแจ้งเตือนบนเครื่องนี้แล้ว");
      setMsg(null);
    } catch (err) {
      onError((err as Error).message || "ปิดไม่สำเร็จ");
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
          แจ้งเตือนเจ้าของ (LINE + ยอดต่ำ)
        </>
      }
      hint="สรุปรายวันช่วงเช้าทาง LINE · เกณฑ์เงินคงเหลือพนักงาน · Web Push"
      defaultOpen={false}
      className="owner-notify-card"
    >
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <form className="owner-notify-form" onSubmit={(e) => void onSave(e)}>
          <h3 className="owner-notify-section">เงินคงเหลือขั้นต่ำ</h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={lowEnabled}
              onChange={(e) => setLowEnabled(e.target.checked)}
            />
            <span>เปิดแจ้งเตือนยอดต่ำ (ป็อปอัป + Web Push เมื่อยอดเปลี่ยน)</span>
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
            />
            <p className="field-hint">
              ตัวอย่าง: {formatBaht(Number(threshold) || 0)} — ค่านี้เคยอยู่ในหน้า
              /alerts/ ที่ถูกลบไป ย้ายมาที่นี่แล้ว
            </p>
          </div>

          <h3 className="owner-notify-section">สรุปรายวันทาง LINE (เช้า ครั้งเดียว)</h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={notify.dailyDigestEnabled}
              onChange={(e) => patchNotify("dailyDigestEnabled", e.target.checked)}
            />
            <span>เปิดสรุปรายวันไป LINE ส่วนตัว</span>
          </label>
          <div className="field">
            <label htmlFor="owner-digest-hour">เวลาส่ง (Asia/Bangkok)</label>
            <select
              id="owner-digest-hour"
              value={notify.digestHour}
              onChange={(e) => patchNotify("digestHour", Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            <p className="field-hint">แนะนำ 08:00 — ส่งครั้งเดียวต่อวัน</p>
          </div>

          <fieldset className="owner-notify-includes">
            <legend>รวมในข้อความเช้า</legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={notify.includeLowBalance}
                onChange={(e) => patchNotify("includeLowBalance", e.target.checked)}
              />
              <span>เงินคงเหลือพนักงาน / เตือนยอดต่ำ</span>
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
            <label className="check-row">
              <input
                type="checkbox"
                checked={notify.webPushOnDigest}
                onChange={(e) => patchNotify("webPushOnDigest", e.target.checked)}
              />
              <span>ส่ง Web Push คู่กับ LINE ด้วย</span>
            </label>
          </fieldset>

          <h3 className="owner-notify-section">ข้อมูล LINE Messaging API</h3>
          <p className="muted owner-notify-help">
            ใช้ได้ง่ายด้วย 2 ค่าจาก{" "}
            <a
              href="https://developers.line.biz/console/"
              target="_blank"
              rel="noreferrer"
            >
              LINE Developers
            </a>
            : (1) Channel access token แบบยาวอายุ จาก Messaging API channel
            (2) User ID ของคุณ (ขึ้นต้น U…) — เพิ่มเพื่อนบัญชี OA แล้วดูจาก Webhook
            event หรือเครื่องมือหา User ID · LINE Notify เลิกใช้แล้ว
          </p>
          <div className="field">
            <label htmlFor="owner-line-token">Channel access token</label>
            <input
              id="owner-line-token"
              type="password"
              autoComplete="off"
              placeholder={
                notify.channelAccessToken
                  ? `บันทึกแล้ว (${maskSecret(notify.channelAccessToken)}) — วางใหม่ถ้าจะเปลี่ยน`
                  : "วาง Channel access token"
              }
              value={tokenDraft}
              onChange={(e) => {
                setTokenDraft(e.target.value);
                setTokenDirty(true);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="owner-line-uid">LINE User ID ของคุณ</label>
            <input
              id="owner-line-uid"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Uxxxxxxxx…"
              value={notify.lineUserId}
              onChange={(e) => patchNotify("lineUserId", e.target.value.trim())}
            />
          </div>

          <div className="btn-row" style={{ marginTop: "0.75rem" }}>
            <button type="submit" className="primary-btn" disabled={busy}>
              บันทึกตั้งค่า
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !ready}
              onClick={() => void onSendTest()}
            >
              ส่งทดสอบ LINE
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !ready}
              onClick={() => void onSendDigestNow()}
            >
              ส่งสรุปตอนนี้
            </button>
          </div>

          <h3 className="owner-notify-section">Web Push บนเครื่องนี้</h3>
          <p className="muted" style={{ textAlign: "left", marginBottom: "0.75rem" }}>
            {pushStatus}
          </p>
          <p
            className="muted"
            style={{ textAlign: "left", marginBottom: "0.75rem", fontSize: "0.85rem" }}
          >
            บน iPhone: เปิดใน Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม แล้วค่อยกดเปิดแจ้งเตือน
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={() => void onEnablePush()}
            >
              เปิดแจ้งเตือนบนเครื่องนี้
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => void onDisablePush()}
            >
              ปิดเครื่องนี้
            </button>
          </div>

          {msg ? <p className="ok-text">{msg}</p> : null}
        </form>
      ) : null}
    </SettingsFold>
  );
}
