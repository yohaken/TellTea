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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);

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
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
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
            : Channel access token (ยาวอายุ) และ User ID ของคุณ (ขึ้นต้น U…)
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
