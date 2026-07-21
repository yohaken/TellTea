"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  DEFAULT_LEDGER_AI_SETTINGS,
  LEDGER_AI_MODELS,
  getLedgerAiSettings,
  maskApiKey,
  saveLedgerAiSettings,
  type LedgerAiSettings,
} from "@/lib/ai-settings";
import { classifyLedgerTypeWithAi, reclassifyLedgerMonthWithAi } from "@/lib/ledger-ai";
import type { ReclassifyMonthProgress } from "@/lib/ledger-ai";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";

/** เดือนที่เปิดให้จัดประเภทย้อนหลังด้วย AI (ตามที่เจ้าของขอ) */
const BACKFILL_YEAR = 2026;
const BACKFILL_MONTH = 7;

type Props = {
  actorId: string;
};

/** แผงตั้งค่า AI เล็กๆ ในสมุดบัญชี — เฉพาะเจ้าของ */
export function LedgerAiSettingsPanel({ actorId }: Props) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<LedgerAiSettings>({
    ...DEFAULT_LEDGER_AI_SETTINGS,
  });
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<ReclassifyMonthProgress | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getLedgerAiSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr((e as Error).message || "โหลดตั้งค่า AI ไม่สำเร็จ");
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const nextKey = apiKeyDraft.trim() || settings.apiKey;
      await saveLedgerAiSettings(
        {
          enabled: settings.enabled,
          model: settings.model,
          apiKey: nextKey,
        },
        actorId,
      );
      setSettings((prev) => ({ ...prev, apiKey: nextKey }));
      setApiKeyDraft("");
      setMsg("บันทึกตั้งค่า AI แล้ว");
    } catch (e) {
      setErr((e as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setMsg(null);
    setErr(null);
    try {
      const result = await classifyLedgerTypeWithAi("ค่าเครื่องดื่ม");
      setMsg(`ทดสอบ OK → ${result.type}${result.reason ? ` (${result.reason})` : ""}`);
    } catch (e) {
      setErr((e as Error).message || "ทดสอบไม่สำเร็จ");
    } finally {
      setTesting(false);
    }
  }

  async function onBackfillJuly() {
    const ok = window.confirm(
      `จัดประเภทเงินออกใหม่ด้วย AI ทั้งเดือน ก.ค. ${BACKFILL_YEAR}?\n\n` +
        "ข้ามรายการที่คุณล็อกประเภทเองไว้ · อาจใช้เวลาสักครู่",
    );
    if (!ok) return;
    setBackfilling(true);
    setMsg(null);
    setErr(null);
    setBackfillProgress(null);
    try {
      const result = await reclassifyLedgerMonthWithAi(BACKFILL_YEAR, BACKFILL_MONTH, {
        onProgress: setBackfillProgress,
      });
      setMsg(
        `ก.ค. ${BACKFILL_YEAR} เสร็จ — อัปเดต ${result.updated} · เหมือนเดิม ${result.unchanged} · ` +
          `ข้ามเจ้าของ ${result.skippedOwner} · ล้มเหลว ${result.failed}`,
      );
    } catch (e) {
      setErr((e as Error).message || "จัดประเภทย้อนหลังไม่สำเร็จ");
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <aside className="ledger-ai-settings" aria-label="ตั้งค่าจัดประเภทด้วย AI">
      <button
        type="button"
        className="ledger-ai-settings-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ledger-ai-settings-toggle-left">
          <Sparkles size={15} aria-hidden />
          ตั้งค่า AI จัดประเภทบัญชี
        </span>
        {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
      </button>

      {open ? (
        <form className="ledger-ai-settings-body" onSubmit={(e) => void onSave(e)}>
          <p className="muted ledger-ai-settings-hint">
            พนักงานเห็นเฉพาะผล AI — แก้ประเภทได้เฉพาะคุณ · คีย์เก็บฝั่งเซิร์ฟเวอร์
            · บริบทร้านแก้ได้ที่ อื่นๆ → ตั้งค่าโมดูล → โปรไฟล์กิจการ
          </p>

          <label className="ledger-ai-check">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, enabled: e.target.checked }))
              }
            />
            เปิดจัดประเภทด้วย AI
          </label>

          <div className="field">
            <label htmlFor="ledger-ai-model">โมเดล</label>
            <select
              id="ledger-ai-model"
              value={settings.model}
              onChange={(e) => setSettings((prev) => ({ ...prev, model: e.target.value }))}
            >
              {LEDGER_AI_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
              {!LEDGER_AI_MODELS.some((m) => m.value === settings.model) && settings.model ? (
                <option value={settings.model}>{settings.model}</option>
              ) : null}
            </select>
          </div>

          <div className="field">
            <label htmlFor="ledger-ai-key">Gemini API key</label>
            <input
              id="ledger-ai-key"
              type="password"
              autoComplete="off"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder={
                loaded && settings.apiKey
                  ? `มีคีย์แล้ว (${maskApiKey(settings.apiKey)}) — วางใหม่เพื่อเปลี่ยน`
                  : "วาง API key (ถ้ายังไม่ใส่ในเซิร์ฟเวอร์)"
              }
            />
          </div>

          <div className="ledger-ai-settings-actions">
            <button type="submit" className="primary-btn" disabled={busy || !loaded || backfilling}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={testing || !loaded || backfilling}
              onClick={() => void onTest()}
            >
              {testing ? "กำลังทดสอบ..." : "ทดสอบ AI"}
            </button>
          </div>

          <div className="ledger-ai-backfill">
            <p className="muted ledger-ai-settings-hint">
              รายการเก่าก่อนมี AI อาจติดประเภทผิด (เช่น 「ค่าเครื่องดื่ม」→ สินทรัพย์ จากกฎคำว่า「เครื่อง」)
              — จัดใหม่เฉพาะ ก.ค. {BACKFILL_YEAR}
            </p>
            <button
              type="button"
              className="ghost-btn"
              disabled={!loaded || backfilling || testing || busy}
              onClick={() => void onBackfillJuly()}
            >
              {backfilling
                ? `กำลังจัด ก.ค.… ${backfillProgress ? `${backfillProgress.done}/${backfillProgress.total}` : ""}`
                : `จัดประเภทใหม่ด้วย AI — ก.ค. ${BACKFILL_YEAR}`}
            </button>
            {backfilling && backfillProgress?.currentDescription ? (
              <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", textAlign: "left" }}>
                {backfillProgress.currentDescription}
              </p>
            ) : null}
          </div>

          {msg ? <p className="ledger-ai-settings-msg">{msg}</p> : null}
          {err ? <p className="error-text">{err}</p> : null}
        </form>
      ) : null}
    </aside>
  );
}
